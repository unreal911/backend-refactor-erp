import {
    Prisma,
    TenantKind,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantPlanCode,
    TenantStatus,
    TenantSubscriptionStatus,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";
import { TenantPurgeService } from "./tenant-purge.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 30;

export const PLAN_LIMITS: Record<TenantPlanCode, {
    maxUsers: number;
    maxProducts: number;
    maxOrders: number;
    maxStorageBytes: bigint;
}> = {
    TRIAL: {
        maxUsers: 3,
        maxProducts: 100,
        maxOrders: 250,
        maxStorageBytes: 500n * 1024n * 1024n,
    },
    STARTER: {
        maxUsers: 5,
        maxProducts: 1_000,
        maxOrders: 5_000,
        maxStorageBytes: 5n * 1024n * 1024n * 1024n,
    },
    GROWTH: {
        maxUsers: 25,
        maxProducts: 20_000,
        maxOrders: 100_000,
        maxStorageBytes: 50n * 1024n * 1024n * 1024n,
    },
    PREMIUM: {
        maxUsers: 100,
        maxProducts: 100_000,
        maxOrders: 1_000_000,
        maxStorageBytes: 250n * 1024n * 1024n * 1024n,
    },
};

export type LegalProfileInput = {
    ruc: string;
    legalName: string;
    address: string;
    contactPhone?: string | null;
    contactEmail?: string | null;
    confirmRuc?: boolean;
};

function normalizeText(value: unknown, maxLength: number): string {
    return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function isValidPeruvianRuc(value: string): boolean {
    if (!/^\d{11}$/.test(value)) return false;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => (
        total + Number(value[index]) * weight
    ), 0);
    const raw = 11 - (sum % 11);
    const expected = raw === 10 ? 0 : raw === 11 ? 1 : raw;
    return Number(value[10]) === expected;
}

function lifecycleMetadata(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertOwnerOrAdmin(role: TenantMembershipRole): void {
    if (role !== TenantMembershipRole.OWNER && role !== TenantMembershipRole.ADMIN) {
        throw CustomError.forbidden("Solo un propietario o administrador puede realizar esta acción");
    }
}

export class TenantQuotaService {
    static async assertAvailable(
        resource: "users" | "products" | "orders" | "storage",
        requested = 1,
    ): Promise<void> {
        const tenantId = TenantDataContext.requireTenantId();
        if (!Number.isInteger(requested) || requested < 1) {
            throw CustomError.badRequest("La cantidad solicitada no es válida");
        }
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: {
                status: true,
                maxUsers: true,
                maxProducts: true,
                maxOrders: true,
                maxStorageBytes: true,
            },
        });
        if (tenant.status === TenantStatus.EXPIRED || tenant.status === TenantStatus.SUSPENDED) {
            throw CustomError.forbidden("La empresa está en modo de solo lectura");
        }
        if (tenant.status !== TenantStatus.TRIAL && tenant.status !== TenantStatus.ACTIVE) {
            throw CustomError.forbidden("La empresa no está disponible");
        }

        let used: number | bigint;
        let limit: number | bigint;
        if (resource === "users") {
            const [memberships, invitations] = await Promise.all([
                tenantPrisma.tenantMembership.count({
                    where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
                }),
                tenantPrisma.tenantInvitation.count({
                    where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } },
                }),
            ]);
            used = memberships + invitations;
            limit = tenant.maxUsers;
        } else if (resource === "products") {
            used = await tenantPrisma.product.count({ where: { tenantId } });
            limit = tenant.maxProducts;
        } else if (resource === "orders") {
            used = await tenantPrisma.order.count({ where: { tenantId } });
            limit = tenant.maxOrders;
        } else {
            const aggregate = await tenantPrisma.sunatArtifact.aggregate({
                where: { tenantId, storageStatus: { not: "DELETED" } },
                _sum: { sizeBytes: true },
            });
            used = aggregate._sum.sizeBytes ?? 0n;
            limit = tenant.maxStorageBytes;
        }

        const next = BigInt(used) + BigInt(requested);
        if (next > BigInt(limit)) {
            throw new CustomError(`Se alcanzó la cuota del plan para ${resource}`, 409);
        }
    }
}

export class TenantLifecycleService {
    static async checkCertificateExpiry(now = new Date()) {
        const tenantId = TenantDataContext.requireTenantId();
        const config = await tenantPrisma.sunatEmisorConfig.findUnique({
            where: { tenantId },
            select: {
                certNotAfter: true,
                certificateValidatedAt: true,
                environment: true,
            },
        });
        if (!config?.certNotAfter) return { configured: false, alerts: [] as number[], expired: false };
        const daysRemaining = Math.ceil((config.certNotAfter.getTime() - now.getTime()) / DAY_MS);
        const alerts: number[] = [];
        for (const threshold of [30, 15, 7, 1]) {
            if (daysRemaining > threshold || daysRemaining < 0) continue;
            const type = `SUNAT_CERTIFICATE_EXPIRES_${threshold}D`;
            const exists = await tenantPrisma.tenantLifecycleEvent.findFirst({
                where: {
                    tenantId,
                    type,
                    createdAt: { gte: config.certificateValidatedAt ?? new Date(0) },
                },
            });
            if (!exists) {
                await tenantPrisma.tenantLifecycleEvent.create({
                    data: {
                        tenantId,
                        type,
                        source: "certificate-worker",
                        metadata: lifecycleMetadata({ daysRemaining, expiresAt: config.certNotAfter.toISOString() }),
                    },
                });
                alerts.push(threshold);
            }
        }
        const expired = config.certNotAfter <= now;
        if (expired && config.environment === "PRODUCCION") {
            await tenantPrisma.tenant.update({
                where: { id: tenantId },
                data: { sunatProductionEnabled: false },
            });
            const previous = await tenantPrisma.tenantLifecycleEvent.findFirst({
                where: {
                    tenantId,
                    type: "SUNAT_CERTIFICATE_EXPIRED",
                    createdAt: { gte: config.certificateValidatedAt ?? new Date(0) },
                },
            });
            if (!previous) {
                await tenantPrisma.tenantLifecycleEvent.create({
                    data: {
                        tenantId,
                        type: "SUNAT_CERTIFICATE_EXPIRED",
                        source: "certificate-worker",
                        metadata: lifecycleMetadata({ expiresAt: config.certNotAfter.toISOString() }),
                    },
                });
            }
        }
        return { configured: true, alerts, expired, daysRemaining };
    }

    static async getCurrent() {
        const tenantId = TenantDataContext.requireTenantId();
        const tenant = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            include: { subscription: true },
        });
        const [memberships, invitations, products, orders, storage] = await Promise.all([
            tenantPrisma.tenantMembership.count({
                where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
            }),
            tenantPrisma.tenantInvitation.count({
                where: { tenantId, status: "PENDING", expiresAt: { gt: new Date() } },
            }),
            tenantPrisma.product.count({ where: { tenantId } }),
            tenantPrisma.order.count({ where: { tenantId } }),
            tenantPrisma.sunatArtifact.aggregate({
                where: { tenantId, storageStatus: { not: "DELETED" } },
                _sum: { sizeBytes: true },
            }),
        ]);
        return {
            tenant: {
                ...tenant,
                maxStorageBytes: tenant.maxStorageBytes.toString(),
            },
            usage: {
                users: memberships + invitations,
                products,
                orders,
                storageBytes: (storage._sum.sizeBytes ?? 0n).toString(),
            },
            readOnly: tenant.status === TenantStatus.EXPIRED
                || tenant.status === TenantStatus.SUSPENDED,
        };
    }

    static async updateLegalProfile(
        input: LegalProfileInput,
        actor: { userId: number; role: TenantMembershipRole },
        now = new Date(),
    ) {
        assertOwnerOrAdmin(actor.role);
        const tenantId = TenantDataContext.requireTenantId();
        const ruc = String(input.ruc ?? "").replace(/\D/g, "");
        if (!isValidPeruvianRuc(ruc)) {
            throw CustomError.badRequest("El RUC no supera la validación de dígito de control");
        }
        const legalName = normalizeText(input.legalName, 200);
        const address = normalizeText(input.address, 300);
        if (!legalName || !address) {
            throw CustomError.badRequest("Razón social y dirección son obligatorias");
        }
        const contactPhone = normalizeText(input.contactPhone, 40) || null;
        const contactEmail = normalizeText(input.contactEmail, 320).toLowerCase() || null;
        if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
            throw CustomError.badRequest("El correo de contacto no es válido");
        }

        const current = await tenantPrisma.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { ruc: true, rucConfirmedAt: true },
        });
        if (current.rucConfirmedAt && current.ruc !== ruc) {
            throw new CustomError(
                "Un RUC confirmado solo puede cambiarse mediante revision de plataforma",
                409,
            );
        }
        const rucConfirmedAt = current.rucConfirmedAt ?? (input.confirmRuc ? now : null);

        try {
            const tenant = await tenantPrisma.tenant.update({
                where: { id: tenantId },
                data: {
                    ruc,
                    legalName,
                    address,
                    contactPhone,
                    contactEmail,
                    rucConfirmedAt,
                },
            });
            await tenantPrisma.tenantLifecycleEvent.create({
                data: {
                    tenantId,
                    type: !current.rucConfirmedAt && rucConfirmedAt
                        ? "LEGAL_PROFILE_CONFIRMED"
                        : "LEGAL_PROFILE_UPDATED",
                    actorUserId: actor.userId,
                    source: "tenant-api",
                    metadata: lifecycleMetadata({ rucLast4: ruc.slice(-4) }),
                },
            });
            await tenantPrisma.$executeRawUnsafe(
                `UPDATE "SystemSetting"
                 SET "value" = CASE "key"
                    WHEN 'company_legal_name' THEN $2
                    WHEN 'company_ruc' THEN $3
                    WHEN 'company_address' THEN $4
                    WHEN 'company_phone' THEN $5
                    WHEN 'company_email' THEN $6
                    ELSE "value" END,
                    "updatedAt" = CURRENT_TIMESTAMP
                 WHERE "tenantId" = $1::uuid
                   AND "key" = ANY($7::text[])`,
                tenantId,
                legalName,
                ruc,
                address,
                contactPhone ?? "",
                contactEmail ?? "",
                ["company_legal_name", "company_ruc", "company_address", "company_phone", "company_email"],
            );
            return tenant;
        } catch (caught) {
            if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
                throw new CustomError("El RUC confirmado ya pertenece a otra empresa", 409);
            }
            throw caught;
        }
    }

    static async expireDueTrials(now = new Date(), graceDays = DEFAULT_GRACE_DAYS) {
        const due = await platformPrisma.tenant.findMany({
            where: { status: TenantStatus.TRIAL, trialEndsAt: { lte: now } },
            select: { id: true },
        });
        for (const { id } of due) {
            await platformPrisma.$transaction(async (tx) => {
                const graceEndsAt = new Date(now.getTime() + graceDays * DAY_MS);
                const changed = await tx.tenant.updateMany({
                    where: { id, status: TenantStatus.TRIAL, trialEndsAt: { lte: now } },
                    data: {
                        status: TenantStatus.EXPIRED,
                        readOnlyAt: now,
                        graceEndsAt,
                        purgeScheduledAt: graceEndsAt,
                        sunatProductionEnabled: false,
                    },
                });
                if (changed.count === 0) return;
                await tx.tenantLifecycleEvent.create({
                    data: {
                        tenantId: id,
                        type: "TRIAL_EXPIRED",
                        source: "lifecycle-worker",
                        metadata: lifecycleMetadata({ graceEndsAt: graceEndsAt.toISOString() }),
                    },
                });
                await tx.sunatJob.upsert({
                    where: {
                        tenantId_type_idempotencyKey: {
                            tenantId: id,
                            type: "PURGE_TRIAL",
                            idempotencyKey: `purge-trial:${id}`,
                        },
                    },
                    create: {
                        tenantId: id,
                        type: "PURGE_TRIAL",
                        idempotencyKey: `purge-trial:${id}`,
                        correlationId: `trial-expiry:${id}`,
                        payload: lifecycleMetadata({ tenantId: id }),
                        nextRunAt: graceEndsAt,
                    },
                    update: { nextRunAt: graceEndsAt, status: "PENDING" },
                });
                await tx.sunatJob.upsert({
                    where: {
                        tenantId_type_idempotencyKey: {
                            tenantId: id,
                            type: "NOTIFY_TRIAL_EXPIRY",
                            idempotencyKey: `notify-trial-expiry:${id}`,
                        },
                    },
                    create: {
                        tenantId: id,
                        type: "NOTIFY_TRIAL_EXPIRY",
                        idempotencyKey: `notify-trial-expiry:${id}`,
                        correlationId: `trial-expiry:${id}`,
                        payload: lifecycleMetadata({ tenantId: id }),
                        nextRunAt: now,
                    },
                    update: {},
                });
            });
        }
        return { expired: due.length, checkedAt: now };
    }

    static async purgeDueTrials(now = new Date(), onlyTenantId?: string) {
        const due = await platformPrisma.tenant.findMany({
            where: {
                ...(onlyTenantId ? { id: onlyTenantId } : {}),
                OR: [
                    { status: TenantStatus.EXPIRED, graceEndsAt: { lte: now } },
                    {
                        status: TenantStatus.PURGED,
                        lifecycleEvents: { none: { type: "TRIAL_PURGED" } },
                    },
                ],
            },
            select: { id: true },
        });
        const results = [];
        for (const { id } of due) {
            results.push(await TenantPurgeService.purgeExpiredTenant(id, now));
        }
        return {
            purged: results.filter((result) => result.purged).length,
            deletedRows: results.reduce((sum, result) => sum + result.deletedRows, 0),
            batches: results.reduce((sum, result) => sum + result.batches, 0),
            deletedUsers: results.reduce((sum, result) => sum + result.deletedUsers, 0),
            checkedAt: now,
        };
    }

    static async approveProduction(
        tenantId: string,
        platformActorUserId: number,
        now = new Date(),
    ) {
        return platformPrisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                include: {
                    subscription: true,
                    memberships: {
                        where: {
                            role: TenantMembershipRole.OWNER,
                            status: TenantMembershipStatus.ACTIVE,
                        },
                        include: {
                            user: {
                                select: {
                                    isActive: true,
                                    trialRegistration: { select: { emailVerifiedAt: true } },
                                },
                            },
                        },
                    },
                    sunatEmisorConfigs: true,
                    comprobanteSeries: { where: { isActive: true }, take: 1 },
                },
            });
            if (!tenant) throw CustomError.notFound("Empresa no encontrada");
            if (tenant.kind === TenantKind.TRIAL || tenant.status === TenantStatus.TRIAL) {
                throw CustomError.forbidden("Un trial nunca puede activar SUNAT producción");
            }
            if (!tenant.ruc || !tenant.rucConfirmedAt || !isValidPeruvianRuc(tenant.ruc)) {
                throw CustomError.badRequest("La empresa requiere un RUC confirmado");
            }
            if (tenant.subscription?.status !== TenantSubscriptionStatus.ACTIVE) {
                throw CustomError.badRequest("La suscripción debe estar activa");
            }
            if (!tenant.memberships.some((membership) => (
                membership.user.isActive
                && Boolean(membership.user.trialRegistration?.emailVerifiedAt)
            ))) {
                throw CustomError.badRequest("La empresa requiere un propietario activo con correo verificado");
            }
            const config = tenant.sunatEmisorConfigs[0];
            if (
                !config
                || config.environment !== "PRODUCCION"
                || config.ruc !== tenant.ruc
                || !config.activo
                || !config.certP12Enc
                || !config.certPasswordEnc
                || !config.solPasswordEnc
                || !config.certificateValidatedAt
                || !config.credentialsVerifiedAt
                || !config.certNotAfter
                || config.certNotAfter <= now
            ) {
                throw CustomError.badRequest("Certificado y credenciales SUNAT deben estar vigentes y verificados");
            }
            if (tenant.comprobanteSeries.length === 0) {
                throw CustomError.badRequest("Configura al menos una serie SUNAT activa");
            }

            const updated = await tx.tenant.update({
                where: { id: tenant.id },
                data: {
                    productionApprovedAt: now,
                    productionApprovedById: platformActorUserId,
                    sunatProductionEnabled: true,
                },
            });
            await tx.tenantLifecycleEvent.create({
                data: {
                    tenantId: tenant.id,
                    type: "SUNAT_PRODUCTION_APPROVED",
                    actorUserId: platformActorUserId,
                    source: "platform-api",
                },
            });
            return updated;
        });
    }
}
