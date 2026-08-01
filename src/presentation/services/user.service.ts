import { PrismaClient } from '@prisma/client';
import { platformPrisma } from '../../data/platform-prisma';
import { tenantPrisma } from '../../data/tenant-prisma';
import bcrypt from 'bcryptjs';
import { CreateUserDto, UpdateUserDto } from '../../domain/dtos/user.dto';
import {
    TenantMembershipRole,
    TenantMembershipStatus,
} from '@prisma/client';

export class UserService {
    private static database(tenantId?: string): PrismaClient {
        return tenantId ? tenantPrisma : platformPrisma;
    }

    private static async ensureAssignableRole(
        roleId: number,
        tenantId?: string,
    ) {
        const prisma = this.database(tenantId);
        const role = await prisma.role.findUnique({
            where: { id: roleId },
            select: { id: true, name: true, isActive: true }
        });

        if (!role) {
            throw new Error('El rol seleccionado no existe');
        }

        if (!role.isActive) {
            throw new Error('No se puede asignar un rol inactivo');
        }

        return role;
    }

    private static toTenantRole(roleName: string): TenantMembershipRole {
        const normalized = String(roleName || '').trim().toUpperCase();
        if (normalized === 'ADMIN' || normalized === 'MANAGER') {
            return TenantMembershipRole.ADMIN;
        }
        if (normalized === 'SELLER') {
            return TenantMembershipRole.SELLER;
        }
        return TenantMembershipRole.VIEWER;
    }

    static async create(createUserDto: CreateUserDto, tenantId?: string) {
        const prisma = this.database(tenantId);
        const { firstName, lastName, email, password, roleId, isActive } = createUserDto;

        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser && !tenantId) {
            throw new Error('El correo electronico ya esta registrado');
        }

        const role = await this.ensureAssignableRole(roleId, tenantId);
        const membershipRole = this.toTenantRole(role.name);

        if (tenantId && existingUser) {
            const existingMembership = await prisma.tenantMembership.findUnique({
                where: {
                    userId_tenantId: {
                        userId: existingUser.id,
                        tenantId,
                    },
                },
            });
            if (existingMembership) {
                throw new Error('El usuario ya pertenece a esta empresa');
            }

            await prisma.tenantMembership.create({
                data: {
                    tenantId,
                    userId: existingUser.id,
                    role: membershipRole,
                    status: isActive
                        ? TenantMembershipStatus.ACTIVE
                        : TenantMembershipStatus.INACTIVE,
                    activatedAt: isActive ? new Date() : null,
                    deactivatedAt: isActive ? null : new Date(),
                },
            });
            return this.findById(existingUser.id, tenantId);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (tenantId) {
            return prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        firstName,
                        lastName,
                        email,
                        password: hashedPassword,
                        roleId,
                        isActive,
                    },
                    include: {
                        role: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                });
                await tx.tenantMembership.create({
                    data: {
                        tenantId,
                        userId: user.id,
                        role: membershipRole,
                        status: isActive
                            ? TenantMembershipStatus.ACTIVE
                            : TenantMembershipStatus.INACTIVE,
                        activatedAt: isActive ? new Date() : null,
                        deactivatedAt: isActive ? null : new Date(),
                    },
                });

                const { password: _, ...userWithoutPassword } = user;
                return userWithoutPassword;
            });
        }

        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashedPassword,
                roleId,
                isActive
            },
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async findAll(tenantId?: string) {
        const prisma = this.database(tenantId);
        if (tenantId) {
            const memberships = await prisma.tenantMembership.findMany({
                where: { tenantId },
                include: {
                    user: {
                        include: {
                            role: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
                orderBy: { createdAt: 'asc' },
            });
            return memberships.map((membership) => {
                const { password, ...userWithoutPassword } = membership.user;
                return {
                    ...userWithoutPassword,
                    isActive: membership.status === TenantMembershipStatus.ACTIVE,
                    tenantRole: membership.role,
                    membershipId: membership.id,
                };
            });
        }

        const users = await prisma.user.findMany({
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        return users.map((user) => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
    }

    static async findById(id: number, tenantId?: string) {
        const prisma = this.database(tenantId);
        if (tenantId) {
            const membership = await prisma.tenantMembership.findUnique({
                where: {
                    userId_tenantId: {
                        userId: id,
                        tenantId,
                    },
                },
                include: {
                    user: {
                        include: {
                            role: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
            });
            if (!membership) {
                throw new Error('Usuario no encontrado en esta empresa');
            }
            const { password, ...userWithoutPassword } = membership.user;
            return {
                ...userWithoutPassword,
                isActive: membership.status === TenantMembershipStatus.ACTIVE,
                tenantRole: membership.role,
                membershipId: membership.id,
            };
        }

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!user) {
            throw new Error('Usuario no encontrado');
        }

        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async update(id: number, updateUserDto: UpdateUserDto, tenantId?: string) {
        const prisma = this.database(tenantId);
        const updateData: {
            firstName?: string;
            lastName?: string;
            email?: string;
            roleId?: number;
            isActive?: boolean;
        } = {};

        if (updateUserDto.firstName !== undefined) updateData.firstName = updateUserDto.firstName;
        if (updateUserDto.lastName !== undefined) updateData.lastName = updateUserDto.lastName;
        if (updateUserDto.email !== undefined) updateData.email = updateUserDto.email;
        let tenantRole: TenantMembershipRole | undefined;
        if (updateUserDto.roleId !== undefined) {
            const role = await this.ensureAssignableRole(
                updateUserDto.roleId,
                tenantId,
            );
            updateData.roleId = updateUserDto.roleId;
            tenantRole = this.toTenantRole(role.name);
        }
        if (updateUserDto.isActive !== undefined && !tenantId) {
            updateData.isActive = updateUserDto.isActive;
        }

        if (tenantId) {
            const membership = await prisma.tenantMembership.findUnique({
                where: { userId_tenantId: { userId: id, tenantId } },
            });
            if (!membership) {
                throw new Error('Usuario no encontrado en esta empresa');
            }

            await prisma.$transaction(async (tx) => {
                if (Object.keys(updateData).length > 0) {
                    await tx.user.update({ where: { id }, data: updateData });
                }
                if (tenantRole !== undefined || updateUserDto.isActive !== undefined) {
                    const active = updateUserDto.isActive;
                    await tx.tenantMembership.update({
                        where: { id: membership.id },
                        data: {
                            ...(tenantRole !== undefined ? { role: tenantRole } : {}),
                            ...(active !== undefined ? {
                                status: active
                                    ? TenantMembershipStatus.ACTIVE
                                    : TenantMembershipStatus.INACTIVE,
                                activatedAt: active ? new Date() : membership.activatedAt,
                                deactivatedAt: active ? null : new Date(),
                            } : {}),
                        },
                    });
                }
            });
            return this.findById(id, tenantId);
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            include: {
                role: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    static async delete(id: number, tenantId?: string) {
        const prisma = this.database(tenantId);
        if (tenantId) {
            const membership = await prisma.tenantMembership.findUnique({
                where: { userId_tenantId: { userId: id, tenantId } },
            });
            if (!membership) {
                throw new Error('Usuario no encontrado en esta empresa');
            }
            await prisma.tenantMembership.update({
                where: { id: membership.id },
                data: {
                    status: TenantMembershipStatus.INACTIVE,
                    deactivatedAt: new Date(),
                },
            });
            return { message: 'Membresia desactivada exitosamente' };
        }

        await prisma.user.delete({
            where: { id }
        });
        return { message: 'Usuario eliminado exitosamente' };
    }

    static async changePassword(id: number, newPassword: string, tenantId?: string) {
        const prisma = this.database(tenantId);
        if (tenantId) {
            const membership = await prisma.tenantMembership.findUnique({
                where: { userId_tenantId: { userId: id, tenantId } },
                select: { id: true },
            });
            if (!membership) {
                throw new Error('Usuario no encontrado en esta empresa');
            }
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id },
            data: { password: hashedPassword }
        });

        return { message: 'Contrasena actualizada exitosamente' };
    }
}
