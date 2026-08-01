import crypto from "node:crypto";
import {
    OpenSecretInput,
    SealSecretInput,
    SecretProtector,
    SecretPurpose,
} from "../../src/modules/sunat/infrastructure/ports/secret-protector.port";

interface SecretRecord {
    tenantId: string;
    purpose: SecretPurpose;
    plaintext: Buffer;
}

function contextValue(value: string, name: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || /[\r\n\0]/.test(normalized)) {
        throw new Error(`${name} inválido para el fake de secretos`);
    }
    return normalized;
}

export class InMemorySecretProtector implements SecretProtector {
    private readonly records = new Map<string, SecretRecord>();

    async seal(input: SealSecretInput): Promise<string> {
        const token = crypto.randomBytes(32).toString("base64url");
        this.records.set(token, {
            tenantId: contextValue(input.tenantId, "tenantId"),
            purpose: input.purpose,
            plaintext: Buffer.from(input.plaintext),
        });
        return `v2.fake.${token}`;
    }

    async open(input: OpenSecretInput): Promise<Buffer> {
        const prefix = "v2.fake.";
        if (!input.payload.startsWith(prefix)) {
            throw new Error("Formato de secreto fake no soportado");
        }

        const token = input.payload.slice(prefix.length);
        const record = this.records.get(token);
        if (
            !record
            || record.tenantId !== contextValue(input.tenantId, "tenantId")
            || record.purpose !== input.purpose
        ) {
            throw new Error("No se pudo autenticar o abrir el secreto fake");
        }
        return Buffer.from(record.plaintext);
    }
}
