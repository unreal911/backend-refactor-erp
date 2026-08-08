import { Router } from "express";
import { AuthMiddleware } from "../../presentation/auth/middleware";
import { OperationalMetrics } from "./operational-metrics";

export function registerOperationsRoutes(router: Router): void {
    router.get(
        "/api/platform/metrics",
        AuthMiddleware.validatePlatformJWT,
        async (_req, res) => {
            try {
                return res.json(await OperationalMetrics.snapshot());
            } catch {
                return res.status(503).json({ message: "Metricas operativas no disponibles" });
            }
        },
    );
}
