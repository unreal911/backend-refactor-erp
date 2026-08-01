import crypto from "node:crypto";
import {
    DecryptCommand,
    GenerateDataKeyCommand,
    KMSClient,
} from "@aws-sdk/client-kms";
import {
    OpenSecretInput,
    SealSecretInput,
    SecretProtector,
    SecretPurpose,
} from "../ports/secret-protector.port";

const FORMAT_PREFIX = "v2.kms";
const ALGORITHM = "AES-256-GCM";
const CONTEXT_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]*$/;

interface EnvelopeV2 {
    version: 2;
    provider: "kms";
    algorithm: typeof ALGORITHM;
    contextVersion: 1;
    keyId: string;
    encryptedDataKey: string;
    iv: string;
    authTag: string;
    ciphertext: string;
}

export interface KmsEnvelopeSecretProtectorOptions {
    client: KMSClient;
    keyId: string;
}

function assertContextValue(value: string, name: string): string {
    const normalized = value.trim();
    if (
        !normalized
        || normalized.length > 128
        || /[\r\n\0]/.test(normalized)
    ) {
        throw new Error(`${name} inválido para el contexto de cifrado`);
    }
    return normalized;
}

function encryptionContext(tenantId: string, purpose: SecretPurpose): Record<string, string> {
    return {
        tenantId: assertContextValue(tenantId, "tenantId"),
        purpose: assertContextValue(purpose, "purpose"),
        contextVersion: String(CONTEXT_VERSION),
    };
}

function additionalAuthenticatedData(tenantId: string, purpose: SecretPurpose): Buffer {
    return Buffer.from(
        JSON.stringify({
            contextVersion: CONTEXT_VERSION,
            tenantId: assertContextValue(tenantId, "tenantId"),
            purpose: assertContextValue(purpose, "purpose"),
        }),
        "utf8",
    );
}

function encodePart(value: Buffer | Uint8Array): string {
    return Buffer.from(value).toString("base64url");
}

function decodePart(value: unknown, field: string, allowEmpty = false): Buffer {
    if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
        throw new Error(`Payload cifrado inválido: ${field}`);
    }
    if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
        throw new Error(`Payload cifrado inválido: ${field}`);
    }
    return Buffer.from(value, "base64url");
}

function serializeEnvelope(envelope: EnvelopeV2): string {
    return `${FORMAT_PREFIX}.${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
}

function parseEnvelope(payload: string): EnvelopeV2 {
    const expectedPrefix = `${FORMAT_PREFIX}.`;
    if (!payload.startsWith(expectedPrefix)) {
        throw new Error("Formato de secreto no soportado");
    }

    const encoded = payload.slice(expectedPrefix.length);
    const raw = decodePart(encoded, "envelope");
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.toString("utf8"));
    } catch {
        throw new Error("Payload cifrado inválido");
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error("Payload cifrado inválido");
    }
    const value = parsed as Record<string, unknown>;
    if (
        value.version !== 2
        || value.provider !== "kms"
        || value.algorithm !== ALGORITHM
        || value.contextVersion !== CONTEXT_VERSION
        || typeof value.keyId !== "string"
        || !value.keyId.trim()
    ) {
        throw new Error("Payload cifrado incompatible");
    }

    const encryptedDataKey = decodePart(value.encryptedDataKey, "encryptedDataKey");
    const iv = decodePart(value.iv, "iv");
    const authTag = decodePart(value.authTag, "authTag");
    // Un secreto vacío es válido y produce ciphertext vacío en AES-GCM.
    decodePart(value.ciphertext, "ciphertext", true);

    if (encryptedDataKey.length === 0 || iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw new Error("Payload cifrado con tamaños inválidos");
    }

    return {
        version: 2,
        provider: "kms",
        algorithm: ALGORITHM,
        contextVersion: CONTEXT_VERSION,
        keyId: value.keyId.trim(),
        encryptedDataKey: value.encryptedDataKey as string,
        iv: value.iv as string,
        authTag: value.authTag as string,
        ciphertext: value.ciphertext as string,
    };
}

export class KmsEnvelopeSecretProtector implements SecretProtector {
    private readonly client: KMSClient;
    private readonly keyId: string;

    constructor(options: KmsEnvelopeSecretProtectorOptions) {
        this.client = options.client;
        this.keyId = options.keyId.trim();
        if (!this.keyId) throw new Error("SUNAT_KMS_KEY_ID es obligatorio");
    }

    async seal(input: SealSecretInput): Promise<string> {
        const context = encryptionContext(input.tenantId, input.purpose);
        const aad = additionalAuthenticatedData(input.tenantId, input.purpose);
        const generated = await this.client.send(
            new GenerateDataKeyCommand({
                KeyId: this.keyId,
                KeySpec: "AES_256",
                EncryptionContext: context,
            }),
        );

        if (!generated.Plaintext || !generated.CiphertextBlob) {
            throw new Error("KMS no devolvió una data key completa");
        }

        const dataKey = Buffer.from(generated.Plaintext);
        try {
            if (dataKey.length !== DATA_KEY_BYTES) {
                throw new Error("KMS devolvió una data key con longitud inválida");
            }

            const iv = crypto.randomBytes(IV_BYTES);
            const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
            cipher.setAAD(aad);
            const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
            const authTag = cipher.getAuthTag();

            return serializeEnvelope({
                version: 2,
                provider: "kms",
                algorithm: ALGORITHM,
                contextVersion: CONTEXT_VERSION,
                keyId: generated.KeyId?.trim() || this.keyId,
                encryptedDataKey: encodePart(generated.CiphertextBlob),
                iv: encodePart(iv),
                authTag: encodePart(authTag),
                ciphertext: encodePart(ciphertext),
            });
        } finally {
            dataKey.fill(0);
            generated.Plaintext.fill(0);
        }
    }

    async open(input: OpenSecretInput): Promise<Buffer> {
        const envelope = parseEnvelope(input.payload);
        const context = encryptionContext(input.tenantId, input.purpose);
        const aad = additionalAuthenticatedData(input.tenantId, input.purpose);
        const decrypted = await this.client.send(
            new DecryptCommand({
                KeyId: envelope.keyId,
                CiphertextBlob: decodePart(envelope.encryptedDataKey, "encryptedDataKey"),
                EncryptionContext: context,
            }),
        );

        if (!decrypted.Plaintext) {
            throw new Error("KMS no devolvió la data key descifrada");
        }

        const dataKey = Buffer.from(decrypted.Plaintext);
        try {
            if (dataKey.length !== DATA_KEY_BYTES) {
                throw new Error("KMS devolvió una data key con longitud inválida");
            }

            const decipher = crypto.createDecipheriv(
                "aes-256-gcm",
                dataKey,
                decodePart(envelope.iv, "iv"),
            );
            decipher.setAAD(aad);
            decipher.setAuthTag(decodePart(envelope.authTag, "authTag"));
            return Buffer.concat([
                decipher.update(decodePart(envelope.ciphertext, "ciphertext", true)),
                decipher.final(),
            ]);
        } catch (error) {
            throw new Error("No se pudo autenticar o descifrar el secreto", { cause: error });
        } finally {
            dataKey.fill(0);
            decrypted.Plaintext.fill(0);
        }
    }
}
