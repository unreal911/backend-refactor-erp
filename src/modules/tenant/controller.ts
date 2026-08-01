import { Response } from "express";
import { AuthRequest } from "../../presentation/auth/middleware";
import { TenantContextService } from "./tenant-context.service";

export class TenantController {
    static current(req: AuthRequest, res: Response) {
        if (!req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        return res.json({ tenant: req.tenant.tenant, membership: req.tenant.membership });
    }

    static async listMine(req: AuthRequest, res: Response) {
        if (!req.user) {
            return res.status(401).json({ message: "Usuario no autenticado" });
        }
        const tenants = await TenantContextService.listAvailableTenants(req.user.id);
        return res.json({ tenants });
    }
}
