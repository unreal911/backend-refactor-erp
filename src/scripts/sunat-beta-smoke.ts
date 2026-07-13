/**
 * Smoke test de la integracion SUNAT contra el entorno BETA (sin BD).
 * Emite una factura de prueba (build -> firma -> zip -> sendBill) e imprime el CDR.
 *
 *   npx tsx src/scripts/sunat-beta-smoke.ts
 *
 * Usa la configuracion de .env (SUNAT_*). Por defecto RUC 20100066603 / MODDATOS.
 */
import { resolveSunatConfig } from "../modules/sunat/config/sunat.config";
import { buildInvoiceXml } from "../modules/sunat/builder/ubl.builder";
import { XmlSignerService } from "../modules/sunat/signer/xml-signer.service";
import { ZipService } from "../modules/sunat/zip/zip.service";
import { SunatSoapClient } from "../modules/sunat/soap/sunat-soap.client";
import { parseCdr } from "../modules/sunat/services/cdr-parser";
import { montoEnLetras } from "../modules/sunat/utils/number-to-words";

async function main(): Promise<void> {
    const config = resolveSunatConfig();
    const numero = Math.floor(Math.random() * 90000) + 10000;

    const built = buildInvoiceXml({
        tipoCodigo: "01",
        serie: "F001",
        numero,
        moneda: "PEN",
        fechaEmision: new Date(),
        emisor: { ruc: config.ruc, razonSocial: config.razonSocial, ubigeo: config.ubigeo },
        cliente: { tipoDoc: "6", numDoc: "20000000001", nombre: "CLIENTE DE PRUEBA SAC" },
        lineas: [
            {
                linea: 1,
                codigoProducto: "SKU1",
                descripcion: "PRODUCTO DE PRUEBA",
                unidadMedida: "NIU",
                cantidad: 1,
                valorUnitario: 100,
                precioUnitario: 118,
                valorVenta: 100,
                afectacionIgv: "10",
                igv: 18,
                isc: 0,
            },
        ],
        totales: {
            gravado: 100, exonerado: 0, inafecto: 0, gratuito: 0,
            igv: 18, isc: 0, otrosTributos: 0, descuentos: 0,
            valorVenta: 100, precioVenta: 118,
        },
        leyendaMontoLetras: montoEnLetras(118),
    });

    console.log(`Emitiendo ${built.nombreArchivo} a ${config.endpointBill}`);

    const signer = new XmlSignerService(config);
    const zip = new ZipService();
    const soap = new SunatSoapClient(40000);

    const signed = signer.sign(built.xml);
    const zipBuffer = await zip.createSingleFileZip(`${built.nombreArchivo}.xml`, signed);

    const resp = await soap.sendBill({
        endpoint: config.endpointBill,
        credentials: { username: `${config.ruc}${config.solUser}`, password: config.solPassword },
        fileName: `${built.nombreArchivo}.zip`,
        zipBuffer,
    });

    if (!resp.ok || !resp.applicationResponseBase64) {
        console.error("FALLO:", resp.faultCode, resp.faultString);
        process.exit(1);
    }

    const cdrXml = await zip.getFirstXmlFromZip(Buffer.from(resp.applicationResponseBase64, "base64"));
    const cdr = parseCdr(cdrXml);
    console.log("CDR:", cdr.status, cdr.cdrCode, "-", cdr.cdrDescription);
    if (cdr.cdrNotes.length) console.log("Observaciones:", cdr.cdrNotes);
}

main().catch((error) => {
    console.error("ERROR:", error);
    process.exit(1);
});
