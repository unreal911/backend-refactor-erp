import { Router } from "express";
import { AuthMiddleware } from "./auth/middleware";
import { categoryRoute } from "./category/router";
import { colorRoute } from "./color/router";
import { sizeRoute } from "./size/router";
import { productRoute } from "./product/router";
import { storeRoute } from "./store/router";
import { publicRoute } from "./public/router";
import { paymentMethodRoute } from "./payment-method/router";
import { systemConfigRoute } from "./system-config/router";
import { auditLogRoute } from "./audit-log/router";
import { userActivityRoute } from "./user-activity/router";
import { SeedRoute } from "./seed/router";
import { envs } from "../config/envs";
import { registerAuthModuleRoutes } from "../modules/auth";
import { registerInventoryModuleRoutes } from "../modules/inventory";
import { registerOrdersModuleRoutes } from "../modules/orders";

export class AppRouter {
    static get router(): Router {
        const router = Router();

        registerAuthModuleRoutes(router);

        if (envs.SEED_ENDPOINT_ENABLED) {
            router.use("/api/seed", SeedRoute.router);
        }

        router.use("/api/public", publicRoute.router);

        // Rutas protegidas - requieren autenticacion
        router.use("/api/categorie", AuthMiddleware.validateJWT, categoryRoute.router);
        router.use("/api/color", AuthMiddleware.validateJWT, colorRoute.router);
        router.use("/api/size", AuthMiddleware.validateJWT, sizeRoute.router);
        router.use("/api/products", AuthMiddleware.validateJWT, productRoute.router);
        registerInventoryModuleRoutes(router);
        router.use("/api/stores", AuthMiddleware.validateJWT, storeRoute.router);
        registerOrdersModuleRoutes(router);
        router.use("/api/payment-methods", AuthMiddleware.validateJWT, paymentMethodRoute.router);
        router.use("/api/system-config", AuthMiddleware.validateJWT, systemConfigRoute.router);
        router.use("/api/audit-logs", AuthMiddleware.validateJWT, auditLogRoute.router);
        router.use("/api/user-activities", AuthMiddleware.validateJWT, userActivityRoute.router);

        return router;
    }
}
