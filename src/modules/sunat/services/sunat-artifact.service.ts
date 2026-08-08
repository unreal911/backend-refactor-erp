import { createHash } from "node:crypto";
import {
    Prisma,
    SunatArtifactOwnerType,
    SunatArtifactType,
} from "@prisma/client";
import { tenantPrisma } from "../../../data/tenant-prisma";
import { CustomError } from "../../../domain/errors/custom.error";
import { TenantQuotaService } from "../../lifecycle/tenant-lifecycle.service";
import { TenantDataContext } from "../../tenant/tenant-data-context";
import { createSunatInfrastructure, SunatInfrastructure } from "../infrastructure/sunat-infrastructure.factory";
import { isSunatDocumentStorageEnabled } from "../infrastructure/sunat-infrastructure.config";
import { DocumentStorage } from "../infrastructure/ports/document-storage.port";
import { DocumentRetention } from "../infrastructure/ports/document-retention.port";

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

type ArtifactOwner =
    | { ownerType: "COMPROBANTE"; ownerId: number }
    | { ownerType: "DISPATCH"; ownerId: number }
    | { ownerType: "RESUMEN"; ownerId: number }
    | { ownerType: "BAJA"; ownerId: number };

export type StoreSunatArtifactInput = ArtifactOwner & {
    logicalKey: string;
    type: SunatArtifactType;
    fileName: string;
    body: Buffer;
    mimeType: string;
    logicalVersion?: number;
    retentionUntil?: Date | null;
};

function digest(body: Buffer): string {
    return createHash("sha256").update(body).digest("hex");
}

function safeSegment(value: string, label: string): string {
    const normalized = String(value || "").trim();
    if (!SAFE_NAME.test(normalized) || normalized === "." || normalized === "..") {
        throw CustomError.badRequest(`${label} no es seguro para almacenamiento`);
    }
    return normalized;
}

function sanitizeSoapXml(value: string): string {
    return String(value || "")
        .replace(/<(?:wsse:)?Password\b[^>]*>[\s\S]*?<\/(?:wsse:)?Password>/gi, "<Password>[REDACTED]</Password>")
        .replace(/<(?:wsse:)?UsernameToken\b[^>]*>[\s\S]*?<\/(?:wsse:)?UsernameToken>/gi, "<UsernameToken>[REDACTED]</UsernameToken>")
        .replace(/<password\b[^>]*>[\s\S]*?<\/password>/gi, "<password>[REDACTED]</password>");
}

export function isLegacyArtifactFallbackEnabled(
    source: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
    const value = String(source.SUNAT_LEGACY_BASE64_FALLBACK_ENABLED ?? "true")
        .trim()
        .toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    throw new Error("SUNAT_LEGACY_BASE64_FALLBACK_ENABLED no es booleano");
}

function ownerData(input: ArtifactOwner) {
    switch (input.ownerType) {
        case "COMPROBANTE": return { comprobanteId: input.ownerId };
        case "DISPATCH": return { dispatchId: input.ownerId };
        case "RESUMEN": return { resumenDiarioId: input.ownerId };
        case "BAJA": return { comunicacionBajaId: input.ownerId };
    }
}

export class SunatArtifactService {
    constructor(
        private readonly storage: DocumentStorage,
        private readonly retention: DocumentRetention | null = null,
    ) {}

    private relativeKey(objectKey: string, tenantId: string): string {
        const prefix = `tenants/${tenantId}/`;
        if (!objectKey.startsWith(prefix)) {
            throw CustomError.internal("La referencia del artefacto no pertenece al tenant");
        }
        return objectKey.slice(prefix.length);
    }

    private async existingBytes(artifact: {
        objectKey: string;
        sha256: string;
    }, tenantId: string): Promise<Buffer> {
        return this.storage.get({
            tenantId,
            relativeKey: this.relativeKey(artifact.objectKey, tenantId),
            expectedSha256: artifact.sha256,
        });
    }

    async store(input: StoreSunatArtifactInput) {
        const tenantId = TenantDataContext.requireTenantId();
        if (!Buffer.isBuffer(input.body) || input.body.length === 0) {
            throw CustomError.badRequest("El artefacto SUNAT está vacío");
        }
        const logicalKey = safeSegment(input.logicalKey.replaceAll(":", "-"), "logicalKey");
        const fileName = safeSegment(input.fileName, "fileName");
        const logicalVersion = input.logicalVersion ?? 1;
        if (!Number.isInteger(logicalVersion) || logicalVersion < 1) {
            throw CustomError.badRequest("La versión lógica no es válida");
        }
        const expectedSha256 = digest(input.body);
        const existing = await tenantPrisma.sunatArtifact.findUnique({
            where: {
                tenantId_logicalKey_type_logicalVersion: {
                    tenantId,
                    logicalKey,
                    type: input.type,
                    logicalVersion,
                },
            },
        });
        if (existing) {
            if (existing.sha256 !== expectedSha256) {
                throw new CustomError("La misma version logica ya existe con otros bytes", 409);
            }
            const existingRelativeKey = this.relativeKey(existing.objectKey, tenantId);
            const headed = await this.storage.head({
                tenantId,
                relativeKey: existingRelativeKey,
            });
            if (!headed) {
                // PostgreSQL y S3 se restauran por mecanismos separados. Si el
                // payload heredado aun existe, rehidratamos la clave registrada
                // sin duplicar la fila de metadatos.
                const restored = await this.storage.put({
                    tenantId,
                    relativeKey: existingRelativeKey,
                    body: input.body,
                    contentType: input.mimeType,
                    expectedSha256,
                    metadata: {
                        artifactType: input.type,
                        ownerType: input.ownerType,
                        logicalVersion: String(logicalVersion),
                    },
                });
                const restoredHead = await this.storage.head({ tenantId, relativeKey: existingRelativeKey });
                if (
                    !restoredHead
                    || restoredHead.sha256 !== expectedSha256
                    || restoredHead.byteSize !== input.body.length
                ) {
                    throw CustomError.internal("El artefacto restaurado no supero la verificacion de integridad");
                }
                return tenantPrisma.sunatArtifact.update({
                    where: { id: existing.id },
                    data: {
                        bucket: restored.bucket,
                        objectVersion: restored.versionId ?? null,
                        sizeBytes: BigInt(input.body.length),
                        mimeType: input.mimeType,
                        storageStatus: "VERIFIED",
                        verifiedAt: new Date(),
                    },
                });
            }
            const bytes = await this.existingBytes(existing, tenantId);
            if (!bytes.equals(input.body)) {
                throw new CustomError("La misma versión lógica ya existe con otros bytes", 409);
            }
            return existing;
        }

        await TenantQuotaService.assertAvailable("storage", input.body.length);
        const date = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
        // Content-addressed: una carrera con bytes distintos no sobrescribe el
        // objeto que termino asociado a la version logica ganadora.
        const relativeKey = `${date}/${input.ownerType.toLowerCase()}/${logicalKey}/v${logicalVersion}/${expectedSha256}-${fileName}`;
        const stored = await this.storage.put({
            tenantId,
            relativeKey,
            body: input.body,
            contentType: input.mimeType,
            expectedSha256,
            metadata: {
                artifactType: input.type,
                ownerType: input.ownerType,
                logicalVersion: String(logicalVersion),
            },
        });
        const headed = await this.storage.head({ tenantId, relativeKey });
        if (
            !headed
            || headed.sha256 !== expectedSha256
            || headed.byteSize !== input.body.length
        ) {
            throw CustomError.internal("El artefacto almacenado no superó la verificación de integridad");
        }

        try {
            return await tenantPrisma.sunatArtifact.create({
                data: {
                    tenantId,
                    ownerType: input.ownerType as SunatArtifactOwnerType,
                    logicalKey,
                    type: input.type,
                    logicalVersion,
                    bucket: stored.bucket,
                    objectKey: stored.objectKey,
                    objectVersion: stored.versionId ?? null,
                    sha256: expectedSha256,
                    sizeBytes: BigInt(input.body.length),
                    mimeType: input.mimeType,
                    storageStatus: "VERIFIED",
                    verifiedAt: new Date(),
                    retentionUntil: input.retentionUntil ?? null,
                    ...ownerData(input),
                },
            });
        } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
                const raced = await tenantPrisma.sunatArtifact.findUnique({
                    where: {
                        tenantId_logicalKey_type_logicalVersion: {
                            tenantId,
                            logicalKey,
                            type: input.type,
                            logicalVersion,
                        },
                    },
                });
                if (raced && raced.sha256 === expectedSha256) return raced;
            }
            throw caught;
        }
    }

    storeSoap(input: ArtifactOwner & {
        logicalKey: string;
        fileName: string;
        xml: string;
        logicalVersion?: number;
    }) {
        return this.store({
            ...input,
            type: "SOAP_RESPONSE",
            body: Buffer.from(sanitizeSoapXml(input.xml), "utf8"),
            mimeType: "application/xml",
        });
    }

    async readWithLegacyFallback(input: {
        artifactId?: string | null;
        legacyBase64?: string | null;
        metricName: string;
    }): Promise<{ bytes: Buffer; source: "artifact" | "legacy" }> {
        const tenantId = TenantDataContext.requireTenantId();
        if (input.artifactId) {
            const artifact = await tenantPrisma.sunatArtifact.findUnique({
                where: { id: input.artifactId },
            });
            if (!artifact) throw CustomError.notFound("Artefacto SUNAT no encontrado");
            return {
                bytes: await this.existingBytes(artifact, tenantId),
                source: "artifact",
            };
        }
        if (!input.legacyBase64) {
            throw CustomError.notFound("No existe evidencia documental disponible");
        }
        if (!isLegacyArtifactFallbackEnabled()) {
            throw CustomError.notFound("El fallback documental heredado esta desactivado");
        }
        console.warn(`[sunat-artifact-fallback] metric=${safeSegment(input.metricName, "metricName")} tenant=${tenantId}`);
        return { bytes: Buffer.from(input.legacyBase64, "base64"), source: "legacy" };
    }

    async listForComprobante(comprobanteId: number) {
        const artifacts = await tenantPrisma.sunatArtifact.findMany({
            where: {
                OR: [
                    { comprobanteId },
                    { dispatch: { comprobanteId } },
                ],
                storageStatus: { not: "DELETED" },
            },
            orderBy: [{ createdAt: "asc" }, { type: "asc" }],
        });
        return artifacts.map((artifact) => ({
            id: artifact.id,
            ownerType: artifact.ownerType,
            type: artifact.type,
            logicalVersion: artifact.logicalVersion,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes.toString(),
            mimeType: artifact.mimeType,
            storageStatus: artifact.storageStatus,
            verifiedAt: artifact.verifiedAt,
            createdAt: artifact.createdAt,
        }));
    }

    async createDownloadUrl(artifactId: string, expiresInSeconds = 300) {
        const tenantId = TenantDataContext.requireTenantId();
        const artifact = await tenantPrisma.sunatArtifact.findUnique({
            where: { id: artifactId },
        });
        if (!artifact || artifact.storageStatus === "DELETED") {
            throw CustomError.notFound("Artefacto SUNAT no encontrado");
        }
        const extension = artifact.mimeType.includes("zip") ? "zip"
            : artifact.mimeType.includes("pdf") ? "pdf" : "xml";
        return this.storage.createDownloadUrl({
            tenantId,
            relativeKey: this.relativeKey(artifact.objectKey, tenantId),
            expiresInSeconds,
            responseContentType: artifact.mimeType,
            responseContentDisposition: `attachment; filename="sunat-${artifact.type.toLowerCase()}.${extension}"`,
        });
    }

    async deleteAllForCurrentTenant(): Promise<number> {
        const tenantId = TenantDataContext.requireTenantId();
        const artifacts = await tenantPrisma.sunatArtifact.findMany({
            where: { storageStatus: { not: "DELETED" } },
            orderBy: { createdAt: "asc" },
        });
        if (artifacts.length > 0 && !this.retention) {
            throw new Error("La purga requiere el puerto interno de retención documental");
        }
        let deleted = 0;
        for (const artifact of artifacts) {
            await this.retention!.delete({
                tenantId,
                relativeKey: this.relativeKey(artifact.objectKey, tenantId),
            });
            await tenantPrisma.sunatArtifact.update({
                where: { id: artifact.id },
                data: { storageStatus: "DELETED" },
            });
            deleted += 1;
        }
        return deleted;
    }
}

let sharedInfrastructure: SunatInfrastructure | null = null;
let sharedService: SunatArtifactService | null = null;

export function getSunatArtifactServiceFromEnvironment(): SunatArtifactService | null {
    if (!isSunatDocumentStorageEnabled()) return null;
    if (!sharedService) {
        sharedInfrastructure = createSunatInfrastructure();
        sharedService = new SunatArtifactService(
            sharedInfrastructure.documentStorage,
            sharedInfrastructure.documentRetention,
        );
    }
    return sharedService;
}

export function destroySharedSunatArtifactInfrastructure(): void {
    sharedInfrastructure?.destroy();
    sharedInfrastructure = null;
    sharedService = null;
}
