import { Response } from "express";
import { AuthRequest } from "../../presentation/auth/middleware";
import { CustomError } from "../../domain/errors/custom.error";
import { WhatsAppConnectionError, WhatsAppConnectionService } from "./whatsapp-connection.service";

export class WhatsAppConnectionController {
    private readonly service = new WhatsAppConnectionService();

    private handle(caught: unknown, res: Response) {
        if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
        if (caught instanceof WhatsAppConnectionError) return res.status(502).json({ message: caught.message, code: caught.code });
        console.error("[whatsapp-connection]", caught);
        return res.status(500).json({ message: "No pudimos completar la conexión de WhatsApp" });
    }

    status = async (_req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.status()); } catch (caught) { return this.handle(caught, res); }
    };

    connect = async (req: AuthRequest, res: Response) => {
        try {
            if (!req.user) throw CustomError.unauthorized("Usuario no autenticado");
            return res.json(await this.service.connect(req.body || {}, req.user.id));
        } catch (caught) { return this.handle(caught, res); }
    };

    disconnect = async (_req: AuthRequest, res: Response) => {
        try { return res.json(await this.service.disconnect()); } catch (caught) { return this.handle(caught, res); }
    };
}
