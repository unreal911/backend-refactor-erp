import { Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { PlatformMfaService } from "./platform-mfa.service";

function actor(req: AuthRequest) {
    if (!req.platform?.platformAdminId) throw CustomError.forbidden("Administrador requerido");
    return { platformAdminId: req.platform.platformAdminId, correlationId: req.header("x-correlation-id") ?? null };
}
function handle(caught: unknown, res: Response) {
    if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
    console.error("[platform-mfa]", caught); return res.status(500).json({ message: "No se pudo administrar MFA" });
}

export class PlatformMfaController {
    status = async (req: AuthRequest, res: Response) => { try { return res.json(await PlatformMfaService.status(actor(req).platformAdminId)); } catch (caught) { return handle(caught, res); } };
    begin = async (req: AuthRequest, res: Response) => { try { return res.json(await PlatformMfaService.begin(actor(req))); } catch (caught) { return handle(caught, res); } };
    confirm = async (req: AuthRequest, res: Response) => { try { return res.json(await PlatformMfaService.confirm(String(req.body?.code || ""), actor(req))); } catch (caught) { return handle(caught, res); } };
}
