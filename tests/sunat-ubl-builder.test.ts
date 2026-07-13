import { describe, expect, it } from "vitest";

import { buildInvoiceXml, buildComprobanteXml } from "../src/modules/sunat/builder/ubl.builder";
import type { ComprobanteData } from "../src/modules/sunat/builder/comprobante-data";

function facturaData(): ComprobanteData {
    return {
        tipoCodigo: "01",
        serie: "F001",
        numero: 123,
        moneda: "PEN",
        fechaEmision: new Date("2026-07-12T10:30:00"),
        emisor: { ruc: "20100066603", razonSocial: "EMPRESA DEMO SAC", ubigeo: "150101" },
        cliente: { tipoDoc: "6", numDoc: "20000000001", nombre: "CLIENTE DEMO SAC" },
        lineas: [
            {
                linea: 1,
                codigoProducto: "SKU1",
                descripcion: "PRODUCTO DE PRUEBA",
                unidadMedida: "NIU",
                cantidad: 2,
                valorUnitario: 100,
                precioUnitario: 118,
                valorVenta: 200,
                afectacionIgv: "10",
                igv: 36,
                isc: 0,
            },
        ],
        totales: {
            gravado: 200, exonerado: 0, inafecto: 0, gratuito: 0,
            igv: 36, isc: 0, otrosTributos: 0, descuentos: 0,
            valorVenta: 200, precioVenta: 236,
        },
        leyendaMontoLetras: "DOSCIENTOS TREINTA Y SEIS CON 00/100 SOLES",
    };
}

describe("buildInvoiceXml", () => {
    it("nombreArchivo con formato RUC-TT-SERIE-NUMERO", () => {
        const built = buildInvoiceXml(facturaData());
        expect(built.nombreArchivo).toBe("20100066603-01-F001-123");
        expect(built.documentTypeCode).toBe("01");
    });

    it("XML incluye ID serie-numero, tipo 01 y moneda", () => {
        const { xml } = buildInvoiceXml(facturaData());
        expect(xml).toContain("<cbc:ID>F001-123</cbc:ID>");
        expect(xml).toContain(">01</cbc:InvoiceTypeCode>");
        expect(xml).toContain("PEN</cbc:DocumentCurrencyCode>");
    });

    it("XML incluye RUC emisor, doc cliente y leyenda de monto en letras", () => {
        const { xml } = buildInvoiceXml(facturaData());
        expect(xml).toContain("20100066603");
        expect(xml).toContain("20000000001");
        expect(xml).toContain("DOSCIENTOS TREINTA Y SEIS CON 00/100 SOLES");
    });

    it("XML incluye montos totales", () => {
        const { xml } = buildInvoiceXml(facturaData());
        expect(xml).toContain(">236.00</cbc:PayableAmount>");
        expect(xml).toContain(">200.00</cbc:LineExtensionAmount>");
    });

    it("buildComprobanteXml enruta 01 al builder de factura", () => {
        const built = buildComprobanteXml(facturaData());
        expect(built.xml).toContain("<Invoice ");
        expect(built.nombreArchivo).toBe("20100066603-01-F001-123");
    });
});
