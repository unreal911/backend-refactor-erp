import crypto from "node:crypto";
import { CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import {
    CreateBucketCommand,
    PutObjectCommand,
    PutBucketVersioningCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KmsEnvelopeSecretProtector } from "../src/modules/sunat/infrastructure/providers/kms-envelope-secret-protector";
import { S3DocumentStorage } from "../src/modules/sunat/infrastructure/providers/s3-document-storage";
import { documentStorageContract } from "./contracts/document-storage.contract";
import { secretProtectorContract } from "./contracts/secret-protector.contract";

const describeMoto = process.env.RUN_MOTO_TESTS === "true" ? describe : describe.skip;
const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://127.0.0.1:5000";
const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

describeMoto("contratos SUNAT contra Moto", () => {
    const region = process.env.AWS_REGION ?? "us-east-1";
    const bucket = `sunat-contract-${process.pid}-${Date.now()}`.toLowerCase();
    const s3Client = new S3Client({
        region,
        endpoint,
        credentials,
        forcePathStyle: true,
    });
    const kmsClient = new KMSClient({
        region,
        endpoint,
        credentials,
    });
    let storage: S3DocumentStorage;
    let secretProtector: KmsEnvelopeSecretProtector;

    beforeAll(async () => {
        await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        await s3Client.send(
            new PutBucketVersioningCommand({
                Bucket: bucket,
                VersioningConfiguration: { Status: "Enabled" },
            }),
        );

        const key = await kmsClient.send(
            new CreateKeyCommand({
                Description: "Clave desechable para contratos SUNAT",
                KeyUsage: "ENCRYPT_DECRYPT",
                KeySpec: "SYMMETRIC_DEFAULT",
            }),
        );
        const keyId = key.KeyMetadata?.KeyId;
        if (!keyId) throw new Error("Moto no devolvió KeyId");

        storage = new S3DocumentStorage({
            client: s3Client,
            bucket,
        });
        secretProtector = new KmsEnvelopeSecretProtector({
            client: kmsClient,
            keyId,
        });
    });

    afterAll(() => {
        s3Client.destroy();
        kmsClient.destroy();
    });

    it("guarda y recupera un artefacto validando SHA-256", async () => {
        const body = Buffer.from("<Invoice>demo</Invoice>", "utf8");
        const expectedSha256 = crypto.createHash("sha256").update(body).digest("hex");

        const stored = await storage.put({
            tenantId: "tenant-a",
            relativeKey: "2026/07/factura-demo.xml",
            body,
            contentType: "application/xml",
            expectedSha256,
            metadata: { documentType: "invoice" },
        });

        expect(stored.objectKey).toBe(
            "tenants/tenant-a/2026/07/factura-demo.xml",
        );
        expect(stored.sha256).toBe(expectedSha256);
        expect(stored.versionId).toBeTruthy();
        await expect(
            storage.get({
                tenantId: "tenant-a",
                relativeKey: "2026/07/factura-demo.xml",
                expectedSha256,
            }),
        ).resolves.toEqual(body);
        await expect(
            storage.head({
                tenantId: "tenant-a",
                relativeKey: "2026/07/factura-demo.xml",
            }),
        ).resolves.toMatchObject({
            objectKey: "tenants/tenant-a/2026/07/factura-demo.xml",
            sha256: expectedSha256,
            contentType: "application/xml",
        });
    });

    it("aísla la misma ruta lógica entre empresas", async () => {
        const relativeKey = "2026/07/respuesta.zip";
        await storage.put({
            tenantId: "tenant-a",
            relativeKey,
            body: Buffer.from("respuesta A"),
            contentType: "application/zip",
        });
        await storage.put({
            tenantId: "tenant-b",
            relativeKey,
            body: Buffer.from("respuesta B"),
            contentType: "application/zip",
        });

        await expect(storage.get({ tenantId: "tenant-a", relativeKey })).resolves.toEqual(
            Buffer.from("respuesta A"),
        );
        await expect(storage.get({ tenantId: "tenant-b", relativeKey })).resolves.toEqual(
            Buffer.from("respuesta B"),
        );
    });

    it("rechaza rutas inseguras y hashes incorrectos antes de escribir", async () => {
        await expect(
            storage.put({
                tenantId: "tenant-a",
                relativeKey: "../otro-tenant/secreto.pfx",
                body: Buffer.from("no guardar"),
                contentType: "application/x-pkcs12",
            }),
        ).rejects.toThrow("relativeKey");

        await expect(
            storage.put({
                tenantId: "tenant-a",
                relativeKey: "2026/07/documento.xml",
                body: Buffer.from("contenido"),
                contentType: "application/xml",
                expectedSha256: "0".repeat(64),
            }),
        ).rejects.toThrow("SHA-256 esperado no coincide");
    });

    it("devuelve null cuando un artefacto no existe", async () => {
        await expect(
            storage.head({
                tenantId: "tenant-a",
                relativeKey: "2026/07/no-existe.xml",
            }),
        ).resolves.toBeNull();
    });

    it("detecta un objeto alterado después de almacenarlo", async () => {
        const relativeKey = "2026/07/xml-firmado.xml";
        const original = Buffer.from("<Invoice>original</Invoice>");
        const originalSha256 = crypto
            .createHash("sha256")
            .update(original)
            .digest("hex");
        await storage.put({
            tenantId: "tenant-a",
            relativeKey,
            body: original,
            contentType: "application/xml",
        });

        await s3Client.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: `tenants/tenant-a/${relativeKey}`,
                Body: Buffer.from("<Invoice>alterado</Invoice>"),
                ContentType: "application/xml",
                Metadata: {
                    "tenant-id": "tenant-a",
                    sha256: originalSha256,
                },
            }),
        );

        await expect(
            storage.get({ tenantId: "tenant-a", relativeKey }),
        ).rejects.toThrow("metadata SHA-256");
    });

    it("genera una URL temporal que permite descargar el artefacto", async () => {
        const relativeKey = "2026/07/cdr-demo.zip";
        const body = Buffer.from("cdr firmado");
        await storage.put({
            tenantId: "tenant-a",
            relativeKey,
            body,
            contentType: "application/zip",
        });

        const signedUrl = await storage.createDownloadUrl({
            tenantId: "tenant-a",
            relativeKey,
            expiresInSeconds: 60,
        });
        expect(new URL(signedUrl).searchParams.get("X-Amz-Expires")).toBe("60");
        const response = await fetch(signedUrl);

        expect(response.ok).toBe(true);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    });

    it("cifra y descifra secretos con una data key de KMS", async () => {
        const plaintext = Buffer.from("clave-sol-super-secreta", "utf8");
        const payload = await secretProtector.seal({
            tenantId: "tenant-a",
            purpose: "SOL_PASSWORD",
            plaintext,
        });

        expect(payload).toMatch(/^v2\.kms\./);
        expect(payload).not.toContain(plaintext.toString("utf8"));
        await expect(
            secretProtector.open({
                tenantId: "tenant-a",
                purpose: "SOL_PASSWORD",
                payload,
            }),
        ).resolves.toEqual(plaintext);
    });

    it("acepta secretos vacíos para configuraciones válidas", async () => {
        const payload = await secretProtector.seal({
            tenantId: "tenant-a",
            purpose: "PFX_PASSWORD",
            plaintext: Buffer.alloc(0),
        });

        await expect(
            secretProtector.open({
                tenantId: "tenant-a",
                purpose: "PFX_PASSWORD",
                payload,
            }),
        ).resolves.toEqual(Buffer.alloc(0));
    });

    it("impide abrir un secreto desde otra empresa o con otro propósito", async () => {
        const payload = await secretProtector.seal({
            tenantId: "tenant-a",
            purpose: "PFX",
            plaintext: Buffer.from("certificado"),
        });

        await expect(
            secretProtector.open({
                tenantId: "tenant-b",
                purpose: "PFX",
                payload,
            }),
        ).rejects.toThrow();
        await expect(
            secretProtector.open({
                tenantId: "tenant-a",
                purpose: "SOL_PASSWORD",
                payload,
            }),
        ).rejects.toThrow();
    });

    it("detecta la alteración del sobre cifrado", async () => {
        const payload = await secretProtector.seal({
            tenantId: "tenant-a",
            purpose: "PFX",
            plaintext: Buffer.from("certificado"),
        });
        const [version, provider, encoded] = payload.split(".");
        if (!version || !provider || !encoded) throw new Error("Sobre de prueba inválido");
        const envelope = JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8"),
        ) as Record<string, string | number>;
        const ciphertext = Buffer.from(String(envelope.ciphertext), "base64url");
        if (ciphertext.length === 0) throw new Error("Ciphertext de prueba vacío");
        ciphertext[0] ^= 1;
        envelope.ciphertext = ciphertext.toString("base64url");
        const tampered = `${version}.${provider}.${Buffer.from(
            JSON.stringify(envelope),
            "utf8",
        ).toString("base64url")}`;

        await expect(
            secretProtector.open({
                tenantId: "tenant-a",
                purpose: "PFX",
                payload: tampered,
            }),
        ).rejects.toThrow("No se pudo autenticar o descifrar el secreto");
    });
});

documentStorageContract(
    "Moto S3",
    async () => {
        const region = process.env.AWS_REGION ?? "us-east-1";
        const bucket = `sunat-storage-contract-${process.pid}-${Date.now()}`.toLowerCase();
        const client = new S3Client({
            region,
            endpoint,
            credentials,
            forcePathStyle: true,
        });
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        await client.send(
            new PutBucketVersioningCommand({
                Bucket: bucket,
                VersioningConfiguration: { Status: "Enabled" },
            }),
        );

        const storage = new S3DocumentStorage({ client, bucket });
        return {
            storage,
            async tamper(input: {
                tenantId: string;
                relativeKey: string;
                body: Buffer;
            }): Promise<void> {
                const current = await storage.head(input);
                if (!current) throw new Error("Objeto Moto no encontrado para alterar");
                await client.send(
                    new PutObjectCommand({
                        Bucket: bucket,
                        Key: current.objectKey,
                        Body: input.body,
                        ContentType: current.contentType,
                        Metadata: {
                            "tenant-id": input.tenantId,
                            sha256: current.sha256,
                        },
                    }),
                );
            },
            async download(signedUrl: string): Promise<Buffer> {
                const response = await fetch(signedUrl);
                if (!response.ok) {
                    throw new Error(`Descarga Moto falló con HTTP ${response.status}`);
                }
                return Buffer.from(await response.arrayBuffer());
            },
            dispose(): void {
                client.destroy();
            },
        };
    },
    { skip: process.env.RUN_MOTO_TESTS !== "true" },
);

secretProtectorContract(
    "Moto KMS",
    async () => {
        const client = new KMSClient({
            region: process.env.AWS_REGION ?? "us-east-1",
            endpoint,
            credentials,
        });
        const key = await client.send(
            new CreateKeyCommand({
                Description: "Clave desechable para contrato SecretProtector",
                KeyUsage: "ENCRYPT_DECRYPT",
                KeySpec: "SYMMETRIC_DEFAULT",
            }),
        );
        const keyId = key.KeyMetadata?.KeyId;
        if (!keyId) throw new Error("Moto no devolvió KeyId para el contrato");

        return {
            secretProtector: new KmsEnvelopeSecretProtector({ client, keyId }),
            dispose(): void {
                client.destroy();
            },
        };
    },
    { skip: process.env.RUN_MOTO_TESTS !== "true" },
);
