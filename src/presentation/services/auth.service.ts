import { prisma } from '../../data/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { LoginDto } from '../../domain/dtos/login.dto';
import { PermissionService } from './permission.service';
import { envs } from '../../config/envs';

type AuthUserPayload = {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    isActive: boolean;
    role: {
        name: string;
    };
};

export class AuthService {
    private static async buildAuthUserContext(user: AuthUserPayload) {
        const permissions = await PermissionService.resolvePermissionsForUser({
            userId: user.id,
            roleName: user.role.name
        });

        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role.name,
            permissions
        };
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
                role: {
                    select: {
                        name: true
                    }
                }
            }
        });

        if (!user) {
            throw new Error('Credenciales invalidas');
        }

        if (!user.isActive) {
            throw new Error('Usuario inactivo');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Credenciales invalidas');
        }

        const authUser = await this.buildAuthUserContext(user as AuthUserPayload);

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role.name,
                permissions: authUser.permissions
            },
            envs.JWT_SECRET,
            { expiresIn: '1h' }
        );

        return {
            token,
            user: authUser
        };
    }

    static async me(userId: number, fallbackRoleName?: string, tokenPermissions?: string[]) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                isActive: true,
                role: {
                    select: {
                        name: true
                    }
                }
            }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        if (!user.isActive) {
            throw new Error('Usuario inactivo');
        }

        const permissionQuery: {
            userId: number;
            roleName: string;
            tokenPermissions?: string[] | null;
        } = {
            userId: user.id,
            roleName: user.role?.name || fallbackRoleName || ''
        };

        if (Array.isArray(tokenPermissions)) {
            permissionQuery.tokenPermissions = tokenPermissions;
        }

        const permissions = await PermissionService.resolvePermissionsForUser(permissionQuery);

        return {
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                role: user.role?.name || fallbackRoleName || 'USER',
                permissions
            }
        };
    }
}
