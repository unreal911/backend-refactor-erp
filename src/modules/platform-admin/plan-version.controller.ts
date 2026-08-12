import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { PlanVersionService } from "./plan-version.service";

function respondError(caught: unknown, res: Response) {
    if (caught instanceof CustomError) {
        return res.status(caught.statusCode).json({ message: caught.message });
    }
    console.error("[platform-plans]", caught);
    return res.status(500).json({ message: "No se pudo procesar la configuración de planes" });
}

function actor(req: AuthRequest) {
    if (!req.platform?.platformAdminId) throw CustomError.forbidden("Administrador de plataforma requerido");
    return {
        platformAdminId: req.platform.platformAdminId,
        correlationId: req.header("x-correlation-id") ?? null,
    };
}

function param(req: Request, name: string): string {
    const value = req.params[name];
    return Array.isArray(value) ? (value[0] || "") : (value || "");
}

export class PlanVersionController {
    listPlatform = async (_req: Request, res: Response) => {
        try {
            return res.json(await PlanVersionService.listForPlatform());
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    listPublic = async (_req: Request, res: Response) => {
        try {
            res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
            return res.json(await PlanVersionService.listPublic());
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    updatePlan = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await PlanVersionService.updatePlanMetadata(
                param(req, "code"),
                req.body || {},
                actor(req),
            ));
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    createDraft = async (req: AuthRequest, res: Response) => {
        try {
            const created = await PlanVersionService.createDraft(
                param(req, "code"),
                req.body || {},
                actor(req),
            );
            return res.status(201).json(created);
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    updateDraft = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await PlanVersionService.updateDraft(
                param(req, "id"),
                req.body || {},
                actor(req),
            ));
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    validate = async (req: Request, res: Response) => {
        try {
            return res.json(await PlanVersionService.validateVersion(param(req, "id")));
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    schedule = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await PlanVersionService.schedule(
                param(req, "id"),
                req.body || {},
                actor(req),
            ));
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    cancel = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await PlanVersionService.cancelSchedule(
                param(req, "id"),
                req.body?.reason,
                actor(req),
            ));
        } catch (caught) {
            return respondError(caught, res);
        }
    };

    activateDue = async (_req: AuthRequest, res: Response) => {
        try {
            return res.json(await PlanVersionService.activateDueVersions());
        } catch (caught) {
            return respondError(caught, res);
        }
    };
}
