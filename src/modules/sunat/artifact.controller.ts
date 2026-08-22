import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { SunatArtifactService } from "./services/sunat-artifact.service";

function handle(caught: unknown, res: Response): Response {
    if (caught instanceof CustomError) {
        return res.status(caught.statusCode).json({ message: caught.message });
    }
    return res.status(500).json({ message: "No se pudo acceder a la evidencia SUNAT" });
}

export class SunatArtifactController {
    constructor(private readonly service: SunatArtifactService | null) {}

    private unavailable(res: Response): Response | null {
        return this.service
            ? null
            : res.status(503).json({ message: "El almacenamiento documental SUNAT no está habilitado" });
    }

    listForComprobante = async (req: Request, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        const comprobanteId = Number(req.params.id);
        if (!Number.isInteger(comprobanteId) || comprobanteId < 1) {
            return res.status(400).json({ message: "ID de comprobante inválido" });
        }
        try {
            return res.json({ artifacts: await this.service!.listForComprobante(comprobanteId) });
        } catch (caught) {
            return handle(caught, res);
        }
    };

    download = async (req: Request, res: Response) => {
        const unavailable = this.unavailable(res);
        if (unavailable) return unavailable;
        const id = String(req.params.id || "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
            return res.status(400).json({ message: "ID de artefacto inválido" });
        }
        try {
            return res.json({
                url: await this.service!.createDownloadUrl(id, 300),
                expiresInSeconds: 300,
            });
        } catch (caught) {
            return handle(caught, res);
        }
    };
}
