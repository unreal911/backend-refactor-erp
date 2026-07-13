// Catalogos SUNAT usados en la construccion del XML UBL 2.1.
// Referencia: "Guia de elaboracion de documentos XML - Factura Electronica".

// Catalogo 01 - Tipo de documento
export const TIPO_DOC = {
    FACTURA: "01",
    BOLETA: "03",
    NOTA_CREDITO: "07",
    NOTA_DEBITO: "08",
} as const;

// Catalogo 06 - Tipo de documento de identidad del adquirente
export const TIPO_DOC_IDENTIDAD = {
    NONE: "0", // sin documento (cliente varios)
    DNI: "1",
    RUC: "6",
    CE: "4", // carnet de extranjeria
    PASAPORTE: "7",
} as const;

// Catalogo 07 - Tipo de afectacion del IGV
export const AFECTACION_IGV = {
    GRAVADO: "10",
    EXONERADO: "20",
    INAFECTO: "30",
    GRAVADO_GRATUITO: "11",
    EXONERADO_GRATUITO: "21",
    INAFECTO_GRATUITO: "31",
} as const;

// Catalogo 05 - Tributos
export const TRIBUTO = {
    IGV: { id: "1000", name: "IGV", code: "VAT" },
    ISC: { id: "2000", name: "ISC", code: "EXC" },
    EXONERADO: { id: "9997", name: "EXO", code: "VAT" },
    INAFECTO: { id: "9998", name: "INA", code: "FRE" },
    GRATUITO: { id: "9996", name: "GRA", code: "FRE" },
} as const;

// Catalogo 51 - Tipo de operacion (ProfileID)
export const TIPO_OPERACION = {
    VENTA_INTERNA: "0101",
} as const;

// Catalogo 52 - Leyendas
export const LEYENDA = {
    MONTO_EN_LETRAS: "1000",
    TRANSFERENCIA_GRATUITA: "1002",
} as const;

// Codigo de tributo por afectacion (para el TaxCategory del item)
export function tributoPorAfectacion(afectacion: string): { id: string; name: string; code: string } {
    if (afectacion === AFECTACION_IGV.EXONERADO) return TRIBUTO.EXONERADO;
    if (afectacion === AFECTACION_IGV.INAFECTO) return TRIBUTO.INAFECTO;
    if (
        afectacion === AFECTACION_IGV.GRAVADO_GRATUITO ||
        afectacion === AFECTACION_IGV.EXONERADO_GRATUITO ||
        afectacion === AFECTACION_IGV.INAFECTO_GRATUITO
    ) {
        return TRIBUTO.GRATUITO;
    }
    return TRIBUTO.IGV;
}

// Categoria de impuesto UBL (catalogo 5305): S=gravado, E=exonerado, O=inafecto/exportacion
export function categoriaTributaria(afectacion: string): "S" | "E" | "O" | "Z" {
    if (afectacion === AFECTACION_IGV.EXONERADO || afectacion === AFECTACION_IGV.EXONERADO_GRATUITO) return "E";
    if (afectacion === AFECTACION_IGV.INAFECTO || afectacion === AFECTACION_IGV.INAFECTO_GRATUITO) return "O";
    return "S";
}

export const IGV_PORCENTAJE = 18;
export const MONEDA_PEN = "PEN";
