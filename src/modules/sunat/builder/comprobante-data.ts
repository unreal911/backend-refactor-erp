// Estructura normalizada que consume el builder UBL (desacoplada de Prisma).

export type ComprobanteTipoCodigo = "01" | "03" | "07" | "08";

export interface ComprobanteEmisor {
    ruc: string;
    razonSocial: string;
    ubigeo?: string | undefined;
}

export interface ComprobanteCliente {
    tipoDoc: string; // catalogo 06
    numDoc: string;
    nombre: string;
}

export interface ComprobanteLineaData {
    linea: number;
    codigoProducto?: string | undefined;
    descripcion: string;
    unidadMedida: string; // catalogo 03
    cantidad: number;
    valorUnitario: number; // sin IGV
    precioUnitario: number; // con IGV
    valorVenta: number; // cantidad * valorUnitario
    afectacionIgv: string; // catalogo 07
    igv: number;
    isc: number;
}

export interface ComprobanteTotales {
    gravado: number;
    exonerado: number;
    inafecto: number;
    gratuito: number;
    igv: number;
    isc: number;
    otrosTributos: number;
    descuentos: number;
    valorVenta: number; // suma de valores de venta gravado+exon+inaf
    precioVenta: number; // importe total (con impuestos)
}

export interface NotaData {
    codigoMotivo: string; // catalogo 09 (NC) / 10 (ND)
    descripcionMotivo: string;
    // Comprobante que se modifica
    tipoDocAfectado: ComprobanteTipoCodigo;
    serieNumeroAfectado: string; // p.ej. F001-123
}

export interface ComprobanteData {
    tipoCodigo: ComprobanteTipoCodigo;
    serie: string;
    numero: number;
    moneda: string;
    fechaEmision: Date;
    emisor: ComprobanteEmisor;
    cliente: ComprobanteCliente;
    lineas: ComprobanteLineaData[];
    totales: ComprobanteTotales;
    leyendaMontoLetras: string;
    nota?: NotaData | undefined; // presente para 07 / 08
}

export interface BuiltDocument {
    xml: string;
    nombreArchivo: string; // RUC-TT-SERIE-NUMERO (sin extension)
    documentTypeCode: ComprobanteTipoCodigo;
}
