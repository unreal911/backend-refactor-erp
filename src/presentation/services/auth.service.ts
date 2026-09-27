import { platformPrisma as prisma } from '../../data/platform-prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { LoginDto } from '../../domain/dtos/login.dto';
import { PermissionService } from './permission.service';
import { envs } from '../../config/envs';
import {
    TenantContextService,
    TenantRequestContext,
} from '../../modules/tenant/tenant-context.service';
import { PlanAccessService } from '../../modules/plans/plan-access.service';
import { TenantPlanCode } from '@prisma/client';
import { getAuthChannelPolicy } from '../../modules/auth/auth-channel-policy';

type AuthUserPayload = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    isActive: boolean;
    authVersion: number;
    role: {
        name: string;
    };
};

export class AccountActivationRequiredError extends Error {
    readonly statusCode = 403;
    readonly code: "EMAIL_VERIFICATION_REQUIRED" | "TRIAL_SETUP_REQUIRED";

    constructor(code: AccountActivationRequiredError["code"]) {
        super(code === "EMAIL_VERIFICATION_REQUIRED"
            ? "Tu cuenta todavía no está activada. Solicita otra verificación y revisa tu WhatsApp o correo."
            : "Tu cuenta ya está verificada, pero falta terminar de crear la prueba. Solicita un nuevo enlace para continuar.");
        this.code = code;
    }
}

export class AuthChannelDisabledError extends Error {
    readonly statusCode = 403;

    constructor(channel: "email" | "whatsapp") {
        super(channel === "email"
            ? "El inicio de sesión por correo está deshabilitado"
            : "El inicio de sesión por WhatsApp está deshabilitado");
        this.name = "AuthChannelDisabledError";
    }
}

export class AuthService {
    private static async buildAuthUserContext(
        user: AuthUserPayload,
        tenantContext: TenantRequestContext,
    ) {
        const permissions = await PermissionService.resolvePermissionsForMembership({
            membershipId: tenantContext.membership.id,
            roleName: tenantContext.rbacRole,
        });
        const planSnapshot = {
            planCode: tenantContext.tenant.planCode ?? TenantPlanCode.STARTER,
            planFeatures: tenantContext.tenant.planFeatures ?? [],
            welcomeStorePromotionEndsAt: tenantContext.tenant.welcomeStorePromotionEndsAt ?? null,
        };
        const planFeatures = Array.from(PlanAccessService.effectiveFeatures(planSnapshot)).sort();

        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: tenantContext.rbacRole,
            permissions,
            tenant: tenantContext.tenant,
            membership: tenantContext.membership,
            plan: {
                code: planSnapshot.planCode,
                features: planFeatures,
            },
        };
    }

    // Re-verificacion de contraseña (step-up) para acciones sensibles.
    static async verifyUserPassword(userId: number, password: string): Promise<boolean> {
        if (!password) return false;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { password: true, isActive: true },
        });
        if (!user || !user.isActive) return false;
        return bcrypt.compare(password, user.password);
    }

    static async login(loginDto: LoginDto) {
        const identifier = loginDto.email.trim();
        const isEmail = identifier.includes("@");
        const { password } = loginDto;
        const policy = await getAuthChannelPolicy();
        if (isEmail && !policy.loginEmailEnabled) throw new AuthChannelDisabledError("email");
        if (!isEmail && !policy.loginWhatsappEnabled) throw new AuthChannelDisabledError("whatsapp");

        const user = await prisma.user.findUnique({
            where: isEmail ? { email: identifier.toLowerCase() } : { phone: identifier },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                password: true,
                isActive: true,
                authVersion: true,
                role: {
                    select: {
                        name: true
                    }
                }
            }
        });

        if (!user) {
            const pendingRegistration = await prisma.ownerRegistration.findUnique({
                where: isEmail ? { email: identifier.toLowerCase() } : { phone: identifier },
                select: { passwordHash: true, status: true },
            });
            if (pendingRegistration) {
                const pendingPasswordValid = await bcrypt.compare(
                    password,
                    pendingRegistration.passwordHash,
                );
                if (pendingPasswordValid && pendingRegistration.status === "EMAIL_PENDING") {
                    throw new AccountActivationRequiredError("EMAIL_VERIFICATION_REQUIRED");
                }
                if (pendingPasswordValid && pendingRegistration.status === "EMAIL_VERIFIED") {
                    throw new AccountActivationRequiredError("TRIAL_SETUP_REQUIRED");
                }
            }
            throw new Error('Credenciales invalidas');
        }

        if (!user.isActive) {
            throw new Error('Usuario inactivo');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Credenciales invalidas');
        }

        const tenantContext = await TenantContextService.resolveForLogin(
            user.id,
            loginDto.tenantSlug,
        );
        const authUser = await this.buildAuthUserContext(
            {
                ...user,
                email: user.email ?? user.phone ?? "",
            } as AuthUserPayload,
            tenantContext,
        );

        const token = jwt.sign(
            {
                scope: 'tenant',
                id: user.id,
                email: user.email ?? user.phone ?? "",
                phone: user.phone,
                role: tenantContext.rbacRole,
                permissions: authUser.permissions,
                tenantId: tenantContext.tenant.id,
                tenantSlug: tenantContext.tenant.slug,
                membershipId: tenantContext.membership.id,
                tenantRole: tenantContext.membership.role,
                authVersion: user.authVersion,
            },
            envs.JWT_SECRET,
            { expiresIn: '1h' }
        );

        return {
            token,
            user: authUser
        };
    }

    static async me(
        userId: number,
        tenantContext: TenantRequestContext,
        tokenPermissions?: string[],
    ) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                isActive: true,
            }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        if (!user.isActive) {
            throw new Error('Usuario inactivo');
        }

        const permissions = await PermissionService.resolvePermissionsForMembership({
            membershipId: tenantContext.membership.id,
            roleName: tenantContext.rbacRole,
        });
        const planSnapshot = {
            planCode: tenantContext.tenant.planCode ?? TenantPlanCode.STARTER,
            planFeatures: tenantContext.tenant.planFeatures ?? [],
            welcomeStorePromotionEndsAt: tenantContext.tenant.welcomeStorePromotionEndsAt ?? null,
        };
        const planFeatures = Array.from(PlanAccessService.effectiveFeatures(planSnapshot)).sort();

        return {
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email ?? user.phone ?? "",
                role: tenantContext.rbacRole,
                permissions: permissions.length > 0 ? permissions : tokenPermissions ?? [],
                tenant: tenantContext.tenant,
                membership: tenantContext.membership,
                plan: {
                    code: planSnapshot.planCode,
                    features: planFeatures,
                },
            },
        };
    }
}
