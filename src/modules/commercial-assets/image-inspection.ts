import { createHash } from "node:crypto";
import { CustomError } from "../../domain/errors/custom.error";

export type InspectedImage = { buffer: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number; sha256: string };

function png(buffer: Buffer) {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        return { contentType: "image/png" as const, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    return null;
}

function jpeg(buffer: Buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
    let offset = 2;
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset + 8 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1]!;
        if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
        const length = buffer.readUInt16BE(offset + 2);
        if (length < 2 || offset + length + 2 > buffer.length) break;
        if (sof.has(marker)) return { contentType: "image/jpeg" as const, height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        offset += length + 2;
    }
    return null;
}

function webp(buffer: Buffer) {
    if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
        const width = 1 + buffer.readUIntLE(24, 3); const height = 1 + buffer.readUIntLE(27, 3);
        return { contentType: "image/webp" as const, width, height };
    }
    if (chunk === "VP8L" && buffer[20] === 0x2f) {
        const bits = buffer.readUInt32LE(21);
        return { contentType: "image/webp" as const, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
}

export function inspectImage(value: string, maxBytes: number): InspectedImage {
    const raw = String(value || "").trim();
    const comma = raw.indexOf(",");
    const base64 = raw.startsWith("data:") ? raw.slice(comma + 1) : raw;
    if (!base64 || (raw.startsWith("data:") && (comma < 0 || !/;base64,/i.test(raw.slice(0, comma + 1))))) {
        throw CustomError.badRequest("La imagen debe enviarse en Base64");
    }
    const buffer = Buffer.from(base64.replace(/\s+/g, ""), "base64");
    if (buffer.length < 32) throw CustomError.badRequest("La imagen está vacía o dañada");
    if (buffer.length > maxBytes) throw CustomError.badRequest(`La imagen excede ${Math.floor(maxBytes / 1048576)} MB`);
    const metadata = png(buffer) || jpeg(buffer) || webp(buffer);
    if (!metadata || metadata.width < 1 || metadata.height < 1) {
        throw CustomError.badRequest("Solo se aceptan imágenes JPEG, PNG o WebP válidas");
    }
    if (metadata.width > 8000 || metadata.height > 8000 || metadata.width * metadata.height > 40_000_000) {
        throw CustomError.badRequest("Las dimensiones de la imagen son demasiado grandes");
    }
    return { buffer, ...metadata, sha256: createHash("sha256").update(buffer).digest("hex") };
}
