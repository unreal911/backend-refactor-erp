import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../../config/envs';
import { PermissionService } from '../../modules/auth/services/permission.service';

export interface AuthRequest extends Request {
    user?: {
        id: number;
        email: string;
        role: string;
        permissions?: string[];
    };
}

export class AuthMiddleware {
    static validateJWT(req: AuthRequest, res: Response, next: NextFunction) {
        const token = req.header('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ message: 'Token no proporcionado' });
        }

        try {
            const decoded = jwt.verify(token, envs.JWT_SECRET) as {
                id: number;
                email: string;
                role: string;
                permissions?: string[];
            };

            req.user = {
                id: decoded.id,
                email: decoded.email,
                role: decoded.role
            };

            if (Array.isArray(decoded.permissions)) {
                req.user.permissions = decoded.permissions;
            }

            const refreshedToken = jwt.sign(
                {
                    id: decoded.id,
                    email: decoded.email,
                    role: decoded.role,
                    ...(Array.isArray(decoded.permissions) ? { permissions: decoded.permissions } : {}),
                },
                envs.JWT_SECRET,
                { expiresIn: '1h' },
            );
            res.setHeader('x-access-token', refreshedToken);

            next();
        } catch (error: unknown) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401).json({ message: 'Token expirado' });
            }
            return res.status(401).json({ message: 'Token invalido' });
        }
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
                const permissionQuery: {
                    userId: number;
                    roleName: string;
                    tokenPermissions?: string[] | null;
                } = {
                    userId: req.user.id,
                    roleName: req.user.role
                };

                if (Array.isArray(req.user.permissions)) {
                    permissionQuery.tokenPermissions = req.user.permissions;
                }

                const effectivePermissions = await PermissionService.resolvePermissionsForUser(permissionQuery);

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
