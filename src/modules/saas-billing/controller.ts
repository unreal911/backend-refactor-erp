import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { PublicPlanService } from "./public-plan.service";
import { TenantSubscriptionService } from "./tenant-subscription.service";

function param(req: Request, name: string): string {
    const value = req.params[name];
    return Array.isArray(value) ? (value[0] || "") : (value || "");
}

function handle(caught: unknown, res: Response) {
    if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
    console.error("[saas-billing]", caught);
    return res.status(500).json({ message: "No se pudo procesar la suscripción" });
}

export class SaasBillingController {
    listPublicPlans = async (_req: Request, res: Response) => {
        try {
            res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
            return res.json(await PublicPlanService.list());
        } catch (caught) {
            return handle(caught, res);
        }
    };

    listPublicMethods = async (_req: Request, res: Response) => {
        try {
            res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
            return res.json(await TenantSubscriptionService.listPublicMethods());
        } catch (caught) {
            return handle(caught, res);
        }
    };

    createTenantRequest = async (req: AuthRequest, res: Response) => {
        try {
            return res.status(201).json(await TenantSubscriptionService.createRequest(req.body || {}, req.user?.id));
        } catch (caught) {
            return handle(caught, res);
        }
    };

    listTenantRequests = async (_req: AuthRequest, res: Response) => {
        try {
            return res.json(await TenantSubscriptionService.listTenantRequests());
        } catch (caught) {
            return handle(caught, res);
        }
    };

    previewDowngrade = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await TenantSubscriptionService.previewDowngrade(param(req, "planVersionId")));
        } catch (caught) {
            return handle(caught, res);
        }
    };
}
