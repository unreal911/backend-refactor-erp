import { prisma } from '../../data/prisma';
import { CreateRoleDto, UpdateRoleDto } from '../../domain/dtos/role.dto';
import { PermissionCatalogItem, PermissionService } from './permission.service';

type RoleFilters = {
    search?: string;
    isActive?: boolean;
};

export class RoleService {
    private static readonly PROTECTED_ROLE_NAMES = new Set(['ADMIN']);

    private static normalizeName(name: string): string {
        return PermissionService.normalizeRole(name);
    }

    private static toNullableDescription(description: string | undefined): string | null {
        if (description === undefined) {
            return null;
        }

        const trimmed = description.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private static async findByNameInsensitive(name: string) {
        return prisma.role.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        });
    }

    private static async findExistingRole(id: number) {
        return prisma.role.findUnique({
            where: { id },
            include: {
                users: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        isActive: true
                    }
                }
            }
        });
    }

    private static ensureCanDeactivate(roleName: string) {
        const normalized = this.normalizeName(roleName);
        if (this.PROTECTED_ROLE_NAMES.has(normalized)) {
            throw new Error('No se puede desactivar el rol administrador principal');
        }
    }

    static async create(createRoleDto: CreateRoleDto) {
        const normalizedName = this.normalizeName(createRoleDto.name);
        const description = this.toNullableDescription(createRoleDto.description);
        const isActive = createRoleDto.isActive;

        const existingRole = await this.findByNameInsensitive(normalizedName);
        if (existingRole) {
            throw new Error('El nombre del rol ya existe');
        }

        const role = await prisma.role.create({
            data: {
                name: normalizedName,
                description,
                isActive
            },
            include: {
                users: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        isActive: true
                    }
                }
            }
        });

        await PermissionService.seedDefaultPermissionsForRoles(new Map([[role.id, role.name]]));

        return role;
    }

    static async findAll(filters?: RoleFilters) {
        const where: {
            name?: {
                contains: string;
                mode: 'insensitive';
            };
            isActive?: boolean;
        } = {};

        const search = filters?.search?.trim();
        if (search) {
            where.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (typeof filters?.isActive === 'boolean') {
            where.isActive = filters.isActive;
        }

        return prisma.role.findMany({
            where,
            orderBy: {
                createdAt: 'desc'
            },
            include: {
                users: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        isActive: true
                    }
                }
            }
        });
    }

    static async findById(id: number) {
        const role = await this.findExistingRole(id);
        if (!role) {
            throw new Error('Rol no encontrado');
        }

        return role;
    }

    static async update(id: number, updateRoleDto: UpdateRoleDto) {
        const role = await this.findExistingRole(id);
        if (!role) {
            throw new Error('Rol no encontrado');
        }

        const updateData: {
            name?: string;
            description?: string | null;
            isActive?: boolean;
        } = {};

        if (updateRoleDto.name !== undefined) {
            const normalizedName = this.normalizeName(updateRoleDto.name);
            const existingRole = await this.findByNameInsensitive(normalizedName);

            if (existingRole && existingRole.id !== id) {
                throw new Error('El nombre del rol ya existe');
            }

            updateData.name = normalizedName;
        }

        if (updateRoleDto.description !== undefined) {
            updateData.description = this.toNullableDescription(updateRoleDto.description);
        }

        if (updateRoleDto.isActive !== undefined) {
            if (!updateRoleDto.isActive) {
                this.ensureCanDeactivate(role.name);
            }
            updateData.isActive = updateRoleDto.isActive;
        }

        return prisma.role.update({
            where: { id },
            data: updateData,
            include: {
                users: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        isActive: true
                    }
                }
            }
        });
    }

    static async updateStatus(id: number, isActive: boolean) {
        const role = await this.findExistingRole(id);
        if (!role) {
            throw new Error('Rol no encontrado');
        }

        if (!isActive) {
            this.ensureCanDeactivate(role.name);
        }

        return prisma.role.update({
            where: { id },
            data: { isActive },
            include: {
                users: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        isActive: true
                    }
                }
            }
        });
    }

    static async delete(id: number) {
        const role = await this.findExistingRole(id);
        if (!role) {
            throw new Error('Rol no encontrado');
        }

        if (role.users.length > 0) {
            throw new Error('No se puede desactivar un rol que tiene usuarios asignados');
        }

        if (!role.isActive) {
            return { message: 'El rol ya se encuentra inactivo' };
        }

        this.ensureCanDeactivate(role.name);

        await prisma.role.update({
            where: { id },
            data: { isActive: false }
        });

        return { message: 'Rol desactivado exitosamente' };
    }

    static async getPermissionsCatalog(): Promise<PermissionCatalogItem[]> {
        return PermissionService.listPermissionsCatalog();
    }

    static async getRolePermissions(id: number): Promise<string[]> {
        const role = await prisma.role.findUnique({
            where: { id },
            select: { id: true, name: true }
        });

        if (!role) {
            throw new Error('Rol no encontrado');
        }

        return PermissionService.getRolePermissions(role.id, role.name);
    }

    static async setRolePermissions(id: number, permissionCodes: string[]): Promise<string[]> {
        const role = await prisma.role.findUnique({
            where: { id },
            select: { id: true, name: true }
        });

        if (!role) {
            throw new Error('Rol no encontrado');
        }

        if (this.PROTECTED_ROLE_NAMES.has(this.normalizeName(role.name))) {
            throw new Error('No se pueden modificar permisos del rol administrador principal');
        }

        return PermissionService.replaceRolePermissions(role.id, permissionCodes);
    }
}
