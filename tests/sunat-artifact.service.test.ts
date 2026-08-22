import { TenantKind, TenantStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { tenantPrisma } from "../src/data/tenant-prisma";
import { SunatArtifactService } from "../src/modules/sunat/services/sunat-artifact.service";
import { InMemoryDocumentStorage } from "./fakes/in-memory-document-storage";

const tag = `${Date.now().toString(36)}-${process.pid}`;
const tenantIds: string[] = [];
const comprobanteIds: number[] = [];
const storage = new InMemoryDocumentStorage();
const service = new SunatArtifactService(storage);
let tenantA = "";
let tenantB = "";
let comprobanteA = 0;

async function createTenant(label: string) {
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `artifact-${label}-${tag}`,
            name: `Artifact ${label} ${tag}`,
            kind: TenantKind.CUSTOMER,
            status: TenantStatus.ACTIVE,
            planCode: "STARTER",
            maxStorageBytes: 10_000_000,
        },
    });
    tenantIds.push(tenant.id);
    return tenant.id;
}

async function createComprobante(tenantId: string, suffix: number) {
    const row = await runTenantDatabaseTransaction(tenantId, () => tenantPrisma.comprobante.create({
        data: {
            tenantId,
            tipo: "FACTURA",
            tipoCodigo: "01",
            serie: "F001",
            numero: suffix,
            nombreArchivo: `20123456789-01-F001-${suffix}-${tag}`,
            emisorRuc: "20123456789",
            emisorRazonSocial: "Artifact Test SAC",
            clienteTipoDoc: "6",
            clienteNumDoc: "20987654321",
            clienteNombre: "Cliente Test SAC",
            leyendaMontoLetras: "CERO CON 00/100 SOLES",
        },
    }));
    comprobanteIds.push(row.id);
    return row.id;
}

beforeAll(async () => {
    tenantA = await createTenant("a");
    tenantB = await createTenant("b");
    comprobanteA = await createComprobante(tenantA, Number(String(Date.now()).slice(-6)));
});

afterAll(async () => {
    await platformPrisma.sunatArtifact.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.comprobante.deleteMany({ where: { id: { in: comprobanteIds } } });
    await platformPrisma.tenant.updateMany({
        where: { id: { in: tenantIds } },
        data: { status: "PURGED", purgedAt: new Date() },
    });
    await platformPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("SUN-001..004 metadatos y almacenamiento documental", () => {
    it("guarda bytes fuera de PostgreSQL con SHA-256, versión y relación tenant", async () => {
        const xml = Buffer.from("<Invoice>firmado</Invoice>");
        const artifact = await runTenantDatabaseTransaction(tenantA, () => service.store({
            ownerType: "COMPROBANTE",
            ownerId: comprobanteA,
            logicalKey: `comprobante-${comprobanteA}`,
            type: "SIGNED_XML",
            fileName: `factura-${comprobanteA}-signed.xml`,
            body: xml,
            mimeType: "application/xml",
        }));
        expect(artifact.tenantId).toBe(tenantA);
        expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(artifact.sizeBytes).toBe(BigInt(xml.length));
        expect(artifact.storageStatus).toBe("VERIFIED");
        expect(artifact.objectKey).toContain(`tenants/${tenantA}/`);
        expect(artifact.objectKey).toContain(artifact.sha256);
        expect(artifact).not.toHaveProperty("body");
        expect(artifact).not.toHaveProperty("base64");
    });

    it("reintenta con los mismos bytes y rechaza cambiar el payload bajo la misma versión", async () => {
        const input = {
            ownerType: "COMPROBANTE" as const,
            ownerId: comprobanteA,
            logicalKey: `comprobante-${comprobanteA}-zip`,
            type: "SUBMISSION_ZIP" as const,
            fileName: `factura-${comprobanteA}-submission.zip`,
            body: Buffer.from("zip-original"),
            mimeType: "application/zip",
        };
        const first = await runTenantDatabaseTransaction(tenantA, () => service.store(input));
        const replay = await runTenantDatabaseTransaction(tenantA, () => service.store(input));
        expect(replay.id).toBe(first.id);
        await expect(runTenantDatabaseTransaction(tenantA, () => service.store({
            ...input,
            body: Buffer.from("zip-modificado"),
        }))).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rehidrata S3 tras restaurar metadatos PostgreSQL sin duplicar la fila", async () => {
        const input = {
            ownerType: "COMPROBANTE" as const,
            ownerId: comprobanteA,
            logicalKey: `comprobante-${comprobanteA}-restore`,
            type: "CDR_ZIP" as const,
            fileName: `factura-${comprobanteA}-cdr.zip`,
            body: Buffer.from("cdr-restaurable"),
            mimeType: "application/zip",
        };
        const first = await runTenantDatabaseTransaction(tenantA, () => service.store(input));
        const prefix = `tenants/${tenantA}/`;
        await storage.remove({
            tenantId: tenantA,
            relativeKey: first.objectKey.slice(prefix.length),
        });
        const restored = await runTenantDatabaseTransaction(tenantA, () => service.store(input));
        expect(restored.id).toBe(first.id);
        expect(restored.objectVersion).not.toBe(first.objectVersion);
        const bytes = await runTenantDatabaseTransaction(tenantA, () => service.readWithLegacyFallback({
            artifactId: restored.id,
            metricName: "restore-verification",
        }));
        expect(bytes).toEqual({ bytes: input.body, source: "artifact" });
    });

    it("RLS impide consultar o descargar el artefacto desde otro tenant", async () => {
        const artifact = await platformPrisma.sunatArtifact.findFirstOrThrow({
            where: { tenantId: tenantA },
        });
        await runTenantDatabaseTransaction(tenantB, async () => {
            expect(await tenantPrisma.sunatArtifact.findUnique({ where: { id: artifact.id } })).toBeNull();
            await expect(service.createDownloadUrl(artifact.id)).rejects.toMatchObject({ statusCode: 404 });
        });
    });

    it("lista metadatos autorizados sin revelar bucket ni object key", async () => {
        const artifacts = await runTenantDatabaseTransaction(tenantA, () => (
            service.listForComprobante(comprobanteA)
        ));
        expect(artifacts.length).toBeGreaterThanOrEqual(2);
        expect(artifacts[0]).not.toHaveProperty("bucket");
        expect(artifacts[0]).not.toHaveProperty("objectKey");
        expect(artifacts[0]?.sizeBytes).toMatch(/^\d+$/);
    });

    it("genera descarga temporal y registra fallback heredado de forma explícita", async () => {
        const artifact = await platformPrisma.sunatArtifact.findFirstOrThrow({
            where: { tenantId: tenantA, type: "SIGNED_XML" },
        });
        const url = await runTenantDatabaseTransaction(tenantA, () => (
            service.createDownloadUrl(artifact.id, 60)
        ));
        await expect(storage.download(url)).resolves.toEqual(Buffer.from("<Invoice>firmado</Invoice>"));

        const fallback = await runTenantDatabaseTransaction(tenantA, () => service.readWithLegacyFallback({
            legacyBase64: Buffer.from("legacy").toString("base64"),
            metricName: "legacy-xml-fallback",
        }));
        expect(fallback).toEqual({ bytes: Buffer.from("legacy"), source: "legacy" });

        const previous = process.env.SUNAT_LEGACY_BASE64_FALLBACK_ENABLED;
        try {
            process.env.SUNAT_LEGACY_BASE64_FALLBACK_ENABLED = "false";
            await expect(runTenantDatabaseTransaction(tenantA, () => service.readWithLegacyFallback({
                legacyBase64: Buffer.from("legacy").toString("base64"),
                metricName: "legacy-xml-fallback",
            }))).rejects.toMatchObject({ statusCode: 404 });
        } finally {
            if (previous === undefined) delete process.env.SUNAT_LEGACY_BASE64_FALLBACK_ENABLED;
            else process.env.SUNAT_LEGACY_BASE64_FALLBACK_ENABLED = previous;
        }
    });
});
