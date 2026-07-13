import { afterAll, beforeAll, describe, expect, it } from "vitest";

// La clave maestra debe existir ANTES de importar el modulo (lee el env al derivar).
const PREV_KEY = process.env.SUNAT_CONFIG_ENC_KEY;

beforeAll(() => {
    process.env.SUNAT_CONFIG_ENC_KEY = "clave-maestra-de-prueba-para-tests";
});

afterAll(() => {
    if (PREV_KEY === undefined) delete process.env.SUNAT_CONFIG_ENC_KEY;
    else process.env.SUNAT_CONFIG_ENC_KEY = PREV_KEY;
});

async function loadCrypto() {
    return import("../src/modules/sunat/config/sunat-crypto");
}

describe("sunat-crypto (AES-256-GCM)", () => {
    it("detecta que la clave esta configurada", async () => {
        const { isSunatEncryptionConfigured } = await loadCrypto();
        expect(isSunatEncryptionConfigured()).toBe(true);
    });

    it("cifra con formato v1.iv.tag.ct", async () => {
        const { encryptSecret } = await loadCrypto();
        const enc = encryptSecret("MiClaveSOL#2026");
        const parts = enc.split(".");
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe("v1");
    });

    it("roundtrip de texto", async () => {
        const { encryptSecret, decryptSecretString } = await loadCrypto();
        const plano = "MiClaveSOL#2026";
        expect(decryptSecretString(encryptSecret(plano))).toBe(plano);
    });

    it("roundtrip de bytes (certificado)", async () => {
        const { encryptSecret, decryptSecret } = await loadCrypto();
        const bytes = Buffer.from([0, 1, 2, 255, 254, 10, 13, 200]);
        expect(Buffer.compare(decryptSecret(encryptSecret(bytes)), bytes)).toBe(0);
    });

    it("dos cifrados del mismo texto difieren (IV aleatorio)", async () => {
        const { encryptSecret } = await loadCrypto();
        expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
    });

    it("rechaza payload manipulado (auth tag GCM)", async () => {
        const { encryptSecret, decryptSecret } = await loadCrypto();
        const enc = encryptSecret("secreto");
        const tampered = `${enc.slice(0, -4)}AAAA`;
        expect(() => decryptSecret(tampered)).toThrow();
    });

    it("rechaza formato invalido", async () => {
        const { decryptSecret } = await loadCrypto();
        expect(() => decryptSecret("no-es-valido")).toThrow(/formato invalido/i);
    });
});
