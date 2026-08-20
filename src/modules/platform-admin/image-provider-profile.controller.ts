import { Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { ImageProviderProfileService } from "./image-provider-profile.service";
import { CommercialAssetService } from "../commercial-assets/commercial-asset.service";

function id(req: AuthRequest) { const raw = req.params.id; return Array.isArray(raw) ? raw[0] || "" : raw || ""; }
function actor(req: AuthRequest) { if (!req.platform?.platformAdminId) throw CustomError.forbidden("Administrador requerido"); return { platformAdminId: req.platform.platformAdminId, correlationId: req.header("x-correlation-id") ?? null }; }
function handle(caught: unknown, res: Response) { if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message }); console.error("[image-providers]", caught); return res.status(500).json({ message: "No se pudo administrar el proveedor de imágenes" }); }

export class ImageProviderProfileController {
    list = async (_req: AuthRequest, res: Response) => { try { return res.json(await ImageProviderProfileService.list()); } catch (caught) { return handle(caught, res); } };
    create = async (req: AuthRequest, res: Response) => { try { return res.status(201).json(await ImageProviderProfileService.create(req.body || {}, actor(req))); } catch (caught) { return handle(caught, res); } };
    update = async (req: AuthRequest, res: Response) => { try { return res.json(await ImageProviderProfileService.update(id(req), req.body || {}, actor(req))); } catch (caught) { return handle(caught, res); } };
    test = async (req: AuthRequest, res: Response) => { try { return res.json(await ImageProviderProfileService.test(id(req), actor(req))); } catch (caught) { return handle(caught, res); } };
    syncUsage = async (req: AuthRequest, res: Response) => { try { return res.json(await ImageProviderProfileService.syncUsage(id(req), actor(req))); } catch (caught) { return handle(caught, res); } };
    activate = async (req: AuthRequest, res: Response) => { try { return res.json(await ImageProviderProfileService.activate(id(req), req.body || {}, actor(req))); } catch (caught) { return handle(caught, res); } };
    reconcile = async (req: AuthRequest, res: Response) => {
        try {
            actor(req);
            const tenantId = String(req.body?.tenantId || "").trim() || undefined;
            const deleteOrphans = req.body?.deleteOrphans === true;
            const limit = Number(req.body?.limit || 250);
            return res.json(await CommercialAssetService.reconcile({ ...(tenantId ? { tenantId } : {}), deleteOrphans, limit }));
        } catch (caught) { return handle(caught, res); }
    };
}
