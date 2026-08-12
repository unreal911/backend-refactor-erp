import {
    CommercialAssetStatus,
    ImageProviderEnvironment,
    ImageProviderHealthStatus,
    ImageProviderProfile,
    ImageProviderType,
    Prisma,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { imageAdapter } from "../commercial-assets/image-provider";
import { PlatformAuditService } from "./platform-audit.service";

type Actor = { platformAdminId: string; correlationId: string | null };
const HEALTH_MAX_AGE_MS = 15 * 60 * 1000;
const TEST_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function text(value: unknown, max: number): string | null {
    const result = String(value || "").trim().replace(/\s+/g, " ");
    return result ? result.slice(0, max) : null;
}

function runtimeEnvironment(): ImageProviderEnvironment {
    const explicit = String(process.env.DEPLOY_ENV || "").toLowerCase();
    if (explicit === "staging") return ImageProviderEnvironment.STAGING;
    if (process.env.NODE_ENV === "production") return ImageProviderEnvironment.PRODUCTION;
    return ImageProviderEnvironment.DEVELOPMENT;
}

function secretRef(value: unknown): string {
    const result = String(value || "").trim();
    if (!/^(env:[A-Z0-9_,]+|aws-secrets-manager:[A-Za-z0-9/_+=.@-]+)$/.test(result)) {
        throw CustomError.badRequest("secretRef debe apuntar a variables de entorno o AWS Secrets Manager; no envíes credenciales");
    }
    return result;
}

function safeConfig(type: ImageProviderType, raw: unknown): Prisma.InputJsonObject {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const folder = text(source.folder, 120) || "commercial-images";
    if (!/^[A-Za-z0-9/_-]+$/.test(folder) || folder.includes("..")) throw CustomError.badRequest("La carpeta no es válida");
    if (type === ImageProviderType.CLOUDINARY) {
        return { folder, transformationProfile: text(source.transformationProfile, 60) || "commercial-v1" };
    }
    const region = text(source.region, 40); const bucket = text(source.bucket, 120); const cdnBaseUrl = text(source.cdnBaseUrl, 500);
    if (!region || !bucket) throw CustomError.badRequest("El perfil S3 requiere región y bucket provisionado");
    if (cdnBaseUrl && !/^https:\/\//i.test(cdnBaseUrl)) throw CustomError.badRequest("El dominio CDN debe usar HTTPS");
    return { folder, region, bucket, ...(cdnBaseUrl ? { cdnBaseUrl } : {}) };
}

function mask(value: string) {
    if (value.length < 8) return "••••";
    return `${value.slice(0, 4)}••••${value.slice(-3)}`;
}

function serializeProfile(profile: ImageProviderProfile, usage?: { bytes: bigint; assets: number }) {
    const config = profile.config as Record<string, unknown>;
    const maskedConfig = {
        folder: config.folder,
        transformationProfile: config.transformationProfile,
        region: config.region,
        bucket: config.bucket ? mask(String(config.bucket)) : undefined,
        cdnBaseUrl: config.cdnBaseUrl ? mask(String(config.cdnBaseUrl)) : undefined,
    };
    return {
        ...profile,
        secretRef: profile.secretRef.startsWith("env:") ? "env:••••" : "aws-secrets-manager:••••",
        config: maskedConfig,
        maxUploadBytes: profile.maxUploadBytes.toString(),
        monthlyBudgetUsd: profile.monthlyBudgetUsd?.toString() ?? null,
        usageBytes: usage?.bytes.toString() ?? "0",
        activeAssets: usage?.assets ?? 0,
        credentialsConfigured: profile.type === ImageProviderType.CLOUDINARY
            ? Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
            : Boolean(config.bucket || process.env.PRODUCT_IMAGE_S3_BUCKET),
    };
}

export class ImageProviderProfileService {
    static async list() {
        const [profiles, usage] = await Promise.all([
            platformPrisma.imageProviderProfile.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
            platformPrisma.commercialAsset.groupBy({ by: ["providerProfileId"], where: { status: CommercialAssetStatus.ACTIVE }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        ]);
        const byProvider = new Map(usage.map((row) => [row.providerProfileId, { bytes: row._sum.sizeBytes ?? 0n, assets: row._count._all }]));
        return profiles.map((profile) => serializeProfile(profile, byProvider.get(profile.id)));
    }

    static async create(input: Record<string, unknown>, actor: Actor) {
        const type = String(input.type || "").toUpperCase() as ImageProviderType;
        const environment = String(input.environment || "ANY").toUpperCase() as ImageProviderEnvironment;
        if (!Object.values(ImageProviderType).includes(type)) throw CustomError.badRequest("Proveedor no válido");
        if (!Object.values(ImageProviderEnvironment).includes(environment)) throw CustomError.badRequest("Ambiente no válido");
        const name = text(input.name, 100); if (!name) throw CustomError.badRequest("El nombre es obligatorio");
        const maxUploadBytes = BigInt(String(input.maxUploadBytes || 10 * 1024 * 1024));
        if (maxUploadBytes < 1024n || maxUploadBytes > 20n * 1024n * 1024n) throw CustomError.badRequest("El máximo por imagen debe estar entre 1 KB y 20 MB");
        const warningPercent = Number(input.warningPercent ?? 80);
        if (!Number.isInteger(warningPercent) || warningPercent < 50 || warningPercent > 95) throw CustomError.badRequest("El umbral debe estar entre 50 % y 95 %");
        const created = await platformPrisma.imageProviderProfile.create({ data: {
            type, name, environment, secretRef: secretRef(input.secretRef), config: safeConfig(type, input.config),
            maxUploadBytes, warningPercent, monthlyBudgetUsd: input.monthlyBudgetUsd ? new Prisma.Decimal(String(input.monthlyBudgetUsd)) : null,
            createdByPlatformAdminId: actor.platformAdminId, updatedByPlatformAdminId: actor.platformAdminId,
        } });
        await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "IMAGE_PROVIDER_PROFILE_CREATED", entityType: "ImageProviderProfile", entityId: created.id, correlationId: actor.correlationId, after: serializeProfile(created) });
        return serializeProfile(created);
    }

    static async update(id: string, input: Record<string, unknown>, actor: Actor) {
        const before = await platformPrisma.imageProviderProfile.findUnique({ where: { id } });
        if (!before) throw CustomError.notFound("El perfil no existe");
        const sensitiveChange = input.type !== undefined || input.environment !== undefined || input.secretRef !== undefined || input.config !== undefined;
        if (before.isActive && sensitiveChange) throw CustomError.conflict("Desactiva este perfil mediante el cambio controlado antes de modificar su conexión");
        const type = input.type ? String(input.type).toUpperCase() as ImageProviderType : before.type;
        const environment = input.environment ? String(input.environment).toUpperCase() as ImageProviderEnvironment : before.environment;
        const data: Prisma.ImageProviderProfileUpdateInput = {
            ...(input.name !== undefined ? { name: text(input.name, 100) || before.name } : {}),
            ...(input.type !== undefined ? { type } : {}),
            ...(input.environment !== undefined ? { environment } : {}),
            ...(input.secretRef !== undefined ? { secretRef: secretRef(input.secretRef) } : {}),
            ...(input.config !== undefined ? { config: safeConfig(type, input.config) } : {}),
            ...(typeof input.isEnabled === "boolean" ? { isEnabled: input.isEnabled } : {}),
            ...(typeof input.pauseNewUploads === "boolean" ? { pauseNewUploads: input.pauseNewUploads } : {}),
            ...(input.warningPercent !== undefined ? { warningPercent: Number(input.warningPercent) } : {}),
            ...(input.monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: input.monthlyBudgetUsd ? new Prisma.Decimal(String(input.monthlyBudgetUsd)) : null } : {}),
            updatedByPlatformAdminId: actor.platformAdminId,
        };
        const after = await platformPrisma.imageProviderProfile.update({ where: { id }, data });
        await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "IMAGE_PROVIDER_PROFILE_UPDATED", entityType: "ImageProviderProfile", entityId: id, correlationId: actor.correlationId, before: serializeProfile(before), after: serializeProfile(after) });
        return serializeProfile(after);
    }

    static async test(id: string, actor: Actor) {
        const profile = await platformPrisma.imageProviderProfile.findUnique({ where: { id } });
        if (!profile) throw CustomError.notFound("El perfil no existe");
        let status: ImageProviderHealthStatus = ImageProviderHealthStatus.HEALTHY; let message = "Carga, consulta y borrado verificados"; let externalId: string | null = null;
        try {
            const adapter = imageAdapter(profile);
            const uploaded = await adapter.upload({ buffer: TEST_PNG, contentType: "image/png", key: `healthcheck/${Date.now()}` }); externalId = uploaded.externalId;
            const checked = await adapter.head(uploaded.externalId);
            if (!checked.exists) throw new Error("El objeto de prueba no pudo leerse");
            await adapter.delete(uploaded.externalId); externalId = null;
        } catch {
            status = ImageProviderHealthStatus.UNAVAILABLE; message = "La prueba aislada del proveedor falló";
            if (externalId) await imageAdapter(profile).delete(externalId).catch(() => undefined);
        }
        const after = await platformPrisma.imageProviderProfile.update({ where: { id }, data: { healthStatus: status, lastHealthMessage: message, lastHealthCheckedAt: new Date() } });
        await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "IMAGE_PROVIDER_HEALTH_TESTED", entityType: "ImageProviderProfile", entityId: id, correlationId: actor.correlationId, after: { status, message } });
        return serializeProfile(after);
    }

    static async activate(id: string, input: Record<string, unknown>, actor: Actor) {
        const profile = await platformPrisma.imageProviderProfile.findUnique({ where: { id } });
        if (!profile) throw CustomError.notFound("El perfil no existe");
        const reason = text(input.reason, 500); if (!reason || reason.length < 8) throw CustomError.badRequest("Explica el motivo del cambio");
        if (String(input.confirmation || "") !== profile.name) throw CustomError.badRequest("La confirmación debe coincidir con el nombre del perfil");
        if (!profile.isEnabled || profile.pauseNewUploads) throw CustomError.conflict("El perfil debe estar habilitado y aceptar nuevas cargas");
        if (profile.environment !== ImageProviderEnvironment.ANY && profile.environment !== runtimeEnvironment()) throw CustomError.conflict("El perfil no pertenece a este ambiente");
        if (profile.healthStatus !== ImageProviderHealthStatus.HEALTHY || !profile.lastHealthCheckedAt || Date.now() - profile.lastHealthCheckedAt.getTime() > HEALTH_MAX_AGE_MS) throw CustomError.conflict("Ejecuta una prueba saludable durante los últimos 15 minutos");
        const result = await platformPrisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('image-provider-activation', 0))`);
            const previous = await tx.imageProviderProfile.findFirst({ where: { isActive: true } });
            if (previous?.id === profile.id) return { previous, active: previous };
            if (previous) await tx.imageProviderProfile.update({ where: { id: previous.id }, data: { isActive: false, updatedByPlatformAdminId: actor.platformAdminId } });
            const active = await tx.imageProviderProfile.update({ where: { id: profile.id }, data: { isActive: true, updatedByPlatformAdminId: actor.platformAdminId } });
            await PlatformAuditService.record({ actorPlatformAdminId: actor.platformAdminId, action: "IMAGE_PROVIDER_ACTIVATED", entityType: "ImageProviderProfile", entityId: id, reason, correlationId: actor.correlationId, before: previous ? serializeProfile(previous) : null, after: serializeProfile(active) }, tx);
            return { previous, active };
        });
        return serializeProfile(result.active);
    }
}
