import { randomUUID } from "node:crypto";
import { CommercialAssetPurpose, CommercialAssetStatus, Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { imageAdapter, jsonVariants } from "./image-provider";
import { inspectImage } from "./image-inspection";

export type CommercialUploadInput = { data: string; key: string; purpose: CommercialAssetPurpose; ownerType: string; ownerId: string };

function serialize(asset: any) {
    return { ...asset, sizeBytes: asset.sizeBytes?.toString(), providerProfile: asset.providerProfile ? { ...asset.providerProfile, maxUploadBytes: asset.providerProfile.maxUploadBytes.toString(), monthlyBudgetUsd: asset.providerProfile.monthlyBudgetUsd?.toString() ?? null } : undefined };
}

export class CommercialAssetService {
    private static async isReferenced(tenantId: string, url: string): Promise<boolean> {
        const rows = await platformPrisma.$queryRaw<Array<{ referenced: boolean }>>(Prisma.sql`
            SELECT EXISTS (
                SELECT 1 FROM "ProductImage" WHERE "tenantId" = ${tenantId}::uuid AND "url" = ${url}
                UNION ALL
                SELECT 1 FROM "ProductVariant" WHERE "tenantId" = ${tenantId}::uuid AND "imageUrl" = ${url}
                UNION ALL
                SELECT 1 FROM "SystemSetting" WHERE "tenantId" = ${tenantId}::uuid AND "value"::text LIKE ${`%${url.replace(/[\\%_]/g, "\\$&")}%`} ESCAPE '\\'
            ) AS referenced
        `);
        return Boolean(rows[0]?.referenced);
    }

    static async upload(input: CommercialUploadInput) {
        const tenantId = TenantDataContext.requireTenantId();
        const profile = await platformPrisma.imageProviderProfile.findFirst({ where: { isActive: true, isEnabled: true } });
        if (!profile) throw CustomError.internal("No hay un proveedor de imágenes activo");
        if (profile.pauseNewUploads) throw CustomError.conflict("Las nuevas cargas de imágenes están pausadas temporalmente");
        const maxUploadBytes = Math.min(Number(profile.maxUploadBytes), 20 * 1024 * 1024);
        const inspected = inspectImage(input.data, maxUploadBytes);
        const reservation = await platformPrisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-storage:${tenantId}`}, 0))`);
            const [tenant, usage] = await Promise.all([
                tx.tenant.findUnique({ where: { id: tenantId }, select: { maxStorageBytes: true } }),
                tx.commercialAsset.aggregate({ where: { tenantId, status: { in: [CommercialAssetStatus.UPLOADING, CommercialAssetStatus.ACTIVE] } }, _sum: { sizeBytes: true } }),
            ]);
            if (!tenant) throw CustomError.notFound("La empresa no existe");
            const used = usage._sum.sizeBytes ?? 0n;
            if (used + BigInt(inspected.buffer.byteLength) > tenant.maxStorageBytes) {
                throw CustomError.conflict("Se alcanzó la cuota de imágenes del plan; las imágenes existentes y SUNAT siguen disponibles");
            }
            return tx.commercialAsset.create({
                data: {
                    tenantId, providerProfileId: profile.id, purpose: input.purpose,
                    ownerType: String(input.ownerType).slice(0, 80), ownerId: String(input.ownerId).slice(0, 160),
                    externalId: `reservation:${randomUUID()}`, url: "", contentType: inspected.contentType,
                    sizeBytes: inspected.buffer.byteLength, width: inspected.width, height: inspected.height, sha256: inspected.sha256,
                    status: CommercialAssetStatus.UPLOADING,
                },
            });
        });
        try {
            const stored = await imageAdapter(profile).upload({ buffer: inspected.buffer, contentType: inspected.contentType, key: input.key });
            const active = await platformPrisma.commercialAsset.update({
                where: { id: reservation.id },
                data: { externalId: stored.externalId, url: stored.url, sizeBytes: stored.bytes, width: stored.width ?? inspected.width, height: stored.height ?? inspected.height, variants: jsonVariants(stored.variants), status: CommercialAssetStatus.ACTIVE },
                include: { providerProfile: true },
            });
            return serialize(active);
        } catch {
            await platformPrisma.commercialAsset.update({ where: { id: reservation.id }, data: { status: CommercialAssetStatus.FAILED, failureReason: "El proveedor rechazó la carga" } }).catch(() => undefined);
            throw CustomError.internal("No se pudo almacenar la imagen");
        }
    }

    static async deleteByUrl(url: string): Promise<boolean> {
        const tenantId = TenantDataContext.requireTenantId();
        const asset = await platformPrisma.commercialAsset.findFirst({ where: { tenantId, url, status: CommercialAssetStatus.ACTIVE }, include: { providerProfile: true } });
        if (!asset) return false;
        try { await imageAdapter(asset.providerProfile).delete(asset.externalId); }
        catch { throw CustomError.internal("No se pudo eliminar la imagen del proveedor"); }
        await platformPrisma.commercialAsset.updateMany({ where: { id: asset.id, tenantId, status: CommercialAssetStatus.ACTIVE }, data: { status: CommercialAssetStatus.DELETED, deletedAt: new Date() } });
        return true;
    }

    static async usage(tenantId = TenantDataContext.requireTenantId()) {
        const [tenant, usage] = await Promise.all([
            platformPrisma.tenant.findUnique({ where: { id: tenantId }, select: { maxStorageBytes: true } }),
            platformPrisma.commercialAsset.aggregate({ where: { tenantId, status: CommercialAssetStatus.ACTIVE }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        ]);
        const usedBytes = usage._sum.sizeBytes ?? 0n; const limitBytes = tenant?.maxStorageBytes ?? 0n;
        return { usedBytes: usedBytes.toString(), limitBytes: limitBytes.toString(), assets: usage._count._all, percent: limitBytes > 0n ? Number((usedBytes * 10000n) / limitBytes) / 100 : 0 };
    }

    static async reconcile(input: { tenantId?: string; deleteOrphans?: boolean; limit?: number } = {}) {
        const requestedLimit = Number(input.limit ?? 250);
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit)))
            : 250;
        const assets = await platformPrisma.commercialAsset.findMany({
            where: {
                status: CommercialAssetStatus.ACTIVE,
                ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            },
            include: { providerProfile: true },
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        const result = { checked: 0, healthy: 0, missing: 0, orphans: 0, deleted: 0, bytesCorrected: 0 };
        for (const asset of assets) {
            result.checked += 1;
            const adapter = imageAdapter(asset.providerProfile);
            const info = await adapter.head(asset.externalId);
            if (!info.exists) {
                await platformPrisma.commercialAsset.update({
                    where: { id: asset.id },
                    data: { status: CommercialAssetStatus.FAILED, failureReason: "Objeto no encontrado durante la reconciliación" },
                });
                result.missing += 1;
                continue;
            }
            if (Number.isFinite(info.bytes) && Number(info.bytes) >= 0 && BigInt(Number(info.bytes)) !== asset.sizeBytes) {
                await platformPrisma.commercialAsset.update({ where: { id: asset.id }, data: { sizeBytes: BigInt(Number(info.bytes)) } });
                result.bytesCorrected += 1;
            }
            if (!await this.isReferenced(asset.tenantId, asset.url)) {
                result.orphans += 1;
                if (input.deleteOrphans) {
                    await adapter.delete(asset.externalId);
                    await platformPrisma.commercialAsset.update({
                        where: { id: asset.id },
                        data: { status: CommercialAssetStatus.DELETED, deletedAt: new Date(), failureReason: "Huérfano eliminado por reconciliación" },
                    });
                    result.deleted += 1;
                }
                continue;
            }
            result.healthy += 1;
        }
        return result;
    }
}
