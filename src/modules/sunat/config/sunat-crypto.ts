import "dotenv/config";
import crypto from "node:crypto";

/**
 * Cifrado de secretos SUNAT en reposo (Clave SOL, .pfx y su password).
 *
 * AES-256-GCM con clave maestra en env `SUNAT_CONFIG_ENC_KEY` (fuera de la BD;
 * unico paso manual por instalacion). La clave de 32 bytes se deriva con SHA-256
 * del valor del env, asi cualquier formato (hex/base64/frase) sirve y siempre da
 * 256 bits. Formato de salida: `v1.<ivB64>.<tagB64>.<cipherB64>`.
 */

const FORMAT_PREFIX = "v1";
const IV_BYTES = 12; // recomendado para GCM

function rawKey(): string {
    return (process.env.SUNAT_CONFIG_ENC_KEY ?? "").trim();
}

export function isSunatEncryptionConfigured(): boolean {
    return rawKey().length > 0;
}

function deriveKey(): Buffer {
    const raw = rawKey();
    if (!raw) {
        throw new Error("SUNAT_CONFIG_ENC_KEY no configurada: no se pueden cifrar/descifrar secretos SUNAT");
    }
    return crypto.createHash("sha256").update(raw, "utf8").digest();
}

// Cifra texto o bytes -> cadena portable en BD.
export function encryptSecret(plain: string | Buffer): string {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const data = typeof plain === "string" ? Buffer.from(plain, "utf8") : plain;
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT_PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

// Descifra a bytes. Lanza si el payload esta corrupto o la clave no coincide.
export function decryptSecret(payload: string): Buffer {
    const key = deriveKey();
    const [prefix, ivB64, tagB64, cipherB64] = (payload ?? "").split(".");
    if (!ivB64 || !tagB64 || !cipherB64 || prefix !== FORMAT_PREFIX) {
        throw new Error("Secreto SUNAT con formato invalido");
    }
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(cipherB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decryptSecretString(payload: string): string {
    return decryptSecret(payload).toString("utf8");
}
