import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { orderRoute } from "../../presentation/order/router";

export function registerOrdersModuleRoutes(router: Router): void {
    router.use("/api/orders", AuthMiddleware.validateJWT, orderRoute.router);
}
