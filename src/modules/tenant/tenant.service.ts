import {
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantStatus,
} from "@prisma/client";
import { platformPrisma as prisma } from "../../data/platform-prisma";
import { TenantAccessError } from "./tenant-context.service";
import { seedDefaultPaymentMethodsForTenant } from "../../data/payment-method-bootstrap";
import { seedDefaultSystemSettingsForTenant } from "../../data/system-config-bootstrap";

export type CreateTenantInput = {
    slug: string;
    name: string;
    legalName?: string | null;
    ruc?: string | null;
    status: Extract<TenantStatus, "TRIAL" | "ACTIVE">;
    trialEndsAt?: Date | null;
    ownerUserId: number;
};

export class TenantService {
    private static normalizeSlug(value: string): string {
        const slug = String(value || "").trim().toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            throw new TenantAccessError("Slug de empresa inválido", 400);
        }
        return slug;
    }

    private static normalizeRuc(value?: string | null): string | null {
        const normalized = String(value || "").replace(/\D/g, "");
        if (!normalized) return null;
        if (!/^\d{11}$/.test(normalized)) {
            throw new TenantAccessError("El RUC debe contener 11 dígitos", 400);
        }
        return normalized;
    }

    static async create(input: CreateTenantInput) {
        const slug = this.normalizeSlug(input.slug);
        const name = String(input.name || "").trim();
        if (!name) {
            throw new TenantAccessError("El nombre de empresa es obligatorio", 400);
        }

        const ruc = this.normalizeRuc(input.ruc);
        const now = new Date();
        const isTrial = input.status === TenantStatus.TRIAL;
        if (!isTrial && !ruc) {
            throw new TenantAccessError("Una empresa activa requiere RUC confirmado", 400);
        }

        const trialEndsAt = isTrial
            ? input.trialEndsAt ?? new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)
            : null;
        if (trialEndsAt && trialEndsAt.getTime() <= now.getTime()) {
            throw new TenantAccessError("La prueba debe terminar en una fecha futura", 400);
        }

        return prisma.$transaction(async (tx) => {
            const owner = await tx.user.findUnique({
                where: { id: input.ownerUserId },
                select: { id: true, isActive: true },
            });
            if (!owner?.isActive) {
                throw new TenantAccessError("El propietario debe ser un usuario activo", 400);
            }

            const tenant = await tx.tenant.create({
                data: {
                    slug,
                    name,
                    legalName: input.legalName?.trim() || null,
                    ruc,
                    rucConfirmedAt: isTrial || !ruc ? null : now,
                    status: input.status,
                    databaseMode: "SHARED",
                    trialStartedAt: isTrial ? now : null,
                    trialEndsAt,
                },
            });

            const membership = await tx.tenantMembership.create({
                data: {
                    tenantId: tenant.id,
                    userId: owner.id,
                    role: TenantMembershipRole.OWNER,
                    status: TenantMembershipStatus.ACTIVE,
                    activatedAt: now,
                },
            });

            await seedDefaultPaymentMethodsForTenant(tenant.id, tx);
            await seedDefaultSystemSettingsForTenant(tenant.id, tx);

            return { tenant, membership };
        });
    }
}
