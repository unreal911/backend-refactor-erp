import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { envs } from "../../config/envs";
import { CustomError } from "../../domain/errors/custom.error";

const MAX_BYTES = 5 * 1024 * 1024;

function key(): Buffer {
    const configured = Buffer.from(envs.PAYMENT_PROOF_ENC_KEY || "", "base64");
    if (configured.length === 32) return configured;
    if (envs.IS_PRODUCTION) throw new Error("PAYMENT_PROOF_ENC_KEY no está configurada");
    return createHash("sha256").update(`${envs.JWT_SECRET}:payment-proof:development`).digest();
}

function detectedType(buffer: Buffer): string | null {
    if (buffer.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return "application/pdf";
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) return "image/jpeg";
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
    return null;
}

export function protectPaymentProof(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw CustomError.badRequest("La constancia no es válida");
    const input = value as Record<string, unknown>;
    const filename = String(input.filename || "constancia").trim().replace(/[^A-Za-z0-9._ -]+/g, "-").slice(0, 180);
    const raw = String(input.data || "").replace(/^data:[^;]+;base64,/, "");
    if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw CustomError.badRequest("La constancia debe enviarse en base64");
    const buffer = Buffer.from(raw, "base64");
    if (buffer.length < 1 || buffer.length > MAX_BYTES) throw CustomError.badRequest("La constancia debe pesar como máximo 5 MB");
    const contentType = detectedType(buffer);
    if (!contentType) throw CustomError.badRequest("La constancia debe ser PDF, JPG, PNG o WebP");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return { filename: filename || "constancia", contentType, sizeBytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function openPaymentProof(proof: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): Buffer {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(proof.iv));
    decipher.setAuthTag(Buffer.from(proof.authTag));
    return Buffer.concat([decipher.update(Buffer.from(proof.ciphertext)), decipher.final()]);
}
