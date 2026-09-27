import crypto from "node:crypto";
import { envs } from "../../config/envs";
import { prisma, platformPrisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";

function encryptionKey(): Buffer {
    const key = Buffer.from(envs.WHATSAPP_CONNECTION_ENC_KEY.trim(), "base64");
    if (key.length !== 32) throw new Error("WHATSAPP_CONNECTION_ENC_KEY debe ser una clave de 32 bytes en base64");
    return key;
}

export function encryptWhatsAppToken(token: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptWhatsAppToken(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 3) throw new Error("Credencial WhatsApp inválida");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[0]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[1]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
}

type GraphError = { error?: { code?: number; message?: string; error_subcode?: number } };

async function graphRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`https://graph.facebook.com/${envs.WHATSAPP_API_VERSION}/${path}`, {
        ...init,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
        signal: AbortSignal.timeout(envs.WHATSAPP_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as (T & GraphError) | null;
    if (!response.ok) {
        const code = String(payload?.error?.code || response.status);
        throw new WhatsAppConnectionError(code, response.status);
    }
    if (!payload) throw new WhatsAppConnectionError("EMPTY_RESPONSE", response.status);
    return payload;
}

export class WhatsAppConnectionError extends Error {
    constructor(public readonly code: string, public readonly httpStatus: number) {
        super(httpStatus === 403 || httpStatus === 401
            ? "Meta no autorizó esta conexión. Revisa los permisos del negocio y vuelve a conectar."
            : "Meta no pudo completar la conexión. Reintenta o consulta el código de error.");
    }
}

const publicSelection = {
    id: true, displayPhone: true, status: true, lastErrorCode: true,
    lastErrorMessage: true, lastErrorAt: true, connectedAt: true,
} as const;

export class WhatsAppConnectionService {
    config() {
        return {
            enabled: Boolean(envs.META_APP_ID && envs.META_APP_SECRET && envs.META_WHATSAPP_CONFIG_ID
                && envs.WHATSAPP_WEBHOOK_ENABLED && envs.WHATSAPP_WEBHOOK_VERIFY_TOKEN && envs.WHATSAPP_APP_SECRET
                && Buffer.from(envs.WHATSAPP_CONNECTION_ENC_KEY, "base64").length === 32),
            appId: envs.META_APP_ID,
            configId: envs.META_WHATSAPP_CONFIG_ID,
            apiVersion: envs.WHATSAPP_API_VERSION,
        };
    }

    async status() {
        const connection = await prisma.whatsAppConnection.findFirst({ select: publicSelection });
        return { ...this.config(), connection };
    }

    async connect(input: { code: unknown; wabaId: unknown; phoneNumberId: unknown; pin: unknown }, actorUserId: number) {
        if (!this.config().enabled) throw CustomError.conflict("La conexión de WhatsApp todavía no está configurada en la plataforma");
        const code = String(input.code || "").trim();
        const wabaId = String(input.wabaId || "").trim();
        const phoneNumberId = String(input.phoneNumberId || "").trim();
        const pin = String(input.pin || "").trim();
        if (!code || !/^\d{5,80}$/.test(wabaId) || !/^\d{5,80}$/.test(phoneNumberId)) {
            throw CustomError.badRequest("Meta no devolvió los datos completos de la conexión");
        }
        if (!/^\d{6}$/.test(pin)) throw CustomError.badRequest("Crea un PIN de seis dígitos para registrar el número en Meta");
        const query = new URLSearchParams({ client_id: envs.META_APP_ID, client_secret: envs.META_APP_SECRET, code });
        const tokenPayload = await graphRequest<{ access_token?: string }>(`oauth/access_token?${query}`, "", { headers: {} });
        const token = String(tokenPayload.access_token || "").trim();
        if (!token) throw new WhatsAppConnectionError("TOKEN_MISSING", 502);
        const phones = await graphRequest<{ data?: Array<{ id: string; display_phone_number?: string }> }>(
            `${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`, token,
        );
        const selected = phones.data?.find((phone) => phone.id === phoneNumberId);
        if (!selected) throw CustomError.badRequest("El número indicado no pertenece al negocio autorizado en Meta");
        const tenantId = TenantDataContext.requireTenantId();
        const existingNumber = await platformPrisma.whatsAppConnection.findUnique({
            where: { phoneNumberId }, select: { tenantId: true },
        });
        if (existingNumber && existingNumber.tenantId !== tenantId) {
            throw CustomError.conflict("Este número de WhatsApp ya está vinculado a otra empresa");
        }
        const encrypted = encryptWhatsAppToken(token);
        let status = "CONNECTED";
        let lastErrorCode: string | null = null;
        let lastErrorMessage: string | null = null;
        try {
            await graphRequest(`${wabaId}/subscribed_apps`, token, { method: "POST" });
        } catch (caught) {
            status = "ACTION_REQUIRED";
            lastErrorCode = caught instanceof WhatsAppConnectionError ? caught.code : "SUBSCRIBE_FAILED";
            lastErrorMessage = "Meta autorizó el número, pero falta habilitar la recepción de mensajes. Reintenta la conexión.";
        }
        try {
            await graphRequest(`${phoneNumberId}/register`, token, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ messaging_product: "whatsapp", pin }),
            });
        } catch (caught) {
            status = "ACTION_REQUIRED";
            lastErrorCode = caught instanceof WhatsAppConnectionError ? caught.code : "REGISTER_FAILED";
            lastErrorMessage = "Meta autorizó el número, pero no completó su registro. Revisa el PIN y los requisitos del número; luego vuelve a conectar.";
        }
        try {
            const connection = await prisma.whatsAppConnection.upsert({
                where: { tenantId },
                create: {
                    tenantId, wabaId, phoneNumberId, displayPhone: selected.display_phone_number || phoneNumberId,
                    accessTokenEncrypted: encrypted, status, lastErrorCode, lastErrorMessage,
                    lastErrorAt: lastErrorCode ? new Date() : null, connectedByUserId: actorUserId,
                },
                update: {
                    wabaId, phoneNumberId, displayPhone: selected.display_phone_number || phoneNumberId,
                    accessTokenEncrypted: encrypted, status, lastErrorCode, lastErrorMessage,
                    lastErrorAt: lastErrorCode ? new Date() : null, connectedByUserId: actorUserId,
                    connectedAt: new Date(),
                }, select: publicSelection,
            });
            return connection;
        } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
                throw CustomError.conflict("Este número de WhatsApp ya está vinculado a otra empresa");
            }
            throw caught;
        }
    }

    async disconnect() {
        const current = await prisma.whatsAppConnection.findFirst({ select: { id: true } });
        if (!current) throw CustomError.notFound("No hay un número conectado");
        await prisma.whatsAppConnection.delete({ where: { id: current.id } });
        return { disconnected: true };
    }

    async connectedForCurrentTenant() {
        const row = await prisma.whatsAppConnection.findFirst({ where: { status: "CONNECTED" } });
        if (!row || !row.accessTokenEncrypted) return null;
        return { ...row, accessToken: decryptWhatsAppToken(row.accessTokenEncrypted) };
    }

    async recordSendFailure(code: string, message: string) {
        const row = await prisma.whatsAppConnection.findFirst({ select: { id: true } });
        if (!row) return;
        await prisma.whatsAppConnection.update({ where: { id: row.id }, data: {
            lastErrorCode: code.slice(0, 80), lastErrorMessage: message.slice(0, 500), lastErrorAt: new Date(),
        } });
    }

    static async tenantForPhoneNumber(phoneNumberId: string): Promise<string | null> {
        const row = await platformPrisma.whatsAppConnection.findUnique({
            where: { phoneNumberId }, select: { tenantId: true, status: true },
        });
        return row?.status === "CONNECTED" ? row.tenantId : null;
    }
}
