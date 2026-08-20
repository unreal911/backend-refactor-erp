import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../../config/envs';
import { PermissionService } from '../../modules/auth/services/permission.service';
import {
    TenantAccessError,
    TenantContextService,
    TenantRequestContext,
} from '../../modules/tenant/tenant-context.service';
import {
    runTenantDatabaseTransaction,
} from '../../data/prisma';
import { platformPrisma } from '../../data/platform-prisma';
import { continueThroughResponse } from '../response-tasks';
import { CustomError } from '../../domain/errors/custom.error';
import { PlanAccessService } from '../../modules/plans/plan-access.service';
import { PlanFeature } from '../../modules/plans/plan-catalog';

export interface AuthRequest extends Request {
    user?: {
        id: number;
        email: string;
        role: string;
        permissions?: string[];
    };
    tenant?: TenantRequestContext;
    platform?: {
        platformAdminId: string;
        role: string;
        permissions: string[];
        mfaVerifiedAt: number | null;
        mfaStatus: string;
    };
}

function isPlatformMfaEnrollmentRoute(req: Request): boolean {
    const path = (String(req.originalUrl || req.path).split('?')[0] || '')
        .replace(/^\/\.netlify\/functions\/api/, '');
    return [
        '/api/platform/security/mfa',
        '/api/platform/security/mfa/enroll',
        '/api/platform/security/mfa/confirm',
        '/api/auth/platform/logout',
    ].includes(path.replace(/\/$/, ''));
}

function isFiscalSafeMutation(req: Request): boolean {
    if (req.method !== 'POST') return false;
    const path = String(req.originalUrl || req.path).split('?')[0] || '';
    return [
        /^\/api\/sunat\/orders\/\d+\/(factura|boleta)\/?$/,
        /^\/api\/sunat\/comprobantes\/\d+\/(nota-credito|nota-debito)\/?$/,
        /^\/api\/sunat\/resumen-diario(?:\/anulacion|\/\d+\/consultar)?\/?$/,
        /^\/api\/sunat\/comunicacion-baja(?:\/\d+\/consultar)?\/?$/,
    ].some((pattern) => pattern.test(path));
}

export class AuthMiddleware {
    static async validateJWT(req: AuthRequest, res: Response, next: NextFunction) {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ message: 'Token no proporcionado' });
        }

        try {
            const decoded = jwt.verify(token, envs.JWT_SECRET) as {
                scope?: string;
                id: number;
                email: string;
                role: string;
                permissions?: string[];
                tenantId?: string;
                tenantSlug?: string;
                membershipId?: string;
                tenantRole?: string;
                authVersion?: number;
            };

            if (
                decoded.scope !== 'tenant'
                || !decoded.tenantId
                || !decoded.membershipId
            ) {
                return res.status(401).json({ message: 'Token tenant inválido' });
            }

            const tokenUser = await platformPrisma.user.findUnique({
                where: { id: decoded.id },
                select: { authVersion: true, isActive: true },
            });
            if (
                !tokenUser?.isActive
                || tokenUser.authVersion !== (decoded.authVersion ?? 0)
            ) {
                return res.status(401).json({ message: 'La sesión ya no es válida' });
            }

            const tenantContext = await TenantContextService.resolveAuthenticatedContext({
                userId: decoded.id,
                tenantId: decoded.tenantId,
                membershipId: decoded.membershipId,
            });
            const requestedTenantId = req.header('x-tenant-id');
            const requestedTenantSlug = req.header('x-tenant-slug');
            if (
                (requestedTenantId && requestedTenantId !== tenantContext.tenant.id)
                || (requestedTenantSlug && requestedTenantSlug !== tenantContext.tenant.slug)
            ) {
                return res.status(403).json({
                    message: 'El encabezado no corresponde a la membresía autenticada',
                });
            }

            req.user = {
                id: decoded.id,
                email: decoded.email,
                role: tenantContext.rbacRole,
            };
            req.tenant = tenantContext;

            const safeMethod = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
            if (tenantContext.tenant.readOnly && !safeMethod && !isFiscalSafeMutation(req)) {
                return res.status(403).json({
                    message: 'La empresa está en modo de solo lectura',
                });
            }

            if (Array.isArray(decoded.permissions)) {
                req.user.permissions = decoded.permissions;
            }

            const refreshedToken = jwt.sign(
                {
                    scope: 'tenant',
                    id: decoded.id,
                    email: decoded.email,
                    role: tenantContext.rbacRole,
                    ...(Array.isArray(decoded.permissions) ? { permissions: decoded.permissions } : {}),
                    tenantId: tenantContext.tenant.id,
                    tenantSlug: tenantContext.tenant.slug,
                    membershipId: tenantContext.membership.id,
                    tenantRole: tenantContext.membership.role,
                    authVersion: tokenUser.authVersion,
                },
                envs.JWT_SECRET,
                { expiresIn: '1h' },
            );
            res.setHeader('x-access-token', refreshedToken);

            return runTenantDatabaseTransaction(
                tenantContext.tenant.id,
                () => continueThroughResponse(res, next),
            );
        } catch (error: unknown) {
            if (res.headersSent) {
                return next(error);
            }
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Token expirado' });
            }
            if (error instanceof TenantAccessError) {
                return res.status(403).json({ message: error.message });
            }
            return res.status(401).json({ message: 'Token invalido' });
        }
    }

    static async validatePlatformJWT(req: AuthRequest, res: Response, next: NextFunction) {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ message: 'Token no proporcionado' });
        }

        try {
            const decoded = jwt.verify(token, envs.JWT_SECRET) as {
                scope?: string;
                id: number;
                email: string;
                role: string;
                platformAdminId?: string;
                authVersion?: number;
                mfaAt?: number;
            };
            if (
                decoded.scope !== 'platform'
                || decoded.role !== 'PLATFORM_ADMIN'
                || !decoded.platformAdminId
            ) {
                return res.status(401).json({ message: 'Token de plataforma inválido' });
            }

            const platformAdmin = await platformPrisma.platformAdmin.findFirst({
                where: {
                    id: decoded.platformAdminId,
                    userId: decoded.id,
                    isActive: true,
                    user: {
                        isActive: true,
                    },
                },
                select: {
                    id: true,
                    mfaStatus: true,
                    role: {
                        select: {
                            code: true,
                            isActive: true,
                            permissions: { select: { permissionCode: true } },
                        },
                    },
                    user: { select: { authVersion: true } },
                },
            });
            if (
                !platformAdmin
                || !platformAdmin.role.isActive
                || platformAdmin.user.authVersion !== (decoded.authVersion ?? 0)
            ) {
                return res.status(403).json({ message: 'Acceso de plataforma revocado' });
            }

            const mfaEnrolled = platformAdmin.mfaStatus === 'ENABLED'
                || platformAdmin.mfaStatus === 'LOCKED';
            if (envs.PLATFORM_MFA_REQUIRED && !mfaEnrolled && !isPlatformMfaEnrollmentRoute(req)) {
                return res.status(428).json({
                    message: 'Debes configurar MFA antes de usar la plataforma',
                    code: 'PLATFORM_MFA_ENROLLMENT_REQUIRED',
                });
            }

            req.user = {
                id: decoded.id,
                email: decoded.email,
                role: 'PLATFORM_ADMIN',
            };
            req.platform = {
                platformAdminId: platformAdmin.id,
                role: platformAdmin.role.code,
                permissions: platformAdmin.role.permissions.map((item) => item.permissionCode),
                mfaVerifiedAt: typeof decoded.mfaAt === 'number' ? decoded.mfaAt : null,
                mfaStatus: platformAdmin.mfaStatus,
            };
            return next();
        } catch (error: unknown) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Token expirado' });
            }
            return res.status(401).json({ message: 'Token de plataforma invalido' });
        }
    }

    static requirePlatformPermission(permission: string) {
        return (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.platform?.permissions.includes(permission)) {
                return res.status(403).json({ message: 'No tienes permiso para esta operación' });
            }
            return next();
        };
    }

    static requireRecentPlatformMfa(req: AuthRequest, res: Response, next: NextFunction) {
        const verifiedAt = req.platform?.mfaVerifiedAt;
        const recent = typeof verifiedAt === 'number' && Math.floor(Date.now() / 1000) - verifiedAt <= 10 * 60;
        if (!recent) {
            return res.status(428).json({
                message: 'Esta operación requiere una sesión iniciada con MFA durante los últimos 10 minutos',
                code: 'PLATFORM_MFA_RECENT_REQUIRED',
            });
        }
        return next();
    }

    static requireTenantContext(req: AuthRequest, res: Response, next: NextFunction) {
        if (!req.user || !req.tenant) {
            return res.status(403).json({ message: 'Contexto de empresa requerido' });
        }
        return next();
    }

    static requireTenantOwner(req: AuthRequest, res: Response, next: NextFunction) {
        if (!req.tenant || req.tenant.membership.role !== 'OWNER') {
            return res.status(403).json({
                message: 'Esta operación está reservada para el propietario de la empresa',
            });
        }
        return next();
    }

    static requireRole(requiredRole: string) {
        return (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.user) {
                return res.status(401).json({ message: 'Usuario no autenticado' });
            }

            const currentRole = PermissionService.normalizeRole(req.user.role);
            const normalizedRequiredRole = PermissionService.normalizeRole(requiredRole);

            if (currentRole !== normalizedRequiredRole) {
                return res.status(403).json({ message: 'Acceso denegado: rol insuficiente' });
            }

            next();
        };
    }

    static requirePermission(requiredPermission: string | string[]) {
        const requiredPermissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];

        return async (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.user) {
                return res.status(401).json({ message: 'Usuario no autenticado' });
            }

            try {
                if (!req.tenant) {
                    return res.status(403).json({ message: 'Contexto de empresa requerido' });
                }
                const effectivePermissions = await PermissionService.resolvePermissionsForTenantRole(
                    req.tenant.rbacRole,
                );

                req.user.permissions = effectivePermissions;

                const hasPermission = effectivePermissions.includes('*') ||
                    requiredPermissions.some((permission) => effectivePermissions.includes(permission.toLowerCase()));

                if (!hasPermission) {
                    return res.status(403).json({ message: 'Acceso denegado: permiso insuficiente' });
                }

                next();
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'No se pudo validar permisos';
                return res.status(500).json({ message });
            }
        };
    }

    static requirePlanFeature(feature: PlanFeature) {
        return async (req: AuthRequest, res: Response, next: NextFunction) => {
            if (!req.tenant) {
                return res.status(403).json({ message: 'Contexto de empresa requerido' });
            }
            try {
                await PlanAccessService.assert(feature);
                return next();
            } catch (caught) {
                if (caught instanceof CustomError) {
                    return res.status(caught.statusCode).json({
                        message: caught.message,
                        reason: 'PLAN_FEATURE_NOT_INCLUDED',
                        feature,
                    });
                }
                return res.status(500).json({ message: 'No se pudo validar el plan' });
            }
        };
    }

    static requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
        return AuthMiddleware.requireRole('ADMIN')(req, res, next);
    }
}
