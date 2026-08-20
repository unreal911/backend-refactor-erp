import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { ManualPaymentService } from "./manual-payment.service";

function value(req: Request, name: string): string {
    const raw = req.params[name];
    return Array.isArray(raw) ? (raw[0] || "") : (raw || "");
}

function errorResponse(caught: unknown, res: Response) {
    if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
    console.error("[manual-payments]", caught);
    return res.status(500).json({ message: "No se pudo procesar el pago manual" });
}

function platformActor(req: AuthRequest) {
    if (!req.platform?.platformAdminId) throw CustomError.forbidden("Administrador de plataforma requerido");
    return {
        platformAdminId: req.platform.platformAdminId,
        correlationId: req.header("x-correlation-id") ?? null,
    };
}

export class ManualPaymentController {
    listPublicMethods = async (_req: Request, res: Response) => {
        try {
            res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
            return res.json(await ManualPaymentService.listPublicMethods());
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    listPlatformMethods = async (_req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.listMethodsForPlatform());
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    createMethod = async (req: AuthRequest, res: Response) => {
        try {
            return res.status(201).json(await ManualPaymentService.createMethod(req.body || {}, platformActor(req)));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    updateMethod = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.updateMethod(value(req, "id"), req.body || {}, platformActor(req)));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    createTenantRequest = async (req: AuthRequest, res: Response) => {
        try {
            return res.status(201).json(await ManualPaymentService.createRequest(req.body || {}, req.user?.id));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    listTenantRequests = async (_req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.listTenantRequests());
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    previewDowngrade = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.previewDowngrade(value(req, "planVersionId")));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    listPlatformRequests = async (req: AuthRequest, res: Response) => {
        try {
            const status = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
            return res.json(await ManualPaymentService.listPlatformRequests(
                typeof status === "string" ? status : undefined,
            ));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    openProof = async (req: AuthRequest, res: Response) => {
        try {
            const proof = await ManualPaymentService.openProof(value(req, "id"), platformActor(req));
            const filename = proof.filename.replace(/["\\\r\n]/g, "-");
            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("Content-Type", proof.contentType);
            res.setHeader("Content-Length", String(proof.sizeBytes));
            res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
            return res.send(proof.buffer);
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    approve = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.approveRequest(
                value(req, "id"),
                req.body || {},
                platformActor(req),
            ));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };

    reject = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await ManualPaymentService.rejectRequest(
                value(req, "id"),
                req.body?.reason,
                platformActor(req),
            ));
        } catch (caught) {
            return errorResponse(caught, res);
        }
    };
}
