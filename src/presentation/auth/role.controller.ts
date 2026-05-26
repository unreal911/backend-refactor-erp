import { Request, Response } from 'express';
import { RoleService } from '../../modules/auth/services/role.service';
import { CreateRoleDto, UpdateRoleDto } from '../../domain/dtos/role.dto';
import { AuthRequest } from '../auth/middleware';

export class RoleController {
    private static parseId(rawId: unknown): number {
        const value = Array.isArray(rawId) ? rawId[0] : rawId;
        if (typeof value !== 'string') {
            throw new Error('El ID del rol debe ser un numero valido');
        }

        const id = Number(value);
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error('El ID del rol debe ser un numero valido');
        }
        return id;
    }

    private static parseIsActiveQuery(value: unknown): boolean | undefined {
        if (value === undefined) {
            return undefined;
        }

        if (value === 'true' || value === true) {
            return true;
        }

        if (value === 'false' || value === false) {
            return false;
        }

        throw new Error('El filtro isActive debe ser true o false');
    }

    static async create(req: AuthRequest, res: Response) {
        try {
            const [error, createRoleDto] = CreateRoleDto.create(req.body);
            if (error) {
                return res.status(400).json({ message: error });
            }

            const role = await RoleService.create(createRoleDto!);
            res.status(201).json(role);
        } catch (error: any) {
            res.status(400).json({ message: error.message });
        }
    }

    static async findAll(req: AuthRequest, res: Response) {
        try {
            const search = typeof req.query.search === 'string' ? req.query.search : undefined;
            const isActive = RoleController.parseIsActiveQuery(req.query.isActive);
            const filters: { search?: string; isActive?: boolean } = {};

            if (search !== undefined) {
                filters.search = search;
            }

            if (isActive !== undefined) {
                filters.isActive = isActive;
            }

            const roles = await RoleService.findAll(filters);
            res.json(roles);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al listar roles';
            res.status(400).json({ message });
        }
    }

    static async findById(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const role = await RoleService.findById(id);
            res.json(role);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al consultar rol';
            res.status(404).json({ message });
        }
    }

    static async update(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const [error, updateRoleDto] = UpdateRoleDto.create(req.body);
            if (error) {
                return res.status(400).json({ message: error });
            }

            const role = await RoleService.update(id, updateRoleDto!);
            res.json(role);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al actualizar rol';
            res.status(400).json({ message });
        }
    }

    static async delete(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const result = await RoleService.delete(id);
            res.json(result);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al desactivar rol';
            res.status(400).json({ message });
        }
    }

    static async updateStatus(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const { isActive } = req.body as { isActive?: unknown };

            if (typeof isActive !== 'boolean') {
                return res.status(400).json({ message: 'El estado del rol debe ser booleano' });
            }

            const role = await RoleService.updateStatus(id, isActive);
            res.json(role);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al actualizar estado del rol';
            res.status(400).json({ message });
        }
    }

    static async listPermissions(_req: Request, res: Response) {
        try {
            const permissions = await RoleService.getPermissionsCatalog();
            res.json(permissions);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al listar permisos';
            res.status(500).json({ message });
        }
    }

    static async getRolePermissions(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const permissions = await RoleService.getRolePermissions(id);
            res.json({ roleId: id, permissions });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al obtener permisos del rol';
            res.status(400).json({ message });
        }
    }

    static async setRolePermissions(req: AuthRequest, res: Response) {
        try {
            const id = RoleController.parseId(req.params.id);
            const { permissions } = req.body as { permissions?: unknown };

            if (!Array.isArray(permissions) || !permissions.every((permission) => typeof permission === 'string')) {
                return res.status(400).json({ message: 'La propiedad permissions debe ser un arreglo de strings' });
            }

            const updatedPermissions = await RoleService.setRolePermissions(id, permissions);
            res.json({
                roleId: id,
                permissions: updatedPermissions
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Error al actualizar permisos del rol';
            res.status(400).json({ message });
        }
    }
}
