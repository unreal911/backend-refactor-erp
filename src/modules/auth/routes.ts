import { Router } from "express";
import { AuthRouter } from "../../presentation/auth/router";
import { UserRouter } from "../../presentation/auth/user.router";
import { RoleRouter } from "../../presentation/auth/role.router";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { RoleController } from "../../presentation/auth/role.controller";

export function registerAuthModuleRoutes(router: Router): void {
    router.use("/api/auth", AuthRouter.router);
    router.use("/api/users", UserRouter.router);
    router.use("/api/roles", RoleRouter.router);
    router.get(
        "/api/permissions",
        AuthMiddleware.validateJWT,
        AuthMiddleware.requirePermission("roles.permissions"),
        RoleController.listPermissions,
    );
}
