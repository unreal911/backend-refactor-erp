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
    };
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
            };

            if (
                decoded.scope !== 'tenant'
                || !decoded.tenantId
                || !decoded.membershipId
            ) {
                return res.status(401).json({ message: 'Token tenant inválido' });
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
            if (tenantContext.tenant.readOnly && !safeMethod) {
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
            });
            if (!platformAdmin) {
                return res.status(403).json({ message: 'Acceso de plataforma revocado' });
            }

            req.user = {
                id: decoded.id,
                email: decoded.email,
                role: 'PLATFORM_ADMIN',
            };
            req.platform = { platformAdminId: platformAdmin.id };
            return next();
        } catch (error: unknown) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Token expirado' });
            }
            return res.status(401).json({ message: 'Token de plataforma invalido' });
        }
    }

    static requireTenantContext(req: AuthRequest, res: Response, next: NextFunction) {
        if (!req.user || !req.tenant) {
            return res.status(403).json({ message: 'Contexto de empresa requerido' });
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

    static requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
        return AuthMiddleware.requireRole('ADMIN')(req, res, next);
    }
}
