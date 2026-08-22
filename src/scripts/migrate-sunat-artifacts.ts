import { createHash, randomUUID } from "node:crypto";
import { platformPrisma } from "../data/platform-prisma";
import { runTenantDatabaseTransaction } from "../data/prisma";
import { tenantPrisma } from "../data/tenant-prisma";
import {
    destroySharedSunatArtifactInfrastructure,
    getSunatArtifactServiceFromEnvironment,
} from "../modules/sunat/services/sunat-artifact.service";
import { ZipService } from "../modules/sunat/zip/zip.service";
import { operationalLog } from "../presentation/observability/operational-logger";

type SourceType = "DISPATCH" | "RESUMEN" | "BAJA";
type LegacyRow = {
    id: number;
    fileName: string;
    xmlBase64: string | null;
    cdrZipBase64: string | null;
    rawResponseXml: string | null;
};

function argument(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function positiveInteger(name: string, fallback: number): number {
    const raw = argument(name);
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} requiere un entero positivo`);
    return value;
}

function tenantArgument(): string {
    const value = argument("--tenant") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error("--tenant requiere un UUID válido");
    }
    return value;
}

function safeBaseName(fileName: string, source: SourceType, id: number): string {
    const normalized = String(fileName || "")
        .replace(/\.zip$/i, "")
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 120);
    return normalized || `${source.toLowerCase()}-${id}`;
}

function sha256(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

async function readBatch(source: SourceType, afterId: number, take: number): Promise<LegacyRow[]> {
    const where = {
        id: { gt: afterId },
        OR: [
            { xmlBase64: { not: null } },
            { cdrZipBase64: { not: null } },
            { rawResponseXml: { not: null } },
        ],
    };
    const select = {
        id: true,
        fileName: true,
        xmlBase64: true,
        cdrZipBase64: true,
        rawResponseXml: true,
    } as const;
    if (source === "DISPATCH") {
        return tenantPrisma.sunatDispatch.findMany({ where, select, orderBy: { id: "asc" }, take });
    }
    if (source === "RESUMEN") {
        return tenantPrisma.resumenDiario.findMany({ where, select, orderBy: { id: "asc" }, take });
    }
    return tenantPrisma.comunicacionBaja.findMany({ where, select, orderBy: { id: "asc" }, take });
}

async function migrateRow(source: SourceType, row: LegacyRow): Promise<number> {
    const service = getSunatArtifactServiceFromEnvironment();
    if (!service) throw new Error("Activa SUNAT_DOCUMENT_STORAGE_ENABLED=true");
    const owner = source === "DISPATCH"
        ? { ownerType: "DISPATCH" as const, ownerId: row.id }
        : source === "RESUMEN"
            ? { ownerType: "RESUMEN" as const, ownerId: row.id }
            : { ownerType: "BAJA" as const, ownerId: row.id };
    const logicalKey = `legacy-${source.toLowerCase()}-${row.id}`;
    const fileBase = safeBaseName(row.fileName, source, row.id);
    let count = 0;
    if (row.xmlBase64) {
        const body = Buffer.from(row.xmlBase64, "base64");
        await service.store({
            ...owner,
            logicalKey,
            type: "SIGNED_XML",
            fileName: `${fileBase}-signed.xml`,
            body,
            mimeType: "application/xml",
        });
        count += 1;
    }
    if (row.cdrZipBase64) {
        const cdrZip = Buffer.from(row.cdrZipBase64, "base64");
        await service.store({
            ...owner,
            logicalKey,
            type: "CDR_ZIP",
            fileName: `${fileBase}-cdr.zip`,
            body: cdrZip,
            mimeType: "application/zip",
        });
        const cdrXml = await new ZipService().getFirstXmlFromZip(cdrZip);
        await service.store({
            ...owner,
            logicalKey,
            type: "CDR_XML",
            fileName: `${fileBase}-cdr.xml`,
            body: Buffer.from(cdrXml, "utf8"),
            mimeType: "application/xml",
        });
        count += 2;
    }
    if (row.rawResponseXml?.trim()) {
        await service.storeSoap({
            ...owner,
            logicalKey,
            fileName: `${fileBase}-soap-response.xml`,
            xml: row.rawResponseXml,
        });
        count += 1;
    }
    return count;
}

async function verifyAndClearRow(source: SourceType, row: LegacyRow): Promise<number> {
    const service = getSunatArtifactServiceFromEnvironment();
    if (!service) throw new Error("Activa SUNAT_DOCUMENT_STORAGE_ENABLED=true");
    const logicalKey = `legacy-${source.toLowerCase()}-${row.id}`;
    const artifacts = await tenantPrisma.sunatArtifact.findMany({
        where: { logicalKey, storageStatus: "VERIFIED" },
    });
    const byType = new Map(artifacts.map((item) => [item.type, item]));
    const expected: Array<{ type: "SIGNED_XML" | "CDR_ZIP" | "SOAP_RESPONSE"; value: Buffer }> = [];
    if (row.xmlBase64) expected.push({ type: "SIGNED_XML", value: Buffer.from(row.xmlBase64, "base64") });
    if (row.cdrZipBase64) expected.push({ type: "CDR_ZIP", value: Buffer.from(row.cdrZipBase64, "base64") });
    if (row.rawResponseXml?.trim()) {
        const soap = byType.get("SOAP_RESPONSE");
        if (!soap) throw new Error(`${source}:${row.id}: falta SOAP_RESPONSE verificado`);
        await service.readWithLegacyFallback({ artifactId: soap.id, metricName: "cutover-verify" });
    }
    for (const item of expected) {
        const artifact = byType.get(item.type);
        if (!artifact) throw new Error(`${source}:${row.id}: falta ${item.type} verificado`);
        const read = await service.readWithLegacyFallback({ artifactId: artifact.id, metricName: "cutover-verify" });
        if (sha256(read.bytes) !== sha256(item.value)) {
            throw new Error(`${source}:${row.id}: hash ${item.type} no coincide`);
        }
    }
    const data = { xmlBase64: null, cdrZipBase64: null, rawResponseXml: null };
    if (source === "DISPATCH") await tenantPrisma.sunatDispatch.update({ where: { id: row.id }, data });
    else if (source === "RESUMEN") await tenantPrisma.resumenDiario.update({ where: { id: row.id }, data });
    else await tenantPrisma.comunicacionBaja.update({ where: { id: row.id }, data });
    return expected.length + (row.rawResponseXml?.trim() ? 1 : 0);
}

async function main(): Promise<void> {
    const tenantId = tenantArgument();
    const source = String(argument("--source") ?? "DISPATCH").toUpperCase() as SourceType;
    if (!["DISPATCH", "RESUMEN", "BAJA"].includes(source)) throw new Error("--source debe ser DISPATCH, RESUMEN o BAJA");
    const take = Math.min(500, positiveInteger("--batch", 50));
    const afterId = Math.max(0, Number(argument("--after-id") ?? 0));
    if (!Number.isInteger(afterId)) throw new Error("--after-id debe ser entero");
    const finalize = process.argv.includes("--finalize");
    const backupId = argument("--backup-id") ?? "";
    if (finalize && (process.env.SUNAT_ARTIFACT_CUTOVER_APPROVED !== "true" || backupId.length < 8)) {
        throw new Error("Finalizar exige SUNAT_ARTIFACT_CUTOVER_APPROVED=true y --backup-id verificable");
    }
    const idempotencyKey = `artifact-${finalize ? "finalize" : "migrate"}:${source}:${afterId}:${take}`;
    const job = await platformPrisma.sunatJob.upsert({
        where: { tenantId_type_idempotencyKey: { tenantId, type: "MIGRATE_ARTIFACTS", idempotencyKey } },
        create: {
            tenantId,
            type: "MIGRATE_ARTIFACTS",
            idempotencyKey,
            correlationId: randomUUID(),
            payload: { tenantId, source, afterId, take, finalize, ...(finalize ? { backupId } : {}) },
            status: "RUNNING",
            attempts: 1,
            lockedAt: new Date(),
            lockedBy: "migration-cli",
        },
        update: {
            status: "RUNNING",
            // El checkpoint MIG-012 conserva los reintentos globales. Este job
            // representa la ejecucion CLI actual y no debe desbordar el check
            // attempts <= maxAttempts tras varias reanudaciones idempotentes.
            attempts: 1,
            completedAt: null,
            lastErrorCode: null,
            lastErrorSafe: null,
            lockedAt: new Date(),
            lockedBy: "migration-cli",
        },
    });
    const failures: Array<{ source: SourceType; id: number; code: string }> = [];
    let artifacts = 0;
    let rows: LegacyRow[] = [];
    await runTenantDatabaseTransaction(tenantId, async () => {
        rows = await readBatch(source, afterId, take);
        for (const row of rows) {
            try {
                artifacts += finalize
                    ? await verifyAndClearRow(source, row)
                    : await migrateRow(source, row);
            } catch (caught) {
                const code = String((caught as { code?: unknown })?.code ?? "ARTIFACT_MIGRATION_ERROR")
                    .replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
                operationalLog("error", "sunat.artifact_migration.row_failed", {
                    tenantId,
                    source,
                    rowId: row.id,
                    correlationId: job.correlationId,
                    idempotencyKey,
                    error: caught instanceof Error ? caught.message : String(caught),
                });
                failures.push({ source, id: row.id, code });
            }
        }
    });
    const nextAfterId = rows.at(-1)?.id ?? afterId;
    await platformPrisma.sunatJob.update({
        where: { id: job.id },
        data: failures.length === 0 ? {
            status: "SUCCEEDED",
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            payload: { tenantId, source, afterId, take, nextAfterId, finalize, ...(finalize ? { backupId } : {}) },
        } : {
            status: "DEAD",
            completedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: "ARTIFACT_QUARANTINE",
            lastErrorSafe: `${failures.length} registro(s) en cuarentena; el origen se conserva`,
            payload: { tenantId, source, afterId, take, nextAfterId, finalize, failures },
        },
    });
    console.log(JSON.stringify({ tenantId, source, rows: rows.length, artifacts, failures, nextAfterId, finalize }));
    if (failures.length > 0) process.exitCode = 2;
}

void main()
    .catch((caught) => {
        console.error("[sunat-artifact-migration]", caught instanceof Error ? caught.message : "migration failed");
        process.exitCode = 1;
    })
    .finally(async () => {
        destroySharedSunatArtifactInfrastructure();
        await platformPrisma.$disconnect();
    });
