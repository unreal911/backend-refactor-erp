import PDFDocument from "pdfkit";
import { tenantPrisma } from "../../../data/tenant-prisma";
import { CustomError } from "../../../domain/errors/custom.error";
import { getSunatArtifactServiceFromEnvironment } from "./sunat-artifact.service";

function money(value: unknown): string {
    return Number(value ?? 0).toFixed(2);
}

function documentBuffer(document: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        document.on("end", () => resolve(Buffer.concat(chunks)));
        document.on("error", reject);
        document.end();
    });
}

function renderHeader(document: PDFKit.PDFDocument, input: {
    emisor: string;
    ruc: string;
    label: string;
    number: string;
    customer: string;
    customerDocument: string;
    date: Date;
}): void {
    document.font("Helvetica-Bold").fontSize(14).text(input.emisor, { align: "center" });
    document.font("Helvetica").fontSize(9).text(`RUC ${input.ruc}`, { align: "center" });
    document.moveDown(0.5);
    document.font("Helvetica-Bold").fontSize(12).text(input.label, { align: "center" });
    document.text(input.number, { align: "center" });
    document.moveDown();
    document.font("Helvetica").fontSize(9);
    document.text(`Fecha: ${input.date.toLocaleDateString("es-PE", { timeZone: "America/Lima" })}`);
    document.text(`Cliente: ${input.customer}`);
    document.text(`Documento: ${input.customerDocument || "-"}`);
    document.moveDown(0.5);
}

export class SunatPdfService {
    async generate(comprobanteId: number): Promise<{ a4: string; thermal: string }> {
        const artifacts = getSunatArtifactServiceFromEnvironment();
        if (!artifacts) throw new Error("SUNAT_DOCUMENT_STORAGE_ENABLED es obligatorio para generar PDF");
        const comprobante = await tenantPrisma.comprobante.findUnique({
            where: { id: comprobanteId },
            include: { items: { orderBy: { linea: "asc" } } },
        });
        if (!comprobante) throw CustomError.notFound("Comprobante no encontrado");
        if (!["ACEPTADO", "ACEPTADO_CON_OBSERVACIONES", "ANULADO"].includes(comprobante.estado)) {
            throw CustomError.badRequest("El PDF fiscal se genera después de la aceptación SUNAT");
        }
        const common = {
            emisor: comprobante.emisorRazonSocial,
            ruc: comprobante.emisorRuc,
            label: comprobante.tipo.replaceAll("_", " "),
            number: `${comprobante.serie}-${comprobante.numero}`,
            customer: comprobante.clienteNombre,
            customerDocument: comprobante.clienteNumDoc,
            date: comprobante.fechaEmision,
        };

        const documentDate = comprobante.fechaEmision;
        const a4Document = new PDFDocument({
            size: "A4",
            margin: 42,
            info: {
                Title: comprobante.nombreArchivo,
                CreationDate: documentDate,
                ModDate: documentDate,
            },
        });
        renderHeader(a4Document, common);
        a4Document.font("Helvetica-Bold").text("Cant.   Descripción                                      Total");
        a4Document.moveDown(0.25).font("Helvetica");
        for (const item of comprobante.items) {
            a4Document.text(`${Number(item.cantidad).toFixed(3)}   ${item.descripcion.slice(0, 55)}   S/ ${money(item.valorVenta)}`);
        }
        a4Document.moveDown();
        a4Document.font("Helvetica-Bold").text(`IGV: S/ ${money(comprobante.totalIgv)}`, { align: "right" });
        a4Document.text(`TOTAL: S/ ${money(comprobante.totalPrecioVenta)}`, { align: "right" });
        a4Document.moveDown().font("Helvetica").fontSize(8).text(comprobante.leyendaMontoLetras);
        a4Document.text(`Estado SUNAT: ${comprobante.estado}`);
        const a4 = await documentBuffer(a4Document);

        const thermalHeight = Math.max(420, 310 + comprobante.items.length * 28);
        const thermalDocument = new PDFDocument({
            size: [226.77, thermalHeight],
            margin: 18,
            info: {
                Title: `${comprobante.nombreArchivo}-thermal`,
                CreationDate: documentDate,
                ModDate: documentDate,
            },
        });
        renderHeader(thermalDocument, common);
        thermalDocument.font("Helvetica").fontSize(8);
        for (const item of comprobante.items) {
            thermalDocument.text(`${Number(item.cantidad).toFixed(2)} x ${item.descripcion.slice(0, 30)}`);
            thermalDocument.text(`S/ ${money(item.valorVenta)}`, { align: "right" });
        }
        thermalDocument.moveDown(0.5).font("Helvetica-Bold").fontSize(10);
        thermalDocument.text(`IGV S/ ${money(comprobante.totalIgv)}`, { align: "right" });
        thermalDocument.text(`TOTAL S/ ${money(comprobante.totalPrecioVenta)}`, { align: "right" });
        thermalDocument.moveDown().font("Helvetica").fontSize(7).text(`Estado SUNAT: ${comprobante.estado}`, { align: "center" });
        const thermal = await documentBuffer(thermalDocument);

        const logicalKey = `comprobante-${comprobante.id}`;
        const a4Artifact = await artifacts.store({
            ownerType: "COMPROBANTE",
            ownerId: comprobante.id,
            logicalKey,
            type: "PDF_A4",
            fileName: `${comprobante.nombreArchivo}-a4.pdf`,
            body: a4,
            mimeType: "application/pdf",
        });
        const thermalArtifact = await artifacts.store({
            ownerType: "COMPROBANTE",
            ownerId: comprobante.id,
            logicalKey,
            type: "PDF_THERMAL",
            fileName: `${comprobante.nombreArchivo}-thermal.pdf`,
            body: thermal,
            mimeType: "application/pdf",
        });
        return { a4: a4Artifact.id, thermal: thermalArtifact.id };
    }
}
