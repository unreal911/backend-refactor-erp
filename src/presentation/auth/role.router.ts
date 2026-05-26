import { Router } from "express";
import { RoleController } from "./role.controller";
import { AuthMiddleware } from "./middleware";

export class RoleRouter {
    static get router(): Router {
        const router = Router();

        router.get('/permissions', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.permissions'), RoleController.listPermissions);

        router.post('/', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.create'), RoleController.create);
        router.get('/', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.view'), RoleController.findAll);

        router.get('/:id/permissions', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.permissions'), RoleController.getRolePermissions);
        router.put('/:id/permissions', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.permissions'), RoleController.setRolePermissions);
        router.patch('/:id/status', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.update'), RoleController.updateStatus);

        router.get('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.view'), RoleController.findById);
        router.put('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.update'), RoleController.update);
        router.patch('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.update'), RoleController.update);
        router.delete('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('roles.update'), RoleController.delete);

        return router;
    }
}
