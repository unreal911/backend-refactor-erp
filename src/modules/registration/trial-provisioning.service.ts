import {
    Prisma,
    TenantDatabaseMode,
    TenantKind,
    TenantMembershipRole,
    TenantMembershipStatus,
    TenantStatus,
} from "@prisma/client";
import { TenantService } from "../tenant/tenant.service";
import {
    ConsumedOwnerIdentity,
    OwnerRegistrationService,
    VerifiedOwnerIdentity,
} from "./owner-registration.service";

const TRIAL_DURATION_MS = 15 * 24 * 60 * 60 * 1000;
const MAX_SLUG_LENGTH = 63;
const MAX_SLUG_BASE_LENGTH = 54;

export class TrialProvisioningConflictError extends Error {
    readonly statusCode = 409;

    constructor() {
        super("La identidad ya está asociada a un usuario");
    }
}

export class TrialProvisioningConfigurationError extends Error {
    readonly statusCode = 503;

    constructor() {
        super("No se pudo preparar el rol propietario de la prueba");
    }
}

export type ProvisionedTrial = {
    replayed: boolean;
    tenant: {
        id: string;
        slug: string;
        name: string;
        kind: TenantKind;
        status: TenantStatus;
        databaseMode: TenantDatabaseMode;
        trialStartedAt: Date | null;
        trialEndsAt: Date | null;
    };
    membership: {
        id: string;
        role: TenantMembershipRole;
        status: TenantMembershipStatus;
    };
};

export type TrialProvisioningServiceOptions = {
    now?: () => Date;
    tenantProvisioner?: Pick<typeof TenantService, "createWithinTransaction">;
};

export class TrialProvisioningService {
    private readonly now: () => Date;
    private readonly tenantProvisioner: Pick<typeof TenantService, "createWithinTransaction">;

    constructor(
        private readonly registrationService: OwnerRegistrationService,
        options: TrialProvisioningServiceOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
        this.tenantProvisioner = options.tenantProvisioner ?? TenantService;
    }

    private normalizeSlug(value: string): string {
        const normalized = value
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, MAX_SLUG_BASE_LENGTH)
            .replace(/-+$/g, "");
        return normalized || "empresa";
    }

    private async allocateSlug(
        businessName: string,
        tx: Prisma.TransactionClient,
    ): Promise<string> {
        const base = this.normalizeSlug(businessName);
        await tx.$queryRaw(Prisma.sql`
            SELECT 1 AS "locked"
            FROM pg_advisory_xact_lock(
                hashtextextended(${`trial-slug:${base}`}, 0)
            )
        `);
        const existing = await tx.tenant.findMany({
            where: {
                OR: [
                    { slug: base },
                    { slug: { startsWith: `${base}-` } },
                ],
            },
            select: { slug: true },
        });
        const taken = new Set(existing.map((tenant) => tenant.slug));
        if (!taken.has(base)) return base;

        for (let suffix = 2; suffix < 1_000_000; suffix += 1) {
            const suffixText = `-${suffix}`;
            const prefix = base
                .slice(0, MAX_SLUG_LENGTH - suffixText.length)
                .replace(/-+$/g, "");
            const candidate = `${prefix}${suffixText}`;
            if (!taken.has(candidate)) return candidate;
        }
        throw new TrialProvisioningConfigurationError();
    }

    private result(
        tenant: ProvisionedTrial["tenant"],
        membership: ProvisionedTrial["membership"],
        replayed: boolean,
    ): ProvisionedTrial {
        return {
            replayed,
            tenant: {
                id: tenant.id,
                slug: tenant.slug,
                name: tenant.name,
                kind: tenant.kind,
                status: tenant.status,
                databaseMode: tenant.databaseMode,
                trialStartedAt: tenant.trialStartedAt,
                trialEndsAt: tenant.trialEndsAt,
            },
            membership: {
                id: membership.id,
                role: membership.role,
                status: membership.status,
            },
        };
    }

    private async createTrial(
        identity: VerifiedOwnerIdentity,
        tx: Prisma.TransactionClient,
    ): Promise<ProvisionedTrial> {
        const existingUser = await tx.user.findFirst({
            where: { email: { equals: identity.email, mode: "insensitive" } },
            select: { id: true },
        });
        if (existingUser) throw new TrialProvisioningConflictError();

        const adminRole = await tx.role.findUnique({
            where: { name: "ADMIN" },
            select: { id: true, isActive: true },
        });
        if (!adminRole?.isActive) throw new TrialProvisioningConfigurationError();

        const now = this.now();
        const user = await tx.user.create({
            data: {
                firstName: identity.firstName,
                lastName: identity.lastName,
                email: identity.email,
                password: identity.passwordHash,
                roleId: adminRole.id,
                isActive: true,
            },
        });
        const slug = await this.allocateSlug(identity.businessName, tx);
        const provisioned = await this.tenantProvisioner.createWithinTransaction({
            slug,
            name: identity.businessName,
            status: TenantStatus.TRIAL,
            kind: TenantKind.TRIAL,
            trialEndsAt: new Date(now.getTime() + TRIAL_DURATION_MS),
            ownerUserId: user.id,
            contactEmail: identity.email,
        }, tx, now);

        await tx.ownerRegistration.update({
            where: { id: identity.id },
            data: {
                provisionedTenantId: provisioned.tenant.id,
                provisionedUserId: user.id,
            },
        });

        await tx.trialBenefitClaim.upsert({
            where: { tenantId: provisioned.tenant.id },
            create: {
                tenantId: provisioned.tenant.id,
                emailFingerprint: identity.signupEmailFingerprint,
                ipFingerprint: identity.signupIpFingerprint,
                deviceFingerprint: identity.signupDeviceFingerprint,
                claimedAt: now,
            },
            update: {},
        });

        return this.result(provisioned.tenant, provisioned.membership, false);
    }

    private async replayTrial(
        registration: ConsumedOwnerIdentity,
        tx: Prisma.TransactionClient,
    ): Promise<ProvisionedTrial> {
        const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: registration.provisionedTenantId },
        });
        const membership = await tx.tenantMembership.findUniqueOrThrow({
            where: {
                userId_tenantId: {
                    userId: registration.provisionedUserId,
                    tenantId: registration.provisionedTenantId,
                },
            },
        });
        return this.result(
            tenant,
            {
                id: membership.id,
                role: membership.role,
                status: membership.status,
            },
            true,
        );
    }

    async provision(trialToken: string): Promise<ProvisionedTrial> {
        try {
            return await this.registrationService.consumeVerifiedIdentity(
                trialToken,
                (identity, tx) => this.createTrial(identity, tx),
                (registration, tx) => this.replayTrial(registration, tx),
            );
        } catch (caught) {
            if (
                caught instanceof Prisma.PrismaClientKnownRequestError
                && caught.code === "P2002"
            ) {
                throw new TrialProvisioningConflictError();
            }
            throw caught;
        }
    }
}
