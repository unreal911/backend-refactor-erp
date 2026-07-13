import { Response } from "express";
import { AuthRequest } from "../../../presentation/auth/middleware";
import { CustomError } from "../../../domain/errors/custom.error";
import { EmisorConfigService, UpdateEmisorInput } from "./emisor-config.service";

function handleError(error: unknown, res: Response): void {
    if (error instanceof CustomError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
    }
    console.error("[SUNAT] error configuracion emisor:", error);
    res.status(500).json({ error: "Error interno al procesar la configuracion SUNAT" });
}

function str(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

function parseUpdate(body: unknown): UpdateEmisorInput {
    if (!body || typeof body !== "object") throw CustomError.badRequest("Body invalido");
    const b = body as Record<string, unknown>;
    return {
        environment: str(b.environment),
        ruc: str(b.ruc),
        razonSocial: str(b.razonSocial),
        nombreComercial: b.nombreComercial === null ? null : str(b.nombreComercial),
        ubigeo: str(b.ubigeo),
        direccion: b.direccion === null ? null : str(b.direccion),
        tipoOperacion: b.tipoOperacion === null ? null : str(b.tipoOperacion),
        regimen: b.regimen === null ? null : str(b.regimen),
        solUser: str(b.solUser),
        solPassword: str(b.solPassword),
        signatureId: str(b.signatureId),
    };
}

export class EmisorConfigController {
    constructor(private readonly service: EmisorConfigService = new EmisorConfigService()) {}

    // GET /api/sunat/config
    obtener = async (_req: AuthRequest, res: Response): Promise<void> => {
        try {
            res.json(await this.service.obtener());
        } catch (error) {
            handleError(error, res);
        }
    };

    // PUT /api/sunat/config   (adminPassword requerido para cambios sensibles)
    actualizar = async (req: AuthRequest, res: Response): Promise<void> => {
        try {
            const adminPassword = str((req.body as Record<string, unknown> | undefined)?.adminPassword);
            res.json(await this.service.actualizar(parseUpdate(req.body), req.user?.id, adminPassword));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/config/certificado   body: { p12Base64, password, adminPassword }
    subirCertificado = async (req: AuthRequest, res: Response): Promise<void> => {
        try {
            const b = (req.body ?? {}) as Record<string, unknown>;
            const p12Base64 = str(b.p12Base64);
            if (!p12Base64) throw CustomError.badRequest("Falta p12Base64 (el .pfx en base64)");
            const view = await this.service.subirCertificado(
                { p12Base64, password: str(b.password) ?? "" },
                req.user?.id,
                str(b.adminPassword),
            );
            res.json(view);
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/config/probar
    probar = async (_req: AuthRequest, res: Response): Promise<void> => {
        try {
            res.json(await this.service.probarConexion());
        } catch (error) {
            handleError(error, res);
        }
    };
}
