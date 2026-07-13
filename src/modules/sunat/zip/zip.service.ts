import JSZip from "jszip";

// SUNAT: ZIP con el XML en la raiz. Bytes en ISO-8859-1 para coincidir con la
// declaracion del documento. (No se incluye la carpeta "dummy" legacy: SUNAT
// lee la primera entrada y una carpeta vacia produce el error 0160.)
export class ZipService {
    async createSingleFileZip(xmlFileName: string, signedXml: string): Promise<Buffer> {
        const zip = new JSZip();
        zip.file(xmlFileName, Buffer.from(signedXml, "latin1"));
        return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }

    async getFirstXmlFromZip(zipBuffer: Buffer): Promise<string> {
        const zip = await JSZip.loadAsync(zipBuffer);
        const entry = Object.values(zip.files).find(
            (f) => !f.dir && f.name.toLowerCase().endsWith(".xml"),
        );
        if (!entry) {
            throw new Error("El ZIP de respuesta no contiene un XML (CDR)");
        }
        return entry.async("string");
    }
}
