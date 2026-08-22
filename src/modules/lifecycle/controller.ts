import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { BillingWebhookService } from "./billing-webhook.service";
import { TenantExportService } from "./tenant-export.service";
import { TenantLifecycleService } from "./tenant-lifecycle.service";
import { CommercialAlertService } from "./commercial-alert.service";

function handle(caught: unknown, res: Response): Response {
    if (caught instanceof CustomError) {
        return res.status(caught.statusCode).json({ message: caught.message });
    }
    const message = caught instanceof Error ? caught.message : "Error interno";
    return res.status(500).json({ message });
}

export class TenantLifecycleController {
    current = async (_req: AuthRequest, res: Response) => {
        try {
            const [current, alerts] = await Promise.all([
                TenantLifecycleService.getCurrent(),
                CommercialAlertService.evaluateCurrent(),
            ]);
            return res.json({ ...current, alerts });
        } catch (caught) {
            return handle(caught, res);
        }
    };

    dismissAlert = async (req: AuthRequest, res: Response) => {
        try {
            return res.json(await CommercialAlertService.dismiss(String(req.params.alertId || "")));
        } catch (caught) {
            return handle(caught, res);
        }
    };

    updateLegalProfile = async (req: AuthRequest, res: Response) => {
        if (!req.user || !req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        try {
            const tenant = await TenantLifecycleService.updateLegalProfile(req.body ?? {}, {
                userId: req.user.id,
                role: req.tenant.membership.role,
            });
            return res.json({ tenant });
        } catch (caught) {
            return handle(caught, res);
        }
    };

    setPrimaryStore = async (req: AuthRequest, res: Response) => {
        if (!req.user || !req.tenant) {
            return res.status(403).json({ message: "Contexto de empresa requerido" });
        }
        try {
            const store = await TenantLifecycleService.setPrimaryStore(
                Number(req.body?.storeId),
                { userId: req.user.id, role: req.tenant.membership.role },
            );
            return res.json({ store });
        } catch (caught) {
            return handle(caught, res);
        }
    };

    exportData = async (_req: AuthRequest, res: Response) => {
        try {
            const exported = await TenantExportService.createCurrentTenantExport();
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
            res.setHeader("X-Export-SHA256", exported.sha256);
            res.setHeader("X-Export-Rows", String(exported.rowCount));
            return res.send(exported.body);
        } catch (caught) {
            return handle(caught, res);
        }
    };

}

export class BillingWebhookController {
    constructor(private readonly service: BillingWebhookService | null) {}

    process = async (req: Request & { rawBody?: Buffer }, res: Response) => {
        if (!this.service) {
            return res.status(503).json({ message: "Facturación no disponible" });
        }
        const signature = String(req.header("x-webhook-signature") || "");
        const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
        try {
            const result = await this.service.process(
                String(req.params.provider || ""),
                rawBody,
                signature,
            );
            return res.status(result.replayed ? 200 : 202).json({
                received: true,
                idempotentReplay: result.replayed,
                eventId: result.event.id,
            });
        } catch (caught) {
            return handle(caught, res);
        }
    };
}
