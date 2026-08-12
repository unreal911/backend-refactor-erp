import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { PlatformOperationsService } from "./platform-operations.service";

function errorResponse(caught: unknown, res: Response) {
    if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
    console.error("[platform-operations]", caught);
    return res.status(500).json({ message: "No se pudo consultar la operación de plataforma" });
}

export class PlatformOperationsController {
    metrics = async (_req: Request, res: Response) => {
        try { return res.json(await PlatformOperationsService.metrics()); }
        catch (caught) { return errorResponse(caught, res); }
    };

    audit = async (req: Request, res: Response) => {
        try { return res.json(await PlatformOperationsService.listAudit(req.query)); }
        catch (caught) { return errorResponse(caught, res); }
    };

    tenants = async (req: Request, res: Response) => {
        try { return res.json(await PlatformOperationsService.listTenants(req.query)); }
        catch (caught) { return errorResponse(caught, res); }
    };
}
