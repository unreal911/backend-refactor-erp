import { Prisma } from '@prisma/client';
import { prisma } from '../../data/prisma';
import {
    getDefaultPermissionsByRole,
    isWildcardPermission,
    normalizePermissionCode,
    normalizeRoleName,
    PERMISSION_CATALOG
} from '../auth/permission-catalog';

export type PermissionCatalogItem = {
    code: string;
    name: string;
    module: string;
    description: string | null;
    isActive: boolean;
};

type RolePermissionRow = {
    permission: {
        code: string;
    };
};

type PermissionTx = Prisma.TransactionClient;

export class PermissionService {
    private static normalizePermissions(permissions: string[]): string[] {
        const normalized = permissions
            .map((permission) => normalizePermissionCode(permission))
            .filter((permission) => permission.length > 0);

        return Array.from(new Set(normalized));
    }

    private static isMissingRbacTables(error: unknown): boolean {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
            return false;
        }

        return error.code === 'P2021' || error.code === 'P2022';
    }

    private static codeToPermissionLabel(code: string): string {
        return code
            .split('.')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    private static codeToModule(code: string): string {
        const [moduleName] = code.split('.');
        return moduleName || 'general';
    }

    private static extractCodes(rolePermissions: RolePermissionRow[]): string[] {
        return this.normalizePermissions(rolePermissions.map((item) => item.permission.code));
    }

    private static buildFallbackCatalog(): PermissionCatalogItem[] {
        return PERMISSION_CATALOG
            .map((item) => ({
                code: normalizePermissionCode(item.code),
                name: item.name,
                module: item.module,
                description: item.description,
                isActive: true
            }))
            .sort((a, b) => a.code.localeCompare(b.code));
    }

    private static mergeWithFallbackCatalog(records: PermissionCatalogItem[]): PermissionCatalogItem[] {
        const merged = new Map<string, PermissionCatalogItem>();

        for (const fallbackItem of this.buildFallbackCatalog()) {
            merged.set(fallbackItem.code, fallbackItem);
        }

        for (const record of records) {
            const normalizedCode = normalizePermissionCode(record.code);
            merged.set(normalizedCode, {
                code: normalizedCode,
                name: record.name,
                module: record.module,
                description: record.description,
                isActive: record.isActive
            });
        }

        return Array.from(merged.values()).sort((a, b) => a.code.localeCompare(b.code));
    }

    private static async ensurePermissionCatalog(tx: PermissionTx): Promise<void> {
        for (const item of PERMISSION_CATALOG) {
            const code = normalizePermissionCode(item.code);
            await tx.permission.upsert({
                where: { code },
                update: {
                    name: item.name,
                    module: item.module,
                    description: item.description,
                    isActive: true
                },
                create: {
                    code,
                    name: item.name,
                    module: item.module,
                    description: item.description,
                    isActive: true
                }
            });
        }
    }

    static getDefaultPermissions(roleName: string | null | undefined): string[] {
        return this.normalizePermissions(getDefaultPermissionsByRole(roleName));
    }

    static async listPermissionsCatalog(): Promise<PermissionCatalogItem[]> {
        try {
            const records = await prisma.permission.findMany({
                where: { isActive: true },
                orderBy: [{ module: 'asc' }, { code: 'asc' }],
                select: {
                    code: true,
                    name: true,
                    module: true,
                    description: true,
                    isActive: true
                }
            });

            if (records.length > 0) {
                return this.mergeWithFallbackCatalog(records.map((record) => ({
                    code: record.code,
                    name: record.name,
                    module: record.module,
                    description: record.description,
                    isActive: record.isActive
                })));
            }
        } catch (error) {
            if (!this.isMissingRbacTables(error)) {
                throw error;
            }
        }

        return this.buildFallbackCatalog();
    }

    static async resolvePermissionsForUser(params: {
        userId: number;
        roleName: string | null | undefined;
        tokenPermissions?: string[] | null;
    }): Promise<string[]> {
        const tokenPermissions = this.normalizePermissions(params.tokenPermissions || []);
        if (tokenPermissions.length > 0) {
            return tokenPermissions;
        }

        try {
            const user = await prisma.user.findUnique({
                where: { id: params.userId },
                select: {
                    role: {
                        select: {
                            name: true,
                            rolePermissions: {
                                where: {
                                    permission: {
                                        isActive: true
                                    }
                                },
                                select: {
                                    permission: {
                                        select: {
                                            code: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            const roleFromDb = user?.role?.name || params.roleName;
            const dbPermissions = this.extractCodes((user?.role?.rolePermissions || []) as RolePermissionRow[]);
            if (dbPermissions.length > 0) {
                return dbPermissions;
            }

            return this.getDefaultPermissions(roleFromDb);
        } catch (error) {
            if (!this.isMissingRbacTables(error)) {
                throw error;
            }
        }

        return this.getDefaultPermissions(params.roleName);
    }

    static async getRolePermissions(roleId: number, roleName?: string): Promise<string[]> {
        try {
            const role = await prisma.role.findUnique({
                where: { id: roleId },
                select: {
                    name: true,
                    rolePermissions: {
                        where: {
                            permission: {
                                isActive: true
                            }
                        },
                        select: {
                            permission: {
                                select: {
                                    code: true
                                }
                            }
                        }
                    }
                }
            });

            if (!role) {
                return [];
            }

            const explicit = this.extractCodes(role.rolePermissions as RolePermissionRow[]);
            if (explicit.length > 0) {
                return explicit;
            }

            return this.getDefaultPermissions(role.name || roleName);
        } catch (error) {
            if (!this.isMissingRbacTables(error)) {
                throw error;
            }
        }

        return this.getDefaultPermissions(roleName);
    }

    static async replaceRolePermissions(roleId: number, permissionCodes: string[]): Promise<string[]> {
        const normalizedCodes = this.normalizePermissions(permissionCodes).filter((code) => !isWildcardPermission(code));

        const catalog = await this.listPermissionsCatalog();
        const catalogByCode = new Map(catalog.map((item) => [normalizePermissionCode(item.code), item]));

        await prisma.$transaction(async (tx) => {
            await this.ensurePermissionCatalog(tx);

            if (normalizedCodes.length === 0) {
                await tx.rolePermission.deleteMany({ where: { roleId } });
                return;
            }

            for (const code of normalizedCodes) {
                const fromCatalog = catalogByCode.get(code);
                await tx.permission.upsert({
                    where: { code },
                    update: {
                        name: fromCatalog?.name || this.codeToPermissionLabel(code),
                        module: fromCatalog?.module || this.codeToModule(code),
                        description: fromCatalog?.description || null,
                        isActive: true
                    },
                    create: {
                        code,
                        name: fromCatalog?.name || this.codeToPermissionLabel(code),
                        module: fromCatalog?.module || this.codeToModule(code),
                        description: fromCatalog?.description || null,
                        isActive: true
                    }
                });
            }

            const permissions = await tx.permission.findMany({
                where: {
                    code: {
                        in: normalizedCodes
                    }
                },
                select: {
                    id: true
                }
            });

            const permissionIds = permissions.map((permission) => permission.id);

            await tx.rolePermission.deleteMany({
                where: {
                    roleId,
                    permissionId: {
                        notIn: permissionIds
                    }
                }
            });

            await tx.rolePermission.createMany({
                data: permissionIds.map((permissionId) => ({
                    roleId,
                    permissionId
                })),
                skipDuplicates: true
            });
        });

        return this.getRolePermissions(roleId);
    }

    static async seedDefaultPermissionsForRoles(roleNameById: Map<number, string>): Promise<void> {
        await prisma.$transaction(async (tx) => {
            await this.ensurePermissionCatalog(tx);

            for (const [roleId, roleName] of roleNameById.entries()) {
                const defaultCodes = this.getDefaultPermissions(roleName).filter((code) => !isWildcardPermission(code));
                if (defaultCodes.length === 0) {
                    continue;
                }

                const permissions = await tx.permission.findMany({
                    where: {
                        code: {
                            in: defaultCodes
                        }
                    },
                    select: { id: true }
                });

                await tx.rolePermission.createMany({
                    data: permissions.map((permission) => ({
                        roleId,
                        permissionId: permission.id
                    })),
                    skipDuplicates: true
                });
            }
        });
    }

    static normalizeRole(roleName: string | null | undefined): string {
        return normalizeRoleName(roleName);
    }
}
