import { createHmac } from "node:crypto";
import {
    TenantKind,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantPlanCode,
    TenantStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { BillingWebhookService } from "../src/modules/lifecycle/billing-webhook.service";
import { TenantExportService } from "../src/modules/lifecycle/tenant-export.service";
import {
    isValidPeruvianRuc,
    TenantLifecycleService,
    TenantQuotaService,
} from "../src/modules/lifecycle/tenant-lifecycle.service";

const tag = `${Date.now().toString(36)}-${process.pid}`;
const rucSeed = String(Date.now()).slice(-8);
const secret = "billing-test-secret-with-more-than-thirty-two-characters";
const tenantIds: string[] = [];
const userIds: number[] = [];
let roleId = 0;
let ownerId = 0;
let ownerMembershipId = "";
let trialId = "";
let activeId = "";

function rucWithPrefix(prefix: string): string {
    const ten = prefix.padEnd(10, "0").slice(0, 10);
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(ten[index]) * weight, 0);
    const raw = 11 - (sum % 11);
    return `${ten}${raw === 10 ? 0 : raw === 11 ? 1 : raw}`;
}

async function createTenant(input: {
    slug: string;
    status: TenantStatus;
    kind: TenantKind;
    trialEndsAt?: Date;
}) {
    const tenant = await platformPrisma.tenant.create({
        data: {
            slug: `${input.slug}-${tag}`,
            name: `${input.slug} ${tag}`,
            status: input.status,
            kind: input.kind,
            trialStartedAt: input.kind === TenantKind.TRIAL ? new Date("2026-07-01T00:00:00Z") : null,
            trialEndsAt: input.trialEndsAt ?? null,
            planCode: input.kind === TenantKind.TRIAL ? TenantPlanCode.TRIAL : TenantPlanCode.STARTER,
            maxUsers: 3,
        },
    });
    tenantIds.push(tenant.id);
    await platformPrisma.tenantSubscription.create({
        data: {
            tenantId: tenant.id,
            provider: "internal",
            planCode: tenant.planCode,
            status: input.kind === TenantKind.TRIAL ? "TRIALING" : "ACTIVE",
        },
    });
    return tenant;
}

beforeAll(async () => {
    const role = await platformPrisma.role.upsert({
        where: { name: "ADMIN" },
        update: { isActive: true },
        create: { name: "ADMIN", description: "Admin", isActive: true },
    });
    roleId = role.id;
    const owner = await platformPrisma.user.create({
        data: {
            firstName: "Lifecycle",
            lastName: "Owner",
            email: `lifecycle-${tag}@example.test`,
            password: "hash-no-usado",
            roleId,
            isActive: true,
        },
    });
    ownerId = owner.id;
    userIds.push(owner.id);
    const trial = await createTenant({
        slug: "trial-lifecycle",
        status: TenantStatus.TRIAL,
        kind: TenantKind.TRIAL,
        trialEndsAt: new Date("2026-08-01T00:00:00Z"),
    });
    trialId = trial.id;
    const membership = await platformPrisma.tenantMembership.create({
        data: {
            tenantId: trial.id,
            userId: owner.id,
            role: TenantMembershipRole.OWNER,
            status: TenantMembershipStatus.ACTIVE,
            activatedAt: new Date(),
        },
    });
    ownerMembershipId = membership.id;
    await platformPrisma.ownerRegistration.create({
        data: {
            firstName: owner.firstName,
            lastName: owner.lastName,
            email: owner.email,
            passwordHash: owner.password,
            businessName: trial.name,
            status: "CONSUMED",
            termsAcceptedAt: new Date("2026-07-01T00:00:00Z"),
            termsVersion: "test-v1",
            verificationRequestedAt: new Date("2026-07-01T00:00:00Z"),
            emailVerifiedAt: new Date("2026-07-01T00:01:00Z"),
            consumedAt: new Date("2026-07-01T00:02:00Z"),
            provisionedTenantId: trial.id,
            provisionedUserId: owner.id,
        },
    });

    const active = await createTenant({
        slug: "active-lifecycle",
        status: TenantStatus.ACTIVE,
        kind: TenantKind.CUSTOMER,
    });
    activeId = active.id;
});

afterAll(async () => {
    await platformPrisma.billingWebhookEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.sunatArtifact.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.sunatJob.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenantLifecycleEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.comprobanteSerie.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.sunatEmisorConfig.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenantSubscription.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenantInvitation.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.ownerRegistration.deleteMany({ where: { provisionedTenantId: { in: tenantIds } } });
    await platformPrisma.tenant.updateMany({
        where: { id: { in: tenantIds } },
        data: { status: "PURGED", purgedAt: new Date(), sunatProductionEnabled: false },
    });
    await platformPrisma.tenantMembership.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await platformPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await platformPrisma.user.deleteMany({ where: { id: { in: userIds } } });
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("ciclo SaaS preproductivo", () => {
    it("valida dígito de control y confirma el perfil legal dentro del tenant", async () => {
        const ruc = rucWithPrefix(`20${rucSeed}`);
        expect(isValidPeruvianRuc(ruc)).toBe(true);
        expect(isValidPeruvianRuc(`${ruc.slice(0, 10)}${(Number(ruc[10]) + 1) % 10}`)).toBe(false);

        const tenant = await runTenantDatabaseTransaction(trialId, () => (
            TenantLifecycleService.updateLegalProfile({
                ruc,
                legalName: "Empresa Lifecycle SAC",
                address: "Av. Pruebas 123",
                contactEmail: "contacto@example.test",
                confirmRuc: true,
            }, {
                userId: ownerId,
                role: TenantMembershipRole.OWNER,
            })
        ));
        expect(tenant.ruc).toBe(ruc);
        expect(tenant.rucConfirmedAt).not.toBeNull();
        expect(await platformPrisma.tenantLifecycleEvent.count({
            where: { tenantId: trialId, type: "LEGAL_PROFILE_CONFIRMED" },
        })).toBe(1);

        const preserved = await runTenantDatabaseTransaction(trialId, () => (
            TenantLifecycleService.updateLegalProfile({
                ruc,
                legalName: "Empresa Lifecycle Actualizada SAC",
                address: "Av. Pruebas 456",
                confirmRuc: false,
            }, {
                userId: ownerId,
                role: TenantMembershipRole.OWNER,
            })
        ));
        expect(preserved.rucConfirmedAt).toEqual(tenant.rucConfirmedAt);
        await expect(runTenantDatabaseTransaction(trialId, () => (
            TenantLifecycleService.updateLegalProfile({
                ruc: rucWithPrefix(`15${rucSeed}`),
                legalName: "Empresa Distinta SAC",
                address: "Av. Cambio 789",
            }, {
                userId: ownerId,
                role: TenantMembershipRole.OWNER,
            })
        ))).rejects.toMatchObject({ statusCode: 409 });
    });

    it("aplica cuota en backend sin afectar a otra empresa", async () => {
        await platformPrisma.tenant.update({ where: { id: trialId }, data: { maxUsers: 1 } });
        await expect(runTenantDatabaseTransaction(trialId, () => (
            TenantQuotaService.assertAvailable("users")
        ))).rejects.toMatchObject({ statusCode: 409 });
        await expect(runTenantDatabaseTransaction(activeId, () => (
            TenantQuotaService.assertAvailable("users")
        ))).resolves.toBeUndefined();
    });

    it("exporta los datos logicos del tenant con manifiesto y sin secretos", async () => {
        await platformPrisma.sunatEmisorConfig.create({
            data: {
                tenantId: trialId,
                environment: "BETA",
                ruc: (await platformPrisma.tenant.findUniqueOrThrow({ where: { id: trialId } })).ruc ?? "",
                razonSocial: "Empresa Lifecycle SAC",
                solUser: "MODDATOS",
                solPasswordEnc: "v2.kms.secret-sol",
                certP12Enc: "v2.kms.secret-pfx",
                certPasswordEnc: "v2.kms.secret-cert-password",
            },
        });
        const exported = await runTenantDatabaseTransaction(trialId, () => (
            TenantExportService.createCurrentTenantExport(new Date("2026-08-02T00:00:00Z"))
        ));
        const parsed = JSON.parse(exported.body) as {
            format: string;
            contentSha256: string;
            manifest: { tableCount: number; rowCount: number };
        };
        expect(parsed.format).toBe("tienda-tenant-export-v1");
        expect(parsed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(parsed.manifest.tableCount).toBeGreaterThan(10);
        expect(parsed.manifest.rowCount).toBeGreaterThan(0);
        expect(exported.body).not.toContain("v2.kms.secret-sol");
        expect(exported.body).not.toContain("v2.kms.secret-pfx");
        expect(exported.body).not.toContain("secret-cert-password");
    });

    it("vence el trial de forma idempotente y agenda purga", async () => {
        const now = new Date("2026-08-02T00:00:00Z");
        expect((await TenantLifecycleService.expireDueTrials(now)).expired).toBeGreaterThanOrEqual(1);
        await TenantLifecycleService.expireDueTrials(now);
        const tenant = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: trialId } });
        expect(tenant.status).toBe(TenantStatus.EXPIRED);
        expect(tenant.readOnlyAt).toEqual(now);
        expect(await platformPrisma.sunatJob.count({
            where: { tenantId: trialId, type: "PURGE_TRIAL" },
        })).toBe(1);
    });

    it("purga un trial vencido por lotes, permite reintento y conserva solo trazabilidad minima", async () => {
        const purgeTenant = await createTenant({
            slug: "trial-purge",
            status: TenantStatus.TRIAL,
            kind: TenantKind.TRIAL,
            trialEndsAt: new Date("2026-07-02T00:00:00Z"),
        });
        await platformPrisma.tenant.update({
            where: { id: purgeTenant.id },
            data: {
                status: TenantStatus.EXPIRED,
                readOnlyAt: new Date("2026-07-02T00:00:00Z"),
                graceEndsAt: new Date("2026-07-10T00:00:00Z"),
                purgeScheduledAt: new Date("2026-07-10T00:00:00Z"),
                ruc: rucWithPrefix(`17${rucSeed}`),
                legalName: "Trial para purgar SAC",
                contactEmail: `purge-contact-${tag}@example.test`,
            },
        });
        const purgeUser = await platformPrisma.user.create({
            data: {
                firstName: "Purge",
                lastName: "Owner",
                email: `purge-${tag}@example.test`,
                password: "hash-a-eliminar",
                roleId,
            },
        });
        userIds.push(purgeUser.id);
        await platformPrisma.tenantMembership.create({
            data: {
                tenantId: purgeTenant.id,
                userId: purgeUser.id,
                role: TenantMembershipRole.OWNER,
                status: TenantMembershipStatus.ACTIVE,
            },
        });
        await platformPrisma.ownerRegistration.create({
            data: {
                firstName: purgeUser.firstName,
                lastName: purgeUser.lastName,
                email: purgeUser.email,
                passwordHash: purgeUser.password,
                businessName: purgeTenant.name,
                status: "CONSUMED",
                termsAcceptedAt: new Date("2026-05-01T00:00:00Z"),
                termsVersion: "test-v1",
                verificationRequestedAt: new Date("2026-05-01T00:00:00Z"),
                emailVerifiedAt: new Date("2026-05-01T00:01:00Z"),
                consumedAt: new Date("2026-05-01T00:02:00Z"),
                provisionedTenantId: purgeTenant.id,
                provisionedUserId: purgeUser.id,
            },
        });
        await platformPrisma.category.create({
            data: { tenantId: purgeTenant.id, name: `Categoria privada ${tag}` },
        });
        await platformPrisma.tenantLifecycleEvent.create({
            data: {
                tenantId: purgeTenant.id,
                type: "TRIAL_EXPIRED",
                source: "test",
                actorUserId: purgeUser.id,
                metadata: { email: purgeUser.email },
            },
        });

        const now = new Date("2026-08-02T00:00:00Z");
        const first = await TenantLifecycleService.purgeDueTrials(now, purgeTenant.id);
        const replay = await TenantLifecycleService.purgeDueTrials(now, purgeTenant.id);
        expect(first).toMatchObject({ purged: 1, deletedUsers: 1 });
        expect(first.deletedRows).toBeGreaterThanOrEqual(3);
        expect(first.batches).toBeGreaterThan(0);
        expect(replay.purged).toBe(0);
        expect(await platformPrisma.category.count({ where: { tenantId: purgeTenant.id } })).toBe(0);
        expect(await platformPrisma.tenantMembership.count({ where: { tenantId: purgeTenant.id } })).toBe(0);
        expect(await platformPrisma.ownerRegistration.count({ where: { provisionedTenantId: purgeTenant.id } })).toBe(0);
        expect(await platformPrisma.user.count({ where: { id: purgeUser.id } })).toBe(0);
        const retained = await platformPrisma.tenantLifecycleEvent.findMany({
            where: { tenantId: purgeTenant.id },
            orderBy: { occurredAt: "asc" },
        });
        expect(retained.map((event) => event.type)).toEqual(["TRIAL_EXPIRED", "TRIAL_PURGED"]);
        expect(retained.every((event) => event.actorUserId === null && event.metadata === null)).toBe(true);
        const purged = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: purgeTenant.id } });
        expect(purged).toMatchObject({
            status: TenantStatus.PURGED,
            name: "Tenant purgado",
            legalName: null,
            ruc: null,
            contactEmail: null,
        });
    });

    it("convierte el mismo tenant mediante webhook firmado e idempotente", async () => {
        const service = new BillingWebhookService(secret);
        const body = Buffer.from(JSON.stringify({
            id: `evt-activate-${tag}`,
            type: "payment.succeeded",
            tenantId: trialId,
            plan: "STARTER",
            customerId: `cus-${tag}`,
            subscriptionId: `sub-${tag}`,
            currentPeriodEndsAt: "2026-09-02T00:00:00.000Z",
        }));
        const signature = createHmac("sha256", secret).update(body).digest("hex");
        const first = await service.process("sandbox", body, signature);
        const replay = await service.process("sandbox", body, signature);
        expect(first.replayed).toBe(false);
        expect(replay.replayed).toBe(true);
        const tenant = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: trialId } });
        expect(tenant.id).toBe(trialId);
        expect(tenant.kind).toBe(TenantKind.CUSTOMER);
        expect(tenant.status).toBe(TenantStatus.ACTIVE);
        expect(tenant.planCode).toBe(TenantPlanCode.STARTER);
        expect(await platformPrisma.billingWebhookEvent.count({
            where: { provider: "sandbox", externalEventId: `evt-activate-${tag}` },
        })).toBe(1);
    });

    it("rechaza firmas incorrectas antes de cambiar el tenant", async () => {
        const service = new BillingWebhookService(secret);
        const body = Buffer.from(JSON.stringify({
            id: `evt-invalid-${tag}`,
            type: "payment.failed",
            tenantId: activeId,
            plan: "STARTER",
        }));
        await expect(service.process("sandbox", body, "0".repeat(64)))
            .rejects.toMatchObject({ statusCode: 401 });
        expect((await platformPrisma.tenant.findUniqueOrThrow({ where: { id: activeId } })).status)
            .toBe(TenantStatus.ACTIVE);
    });

    it("suspende y reactiva el mismo tenant sin borrar ni duplicar datos", async () => {
        const service = new BillingWebhookService(secret);
        const failedBody = Buffer.from(JSON.stringify({
            id: `evt-failed-${tag}`,
            type: "payment.failed",
            tenantId: activeId,
            plan: "STARTER",
        }));
        const failedSignature = createHmac("sha256", secret).update(failedBody).digest("hex");
        await service.process("sandbox", failedBody, failedSignature);
        const suspended = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: activeId } });
        expect(suspended.status).toBe(TenantStatus.SUSPENDED);
        expect(suspended.sunatProductionEnabled).toBe(false);

        const activeBody = Buffer.from(JSON.stringify({
            id: `evt-reactivate-${tag}`,
            type: "payment.succeeded",
            tenantId: activeId,
            plan: "STARTER",
        }));
        const activeSignature = createHmac("sha256", secret).update(activeBody).digest("hex");
        await service.process("sandbox", activeBody, activeSignature);
        const reactivated = await platformPrisma.tenant.findUniqueOrThrow({ where: { id: activeId } });
        expect(reactivated.id).toBe(activeId);
        expect(reactivated.status).toBe(TenantStatus.ACTIVE);
        expect(await platformPrisma.tenant.count({ where: { id: activeId } })).toBe(1);
        expect(await platformPrisma.tenantLifecycleEvent.count({
            where: {
                tenantId: activeId,
                type: { in: ["SUBSCRIPTION_SUSPENDED", "SUBSCRIPTION_ACTIVATED"] },
            },
        })).toBe(2);
    });

    it("aprueba SUNAT producción solo con suscripción, propietario, PFX, SOL y serie verificados", async () => {
        const ruc = rucWithPrefix(`10${rucSeed}`);
        await platformPrisma.tenant.update({
            where: { id: activeId },
            data: { ruc, rucConfirmedAt: new Date("2026-08-01T00:00:00Z") },
        });
        await platformPrisma.tenantMembership.create({
            data: {
                tenantId: activeId,
                userId: ownerId,
                role: TenantMembershipRole.OWNER,
                status: TenantMembershipStatus.ACTIVE,
                activatedAt: new Date(),
            },
        });
        await platformPrisma.sunatEmisorConfig.create({
            data: {
                tenantId: activeId,
                environment: "PRODUCCION",
                ruc,
                razonSocial: "Empresa Activa SAC",
                solUser: "MODDATOS",
                solPasswordEnc: "v2.kms.fake",
                certP12Enc: "v2.kms.fake",
                certPasswordEnc: "v2.kms.fake",
                certSubjectCN: ruc,
                certNotAfter: new Date("2027-08-01T00:00:00Z"),
                certificateValidatedAt: new Date("2026-08-01T00:00:00Z"),
                credentialsVerifiedAt: new Date("2026-08-01T00:00:00Z"),
                activo: true,
            },
        });
        await platformPrisma.comprobanteSerie.create({
            data: { tenantId: activeId, tipo: "FACTURA", serie: `F${tag.slice(-3).toUpperCase()}` },
        });

        await platformPrisma.sunatEmisorConfig.update({
            where: { tenantId: activeId },
            data: { ruc: rucWithPrefix(`12${rucSeed}`) },
        });
        await expect(TenantLifecycleService.approveProduction(activeId, ownerId))
            .rejects.toMatchObject({ statusCode: 400 });
        await platformPrisma.sunatEmisorConfig.update({
            where: { tenantId: activeId },
            data: { ruc },
        });
        const approved = await TenantLifecycleService.approveProduction(activeId, ownerId);
        expect(approved.sunatProductionEnabled).toBe(true);
        expect(approved.productionApprovedById).toBe(ownerId);
    });
});
