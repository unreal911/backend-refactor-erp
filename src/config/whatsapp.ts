import crypto from "node:crypto";
import { envs } from "./envs";

export function isWhatsAppCloudApiConfigured(): boolean {
    return [envs.WHATSAPP_ACCESS_TOKEN, envs.WHATSAPP_PHONE_NUMBER_ID]
        .every((value) => String(value ?? "").trim().length > 0);
}

export function verifyWhatsAppWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string,
    appSecret: string,
): boolean {
    const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
    const secret = appSecret.trim();
    if (!match || !secret) return false;
    const received = Buffer.from(match[1]!, "hex");
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
