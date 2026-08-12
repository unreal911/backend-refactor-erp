import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { envs } from "../../config/envs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptionKey(): Buffer {
    const configured = Buffer.from(envs.PLATFORM_MFA_ENC_KEY || "", "base64");
    if (configured.length === 32) return configured;
    if (envs.IS_PRODUCTION) throw new Error("PLATFORM_MFA_ENC_KEY no está configurada");
    return createHash("sha256").update(`${envs.JWT_SECRET}:platform-mfa:development`).digest();
}

export function base32Encode(value: Buffer): string {
    let bits = 0; let accumulator = 0; let output = "";
    for (const byte of value) {
        accumulator = (accumulator << 8) | byte; bits += 8;
        while (bits >= 5) { output += ALPHABET[(accumulator >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) output += ALPHABET[(accumulator << (5 - bits)) & 31];
    return output;
}

function base32Decode(value: string): Buffer {
    let bits = 0; let accumulator = 0; const bytes: number[] = [];
    for (const char of value.toUpperCase().replace(/=|\s|-/g, "")) {
        const index = ALPHABET.indexOf(char); if (index < 0) throw new Error("Secreto TOTP inválido");
        accumulator = (accumulator << 5) | index; bits += 5;
        if (bits >= 8) { bytes.push((accumulator >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(bytes);
}

export function generateTotpSecret(): string { return base32Encode(randomBytes(20)); }

export function encryptTotpSecret(secret: string): string {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptTotpSecret(value: string): string {
    const [version, iv, tag, payload] = String(value || "").split(".");
    if (version !== "v1" || !iv || !tag || !payload) throw new Error("Secreto MFA cifrado inválido");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
}

function totp(secret: string, counter: number): string {
    const value = Buffer.alloc(8); value.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac("sha1", base32Decode(secret)).update(value).digest();
    const offset = digest[digest.length - 1]! & 15;
    const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    return number.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
    const normalized = String(code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(normalized)) return false;
    const counter = Math.floor(now / 30_000);
    return [-1, 0, 1].some((offset) => {
        const expected = Buffer.from(totp(secret, counter + offset)); const actual = Buffer.from(normalized);
        return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
}

export function recoveryHash(code: string): string {
    return createHmac("sha256", encryptionKey()).update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

export function createRecoveryCodes(count = 8): string[] {
    return Array.from({ length: count }, () => {
        const raw = randomBytes(8).toString("hex").toUpperCase();
        return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    });
}
