import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    DocumentStorage,
} from "../../src/modules/sunat/infrastructure/ports/document-storage.port";

export interface DocumentStorageContractHarness {
    storage: DocumentStorage;
    tamper(input: {
        tenantId: string;
        relativeKey: string;
        body: Buffer;
    }): Promise<void>;
    download(signedUrl: string): Promise<Buffer>;
    dispose?(): Promise<void> | void;
}

export interface ContractSuiteOptions {
    skip?: boolean;
}

export function documentStorageContract(
    implementationName: string,
    createHarness: () => Promise<DocumentStorageContractHarness> | DocumentStorageContractHarness,
    options: ContractSuiteOptions = {},
): void {
    const suite = options.skip ? describe.skip : describe;

    suite(`contrato DocumentStorage: ${implementationName}`, () => {
        let harness: DocumentStorageContractHarness;
        const runPrefix = `contracts/${process.pid}-${Date.now()}`;

        beforeAll(async () => {
            harness = await createHarness();
        });

        afterAll(async () => {
            await harness?.dispose?.();
        });

        it("guarda, consulta y recupera bytes con SHA-256 verificable", async () => {
            const relativeKey = `${runPrefix}/factura.xml`;
            const body = Buffer.from("<Invoice>contrato</Invoice>", "utf8");
            const expectedSha256 = crypto.createHash("sha256").update(body).digest("hex");

            const stored = await harness.storage.put({
                tenantId: "tenant-a",
                relativeKey,
                body,
                contentType: "application/xml",
                expectedSha256,
                metadata: { documentType: "invoice" },
            });

            expect(stored.objectKey).toBe(`tenants/tenant-a/${relativeKey}`);
            expect(stored.sha256).toBe(expectedSha256);
            expect(stored.byteSize).toBe(body.byteLength);
            expect(stored.versionId).toBeTruthy();
            await expect(
                harness.storage.head({ tenantId: "tenant-a", relativeKey }),
            ).resolves.toMatchObject({
                objectKey: `tenants/tenant-a/${relativeKey}`,
                sha256: expectedSha256,
                byteSize: body.byteLength,
                contentType: "application/xml",
            });
            await expect(
                harness.storage.get({
                    tenantId: "tenant-a",
                    relativeKey,
                    expectedSha256,
                }),
            ).resolves.toEqual(body);
        });

        it("aísla la misma ruta lógica entre tenants", async () => {
            const relativeKey = `${runPrefix}/respuesta.zip`;
            await harness.storage.put({
                tenantId: "tenant-a",
                relativeKey,
                body: Buffer.from("respuesta A"),
                contentType: "application/zip",
            });
            await harness.storage.put({
                tenantId: "tenant-b",
                relativeKey,
                body: Buffer.from("respuesta B"),
                contentType: "application/zip",
            });

            await expect(
                harness.storage.get({ tenantId: "tenant-a", relativeKey }),
            ).resolves.toEqual(Buffer.from("respuesta A"));
            await expect(
                harness.storage.get({ tenantId: "tenant-b", relativeKey }),
            ).resolves.toEqual(Buffer.from("respuesta B"));
        });

        it.each([
            "/absoluta.xml",
            "../otro-tenant/secreto.pfx",
            "directorio\\archivo.xml",
            "directorio//archivo.xml",
            "./archivo.xml",
        ])("rechaza la ruta insegura %s", async (relativeKey) => {
            await expect(
                harness.storage.put({
                    tenantId: "tenant-a",
                    relativeKey,
                    body: Buffer.from("no guardar"),
                    contentType: "application/octet-stream",
                }),
            ).rejects.toThrow(/relativeKey|segmentos/i);
        });

        it("rechaza tenant inválido y hash esperado incorrecto antes de escribir", async () => {
            const relativeKey = `${runPrefix}/hash-invalido.xml`;
            await expect(
                harness.storage.put({
                    tenantId: "../tenant-b",
                    relativeKey,
                    body: Buffer.from("no guardar"),
                    contentType: "application/xml",
                }),
            ).rejects.toThrow(/tenantId/i);
            await expect(
                harness.storage.put({
                    tenantId: "tenant-a",
                    relativeKey,
                    body: Buffer.from("contenido"),
                    contentType: "application/xml",
                    expectedSha256: "0".repeat(64),
                }),
            ).rejects.toThrow(/SHA-256/i);
            await expect(
                harness.storage.head({ tenantId: "tenant-a", relativeKey }),
            ).resolves.toBeNull();
        });

        it("devuelve null cuando el objeto no existe", async () => {
            await expect(
                harness.storage.head({
                    tenantId: "tenant-a",
                    relativeKey: `${runPrefix}/no-existe.xml`,
                }),
            ).resolves.toBeNull();
        });

        it("detecta contenido alterado después de almacenarlo", async () => {
            const relativeKey = `${runPrefix}/alterado.xml`;
            await harness.storage.put({
                tenantId: "tenant-a",
                relativeKey,
                body: Buffer.from("<Invoice>original</Invoice>"),
                contentType: "application/xml",
            });
            await harness.tamper({
                tenantId: "tenant-a",
                relativeKey,
                body: Buffer.from("<Invoice>alterado</Invoice>"),
            });

            await expect(
                harness.storage.get({ tenantId: "tenant-a", relativeKey }),
            ).rejects.toThrow(/SHA-256/i);
        });

        it("genera una descarga temporal y limita su expiración", async () => {
            const relativeKey = `${runPrefix}/cdr.zip`;
            const body = Buffer.from("cdr contrato");
            await harness.storage.put({
                tenantId: "tenant-a",
                relativeKey,
                body,
                contentType: "application/zip",
            });

            const signedUrl = await harness.storage.createDownloadUrl({
                tenantId: "tenant-a",
                relativeKey,
                expiresInSeconds: 60,
            });
            await expect(harness.download(signedUrl)).resolves.toEqual(body);
            await expect(
                harness.storage.createDownloadUrl({
                    tenantId: "tenant-a",
                    relativeKey,
                    expiresInSeconds: 0,
                }),
            ).rejects.toThrow(/entre 1 y 900/i);
            await expect(
                harness.storage.createDownloadUrl({
                    tenantId: "tenant-a",
                    relativeKey,
                    expiresInSeconds: 901,
                }),
            ).rejects.toThrow(/entre 1 y 900/i);
        });

        it("no expone eliminación directa en el puerto", () => {
            expect("delete" in harness.storage).toBe(false);
        });
    });
}
