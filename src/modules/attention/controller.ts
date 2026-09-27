import { Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { AuthRequest } from "../../presentation/auth/middleware";
import { AdminEventBus } from "../../presentation/admin-events/admin-event-bus";
import { WhatsAppCloudApiError } from "../../shared/whatsapp-cloud-api";
import { AttentionService } from "./attention.service";

export class AttentionController {
    constructor(private readonly service = new AttentionService()) {}

    private actor(req: AuthRequest): number {
        if (!req.user) throw CustomError.unauthorized("Usuario no autenticado");
        return req.user.id;
    }

    private handle(error: unknown, res: Response) {
        if (error instanceof CustomError) return res.status(error.statusCode).json({ message: error.message });
        if (error instanceof WhatsAppCloudApiError) return res.status(502).json({ message: error.message, code: error.providerCode });
        console.error("[attention]", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }

    list = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.list(req.query)); } catch (error) { return this.handle(error, res); }
    };
    get = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.get(String(req.params.id || ""))); } catch (error) { return this.handle(error, res); }
    };
    create = async (req: AuthRequest, res: Response) => {
        try {
            const actorUserId = this.actor(req);
            const result = await this.service.create(req.body ?? {}, actorUserId);
            await AdminEventBus.publish({ type: "ATTENTION_CREATED", entity: "ATTENTION", entityId: result.id, status: result.status, actorUserId });
            return res.status(201).json(result);
        } catch (error) { return this.handle(error, res); }
    };
    send = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.params.id || ""); const actorUserId = this.actor(req);
            const result = await this.service.send(id, req.body?.body, actorUserId);
            await AdminEventBus.publish({ type: "ATTENTION_MESSAGE_SENT", entity: "ATTENTION", entityId: id, actorUserId });
            return res.status(201).json(result);
        } catch (error) { return this.handle(error, res); }
    };
    receiveLocal = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.params.id || ""); const actorUserId = this.actor(req);
            const result = await this.service.receiveLocal(id, req.body?.body);
            await AdminEventBus.publish({ type: "ATTENTION_MESSAGE_RECEIVED", entity: "ATTENTION", entityId: id, actorUserId });
            return res.status(201).json(result);
        } catch (error) { return this.handle(error, res); }
    };
    update = async (req: AuthRequest, res: Response) => {
        try {
            const id = String(req.params.id || ""); const actorUserId = this.actor(req);
            const result = await this.service.update(id, req.body ?? {});
            await AdminEventBus.publish({ type: "ATTENTION_UPDATED", entity: "ATTENTION", entityId: id, status: result.status, actorUserId, targetUserId: result.assignedUserId });
            return res.json(result);
        } catch (error) { return this.handle(error, res); }
    };
    metrics = async (_req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.metrics()); } catch (error) { return this.handle(error, res); }
    };
    templates = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.listTemplates(req.query.includeInactive === "true")); } catch (error) { return this.handle(error, res); }
    };
    createTemplate = async (req: AuthRequest, res: Response) => {
        try { return res.status(201).json(await this.service.createTemplate(req.body ?? {}, this.actor(req))); } catch (error) { return this.handle(error, res); }
    };
    updateTemplate = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.updateTemplate(String(req.params.id || ""), req.body ?? {})); } catch (error) { return this.handle(error, res); }
    };
    linkOrder = async (req: AuthRequest, res: Response) => {
        try {
            const result = await this.service.linkOrder(String(req.params.id || ""), req.body?.orderId);
            await AdminEventBus.publish({ type: "ATTENTION_UPDATED", entity: "ATTENTION", entityId: String(req.params.id || ""), actorUserId: this.actor(req) });
            return res.status(201).json(result);
        } catch (error) { return this.handle(error, res); }
    };
    updateCaseSummary = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.updateCaseSummary(String(req.params.caseId || ""), req.body?.summary)); }
        catch (error) { return this.handle(error, res); }
    };
    createFollowUp = async (req: AuthRequest, res: Response) => {
        try { return res.status(201).json(await this.service.createFollowUp(String(req.params.caseId || ""), req.body?.body, this.actor(req))); }
        catch (error) { return this.handle(error, res); }
    };
    updateFollowUp = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.updateFollowUp(String(req.params.noteId || ""), req.body?.status, this.actor(req))); }
        catch (error) { return this.handle(error, res); }
    };
    orderCases = async (req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.listOrderCases(req.params.orderId)); }
        catch (error) { return this.handle(error, res); }
    };
}
