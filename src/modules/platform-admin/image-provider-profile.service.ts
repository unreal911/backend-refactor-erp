import {
    CommercialAssetStatus,
    ImageProviderEnvironment,
    ImageProviderHealthStatus,
    ImageProviderProfile,
    ImageProviderType,
    Prisma,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { cloudinary } from "../../config/cloudinary";
import { CustomError } from "../../domain/errors/custom.error";
import { imageAdapter } from "../commercial-assets/image-provider";
import { PlatformAuditService } from "./platform-audit.service";

type Actor = { platformAdminId: string; correlationId: string | null };
type UsageActor = { platformAdminId?: string | null; correlationId: string | null };
const HEALTH_MAX_AGE_MS = 15 * 60 * 1000;
const TEST_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

type UsageMetric = { used: number | null; limit: number | null; percent: number | null };
export type CloudinaryUsageSnapshot = {
    source: "CLOUDINARY_ADMIN_API";
    plan: string | null;
    lastUpdated: string | null;
    credits: UsageMetric;
    storage: UsageMetric;
    bandwidth: UsageMetric;
    transformations: UsageMetric;
    resources: number | null;
    derivedResources: number | null;
    adminApi: { limit: number | null; remaining: number | null; resetAt: string | null };
};

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function metric(value: unknown): UsageMetric {
    const source = record(value);
    const used = finiteNumber(source.usage ?? source.used);
    const limit = finiteNumber(source.limit ?? source.max);
    const explicitPercent = finiteNumber(source.used_percent ?? source.percent);
    const percent = explicitPercent ?? (used !== null && limit !== null && limit > 0
        ? Math.round((used / limit) * 10000) / 100
        : null);
    return { used, limit, percent };
}

export function normalizeCloudinaryUsage(value: unknown): CloudinaryUsageSnapshot {
    const source = record(value);
    return {
        source: "CLOUDINARY_ADMIN_API",
        plan: source.plan ? String(source.plan).slice(0, 100) : null,
        lastUpdated: source.last_updated ? String(source.last_updated).slice(0, 80) : null,
        credits: metric(source.credits),
        storage: metric(source.storage),
        bandwidth: metric(source.bandwidth),
        transformations: metric(source.transformations),
        resources: finiteNumber(source.resources ?? record(source.objects).usage),
        derivedResources: finiteNumber(source.derived_resources),
        adminApi: {
            limit: finiteNumber(source.rate_limit_allowed),
            remaining: finiteNumber(source.rate_limit_remaining),
            resetAt: source.rate_limit_reset_at ? String(source.rate_limit_reset_at).slice(0, 80) : null,
        },
    };
}

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
        capacityBytes: profile.capacityBytes?.toString() ?? null,
        monthlyBudgetUsd: profile.monthlyBudgetUsd?.toString() ?? null,
        providerUsage: profile.providerUsage ?? null,
        providerUsageCheckedAt: profile.providerUsageCheckedAt?.toISOString() ?? null,
        providerUsageError: profile.providerUsageError ?? null,
        usageBytes: usage?.bytes.toString() ?? "0",
        activeAssets: usage?.assets ?? 0,
        capacityPercent: profile.capacityBytes && profile.capacityBytes > 0n
            ? Number(((usage?.bytes ?? 0n) * 10000n) / profile.capacityBytes) / 100
            : null,
        capacityWarning: Boolean(profile.capacityBytes && profile.capacityBytes > 0n
            && ((usage?.bytes ?? 0n) * 100n) / profile.capacityBytes >= BigInt(profile.warningPercent)),
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
        const capacityBytes = input.capacityBytes ? BigInt(String(input.capacityBytes)) : null;
        if (capacityBytes !== null && capacityBytes < 1024n * 1024n) throw CustomError.badRequest("La capacidad debe ser al menos 1 MB");
        const created = await platformPrisma.imageProviderProfile.create({ data: {
            type, name, environment, secretRef: secretRef(input.secretRef), config: safeConfig(type, input.config),
            maxUploadBytes, capacityBytes, warningPercent, monthlyBudgetUsd: input.monthlyBudgetUsd ? new Prisma.Decimal(String(input.monthlyBudgetUsd)) : null,
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
        const nextWarningPercent = input.warningPercent !== undefined ? Number(input.warningPercent) : before.warningPercent;
        if (!Number.isInteger(nextWarningPercent) || nextWarningPercent < 50 || nextWarningPercent > 95) throw CustomError.badRequest("El umbral debe estar entre 50 % y 95 %");
        const nextCapacity = input.capacityBytes !== undefined && input.capacityBytes
            ? BigInt(String(input.capacityBytes))
            : null;
        if (nextCapacity !== null && nextCapacity < 1024n * 1024n) throw CustomError.badRequest("La capacidad debe ser al menos 1 MB");
        const data: Prisma.ImageProviderProfileUpdateInput = {
            ...(input.name !== undefined ? { name: text(input.name, 100) || before.name } : {}),
            ...(input.type !== undefined ? { type } : {}),
            ...(input.environment !== undefined ? { environment } : {}),
            ...(input.secretRef !== undefined ? { secretRef: secretRef(input.secretRef) } : {}),
            ...(input.config !== undefined ? { config: safeConfig(type, input.config) } : {}),
            ...(typeof input.isEnabled === "boolean" ? { isEnabled: input.isEnabled } : {}),
            ...(typeof input.pauseNewUploads === "boolean" ? { pauseNewUploads: input.pauseNewUploads } : {}),
            ...(input.warningPercent !== undefined ? { warningPercent: nextWarningPercent } : {}),
            ...(input.capacityBytes !== undefined ? { capacityBytes: nextCapacity } : {}),
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

    static async syncUsage(id: string, actor: UsageActor) {
        const profile = await platformPrisma.imageProviderProfile.findUnique({ where: { id } });
        if (!profile) throw CustomError.notFound("El perfil no existe");
        if (profile.type !== ImageProviderType.CLOUDINARY) {
            throw CustomError.badRequest("La sincronización de uso está disponible solo para Cloudinary");
        }
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            throw CustomError.badRequest("Configura las credenciales de Cloudinary antes de consultar el uso");
        }

        const checkedAt = new Date();
        try {
            const snapshot = normalizeCloudinaryUsage(await cloudinary.api.usage());
            const after = await platformPrisma.imageProviderProfile.update({
                where: { id },
                data: {
                    providerUsage: snapshot as unknown as Prisma.InputJsonValue,
                    providerUsageCheckedAt: checkedAt,
                    providerUsageError: null,
                },
            });
            await PlatformAuditService.record({
                actorPlatformAdminId: actor.platformAdminId ?? null,
                action: "CLOUDINARY_USAGE_SYNCED",
                entityType: "ImageProviderProfile",
                entityId: id,
                correlationId: actor.correlationId,
                after: snapshot as unknown as Prisma.InputJsonValue,
            });
            return serializeProfile(after);
        } catch (caught) {
            const httpCode = finiteNumber(record(caught).http_code);
            const message = httpCode
                ? `Cloudinary rechazó la consulta (HTTP ${httpCode})`
                : "Cloudinary no respondió a la consulta de uso";
            await platformPrisma.imageProviderProfile.update({
                where: { id },
                data: { providerUsageCheckedAt: checkedAt, providerUsageError: message },
            }).catch(() => undefined);
            await PlatformAuditService.record({
                actorPlatformAdminId: actor.platformAdminId ?? null,
                action: "CLOUDINARY_USAGE_SYNC_FAILED",
                entityType: "ImageProviderProfile",
                entityId: id,
                correlationId: actor.correlationId,
                after: { checkedAt: checkedAt.toISOString(), error: "Consulta rechazada por Cloudinary" },
            }).catch(() => undefined);
            throw CustomError.internal("No se pudo consultar el uso de Cloudinary");
        }
    }

    static async syncDueCloudinaryUsage(now = new Date()) {
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            return { checked: 0, failed: 0, skipped: true };
        }
        const staleBefore = new Date(now.getTime() - 60 * 60 * 1000);
        const profiles = await platformPrisma.imageProviderProfile.findMany({
            where: {
                type: ImageProviderType.CLOUDINARY,
                isEnabled: true,
                OR: [{ providerUsageCheckedAt: null }, { providerUsageCheckedAt: { lt: staleBefore } }],
            },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        let checked = 0; let failed = 0;
        for (const profile of profiles) {
            try {
                await this.syncUsage(profile.id, { platformAdminId: null, correlationId: `cloudinary-usage:${now.toISOString()}` });
                checked += 1;
            } catch {
                failed += 1;
            }
        }
        return { checked, failed, skipped: false };
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
