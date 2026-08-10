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

type AuthUserPayload = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
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
            ? "Tu correo todavía no está verificado. Reenvía el enlace de activación y revisa también la carpeta de spam."
            : "Tu correo ya está verificado, pero falta terminar de crear la prueba. Solicita un nuevo enlace para continuar.");
        this.code = code;
    }
}

export class AuthService {
    private static async buildAuthUserContext(
        user: AuthUserPayload,
        tenantContext: TenantRequestContext,
    ) {
        const permissions = await PermissionService.resolvePermissionsForTenantRole(
            tenantContext.rbacRole,
        );

        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: tenantContext.rbacRole,
            permissions,
            tenant: tenantContext.tenant,
            membership: tenantContext.membership,
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
        const { email, password } = loginDto;

        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
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
                where: { email },
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
            user as AuthUserPayload,
            tenantContext,
        );

        const token = jwt.sign(
            {
                scope: 'tenant',
                id: user.id,
                email: user.email,
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
                isActive: true,
            }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        if (!user.isActive) {
            throw new Error('Usuario inactivo');
        }

        const permissions = await PermissionService.resolvePermissionsForTenantRole(
            tenantContext.rbacRole,
        );

        return {
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: tenantContext.rbacRole,
                permissions: permissions.length > 0 ? permissions : tokenPermissions ?? [],
                tenant: tenantContext.tenant,
                membership: tenantContext.membership,
            },
        };
    }

    static async loginPlatform(loginDto: LoginDto) {
        const user = await prisma.user.findUnique({
            where: { email: loginDto.email },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                password: true,
                isActive: true,
                authVersion: true,
                platformAdmin: {
                    select: {
                        id: true,
                        isActive: true,
                    },
                },
            },
        });

        if (!user || !user.isActive || !user.platformAdmin?.isActive) {
            throw new Error('Credenciales de plataforma invalidas');
        }
        const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
        if (!isPasswordValid) {
            throw new Error('Credenciales de plataforma invalidas');
        }

        const token = jwt.sign(
            {
                scope: 'platform',
                id: user.id,
                email: user.email,
                role: 'PLATFORM_ADMIN',
                platformAdminId: user.platformAdmin.id,
                authVersion: user.authVersion,
            },
            envs.JWT_SECRET,
            { expiresIn: '30m' },
        );

        return {
            token,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: 'PLATFORM_ADMIN',
                scope: 'platform',
            },
        };
    }
}
