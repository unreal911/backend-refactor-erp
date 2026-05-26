import { Router } from "express";
import { UserController } from "./user.controller";
import { AuthMiddleware } from "./middleware";

export class UserRouter {
    static get router(): Router {
        const router = Router();

        router.post('/', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.create'), UserController.create);
        router.get('/', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.view'), UserController.findAll);
        router.get('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.view'), UserController.findById);
        router.put('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.update'), UserController.update);
        router.delete('/:id', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.disable'), UserController.delete);
        router.post('/:id/change-password', AuthMiddleware.validateJWT, AuthMiddleware.requirePermission('users.change_password'), UserController.changePassword);

        return router;
    }
}
