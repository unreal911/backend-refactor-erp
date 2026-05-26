import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { inventoryRoute } from "../../presentation/inventory/router";

export function registerInventoryModuleRoutes(router: Router): void {
    router.use("/api/inventory", AuthMiddleware.validateJWT, inventoryRoute.router);
}
