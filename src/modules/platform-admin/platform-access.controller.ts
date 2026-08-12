import { Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { PlatformAccessService } from "./platform-access.service";
function actor(req: AuthRequest) { if (!req.platform?.platformAdminId) throw CustomError.forbidden("Administrador requerido"); return { platformAdminId: req.platform.platformAdminId, correlationId: req.header("x-correlation-id") ?? null }; }
function id(req: AuthRequest) { const value = req.params.id; return Array.isArray(value) ? value[0] || "" : value || ""; }
function handle(caught: unknown, res: Response) { if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message }); console.error("[platform-access]", caught); return res.status(500).json({ message: "No se pudo administrar el acceso" }); }
export class PlatformAccessController {
    list = async (_req: AuthRequest, res: Response) => { try { return res.json(await PlatformAccessService.list()); } catch (caught) { return handle(caught, res); } };
    grant = async (req: AuthRequest, res: Response) => { try { return res.status(201).json(await PlatformAccessService.grant(req.body || {}, actor(req))); } catch (caught) { return handle(caught, res); } };
    update = async (req: AuthRequest, res: Response) => { try { return res.json(await PlatformAccessService.update(id(req), req.body || {}, actor(req))); } catch (caught) { return handle(caught, res); } };
}
