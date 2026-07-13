import {
    Comprobante,
    ComprobanteEstado,
    ComprobanteTipo,
    ComunicacionBaja,
    Prisma,
    ResumenDiario,
    SunatDispatchStatus,
} from "@prisma/client";
import { prisma } from "../../../data/prisma";
import { CustomError } from "../../../domain/errors/custom.error";
import { IGV_PORCENTAJE, TIPO_DOC, TIPO_DOC_IDENTIDAD, AFECTACION_IGV } from "../catalogs/sunat-catalogs";
import { loadSunatConfig, resolveSunatConfig, SunatConfig } from "../config/sunat.config";
import { buildComprobanteXml } from "../builder/ubl.builder";
import {
    ComprobanteData,
    ComprobanteLineaData,
    ComprobanteTipoCodigo,
    ComprobanteTotales,
} from "../builder/comprobante-data";
import { buildResumenDiarioXml, ResumenBoletaLinea } from "../builder/resumen.builder";
import { buildComunicacionBajaXml } from "../builder/baja.builder";
import { montoEnLetras } from "../utils/number-to-words";
import { XmlSignerService } from "../signer/xml-signer.service";
import { ZipService } from "../zip/zip.service";
import { SunatSoapClient } from "../soap/sunat-soap.client";
import { parseCdr } from "./cdr-parser";
import { reserveNextNumber } from "./numbering.service";

const TIPO_CODIGO: Record<ComprobanteTipo, ComprobanteTipoCodigo> = {
    FACTURA: "01",
    BOLETA: "03",
    NOTA_CREDITO: "07",
    NOTA_DEBITO: "08",
};

export interface ClienteInput {
    tipoDoc?: string | undefined; // catalogo 06
    numDoc?: string | undefined;
    nombre?: string | undefined;
}

// Comprobante con el documento afectado embebido (para armar la referencia en el resumen).
type ComprobanteConAfectado = Comprobante & {
    comprobanteAfectado?: { serie: string; numero: number; tipoCodigo: string } | null;
};

export interface EmitirComprobanteOptions {
    cliente?: ClienteInput | undefined;
    dryRun?: boolean | undefined;
    // Boletas: crear localmente (BORRADOR) para informar por Resumen Diario
    // en vez de enviarlas individualmente por sendBill.
    viaResumen?: boolean | undefined;
}

export interface EmitirNotaOptions {
    codigoMotivo: string; // catalogo 09 (NC) / 10 (ND)
    descripcionMotivo: string;
    dryRun?: boolean | undefined;
}

// Lote de boletas/notas de un dia pendiente de informar a SUNAT via Resumen Diario.
export interface LotePendiente {
    fecha: string; // YYYY-MM-DD (fecha de emision)
    boletas: number;
    notas: number;
    totalGravado: number;
    totalIgv: number;
    totalPrecioVenta: number;
    fechaLimite: string; // YYYY-MM-DD, 7mo dia calendario tras la emision
    diasRestantes: number; // dias hasta el plazo (negativo = vencido)
    vencido: boolean;
}

// Filtros del listado de comprobantes emitidos (panel admin).
export interface ListarComprobantesFiltros {
    tipo?: ComprobanteTipo | undefined;
    estado?: ComprobanteEstado | undefined;
    desde?: string | undefined; // YYYY-MM-DD
    hasta?: string | undefined; // YYYY-MM-DD
    q?: string | undefined; // serie o numero
    skip?: number | undefined;
    take?: number | undefined;
}

// Resumen por tipo de comprobante en el informe diario.
export interface InformeGrupo {
    total: number;
    declaradas: number;
    pendientes: number;
    monto: number;
    montoPendiente: number;
}

// Informe de un dia: boletas/facturas/notas declaradas vs pendientes.
export interface InformeDia {
    fecha: string; // YYYY-MM-DD
    boletas: InformeGrupo;
    facturas: InformeGrupo;
    notas: InformeGrupo;
}

// Orden que pidio comprobante pero no llego a emitirse/aceptarse (reconciliacion).
export interface OrdenSinComprobante {
    orderId: number;
    code: string;
    comprobanteTipo: ComprobanteTipo;
    clienteNombre: string | null;
    clienteNumDoc: string | null;
    total: number;
    fecha: string; // ISO createdAt de la orden
    motivo: "SIN_COMPROBANTE" | "ERROR" | "RECHAZADO" | "SIN_ENVIAR";
    comprobanteId: number | null; // si existe un comprobante (fallido) asociado
    comprobanteEstado: ComprobanteEstado | null;
}

const IGV_FACTOR = 1 + IGV_PORCENTAJE / 100;

function round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Afectaciones onerosas soportadas en el calculo (catalogo 07). Otras => se trata como gravado.
const AFECTACIONES_SOPORTADAS: readonly string[] = [
    AFECTACION_IGV.GRAVADO,
    AFECTACION_IGV.EXONERADO,
    AFECTACION_IGV.INAFECTO,
];

function normalizeAfectacion(raw: string | null | undefined): string {
    const code = (raw ?? "").trim();
    return AFECTACIONES_SOPORTADAS.includes(code) ? code : AFECTACION_IGV.GRAVADO;
}

function estadoFromDispatch(status: SunatDispatchStatus): ComprobanteEstado {
    switch (status) {
        case "ACCEPTED":
            return "ACEPTADO";
        case "ACCEPTED_WITH_OBSERVATIONS":
            return "ACEPTADO_CON_OBSERVACIONES";
        case "REJECTED":
            return "RECHAZADO";
        case "SIMULATED":
            return "BORRADOR";
        default:
            return "ERROR";
    }
}

export class ComprobanteService {
    private config: SunatConfig;
    private signer: XmlSignerService;
    private readonly zip: ZipService;
    private readonly soap: SunatSoapClient;
    // Si el caller inyecta config, se respeta y no se lee la BD.
    private readonly explicitConfig: boolean;
    private ready?: Promise<void>;

    constructor(config?: SunatConfig) {
        // Base sincrona (env, BETA) para que this.config nunca sea undefined.
        const initial = config ?? resolveSunatConfig();
        this.config = initial;
        this.signer = new XmlSignerService(initial);
        this.zip = new ZipService();
        this.soap = new SunatSoapClient();
        this.explicitConfig = config !== undefined;
    }

    // Carga la config efectiva desde la BD (emisor activo) una sola vez.
    // Con config inyectada o sin fila activa, mantiene la base de env (BETA).
    private async ensureReady(): Promise<void> {
        if (this.explicitConfig) return;
        if (!this.ready) {
            this.ready = (async () => {
                const resolved = await loadSunatConfig();
                this.config = resolved;
                this.signer = new XmlSignerService(resolved);
            })();
        }
        return this.ready;
    }

    // -------- Emitir factura / boleta desde un Order --------
    async emitirDesdeOrder(
        orderId: number,
        tipo: "FACTURA" | "BOLETA",
        options: EmitirComprobanteOptions = {},
    ): Promise<Comprobante> {
        await this.ensureReady();
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: {
                    where: { removedAt: null },
                    include: { variant: { include: { product: true, color: true, size: true } } },
                },
            },
        });

        if (!order) throw CustomError.notFound("Orden no encontrada");
        if (order.items.length === 0) throw CustomError.badRequest("La orden no tiene items facturables");

        // El doc del adquirente puede venir en el request o estar persistido en la orden.
        const clienteInput: ClienteInput = {
            tipoDoc: options.cliente?.tipoDoc ?? order.clienteTipoDoc ?? undefined,
            numDoc: options.cliente?.numDoc ?? order.clienteNumDoc ?? undefined,
            nombre: options.cliente?.nombre ?? undefined,
        };
        const cliente = this.resolveCliente(tipo, clienteInput, order.clientName);

        // Snapshot de lineas + totales
        const lineas = order.items.map((item, index): ComprobanteLineaData => {
            const cantidad = item.quantity;
            const precioVentaUnit = Number(item.unitPrice); // precio de lista (con IGV si es gravado)
            const v = item.variant;
            const afectacion = normalizeAfectacion(v.product.afectacionIgv);
            const gravado = afectacion === AFECTACION_IGV.GRAVADO;
            // Exonerado/inafecto no llevan IGV: el precio de lista ya es el valor de venta.
            const valorUnitario = gravado ? round2(precioVentaUnit / IGV_FACTOR) : precioVentaUnit;
            const valorVenta = round2(valorUnitario * cantidad);
            const igv = gravado ? round2(valorVenta * (IGV_PORCENTAJE / 100)) : 0;
            const descripcion = [v.product.name, v.color?.name, v.size?.name].filter(Boolean).join(" ");
            return {
                linea: index + 1,
                codigoProducto: v.sku,
                descripcion: descripcion || `Producto ${v.id}`,
                unidadMedida: "NIU",
                cantidad,
                valorUnitario,
                precioUnitario: gravado ? precioVentaUnit : valorUnitario,
                valorVenta,
                afectacionIgv: afectacion,
                igv,
                isc: 0,
            };
        });

        const totales = this.computeTotales(lineas);
        const tipoCodigo = TIPO_CODIGO[tipo];

        // Reserva de numero + creacion del comprobante en una transaccion
        const comprobante = await prisma.$transaction(async (tx) => {
            const { serieId, serie, numero } = await reserveNextNumber(tx, tipo);
            const nombreArchivo = `${this.config.ruc}-${tipoCodigo}-${serie}-${numero}`;

            return tx.comprobante.create({
                data: {
                    tipo,
                    tipoCodigo,
                    serie,
                    numero,
                    nombreArchivo,
                    estado: "BORRADOR",
                    emisorRuc: this.config.ruc,
                    emisorRazonSocial: this.config.razonSocial,
                    clienteTipoDoc: cliente.tipoDoc,
                    clienteNumDoc: cliente.numDoc,
                    clienteNombre: cliente.nombre,
                    moneda: "PEN",
                    totalGravado: totales.gravado,
                    totalExonerado: totales.exonerado,
                    totalInafecto: totales.inafecto,
                    totalGratuito: totales.gratuito,
                    totalIgv: totales.igv,
                    totalIsc: totales.isc,
                    totalOtrosTributos: totales.otrosTributos,
                    totalValorVenta: totales.valorVenta,
                    totalPrecioVenta: totales.precioVenta,
                    leyendaMontoLetras: montoEnLetras(totales.precioVenta),
                    orderId: order.id,
                    serieRefId: serieId,
                    items: {
                        create: lineas.map((l) => ({
                            linea: l.linea,
                            codigoProducto: l.codigoProducto ?? null,
                            descripcion: l.descripcion,
                            unidadMedida: l.unidadMedida,
                            cantidad: l.cantidad,
                            valorUnitario: l.valorUnitario,
                            precioUnitario: l.precioUnitario,
                            valorVenta: l.valorVenta,
                            afectacionIgvCodigo: l.afectacionIgv,
                            igv: l.igv,
                            isc: l.isc,
                        })),
                    },
                },
            });
        });

        // Boleta por Resumen Diario: se queda en BORRADOR hasta que se genere el RC.
        if (tipo === "BOLETA" && options.viaResumen) {
            return this.reload(comprobante.id);
        }

        const data = this.toComprobanteData(comprobante, cliente, lineas, totales);
        return this.enviar(comprobante.id, data, options.dryRun ?? false);
    }

    // -------- Emitir nota de credito / debito sobre un comprobante aceptado --------
    async emitirNota(
        comprobanteAfectadoId: number,
        tipoNota: "NOTA_CREDITO" | "NOTA_DEBITO",
        options: EmitirNotaOptions,
    ): Promise<Comprobante> {
        await this.ensureReady();
        const base = await prisma.comprobante.findUnique({
            where: { id: comprobanteAfectadoId },
            include: { items: true },
        });

        if (!base) throw CustomError.notFound("Comprobante base no encontrado");
        if (base.estado !== "ACEPTADO" && base.estado !== "ACEPTADO_CON_OBSERVACIONES") {
            throw CustomError.badRequest("El comprobante base debe estar aceptado por SUNAT");
        }
        if (base.tipo !== "FACTURA" && base.tipo !== "BOLETA") {
            throw CustomError.badRequest("Solo se emiten notas sobre facturas o boletas");
        }

        const tipoCodigo = TIPO_CODIGO[tipoNota];
        const serieBaseNota = base.tipo === "FACTURA"
            ? (tipoNota === "NOTA_CREDITO" ? "FC01" : "FD01")
            : (tipoNota === "NOTA_CREDITO" ? "BC01" : "BD01");

        const lineas: ComprobanteLineaData[] = base.items.map((it) => ({
            linea: it.linea,
            codigoProducto: it.codigoProducto ?? undefined,
            descripcion: it.descripcion,
            unidadMedida: it.unidadMedida,
            cantidad: Number(it.cantidad),
            valorUnitario: Number(it.valorUnitario),
            precioUnitario: Number(it.precioUnitario),
            valorVenta: Number(it.valorVenta),
            afectacionIgv: it.afectacionIgvCodigo,
            igv: Number(it.igv),
            isc: Number(it.isc),
        }));

        const totales = this.computeTotales(lineas);
        const cliente = {
            tipoDoc: base.clienteTipoDoc,
            numDoc: base.clienteNumDoc,
            nombre: base.clienteNombre,
        };

        const nota = await prisma.$transaction(async (tx) => {
            const { serieId, serie, numero } = await reserveNextNumber(tx, tipoNota, serieBaseNota);
            const nombreArchivo = `${this.config.ruc}-${tipoCodigo}-${serie}-${numero}`;

            return tx.comprobante.create({
                data: {
                    tipo: tipoNota,
                    tipoCodigo,
                    serie,
                    numero,
                    nombreArchivo,
                    estado: "BORRADOR",
                    emisorRuc: this.config.ruc,
                    emisorRazonSocial: this.config.razonSocial,
                    clienteTipoDoc: cliente.tipoDoc,
                    clienteNumDoc: cliente.numDoc,
                    clienteNombre: cliente.nombre,
                    moneda: base.moneda,
                    totalGravado: totales.gravado,
                    totalExonerado: totales.exonerado,
                    totalInafecto: totales.inafecto,
                    totalGratuito: totales.gratuito,
                    totalIgv: totales.igv,
                    totalIsc: totales.isc,
                    totalOtrosTributos: totales.otrosTributos,
                    totalValorVenta: totales.valorVenta,
                    totalPrecioVenta: totales.precioVenta,
                    leyendaMontoLetras: montoEnLetras(totales.precioVenta),
                    motivoNota: options.descripcionMotivo,
                    motivoNotaCodigo: options.codigoMotivo,
                    comprobanteAfectadoId: base.id,
                    orderId: base.orderId,
                    serieRefId: serieId,
                    items: {
                        create: lineas.map((l) => ({
                            linea: l.linea,
                            codigoProducto: l.codigoProducto ?? null,
                            descripcion: l.descripcion,
                            unidadMedida: l.unidadMedida,
                            cantidad: l.cantidad,
                            valorUnitario: l.valorUnitario,
                            precioUnitario: l.precioUnitario,
                            valorVenta: l.valorVenta,
                            afectacionIgvCodigo: l.afectacionIgv,
                            igv: l.igv,
                            isc: l.isc,
                        })),
                    },
                },
            });
        });

        // Las notas de BOLETA se informan por Resumen Diario (no sendBill individual):
        // quedan en BORRADOR hasta que se genere el RC (igual que las boletas viaResumen).
        if (base.tipo === "BOLETA") {
            return this.reload(nota.id);
        }

        const data = this.toComprobanteData(nota, cliente, lineas, totales, {
            codigoMotivo: options.codigoMotivo,
            descripcionMotivo: options.descripcionMotivo,
            tipoDocAfectado: base.tipoCodigo as ComprobanteTipoCodigo,
            serieNumeroAfectado: `${base.serie}-${base.numero}`,
        });

        return this.enviar(nota.id, data, options.dryRun ?? false);
    }

    // -------- Envio: firma + zip + sendBill + CDR --------
    private async enviar(comprobanteId: number, data: ComprobanteData, dryRun: boolean): Promise<Comprobante> {
        const built = buildComprobanteXml(data);

        if (dryRun) {
            await prisma.sunatDispatch.create({
                data: {
                    comprobanteId,
                    environment: this.config.environment,
                    endpoint: this.config.endpointBill,
                    fileName: `${built.nombreArchivo}.zip`,
                    metodo: "sendBill",
                    documentTypeCode: built.documentTypeCode,
                    status: "SIMULATED",
                    cdrDescription: "Dry run local: XML/ZIP generados sin envio a SUNAT",
                    xmlBase64: Buffer.from(built.xml, "latin1").toString("base64"),
                },
            });
            return this.reload(comprobanteId);
        }

        const signedXml = this.signer.sign(built.xml);
        const zipBuffer = await this.zip.createSingleFileZip(`${built.nombreArchivo}.xml`, signedXml);
        const xmlBase64 = Buffer.from(signedXml, "latin1").toString("base64");

        const response = await this.soap.sendBill({
            endpoint: this.config.endpointBill,
            credentials: {
                username: `${this.config.ruc}${this.config.solUser}`,
                password: this.config.solPassword,
            },
            fileName: `${built.nombreArchivo}.zip`,
            zipBuffer,
        });

        if (!response.ok || !response.applicationResponseBase64) {
            await prisma.sunatDispatch.create({
                data: {
                    comprobanteId,
                    environment: this.config.environment,
                    endpoint: this.config.endpointBill,
                    fileName: `${built.nombreArchivo}.zip`,
                    metodo: "sendBill",
                    documentTypeCode: built.documentTypeCode,
                    status: "ERROR",
                    faultCode: response.faultCode ?? null,
                    faultString: response.faultString ?? null,
                    rawResponseXml: response.rawResponseXml,
                    xmlBase64,
                },
            });
            await prisma.comprobante.update({ where: { id: comprobanteId }, data: { estado: "ERROR" } });
            return this.reload(comprobanteId);
        }

        const cdrZip = Buffer.from(response.applicationResponseBase64, "base64");
        const cdrXml = await this.zip.getFirstXmlFromZip(cdrZip);
        const parsed = parseCdr(cdrXml);

        await prisma.sunatDispatch.create({
            data: {
                comprobanteId,
                environment: this.config.environment,
                endpoint: this.config.endpointBill,
                fileName: `${built.nombreArchivo}.zip`,
                metodo: "sendBill",
                documentTypeCode: built.documentTypeCode,
                status: parsed.status,
                cdrCode: parsed.cdrCode ?? null,
                cdrDescription: parsed.cdrDescription ?? null,
                cdrNotes: parsed.cdrNotes,
                cdrZipBase64: response.applicationResponseBase64,
                rawResponseXml: response.rawResponseXml,
                xmlBase64,
            },
        });

        await prisma.comprobante.update({
            where: { id: comprobanteId },
            data: { estado: estadoFromDispatch(parsed.status) },
        });

        return this.reload(comprobanteId);
    }

    // -------- Resumen Diario de boletas (envio asincrono) --------
    // Agrupa las boletas en BORRADOR (aun no informadas) de una fecha y las
    // envia a SUNAT via sendSummary, obteniendo un ticket para consultar luego.
    async generarResumenDiario(fecha?: string): Promise<ResumenDiario> {
        await this.ensureReady();
        const dia = fecha ? new Date(`${fecha}T00:00:00.000Z`) : new Date();
        if (Number.isNaN(dia.getTime())) throw CustomError.badRequest("Fecha invalida (usar YYYY-MM-DD)");
        const inicio = this.dateOnly(dia);
        const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);

        // Incluye boletas (03) y sus notas de credito/debito (07/08), todas en BORRADOR.
        // Las notas de boleta se informan por Resumen Diario, no por sendBill individual.
        const boletas = await prisma.comprobante.findMany({
            where: {
                estado: "BORRADOR",
                resumenDiarioId: null,
                fechaEmision: { gte: inicio, lt: fin },
                OR: [
                    { tipo: "BOLETA" },
                    {
                        tipo: { in: ["NOTA_CREDITO", "NOTA_DEBITO"] },
                        comprobanteAfectado: { tipo: "BOLETA" },
                    },
                ],
            },
            include: {
                comprobanteAfectado: { select: { serie: true, numero: true, tipoCodigo: true } },
            },
            orderBy: [{ tipoCodigo: "asc" }, { numero: "asc" }],
        });

        if (boletas.length === 0) {
            throw CustomError.badRequest("No hay boletas ni notas de boleta en borrador para esa fecha");
        }

        return this.enviarResumen(boletas, inicio, false);
    }

    // Anula boletas ya aceptadas por SUNAT enviando un Resumen Diario con
    // estado 3 (anulacion). Las boletas deben compartir fecha de emision.
    async anularBoletasPorResumen(comprobanteIds: number[]): Promise<ResumenDiario> {
        await this.ensureReady();
        if (!comprobanteIds.length) throw CustomError.badRequest("Indica las boletas a anular");

        const boletas = await prisma.comprobante.findMany({ where: { id: { in: comprobanteIds } } });
        if (boletas.length !== comprobanteIds.length) {
            throw CustomError.notFound("Alguna de las boletas no existe");
        }

        for (const b of boletas) {
            if (b.tipo !== "BOLETA") {
                throw CustomError.badRequest(`${b.serie}-${b.numero} no es boleta (usa Comunicacion de Baja)`);
            }
            if (b.estado !== "ACEPTADO" && b.estado !== "ACEPTADO_CON_OBSERVACIONES") {
                throw CustomError.badRequest(`${b.serie}-${b.numero} no esta aceptada por SUNAT`);
            }
        }

        const fechas = new Set(boletas.map((b) => this.dateOnly(b.fechaEmision).toISOString()));
        if (fechas.size > 1) {
            throw CustomError.badRequest("Las boletas deben tener la misma fecha de emision");
        }

        return this.enviarResumen(boletas, this.dateOnly(boletas[0]!.fechaEmision), true);
    }

    // Construye, firma y envia un Resumen Diario (adicion o anulacion).
    private async enviarResumen(
        boletas: ComprobanteConAfectado[],
        fechaReferencia: Date,
        esAnulacion: boolean,
    ): Promise<ResumenDiario> {
        // En fallo de envio, revertir al estado previo del que partieron las boletas.
        const estadoRevert: ComprobanteEstado = esAnulacion ? "ACEPTADO" : "BORRADOR";

        // Correlativo por fecha de generacion (la que va en el nombre del archivo).
        const hoyInicio = this.dateOnly(new Date());
        const hoyFin = new Date(hoyInicio.getTime() + 24 * 60 * 60 * 1000);
        const correlativo =
            (await prisma.resumenDiario.count({
                where: { fechaGeneracion: { gte: hoyInicio, lt: hoyFin } },
            })) + 1;

        const lineas: ResumenBoletaLinea[] = boletas.map((b) => {
            const esNota = b.tipo === "NOTA_CREDITO" || b.tipo === "NOTA_DEBITO";
            const afectado = b.comprobanteAfectado;
            return {
                tipoCodigo: b.tipoCodigo,
                serieNumero: `${b.serie}-${b.numero}`,
                clienteTipoDoc: b.clienteTipoDoc,
                clienteNumDoc: b.clienteNumDoc,
                estado: esAnulacion ? "3" : "1",
                docReferenciaTipo: esNota && afectado ? afectado.tipoCodigo : undefined,
                docReferenciaSerieNumero: esNota && afectado ? `${afectado.serie}-${afectado.numero}` : undefined,
                totalPrecioVenta: Number(b.totalPrecioVenta),
                gravado: Number(b.totalGravado),
                exonerado: Number(b.totalExonerado),
                inafecto: Number(b.totalInafecto),
                gratuito: Number(b.totalGratuito),
                igv: Number(b.totalIgv),
                isc: Number(b.totalIsc),
            };
        });

        const built = buildResumenDiarioXml({
            correlativo,
            fechaReferencia,
            fechaGeneracion: new Date(),
            emisorRuc: this.config.ruc,
            emisorRazonSocial: this.config.razonSocial,
            moneda: "PEN",
            lineas,
        });

        // Crea el resumen y vincula las boletas (estado ENVIADO) en una transaccion.
        const resumen = await prisma.$transaction(async (tx) => {
            const created = await tx.resumenDiario.create({
                data: {
                    correlativo,
                    fechaReferencia,
                    fileName: built.fileName,
                    esAnulacion,
                    environment: this.config.environment,
                    endpoint: this.config.endpointBill,
                    status: "PENDING",
                },
            });
            await tx.comprobante.updateMany({
                where: { id: { in: boletas.map((b) => b.id) } },
                data: { resumenDiarioId: created.id, estado: "ENVIADO" },
            });
            return created;
        });

        const signedXml = this.signer.sign(built.xml);
        const zipBuffer = await this.zip.createSingleFileZip(`${built.fileName}.xml`, signedXml);
        const xmlBase64 = Buffer.from(signedXml, "latin1").toString("base64");

        const response = await this.soap.sendSummary({
            endpoint: this.config.endpointBill,
            credentials: {
                username: `${this.config.ruc}${this.config.solUser}`,
                password: this.config.solPassword,
            },
            fileName: `${built.fileName}.zip`,
            zipBuffer,
        });

        if (!response.ok || !response.ticket) {
            await prisma.$transaction([
                prisma.comprobante.updateMany({
                    where: { resumenDiarioId: resumen.id },
                    data: { resumenDiarioId: null, estado: estadoRevert },
                }),
                prisma.resumenDiario.update({
                    where: { id: resumen.id },
                    data: {
                        status: "ERROR",
                        faultCode: response.faultCode ?? null,
                        faultString: response.faultString ?? null,
                        rawResponseXml: response.rawResponseXml,
                        xmlBase64,
                    },
                }),
            ]);
            return this.reloadResumen(resumen.id);
        }

        await prisma.resumenDiario.update({
            where: { id: resumen.id },
            data: { ticket: response.ticket, xmlBase64, rawResponseXml: response.rawResponseXml },
        });

        return this.reloadResumen(resumen.id);
    }

    // Consulta el ticket del resumen (getStatus) y aplica el CDR.
    async consultarResumen(resumenId: number): Promise<ResumenDiario> {
        await this.ensureReady();
        const resumen = await prisma.resumenDiario.findUnique({ where: { id: resumenId } });
        if (!resumen) throw CustomError.notFound("Resumen no encontrado");
        if (!resumen.ticket) throw CustomError.badRequest("El resumen no tiene ticket (no fue enviado)");
        if (resumen.status === "ACCEPTED" || resumen.status === "ACCEPTED_WITH_OBSERVATIONS") {
            return this.reloadResumen(resumen.id);
        }

        const response = await this.soap.getStatus(
            resumen.endpoint,
            { username: `${this.config.ruc}${this.config.solUser}`, password: this.config.solPassword },
            resumen.ticket,
        );

        if (!response.ok) {
            await prisma.resumenDiario.update({
                where: { id: resumen.id },
                data: {
                    faultCode: response.faultCode ?? null,
                    faultString: response.faultString ?? null,
                    rawResponseXml: response.rawResponseXml,
                },
            });
            return this.reloadResumen(resumen.id);
        }

        // 98 = aun en proceso
        if (response.statusCode === "98") {
            return this.reloadResumen(resumen.id);
        }

        // 0 = correcto, 99 = con errores. Ambos traen CDR en content.
        if (!response.applicationResponseBase64) {
            await prisma.resumenDiario.update({
                where: { id: resumen.id },
                data: { rawResponseXml: response.rawResponseXml },
            });
            return this.reloadResumen(resumen.id);
        }

        const cdrZip = Buffer.from(response.applicationResponseBase64, "base64");
        const cdrXml = await this.zip.getFirstXmlFromZip(cdrZip);
        const parsed = parseCdr(cdrXml);

        await prisma.$transaction(async (tx) => {
            await tx.resumenDiario.update({
                where: { id: resumen.id },
                data: {
                    status: parsed.status,
                    cdrCode: parsed.cdrCode ?? null,
                    cdrDescription: parsed.cdrDescription ?? null,
                    cdrNotes: parsed.cdrNotes,
                    cdrZipBase64: response.applicationResponseBase64 ?? null,
                    rawResponseXml: response.rawResponseXml,
                },
            });

            if (parsed.status === "ACCEPTED" || parsed.status === "ACCEPTED_WITH_OBSERVATIONS") {
                // Anulacion aceptada => ANULADO; adicion aceptada => ACEPTADO/OBS.
                await tx.comprobante.updateMany({
                    where: { resumenDiarioId: resumen.id },
                    data: { estado: resumen.esAnulacion ? "ANULADO" : estadoFromDispatch(parsed.status) },
                });
            } else if (parsed.status === "REJECTED") {
                // Rechazo: el documento completo no se informa; se puede reenviar.
                // Adicion vuelve a BORRADOR; anulacion vuelve a ACEPTADO.
                await tx.comprobante.updateMany({
                    where: { resumenDiarioId: resumen.id },
                    data: { resumenDiarioId: null, estado: resumen.esAnulacion ? "ACEPTADO" : "BORRADOR" },
                });
            }
        });

        return this.reloadResumen(resumen.id);
    }

    private async reloadResumen(id: number): Promise<ResumenDiario> {
        const r = await prisma.resumenDiario.findUnique({
            where: { id },
            include: { comprobantes: { select: { id: true, serie: true, numero: true, estado: true } } },
        });
        if (!r) throw CustomError.notFound("Resumen no encontrado");
        return r;
    }

    // -------- Comunicacion de Baja (anula facturas y notas aceptadas) --------
    async generarComunicacionBaja(
        items: Array<{ comprobanteId: number; motivo: string }>,
    ): Promise<ComunicacionBaja> {
        await this.ensureReady();
        if (!items.length) throw CustomError.badRequest("Debes indicar al menos un comprobante a dar de baja");

        const ids = items.map((i) => i.comprobanteId);
        const comprobantes = await prisma.comprobante.findMany({ where: { id: { in: ids } } });

        if (comprobantes.length !== ids.length) {
            throw CustomError.notFound("Alguno de los comprobantes no existe");
        }

        const motivoPorId = new Map(items.map((i) => [i.comprobanteId, i.motivo.trim()]));

        for (const c of comprobantes) {
            if (c.tipo === "BOLETA") {
                throw CustomError.badRequest(
                    `${c.serie}-${c.numero}: las boletas se anulan por Resumen Diario, no por Comunicacion de Baja`,
                );
            }
            if (c.estado !== "ACEPTADO" && c.estado !== "ACEPTADO_CON_OBSERVACIONES") {
                throw CustomError.badRequest(`${c.serie}-${c.numero} no esta aceptado por SUNAT`);
            }
            if (c.comunicacionBajaId) {
                throw CustomError.badRequest(`${c.serie}-${c.numero} ya tiene una comunicacion de baja`);
            }
            if (!motivoPorId.get(c.id)) {
                throw CustomError.badRequest(`Falta el motivo de baja de ${c.serie}-${c.numero}`);
            }
        }

        // Todos los documentos del RA deben compartir la fecha de emision.
        const fechas = new Set(comprobantes.map((c) => this.dateOnly(c.fechaEmision).toISOString()));
        if (fechas.size > 1) {
            throw CustomError.badRequest("Los comprobantes deben tener la misma fecha de emision (usa un RA por fecha)");
        }
        const fechaReferencia = this.dateOnly(comprobantes[0]!.fechaEmision);

        const hoyInicio = this.dateOnly(new Date());
        const hoyFin = new Date(hoyInicio.getTime() + 24 * 60 * 60 * 1000);
        const correlativo =
            (await prisma.comunicacionBaja.count({
                where: { fechaGeneracion: { gte: hoyInicio, lt: hoyFin } },
            })) + 1;

        const built = buildComunicacionBajaXml({
            correlativo,
            fechaReferencia,
            fechaGeneracion: new Date(),
            emisorRuc: this.config.ruc,
            emisorRazonSocial: this.config.razonSocial,
            lineas: comprobantes.map((c) => ({
                tipoCodigo: c.tipoCodigo,
                serie: c.serie,
                numero: c.numero,
                motivo: motivoPorId.get(c.id) as string,
            })),
        });

        const baja = await prisma.$transaction(async (tx) => {
            const created = await tx.comunicacionBaja.create({
                data: {
                    correlativo,
                    fechaReferencia,
                    fileName: built.fileName,
                    environment: this.config.environment,
                    endpoint: this.config.endpointBill,
                    status: "PENDING",
                },
            });
            for (const c of comprobantes) {
                await tx.comprobante.update({
                    where: { id: c.id },
                    data: { comunicacionBajaId: created.id, motivoBaja: motivoPorId.get(c.id) ?? null },
                });
            }
            return created;
        });

        const signedXml = this.signer.sign(built.xml);
        const zipBuffer = await this.zip.createSingleFileZip(`${built.fileName}.xml`, signedXml);
        const xmlBase64 = Buffer.from(signedXml, "latin1").toString("base64");

        const response = await this.soap.sendSummary({
            endpoint: this.config.endpointBill,
            credentials: {
                username: `${this.config.ruc}${this.config.solUser}`,
                password: this.config.solPassword,
            },
            fileName: `${built.fileName}.zip`,
            zipBuffer,
        });

        if (!response.ok || !response.ticket) {
            await prisma.$transaction([
                prisma.comprobante.updateMany({
                    where: { comunicacionBajaId: baja.id },
                    data: { comunicacionBajaId: null, motivoBaja: null },
                }),
                prisma.comunicacionBaja.update({
                    where: { id: baja.id },
                    data: {
                        status: "ERROR",
                        faultCode: response.faultCode ?? null,
                        faultString: response.faultString ?? null,
                        rawResponseXml: response.rawResponseXml,
                        xmlBase64,
                    },
                }),
            ]);
            return this.reloadBaja(baja.id);
        }

        await prisma.comunicacionBaja.update({
            where: { id: baja.id },
            data: { ticket: response.ticket, xmlBase64, rawResponseXml: response.rawResponseXml },
        });

        return this.reloadBaja(baja.id);
    }

    async consultarBaja(bajaId: number): Promise<ComunicacionBaja> {
        await this.ensureReady();
        const baja = await prisma.comunicacionBaja.findUnique({ where: { id: bajaId } });
        if (!baja) throw CustomError.notFound("Comunicacion de baja no encontrada");
        if (!baja.ticket) throw CustomError.badRequest("La comunicacion no tiene ticket (no fue enviada)");
        if (baja.status === "ACCEPTED" || baja.status === "ACCEPTED_WITH_OBSERVATIONS") {
            return this.reloadBaja(baja.id);
        }

        const response = await this.soap.getStatus(
            baja.endpoint,
            { username: `${this.config.ruc}${this.config.solUser}`, password: this.config.solPassword },
            baja.ticket,
        );

        if (!response.ok) {
            await prisma.comunicacionBaja.update({
                where: { id: baja.id },
                data: {
                    faultCode: response.faultCode ?? null,
                    faultString: response.faultString ?? null,
                    rawResponseXml: response.rawResponseXml,
                },
            });
            return this.reloadBaja(baja.id);
        }

        if (response.statusCode === "98") {
            return this.reloadBaja(baja.id);
        }

        if (!response.applicationResponseBase64) {
            await prisma.comunicacionBaja.update({
                where: { id: baja.id },
                data: { rawResponseXml: response.rawResponseXml },
            });
            return this.reloadBaja(baja.id);
        }

        const cdrZip = Buffer.from(response.applicationResponseBase64, "base64");
        const cdrXml = await this.zip.getFirstXmlFromZip(cdrZip);
        const parsed = parseCdr(cdrXml);

        await prisma.$transaction(async (tx) => {
            await tx.comunicacionBaja.update({
                where: { id: baja.id },
                data: {
                    status: parsed.status,
                    cdrCode: parsed.cdrCode ?? null,
                    cdrDescription: parsed.cdrDescription ?? null,
                    cdrNotes: parsed.cdrNotes,
                    cdrZipBase64: response.applicationResponseBase64 ?? null,
                    rawResponseXml: response.rawResponseXml,
                },
            });

            if (parsed.status === "ACCEPTED" || parsed.status === "ACCEPTED_WITH_OBSERVATIONS") {
                await tx.comprobante.updateMany({
                    where: { comunicacionBajaId: baja.id },
                    data: { estado: "ANULADO" },
                });
            } else if (parsed.status === "REJECTED") {
                await tx.comprobante.updateMany({
                    where: { comunicacionBajaId: baja.id },
                    data: { comunicacionBajaId: null, motivoBaja: null },
                });
            }
        });

        return this.reloadBaja(baja.id);
    }

    private async reloadBaja(id: number): Promise<ComunicacionBaja> {
        const b = await prisma.comunicacionBaja.findUnique({
            where: { id },
            include: { comprobantes: { select: { id: true, serie: true, numero: true, estado: true } } },
        });
        if (!b) throw CustomError.notFound("Comunicacion de baja no encontrada");
        return b;
    }

    private dateOnly(d: Date): Date {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    // -------- Consultas --------
    // Lotes pendientes de declarar: boletas (03) y sus notas (07/08) en BORRADOR,
    // agrupadas por fecha de emision, con contadores, totales y plazo (7mo dia calendario).
    async listarPendientes(): Promise<LotePendiente[]> {
        const comprobantes = await prisma.comprobante.findMany({
            where: {
                estado: "BORRADOR",
                resumenDiarioId: null,
                OR: [
                    { tipo: "BOLETA" },
                    {
                        tipo: { in: ["NOTA_CREDITO", "NOTA_DEBITO"] },
                        comprobanteAfectado: { tipo: "BOLETA" },
                    },
                ],
            },
            select: {
                tipo: true,
                fechaEmision: true,
                totalGravado: true,
                totalIgv: true,
                totalPrecioVenta: true,
            },
        });

        const hoy = this.dateOnly(new Date());
        const DIA_MS = 24 * 60 * 60 * 1000;
        const lotes = new Map<string, LotePendiente>();

        for (const c of comprobantes) {
            const dia = this.dateOnly(c.fechaEmision);
            const fecha = dia.toISOString().slice(0, 10);
            let lote = lotes.get(fecha);
            if (!lote) {
                // Plazo legal: hasta el 7mo dia calendario siguiente a la emision.
                const limite = new Date(dia.getTime() + 7 * DIA_MS);
                const diasRestantes = Math.floor((limite.getTime() - hoy.getTime()) / DIA_MS);
                lote = {
                    fecha,
                    boletas: 0,
                    notas: 0,
                    totalGravado: 0,
                    totalIgv: 0,
                    totalPrecioVenta: 0,
                    fechaLimite: limite.toISOString().slice(0, 10),
                    diasRestantes,
                    vencido: diasRestantes < 0,
                };
                lotes.set(fecha, lote);
            }
            if (c.tipo === "BOLETA") lote.boletas += 1;
            else lote.notas += 1;
            lote.totalGravado = round2(lote.totalGravado + Number(c.totalGravado));
            lote.totalIgv = round2(lote.totalIgv + Number(c.totalIgv));
            lote.totalPrecioVenta = round2(lote.totalPrecioVenta + Number(c.totalPrecioVenta));
        }

        return [...lotes.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
    }

    // Reconciliacion: ordenes marcadas con comprobanteTipo cuyo comprobante falta o quedo
    // en un estado no resuelto (red de seguridad para ventas que no llegaron a emitirse).
    async listarReconciliacion(): Promise<OrdenSinComprobante[]> {
        // Estados que consideramos "resueltos" para el comprobante solicitado.
        // Boleta en BORRADOR/ENVIADO es normal (pendiente de Resumen Diario) -> resuelto.
        // Factura en BORRADOR/ENVIADO = creada pero no aceptada -> NO resuelto.
        const OK_BOLETA = new Set<ComprobanteEstado>([
            "ACEPTADO", "ACEPTADO_CON_OBSERVACIONES", "ANULADO", "BORRADOR", "ENVIADO",
        ]);
        const OK_FACTURA = new Set<ComprobanteEstado>([
            "ACEPTADO", "ACEPTADO_CON_OBSERVACIONES", "ANULADO",
        ]);

        const orders = await prisma.order.findMany({
            where: { comprobanteTipo: { not: null } },
            select: {
                id: true,
                code: true,
                comprobanteTipo: true,
                clientName: true,
                clienteTipoDoc: true,
                clienteNumDoc: true,
                total: true,
                createdAt: true,
                comprobantes: {
                    select: { id: true, tipo: true, estado: true, serie: true, numero: true },
                    orderBy: { id: "desc" },
                },
            },
            orderBy: { id: "desc" },
        });

        const pendientes: OrdenSinComprobante[] = [];
        for (const o of orders) {
            const tipo = o.comprobanteTipo as ComprobanteTipo;
            const okSet = tipo === "FACTURA" ? OK_FACTURA : OK_BOLETA;
            const delTipo = o.comprobantes.filter((c) => c.tipo === tipo);
            const resuelto = delTipo.some((c) => okSet.has(c.estado));
            if (resuelto) continue;

            const ultimo = delTipo[0];
            const motivo: OrdenSinComprobante["motivo"] = !ultimo
                ? "SIN_COMPROBANTE"
                : ultimo.estado === "ERROR"
                  ? "ERROR"
                  : ultimo.estado === "RECHAZADO"
                    ? "RECHAZADO"
                    : "SIN_ENVIAR"; // factura BORRADOR/ENVIADO

            pendientes.push({
                orderId: o.id,
                code: o.code,
                comprobanteTipo: tipo,
                clienteNombre: o.clientName,
                clienteNumDoc: o.clienteNumDoc,
                total: Number(o.total),
                fecha: o.createdAt.toISOString(),
                motivo,
                comprobanteId: ultimo?.id ?? null,
                comprobanteEstado: ultimo?.estado ?? null,
            });
        }

        return pendientes;
    }

    // Listado de comprobantes emitidos con filtros (para el panel de administracion).
    async listarComprobantes(filtros: ListarComprobantesFiltros): Promise<{ items: Comprobante[]; total: number }> {
        const where: Prisma.ComprobanteWhereInput = {};
        if (filtros.tipo) where.tipo = filtros.tipo;
        if (filtros.estado) where.estado = filtros.estado;

        if (filtros.desde || filtros.hasta) {
            const rango: Prisma.DateTimeFilter = {};
            if (filtros.desde) rango.gte = new Date(`${filtros.desde}T00:00:00.000Z`);
            if (filtros.hasta) rango.lt = new Date(new Date(`${filtros.hasta}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
            where.fechaEmision = rango;
        }

        const q = filtros.q?.trim();
        if (q) {
            const or: Prisma.ComprobanteWhereInput[] = [{ serie: { contains: q, mode: "insensitive" } }];
            const num = Number(q.replace(/^\D+/, ""));
            if (Number.isInteger(num) && num > 0) or.push({ numero: num });
            where.OR = or;
        }

        const take = Math.min(Math.max(filtros.take ?? 50, 1), 200);
        const skip = Math.max(filtros.skip ?? 0, 0);

        const [items, total] = await Promise.all([
            prisma.comprobante.findMany({
                where,
                orderBy: { id: "desc" },
                skip,
                take,
                include: { dispatches: { orderBy: { sentAt: "desc" }, take: 1 } },
            }),
            prisma.comprobante.count({ where }),
        ]);

        return { items, total };
    }

    // Informe de comprobantes de un dia: declarados vs pendientes (para el panel).
    async informeDia(fecha?: string): Promise<InformeDia> {
        const dia = fecha ? new Date(`${fecha}T00:00:00.000Z`) : new Date();
        if (Number.isNaN(dia.getTime())) throw CustomError.badRequest("Fecha invalida (usar YYYY-MM-DD)");
        const inicio = this.dateOnly(dia);
        const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);

        const comprobantes = await prisma.comprobante.findMany({
            where: { fechaEmision: { gte: inicio, lt: fin } },
            select: { tipo: true, estado: true, resumenDiarioId: true, totalPrecioVenta: true },
        });

        // Un comprobante esta "declarado" si SUNAT lo acepto/anulo o ya va en un resumen (enviado).
        const DECLARADO = new Set<ComprobanteEstado>(["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES", "ANULADO", "ENVIADO"]);
        const declarado = (c: { estado: ComprobanteEstado; resumenDiarioId: number | null }): boolean =>
            DECLARADO.has(c.estado) || c.resumenDiarioId !== null;

        const grupo = (tipos: ComprobanteTipo[]): InformeGrupo => {
            const items = comprobantes.filter((c) => tipos.includes(c.tipo));
            const dec = items.filter(declarado);
            const pend = items.filter((c) => !declarado(c));
            const suma = (arr: typeof items) => round2(arr.reduce((s, c) => s + Number(c.totalPrecioVenta), 0));
            return {
                total: items.length,
                declaradas: dec.length,
                pendientes: pend.length,
                monto: suma(items),
                montoPendiente: suma(pend),
            };
        };

        return {
            fecha: inicio.toISOString().slice(0, 10),
            boletas: grupo(["BOLETA"]),
            facturas: grupo(["FACTURA"]),
            notas: grupo(["NOTA_CREDITO", "NOTA_DEBITO"]),
        };
    }

    async listarPorOrder(orderId: number): Promise<Comprobante[]> {
        return prisma.comprobante.findMany({
            where: { orderId },
            orderBy: { createdAt: "desc" },
            include: { dispatches: { orderBy: { sentAt: "desc" } } },
        });
    }

    async obtener(comprobanteId: number): Promise<Comprobante> {
        return this.reload(comprobanteId);
    }

    private async reload(comprobanteId: number): Promise<Comprobante> {
        const c = await prisma.comprobante.findUnique({
            where: { id: comprobanteId },
            include: { items: true, dispatches: { orderBy: { sentAt: "desc" } } },
        });
        if (!c) throw CustomError.notFound("Comprobante no encontrado");
        return c;
    }

    // -------- Helpers --------
    private resolveCliente(tipo: "FACTURA" | "BOLETA", input: ClienteInput | undefined, fallbackNombre: string | null): {
        tipoDoc: string;
        numDoc: string;
        nombre: string;
    } {
        const nombre = (input?.nombre ?? fallbackNombre ?? "").trim();

        if (tipo === "FACTURA") {
            const numDoc = (input?.numDoc ?? "").trim();
            if (!/^\d{11}$/.test(numDoc)) {
                throw CustomError.badRequest("La factura requiere RUC valido (11 digitos) del adquirente");
            }
            if (!nombre) throw CustomError.badRequest("La factura requiere razon social del adquirente");
            return { tipoDoc: TIPO_DOC_IDENTIDAD.RUC, numDoc, nombre };
        }

        // Boleta: DNI opcional. Sin documento => cliente varios.
        const numDoc = (input?.numDoc ?? "").trim();
        if (numDoc) {
            const tipoDoc = input?.tipoDoc ?? (numDoc.length === 8 ? TIPO_DOC_IDENTIDAD.DNI : TIPO_DOC_IDENTIDAD.RUC);
            return { tipoDoc, numDoc, nombre: nombre || "CLIENTE" };
        }
        return { tipoDoc: TIPO_DOC_IDENTIDAD.NONE, numDoc: "0", nombre: nombre || "CLIENTE VARIOS" };
    }

    private computeTotales(lineas: ComprobanteLineaData[]): ComprobanteTotales {
        const gravado = round2(
            lineas.filter((l) => l.afectacionIgv === AFECTACION_IGV.GRAVADO).reduce((s, l) => s + l.valorVenta, 0),
        );
        const exonerado = round2(
            lineas.filter((l) => l.afectacionIgv === AFECTACION_IGV.EXONERADO).reduce((s, l) => s + l.valorVenta, 0),
        );
        const inafecto = round2(
            lineas.filter((l) => l.afectacionIgv === AFECTACION_IGV.INAFECTO).reduce((s, l) => s + l.valorVenta, 0),
        );
        const igv = round2(lineas.reduce((s, l) => s + l.igv, 0));
        const isc = round2(lineas.reduce((s, l) => s + l.isc, 0));
        const valorVenta = round2(gravado + exonerado + inafecto);
        const precioVenta = round2(valorVenta + igv + isc);

        return {
            gravado,
            exonerado,
            inafecto,
            gratuito: 0,
            igv,
            isc,
            otrosTributos: 0,
            descuentos: 0,
            valorVenta,
            precioVenta,
        };
    }

    private toComprobanteData(
        comprobante: Comprobante,
        cliente: { tipoDoc: string; numDoc: string; nombre: string },
        lineas: ComprobanteLineaData[],
        totales: ComprobanteTotales,
        nota?: ComprobanteData["nota"],
    ): ComprobanteData {
        return {
            tipoCodigo: comprobante.tipoCodigo as ComprobanteTipoCodigo,
            serie: comprobante.serie,
            numero: comprobante.numero,
            moneda: comprobante.moneda,
            fechaEmision: comprobante.fechaEmision,
            emisor: {
                ruc: comprobante.emisorRuc,
                razonSocial: comprobante.emisorRazonSocial,
                ubigeo: this.config.ubigeo,
            },
            cliente,
            lineas,
            totales,
            leyendaMontoLetras: comprobante.leyendaMontoLetras,
            nota,
        };
    }
}
