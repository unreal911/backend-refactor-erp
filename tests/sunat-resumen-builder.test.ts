import { describe, expect, it } from "vitest";

import { buildResumenDiarioXml, ResumenBoletaLinea } from "../src/modules/sunat/builder/resumen.builder";

function boletaLinea(): ResumenBoletaLinea {
    return {
        tipoCodigo: "03",
        serieNumero: "B001-5",
        clienteTipoDoc: "1",
        clienteNumDoc: "44556677",
        estado: "1",
        totalPrecioVenta: 118,
        gravado: 100, exonerado: 0, inafecto: 0, gratuito: 0, igv: 18, isc: 0,
    };
}

function notaLinea(): ResumenBoletaLinea {
    return {
        tipoCodigo: "07",
        serieNumero: "BC01-1",
        clienteTipoDoc: "1",
        clienteNumDoc: "44556677",
        estado: "1",
        docReferenciaTipo: "03",
        docReferenciaSerieNumero: "B001-5",
        totalPrecioVenta: 118,
        gravado: 100, exonerado: 0, inafecto: 0, gratuito: 0, igv: 18, isc: 0,
    };
}

function build(lineas: ResumenBoletaLinea[]) {
    return buildResumenDiarioXml({
        correlativo: 1,
        fechaReferencia: new Date("2026-07-12T00:00:00"),
        fechaGeneracion: new Date("2026-07-12T09:00:00"),
        emisorRuc: "20100066603",
        emisorRazonSocial: "EMPRESA DEMO SAC",
        moneda: "PEN",
        lineas,
    });
}

describe("buildResumenDiarioXml", () => {
    it("fileName RUC-RC-YYYYMMDD-N con fecha de generacion", () => {
        const { fileName } = build([boletaLinea()]);
        expect(fileName).toBe("20100066603-RC-20260712-1");
    });

    it("la nota (07) incluye BillingReference a la boleta afectada", () => {
        const { xml } = build([notaLinea()]);
        expect(xml).toContain("<cbc:DocumentTypeCode>07</cbc:DocumentTypeCode>");
        expect(xml).toContain("<cac:BillingReference>");
        expect(xml).toContain("<cbc:ID>B001-5</cbc:ID>");
        expect(xml).toContain("<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>");
    });

    it("la boleta (03) NO incluye BillingReference", () => {
        const { xml } = build([boletaLinea()]);
        expect(xml).not.toContain("<cac:BillingReference>");
    });

    it("resumen mixto: boleta + nota generan dos lineas", () => {
        const { xml } = build([boletaLinea(), notaLinea()]);
        const lineCount = (xml.match(/<sac:SummaryDocumentsLine>/g) ?? []).length;
        expect(lineCount).toBe(2);
    });
});
