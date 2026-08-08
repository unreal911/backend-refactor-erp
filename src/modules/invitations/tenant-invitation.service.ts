import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
    Prisma,
    TenantInvitationStatus,
    TenantMembershipRole,
    TenantMembershipStatus,
} from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";
import { tenantPrisma } from "../../data/tenant-prisma";
import { TenantRequestContext } from "../tenant/tenant-context.service";
import { TenantQuotaService } from "../lifecycle/tenant-lifecycle.service";
import {
    AcceptTenantInvitationDto,
    CreateTenantInvitationDto,
    strongInvitationPasswordError,
} from "./tenant-invitation.dto";
import { TenantInvitationEmailSender } from "./ports/tenant-invitation-email.port";

const DEFAULT_BCRYPT_ROUNDS = 12;

export class TenantInvitationError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "TenantInvitationError";
    }
}

export type TenantInvitationServiceOptions = {
    tokenPepper: string;
    ttlHours: number;
    now?: () => Date;
    createToken?: () => string;
    bcryptRounds?: number;
};

type InvitationActor = {
    userId: number;
    email: string;
    tenant: TenantRequestContext;
};

export class TenantInvitationService {
    private readonly now: () => Date;
    private readonly createToken: () => string;
    private readonly bcryptRounds: number;

    constructor(
        private readonly emailSender: TenantInvitationEmailSender,
        private readonly options: TenantInvitationServiceOptions,
    ) {
        this.now = options.now ?? (() => new Date());
        this.createToken = options.createToken
            ?? (() => randomBytes(32).toString("base64url"));
        this.bcryptRounds = options.bcryptRounds ?? DEFAULT_BCRYPT_ROUNDS;
    }

    private hashToken(token: string): string {
        return createHmac("sha256", this.options.tokenPepper)
            .update(token, "utf8")
            .digest("hex");
    }

    private expiration(now: Date): Date {
        return new Date(now.getTime() + this.options.ttlHours * 60 * 60_000);
    }

    private assertCanInvite(role: TenantMembershipRole): void {
        if (
            role !== TenantMembershipRole.OWNER
            && role !== TenantMembershipRole.ADMIN
        ) {
            throw new TenantInvitationError(
                "Solo OWNER o ADMIN puede invitar colaboradores",
                403,
            );
        }
    }

    private globalRoleName(role: TenantMembershipRole): string {
        if (role === TenantMembershipRole.ADMIN) return "ADMIN";
        if (role === TenantMembershipRole.SELLER) return "SELLER";
        return "USER";
    }

    async invite(dto: CreateTenantInvitationDto, actor: InvitationActor) {
        this.assertCanInvite(actor.tenant.membership.role);
        const tenantId = actor.tenant.tenant.id;
        const now = this.now();
        const expiresAt = this.expiration(now);
        const token = this.createToken();
        const tokenHash = this.hashToken(token);

        await tenantPrisma.$queryRaw(
            Prisma.sql`
                SELECT 1 AS "locked"
                FROM pg_advisory_xact_lock(
                    hashtextextended(${`${tenantId}|${dto.email}`}, 0)
                )
            `,
        );

        const inviter = await tenantPrisma.tenantMembership.findFirst({
            where: {
                id: actor.tenant.membership.id,
                userId: actor.userId,
                tenantId,
                status: TenantMembershipStatus.ACTIVE,
            },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                    },
                },
            },
        });
        if (!inviter || inviter.role !== actor.tenant.membership.role) {
            throw new TenantInvitationError("La membres\u00eda del invitador no es v\u00e1lida", 403);
        }

        await tenantPrisma.tenantInvitation.updateMany({
            where: {
                tenantId,
                email: dto.email,
                status: TenantInvitationStatus.PENDING,
                expiresAt: { lte: now },
            },
            data: { status: TenantInvitationStatus.EXPIRED },
        });

        const membership = await tenantPrisma.tenantMembership.findFirst({
            where: {
                tenantId,
                user: {
                    email: { equals: dto.email, mode: "insensitive" },
                },
            },
            select: { id: true, status: true },
        });
        if (membership) {
            throw new TenantInvitationError("El usuario ya pertenece a esta empresa", 409);
        }

        const pending = await tenantPrisma.tenantInvitation.findFirst({
            where: {
                tenantId,
                email: dto.email,
                status: TenantInvitationStatus.PENDING,
            },
            select: { id: true },
        });

        if (!pending) {
            await TenantQuotaService.assertAvailable("users");
        }

        const invitation = pending
            ? await tenantPrisma.tenantInvitation.update({
                where: { id: pending.id },
                data: {
                    role: dto.role,
                    tokenHash,
                    expiresAt,
                    invitedByMembershipId: inviter.id,
                },
            })
            : await tenantPrisma.tenantInvitation.create({
                data: {
                    tenantId,
                    email: dto.email,
                    role: dto.role,
                    tokenHash,
                    expiresAt,
                    invitedByMembershipId: inviter.id,
                },
            });

        const inviterName = `${inviter.user.firstName} ${inviter.user.lastName}`.trim()
            || inviter.user.email;
        await this.emailSender.sendInvitation({
            to: dto.email,
            tenantName: actor.tenant.tenant.name,
            inviterName,
            role: dto.role,
            token,
            expiresAt,
        });

        return {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            resent: Boolean(pending),
        };
    }

    async list(tenant: TenantRequestContext) {
        this.assertCanInvite(tenant.membership.role);
        const now = this.now();
        await tenantPrisma.tenantInvitation.updateMany({
            where: {
                status: TenantInvitationStatus.PENDING,
                expiresAt: { lte: now },
            },
            data: { status: TenantInvitationStatus.EXPIRED },
        });
        return tenantPrisma.tenantInvitation.findMany({
            select: {
                id: true,
                email: true,
                role: true,
                status: true,
                expiresAt: true,
                acceptedAt: true,
                createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
    }

    async revoke(id: string, tenant: TenantRequestContext) {
        this.assertCanInvite(tenant.membership.role);
        const revoked = await tenantPrisma.tenantInvitation.updateMany({
            where: {
                id,
                status: TenantInvitationStatus.PENDING,
            },
            data: {
                status: TenantInvitationStatus.REVOKED,
                revokedAt: this.now(),
            },
        });
        if (revoked.count !== 1) {
            throw new TenantInvitationError("La invitaci\u00f3n no est\u00e1 pendiente", 404);
        }
        return { message: "Invitaci\u00f3n revocada" };
    }

    async inspect(token: string) {
        const tokenHash = this.hashToken(token);
        const now = this.now();
        const invitation = await platformPrisma.tenantInvitation.findUnique({
            where: { tokenHash },
            include: {
                tenant: {
                    select: { id: true, slug: true, name: true, status: true },
                },
            },
        });
        if (!invitation) {
            throw new TenantInvitationError("La invitaci\u00f3n es inv\u00e1lida o venci\u00f3", 400);
        }
        if (
            invitation.status === TenantInvitationStatus.PENDING
            && invitation.expiresAt <= now
        ) {
            await platformPrisma.tenantInvitation.updateMany({
                where: {
                    id: invitation.id,
                    status: TenantInvitationStatus.PENDING,
                },
                data: { status: TenantInvitationStatus.EXPIRED },
            });
            throw new TenantInvitationError("La invitaci\u00f3n venci\u00f3", 410);
        }
        if (
            invitation.status !== TenantInvitationStatus.PENDING
            && invitation.status !== TenantInvitationStatus.ACCEPTED
        ) {
            throw new TenantInvitationError("La invitaci\u00f3n ya no est\u00e1 disponible", 410);
        }

        const existingAccount = await platformPrisma.user.findFirst({
            where: {
                email: { equals: invitation.email, mode: "insensitive" },
            },
            select: { id: true },
        });
        return {
            email: invitation.email,
            role: invitation.role,
            status: invitation.status,
            expiresAt: invitation.expiresAt,
            existingAccount: Boolean(existingAccount),
            tenant: invitation.tenant,
        };
    }

    async accept(dto: AcceptTenantInvitationDto) {
        const tokenHash = this.hashToken(dto.token);
        const now = this.now();

        return platformPrisma.$transaction(async (tx) => {
            await tx.$queryRaw(
                Prisma.sql`
                    SELECT 1 AS "locked"
                    FROM pg_advisory_xact_lock(hashtextextended(${tokenHash}, 0))
                `,
            );
            const invitation = await tx.tenantInvitation.findUnique({
                where: { tokenHash },
                include: {
                    tenant: {
                        select: { id: true, slug: true, name: true, status: true },
                    },
                    acceptedMembership: {
                        include: {
                            user: { select: { id: true, email: true } },
                        },
                    },
                },
            });
            if (!invitation) {
                throw new TenantInvitationError("La invitaci\u00f3n es inv\u00e1lida o venci\u00f3", 400);
            }
            if (
                invitation.status === TenantInvitationStatus.ACCEPTED
                && invitation.acceptedMembership
            ) {
                return {
                    tenant: invitation.tenant,
                    membership: {
                        id: invitation.acceptedMembership.id,
                        role: invitation.acceptedMembership.role,
                        status: invitation.acceptedMembership.status,
                    },
                    email: invitation.acceptedMembership.user.email,
                    accountCreated: false,
                    idempotentReplay: true,
                };
            }
            if (
                invitation.status !== TenantInvitationStatus.PENDING
                || invitation.expiresAt <= now
            ) {
                if (
                    invitation.status === TenantInvitationStatus.PENDING
                    && invitation.expiresAt <= now
                ) {
                    await tx.tenantInvitation.update({
                        where: { id: invitation.id },
                        data: { status: TenantInvitationStatus.EXPIRED },
                    });
                }
                throw new TenantInvitationError("La invitaci\u00f3n es inv\u00e1lida o venci\u00f3", 410);
            }

            let user = await tx.user.findFirst({
                where: {
                    email: { equals: invitation.email, mode: "insensitive" },
                },
                select: {
                    id: true,
                    email: true,
                    password: true,
                    isActive: true,
                },
            });
            let accountCreated = false;

            if (user) {
                if (!user.isActive || !await bcrypt.compare(dto.password, user.password)) {
                    throw new TenantInvitationError("Credenciales inv\u00e1lidas", 401);
                }
            } else {
                if (!dto.firstName || !dto.lastName) {
                    throw new TenantInvitationError(
                        "Nombre y apellido son obligatorios para crear la cuenta",
                        400,
                    );
                }
                const passwordError = strongInvitationPasswordError(dto.password);
                if (passwordError) {
                    throw new TenantInvitationError(passwordError, 400);
                }
                const globalRole = await tx.role.findUnique({
                    where: { name: this.globalRoleName(invitation.role) },
                    select: { id: true, isActive: true },
                });
                if (!globalRole?.isActive) {
                    throw new TenantInvitationError("El rol de acceso no est\u00e1 configurado", 503);
                }
                user = await tx.user.create({
                    data: {
                        firstName: dto.firstName,
                        lastName: dto.lastName,
                        email: invitation.email,
                        password: await bcrypt.hash(dto.password, this.bcryptRounds),
                        roleId: globalRole.id,
                        isActive: true,
                    },
                    select: {
                        id: true,
                        email: true,
                        password: true,
                        isActive: true,
                    },
                });
                accountCreated = true;
            }

            const existingMembership = await tx.tenantMembership.findUnique({
                where: {
                    userId_tenantId: {
                        userId: user.id,
                        tenantId: invitation.tenantId,
                    },
                },
            });
            const membership = existingMembership ?? await tx.tenantMembership.create({
                data: {
                    tenantId: invitation.tenantId,
                    userId: user.id,
                    role: invitation.role,
                    status: TenantMembershipStatus.ACTIVE,
                    invitedAt: invitation.createdAt,
                    activatedAt: now,
                },
            });
            if (
                existingMembership
                && existingMembership.status !== TenantMembershipStatus.ACTIVE
            ) {
                throw new TenantInvitationError("La membres\u00eda existente est\u00e1 inactiva", 409);
            }

            const accepted = await tx.tenantInvitation.updateMany({
                where: {
                    id: invitation.id,
                    tokenHash,
                    status: TenantInvitationStatus.PENDING,
                    expiresAt: { gt: now },
                },
                data: {
                    status: TenantInvitationStatus.ACCEPTED,
                    acceptedMembershipId: membership.id,
                    acceptedAt: now,
                },
            });
            if (accepted.count !== 1) {
                throw new TenantInvitationError("La invitaci\u00f3n ya fue procesada", 409);
            }

            return {
                tenant: invitation.tenant,
                membership: {
                    id: membership.id,
                    role: membership.role,
                    status: membership.status,
                },
                email: user.email,
                accountCreated,
                idempotentReplay: false,
            };
        }, {
            maxWait: 10_000,
            timeout: 30_000,
        });
    }
}
