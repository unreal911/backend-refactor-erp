import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { TenantDataContext } from "../src/modules/tenant/tenant-data-context";
import {
    isKmsSunatSecret,
    SunatSecretService,
} from "../src/modules/sunat/config/sunat-secret.service";
import { encryptSecret } from "../src/modules/sunat/config/sunat-crypto";
import { OpenSecretInput, SealSecretInput, SecretProtector } from "../src/modules/sunat/infrastructure/ports/secret-protector.port";

class ContextSecretProtector implements SecretProtector {
    private readonly values = new Map<string, { tenantId: string; purpose: string; value: Buffer }>();

    async seal(input: SealSecretInput): Promise<string> {
        const token = randomBytes(24).toString("base64url");
        this.values.set(token, { tenantId: input.tenantId, purpose: input.purpose, value: Buffer.from(input.plaintext) });
        return `v2.kms.fake-${token}`;
    }

    async open(input: OpenSecretInput): Promise<Buffer> {
        const token = input.payload.replace(/^v2\.kms\.fake-/, "");
        const found = this.values.get(token);
        if (!found || found.tenantId !== input.tenantId || found.purpose !== input.purpose) {
            throw new Error("context mismatch");
        }
        return Buffer.from(found.value);
    }
}

const originalKey = process.env.SUNAT_CONFIG_ENC_KEY;

afterEach(() => {
    if (originalKey === undefined) delete process.env.SUNAT_CONFIG_ENC_KEY;
    else process.env.SUNAT_CONFIG_ENC_KEY = originalKey;
});

describe("SUN-007 lector dual y migración de secretos", () => {
    it("abre v1 y migra/verifica a v2 sin cambiar el texto", async () => {
        process.env.SUNAT_CONFIG_ENC_KEY = "legacy-test-key-with-enough-entropy";
        const service = new SunatSecretService(new ContextSecretProtector());
        const legacy = encryptSecret("clave-sol-test");

        await TenantDataContext.run("tenant-a", async () => {
            await expect(service.openString(legacy, "SOL_PASSWORD")).resolves.toBe("clave-sol-test");
            const migrated = await service.migrateAndVerify(legacy, "SOL_PASSWORD");
            expect(isKmsSunatSecret(migrated)).toBe(true);
            expect(migrated).not.toContain("clave-sol-test");
            await expect(service.openString(migrated, "SOL_PASSWORD")).resolves.toBe("clave-sol-test");
        });
    });

    it("vincula v2 al tenant y al propósito", async () => {
        const service = new SunatSecretService(new ContextSecretProtector());
        const payload = await TenantDataContext.run("tenant-a", () => service.seal("cert", "PFX"));
        await expect(TenantDataContext.run("tenant-b", () => service.open(payload, "PFX"))).rejects.toThrow();
        await expect(TenantDataContext.run("tenant-a", () => service.open(payload, "SOL_PASSWORD"))).rejects.toThrow();
    });
});
