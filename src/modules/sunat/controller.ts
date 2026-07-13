import { Request, Response } from "express";
import { CustomError } from "../../domain/errors/custom.error";
import { ClienteInput, ComprobanteService } from "./services/comprobante.service";

function handleError(error: unknown, res: Response): void {
    if (error instanceof CustomError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
    }
    console.error("[SUNAT] error no controlado:", error);
    res.status(500).json({ error: "Error interno al procesar el comprobante" });
}

function parseId(raw: unknown): number {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) throw CustomError.badRequest("ID invalido");
    return id;
}

function parseCliente(body: unknown): ClienteInput | undefined {
    if (!body || typeof body !== "object") return undefined;
    const c = (body as Record<string, unknown>).cliente;
    if (!c || typeof c !== "object") return undefined;
    const obj = c as Record<string, unknown>;
    return {
        tipoDoc: typeof obj.tipoDoc === "string" ? obj.tipoDoc : undefined,
        numDoc: typeof obj.numDoc === "string" ? obj.numDoc : undefined,
        nombre: typeof obj.nombre === "string" ? obj.nombre : undefined,
    };
}

function parseDryRun(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    return (body as Record<string, unknown>).dryRun === true;
}

function parseIdList(body: unknown): number[] {
    if (!body || typeof body !== "object") throw CustomError.badRequest("Body invalido");
    const b = body as Record<string, unknown>;
    const raw = Array.isArray(b.comprobanteIds)
        ? b.comprobanteIds
        : b.comprobanteId !== undefined
          ? [b.comprobanteId]
          : [];
    if (raw.length === 0) throw CustomError.badRequest("Indica comprobanteIds:number[]");
    return raw.map((v) => {
        const id = Number(v);
        if (!Number.isInteger(id) || id < 1) throw CustomError.badRequest("comprobanteId invalido");
        return id;
    });
}

function parseBajaItems(body: unknown): Array<{ comprobanteId: number; motivo: string }> {
    if (!body || typeof body !== "object") throw CustomError.badRequest("Body invalido");
    const b = body as Record<string, unknown>;

    const raw = Array.isArray(b.items)
        ? b.items
        : b.comprobanteId !== undefined
          ? [{ comprobanteId: b.comprobanteId, motivo: b.motivo }]
          : [];

    if (raw.length === 0) throw CustomError.badRequest("Indica items:[{comprobanteId,motivo}]");

    return raw.map((entry) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        const comprobanteId = Number(e.comprobanteId);
        const motivo = typeof e.motivo === "string" ? e.motivo.trim() : "";
        if (!Number.isInteger(comprobanteId) || comprobanteId < 1) {
            throw CustomError.badRequest("comprobanteId invalido");
        }
        if (!motivo) throw CustomError.badRequest("motivo es obligatorio para cada comprobante");
        return { comprobanteId, motivo };
    });
}

export class SunatController {
    constructor(private readonly service: ComprobanteService = new ComprobanteService()) {}

    // POST /api/sunat/orders/:orderId/factura
    emitirFactura = async (req: Request, res: Response): Promise<void> => {
        try {
            const orderId = parseId(req.params.orderId);
            const comprobante = await this.service.emitirDesdeOrder(orderId, "FACTURA", {
                cliente: parseCliente(req.body),
                dryRun: parseDryRun(req.body),
            });
            res.status(201).json(comprobante);
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/orders/:orderId/boleta
    // body.viaResumen=true => crea la boleta en BORRADOR para informarla por Resumen Diario.
    emitirBoleta = async (req: Request, res: Response): Promise<void> => {
        try {
            const orderId = parseId(req.params.orderId);
            const body = (req.body ?? {}) as Record<string, unknown>;
            const comprobante = await this.service.emitirDesdeOrder(orderId, "BOLETA", {
                cliente: parseCliente(req.body),
                dryRun: parseDryRun(req.body),
                viaResumen: body.viaResumen === true,
            });
            res.status(201).json(comprobante);
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/resumen-diario   body: { fecha?: "YYYY-MM-DD" }
    generarResumenDiario = async (req: Request, res: Response): Promise<void> => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const fecha = typeof body.fecha === "string" ? body.fecha : undefined;
            res.status(201).json(await this.service.generarResumenDiario(fecha));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/resumen-diario/:id/consultar
    consultarResumen = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.consultarResumen(parseId(req.params.id)));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/resumen-diario/anulacion
    // body: { comprobanteIds: number[] }  o  { comprobanteId }  (boletas ya aceptadas)
    anularBoletas = async (req: Request, res: Response): Promise<void> => {
        try {
            res.status(201).json(await this.service.anularBoletasPorResumen(parseIdList(req.body)));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/comunicacion-baja
    // body: { items: [{comprobanteId, motivo}] }  o  { comprobanteId, motivo } (uno solo)
    generarComunicacionBaja = async (req: Request, res: Response): Promise<void> => {
        try {
            res.status(201).json(await this.service.generarComunicacionBaja(parseBajaItems(req.body)));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/comunicacion-baja/:id/consultar
    consultarComunicacionBaja = async (req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.consultarBaja(parseId(req.params.id)));
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/comprobantes/:id/nota-credito
    emitirNotaCredito = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.emitirNota(req, res, "NOTA_CREDITO");
        } catch (error) {
            handleError(error, res);
        }
    };

    // POST /api/sunat/comprobantes/:id/nota-debito
    emitirNotaDebito = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.emitirNota(req, res, "NOTA_DEBITO");
        } catch (error) {
            handleError(error, res);
        }
    };

    private emitirNota = async (
        req: Request,
        res: Response,
        tipo: "NOTA_CREDITO" | "NOTA_DEBITO",
    ): Promise<void> => {
        const id = parseId(req.params.id);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const codigoMotivo = typeof body.codigoMotivo === "string" ? body.codigoMotivo.trim() : "";
        const descripcionMotivo = typeof body.descripcionMotivo === "string" ? body.descripcionMotivo.trim() : "";

        if (!codigoMotivo) throw CustomError.badRequest("codigoMotivo es obligatorio (catalogo 09/10)");
        if (!descripcionMotivo) throw CustomError.badRequest("descripcionMotivo es obligatorio");

        const comprobante = await this.service.emitirNota(id, tipo, {
            codigoMotivo,
            descripcionMotivo,
            dryRun: parseDryRun(body),
        });
        res.status(201).json(comprobante);
    };

    // GET /api/sunat/pendientes  -> lotes de boletas/notas en BORRADOR por dia
    listarPendientes = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.listarPendientes());
        } catch (error) {
            handleError(error, res);
        }
    };

    // GET /api/sunat/comprobantes?tipo=&estado=&desde=&hasta=&q=&skip=&take=
    listarComprobantes = async (req: Request, res: Response): Promise<void> => {
        try {
            const q = req.query as Record<string, string | undefined>;
            const tipos = ["FACTURA", "BOLETA", "NOTA_CREDITO", "NOTA_DEBITO"];
            const estados = ["BORRADOR", "ENVIADO", "ACEPTADO", "ACEPTADO_CON_OBSERVACIONES", "RECHAZADO", "ANULADO", "ERROR"];
            res.json(await this.service.listarComprobantes({
                tipo: q.tipo && tipos.includes(q.tipo) ? (q.tipo as any) : undefined,
                estado: q.estado && estados.includes(q.estado) ? (q.estado as any) : undefined,
                desde: q.desde,
                hasta: q.hasta,
                q: q.q,
                skip: q.skip ? Number(q.skip) : undefined,
                take: q.take ? Number(q.take) : undefined,
            }));
        } catch (error) {
            handleError(error, res);
        }
    };

    // GET /api/sunat/informe-dia?fecha=YYYY-MM-DD -> declarados vs pendientes del dia
    informeDia = async (req: Request, res: Response): Promise<void> => {
        try {
            const fecha = typeof req.query.fecha === "string" ? req.query.fecha : undefined;
            res.json(await this.service.informeDia(fecha));
        } catch (error) {
            handleError(error, res);
        }
    };

    // GET /api/sunat/reconciliacion -> ordenes con comprobanteTipo sin comprobante resuelto
    listarReconciliacion = async (_req: Request, res: Response): Promise<void> => {
        try {
            res.json(await this.service.listarReconciliacion());
        } catch (error) {
            handleError(error, res);
        }
    };

    // GET /api/sunat/orders/:orderId/comprobantes
    listarPorOrder = async (req: Request, res: Response): Promise<void> => {
        try {
            const orderId = parseId(req.params.orderId);
            res.json(await this.service.listarPorOrder(orderId));
        } catch (error) {
            handleError(error, res);
        }
    };

    // GET /api/sunat/comprobantes/:id
    obtener = async (req: Request, res: Response): Promise<void> => {
        try {
            const id = parseId(req.params.id);
            res.json(await this.service.obtener(id));
        } catch (error) {
            handleError(error, res);
        }
    };
}
