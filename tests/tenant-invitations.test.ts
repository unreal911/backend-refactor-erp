import bcrypt from "bcryptjs";
import {
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantStatus,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { runTenantDatabaseTransaction } from "../src/data/prisma";
import { tenantPrisma } from "../src/data/tenant-prisma";
import { LoginDto } from "../src/domain/dtos/login.dto";
import { AuthService } from "../src/presentation/services/auth.service";
import {
    AcceptTenantInvitationDto,
    CreateTenantInvitationDto,
} from "../src/modules/invitations/tenant-invitation.dto";
import {
    TenantInvitationEmail,
    TenantInvitationEmailSender,
} from "../src/modules/invitations/ports/tenant-invitation-email.port";
import {
    TenantInvitationError,
    TenantInvitationService,
} from "../src/modules/invitations/tenant-invitation.service";
import { TenantRequestContext } from "../src/modules/tenant/tenant-context.service";

class FakeInvitationSender implements TenantInvitationEmailSender {
    readonly messages: TenantInvitationEmail[] = [];

    async sendInvitation(message: TenantInvitationEmail): Promise<void> {
        this.messages.push(message);
    }

    tokenFor(email: string): string {
        const token = [...this.messages].reverse().find((item) => item.to === email)?.token;
        if (!token) throw new Error(`Token no disponible para ${email}`);
        return token;
    }
}

const tag = `${Date.now().toString(36)}-${process.pid}`;
const prefix = `emp005-${tag}`;
const password = "Segura-2026!Clave";
const sender = new FakeInvitationSender();
let currentTime = new Date("2026-08-02T15:00:00.000Z");
const service = new TenantInvitationService(sender, {
    tokenPepper: "emp-005-invitation-token-pepper-with-at-least-32-chars",
    ttlHours: 72,
    now: () => currentTime,
    bcryptRounds: 4,
});

let adminRoleId = 0;
let sellerRoleId = 0;
let userRoleId = 0;
let ownerAId = 0;
let ownerBId = 0;
let ownerAMembershipId = "";
let ownerBMembershipId = "";
let tenantAId = "";
let tenantBId = "";

function inviteDto(email: string, role: TenantMembershipRole) {
    const [error, dto] = CreateTenantInvitationDto.create({ email, role });
    if (error || !dto) throw new Error(error ?? "DTO de invitaci\u00f3n no disponible");
    return dto;
}

function acceptDto(
    token: string,
    overrides: Record<string, unknown> = {},
) {
    const [error, dto] = AcceptTenantInvitationDto.create({
        token,
        password,
        ...overrides,
    });
    if (error || !dto) throw new Error(error ?? "DTO de aceptaci\u00f3n no disponible");
    return dto;
}

function context(
    tenantId: string,
    tenantSlug: string,
    tenantName: string,
    membershipId: string,
    role: TenantMembershipRole,
): TenantRequestContext {
    return {
        tenant: {
            id: tenantId,
            slug: tenantSlug,
            name: tenantName,
            status: TenantStatus.ACTIVE,
            databaseMode: "SHARED",
            trialEndsAt: null,
        },
        membership: {
            id: membershipId,
            role,
            status: TenantMembershipStatus.ACTIVE,
        },
        rbacRole: role === TenantMembershipRole.SELLER ? "SELLER" : "ADMIN",
    };
}

beforeAll(async () => {
    const [adminRole, sellerRole, userRole] = await Promise.all([
        platformPrisma.role.upsert({
            where: { name: "ADMIN" },
            update: { isActive: true },
            create: { name: "ADMIN", isActive: true },
        }),
        platformPrisma.role.upsert({
            where: { name: "SELLER" },
            update: { isActive: true },
            create: { name: "SELLER", isActive: true },
        }),
        platformPrisma.role.upsert({
            where: { name: "USER" },
            update: { isActive: true },
            create: { name: "USER", isActive: true },
        }),
    ]);
    adminRoleId = adminRole.id;
    sellerRoleId = sellerRole.id;
    userRoleId = userRole.id;

    const passwordHash = await bcrypt.hash(password, 4);
    const [ownerA, ownerB] = await Promise.all([
        platformPrisma.user.create({
            data: {
                firstName: "Olga",
                lastName: "Owner A",
                email: `${prefix}-owner-a@example.test`,
                password: passwordHash,
                roleId: adminRoleId,
            },
        }),
        platformPrisma.user.create({
            data: {
                firstName: "Omar",
                lastName: "Owner B",
                email: `${prefix}-owner-b@example.test`,
                password: passwordHash,
                roleId: adminRoleId,
            },
        }),
    ]);
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;

    const [tenantA, tenantB] = await Promise.all([
        platformPrisma.tenant.create({
            data: {
                slug: `${prefix}-a`,
                name: `EMP005 Empresa A ${tag}`,
                status: TenantStatus.ACTIVE,
            },
        }),
        platformPrisma.tenant.create({
            data: {
                slug: `${prefix}-b`,
                name: `EMP005 Empresa B ${tag}`,
                status: TenantStatus.ACTIVE,
            },
        }),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    const [membershipA, membershipB] = await Promise.all([
        platformPrisma.tenantMembership.create({
            data: {
                tenantId: tenantAId,
                userId: ownerAId,
                role: TenantMembershipRole.OWNER,
                status: TenantMembershipStatus.ACTIVE,
                activatedAt: currentTime,
            },
        }),
        platformPrisma.tenantMembership.create({
            data: {
                tenantId: tenantBId,
                userId: ownerBId,
                role: TenantMembershipRole.OWNER,
                status: TenantMembershipStatus.ACTIVE,
                activatedAt: currentTime,
            },
        }),
    ]);
    ownerAMembershipId = membershipA.id;
    ownerBMembershipId = membershipB.id;
});

afterAll(async () => {
    await platformPrisma.tenantInvitation.deleteMany({
        where: { email: { startsWith: prefix } },
    }).catch(() => undefined);
    await platformPrisma.tenantMembership.deleteMany({
        where: { tenantId: { in: [tenantAId, tenantBId].filter(Boolean) } },
    }).catch(() => undefined);
    await platformPrisma.tenant.deleteMany({
        where: { id: { in: [tenantAId, tenantBId].filter(Boolean) } },
    }).catch(() => undefined);
    await platformPrisma.user.deleteMany({
        where: { email: { startsWith: prefix } },
    }).catch(() => undefined);
    await platformPrisma.$disconnect().catch(() => undefined);
});

describe("EMP-005 invitaciones y autenticaci\u00f3n multiempresa", () => {
    it("permite a OWNER invitar un rol permitido y persiste solo HMAC", async () => {
        const email = `${prefix}-secure@example.test`;
        const created = await runTenantDatabaseTransaction(tenantAId, () =>
            service.invite(
                inviteDto(email, TenantMembershipRole.SELLER),
                {
                    userId: ownerAId,
                    email: `${prefix}-owner-a@example.test`,
                    tenant: context(
                        tenantAId,
                        `${prefix}-a`,
                        `EMP005 Empresa A ${tag}`,
                        ownerAMembershipId,
                        TenantMembershipRole.OWNER,
                    ),
                },
            ));

        const token = sender.tokenFor(email);
        const stored = await platformPrisma.tenantInvitation.findUniqueOrThrow({
            where: { id: created.id },
        });
        expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(stored.tokenHash).not.toBe(token);
        expect(stored.tenantId).toBe(tenantAId);
        expect(stored.role).toBe(TenantMembershipRole.SELLER);
        expect(created).not.toHaveProperty("token");
    });

    it("impide que SELLER invite y no permite asignar OWNER", async () => {
        expect(CreateTenantInvitationDto.create({
            email: `${prefix}-owner-role@example.test`,
            role: "OWNER",
        })[0]).toBeDefined();

        await runTenantDatabaseTransaction(tenantAId, async () => {
            await expect(service.invite(
                inviteDto(`${prefix}-seller-denied@example.test`, TenantMembershipRole.VIEWER),
                {
                    userId: ownerAId,
                    email: `${prefix}-owner-a@example.test`,
                    tenant: context(
                        tenantAId,
                        `${prefix}-a`,
                        `EMP005 Empresa A ${tag}`,
                        ownerAMembershipId,
                        TenantMembershipRole.SELLER,
                    ),
                },
            )).rejects.toMatchObject({ statusCode: 403 });
        });
    });

    it("crea una cuenta nueva solo tras probar correo y contrase\u00f1a fuerte", async () => {
        const email = `${prefix}-new-account@example.test`;
        await runTenantDatabaseTransaction(tenantAId, () => service.invite(
            inviteDto(email, TenantMembershipRole.VIEWER),
            {
                userId: ownerAId,
                email: `${prefix}-owner-a@example.test`,
                tenant: context(
                    tenantAId,
                    `${prefix}-a`,
                    `EMP005 Empresa A ${tag}`,
                    ownerAMembershipId,
                    TenantMembershipRole.OWNER,
                ),
            },
        ));
        const token = sender.tokenFor(email);

        await expect(service.accept(acceptDto(token)))
            .rejects.toMatchObject({ statusCode: 400 });
        const accepted = await service.accept(acceptDto(token, {
            firstName: "Valeria",
            lastName: "Visora",
        }));

        expect(accepted.accountCreated).toBe(true);
        expect(accepted.membership).toMatchObject({
            role: TenantMembershipRole.VIEWER,
            status: TenantMembershipStatus.ACTIVE,
        });
        const user = await platformPrisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.roleId).toBe(userRoleId);
        expect(user.password).not.toBe(password);
        expect(await bcrypt.compare(password, user.password)).toBe(true);
    });

    it("para una cuenta existente crea solo membres\u00eda y el replay no duplica", async () => {
        const email = `${prefix}-existing@example.test`;
        const existing = await platformPrisma.user.create({
            data: {
                firstName: "Eva",
                lastName: "Existente",
                email,
                password: await bcrypt.hash(password, 4),
                roleId: sellerRoleId,
            },
        });
        await platformPrisma.tenantMembership.create({
            data: {
                tenantId: tenantBId,
                userId: existing.id,
                role: TenantMembershipRole.SELLER,
                status: TenantMembershipStatus.ACTIVE,
                activatedAt: currentTime,
            },
        });

        await runTenantDatabaseTransaction(tenantAId, () => service.invite(
            inviteDto(email, TenantMembershipRole.ADMIN),
            {
                userId: ownerAId,
                email: `${prefix}-owner-a@example.test`,
                tenant: context(
                    tenantAId,
                    `${prefix}-a`,
                    `EMP005 Empresa A ${tag}`,
                    ownerAMembershipId,
                    TenantMembershipRole.OWNER,
                ),
            },
        ));
        const token = sender.tokenFor(email);

        await expect(service.accept(acceptDto(token, { password: "incorrecta" })))
            .rejects.toBeInstanceOf(TenantInvitationError);
        const first = await service.accept(acceptDto(token));
        const replay = await service.accept(acceptDto(token));

        expect(first.accountCreated).toBe(false);
        expect(replay.idempotentReplay).toBe(true);
        expect(replay.membership.id).toBe(first.membership.id);
        expect(await platformPrisma.user.count({ where: { email } })).toBe(1);
        expect(await platformPrisma.tenantMembership.count({
            where: { userId: existing.id },
        })).toBe(2);

        await expect(AuthService.login(LoginDto.create({ email, password })[1]!))
            .rejects.toMatchObject({ statusCode: 409 });
        const selected = await AuthService.login(LoginDto.create({
            email,
            password,
            tenantSlug: `${prefix}-a`,
        })[1]!);
        expect(selected.user.tenant.id).toBe(tenantAId);
        expect(selected.user.membership.id).toBe(first.membership.id);
        await expect(AuthService.login(LoginDto.create({
            email,
            password,
            tenantSlug: "empresa-ajena",
        })[1]!)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("mantiene invitaciones aisladas por RLS entre dos empresas", async () => {
        const emailA = `${prefix}-isolation-a@example.test`;
        const emailB = `${prefix}-isolation-b@example.test`;
        await runTenantDatabaseTransaction(tenantAId, () => service.invite(
            inviteDto(emailA, TenantMembershipRole.SELLER),
            {
                userId: ownerAId,
                email: `${prefix}-owner-a@example.test`,
                tenant: context(
                    tenantAId,
                    `${prefix}-a`,
                    `EMP005 Empresa A ${tag}`,
                    ownerAMembershipId,
                    TenantMembershipRole.OWNER,
                ),
            },
        ));
        await runTenantDatabaseTransaction(tenantBId, () => service.invite(
            inviteDto(emailB, TenantMembershipRole.VIEWER),
            {
                userId: ownerBId,
                email: `${prefix}-owner-b@example.test`,
                tenant: context(
                    tenantBId,
                    `${prefix}-b`,
                    `EMP005 Empresa B ${tag}`,
                    ownerBMembershipId,
                    TenantMembershipRole.OWNER,
                ),
            },
        ));

        await runTenantDatabaseTransaction(tenantAId, async () => {
            const visible = await tenantPrisma.tenantInvitation.findMany({
                where: { email: { in: [emailA, emailB] } },
            });
            expect(visible.map((item) => item.email)).toEqual([emailA]);
            expect(await tenantPrisma.tenantInvitation.updateMany({
                where: { email: emailB },
                data: { role: TenantMembershipRole.ADMIN },
            })).toMatchObject({ count: 0 });
        });
        await expect(async () => tenantPrisma.tenantInvitation.findMany())
            .rejects.toThrow("Contexto tenant requerido");
    });

    it("vence la invitaci\u00f3n usando tiempo de servidor", async () => {
        const email = `${prefix}-expired@example.test`;
        await runTenantDatabaseTransaction(tenantAId, () => service.invite(
            inviteDto(email, TenantMembershipRole.VIEWER),
            {
                userId: ownerAId,
                email: `${prefix}-owner-a@example.test`,
                tenant: context(
                    tenantAId,
                    `${prefix}-a`,
                    `EMP005 Empresa A ${tag}`,
                    ownerAMembershipId,
                    TenantMembershipRole.OWNER,
                ),
            },
        ));
        const token = sender.tokenFor(email);
        currentTime = new Date(currentTime.getTime() + 73 * 60 * 60_000);

        await expect(service.inspect(token)).rejects.toMatchObject({ statusCode: 410 });
        expect(await platformPrisma.tenantInvitation.findFirstOrThrow({
            where: { email },
        })).toMatchObject({ status: "EXPIRED" });
    });
});
