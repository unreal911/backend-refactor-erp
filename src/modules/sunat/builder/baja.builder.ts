import { xmlDecl, ymd } from "../utils/xml";

export interface BajaLinea {
    tipoCodigo: string; // 01 (factura) / 07 / 08
    serie: string; // F001
    numero: number;
    motivo: string;
}

export interface ComunicacionBajaData {
    correlativo: number;
    fechaReferencia: Date; // fecha de emision de los documentos a dar de baja
    fechaGeneracion: Date;
    emisorRuc: string;
    emisorRazonSocial: string;
    lineas: BajaLinea[];
}

export interface BuiltBaja {
    xml: string;
    fileName: string; // RUC-RA-YYYYMMDD-N (sin extension)
}

const RA_NS = `xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"`;

const UBL_EXTENSIONS_PLACEHOLDER = `<ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function voidedLine(l: BajaLinea, index: number): string {
    return `<sac:VoidedDocumentsLine>
      <cbc:LineID>${index + 1}</cbc:LineID>
      <cbc:DocumentTypeCode>${l.tipoCodigo}</cbc:DocumentTypeCode>
      <sac:DocumentSerialID>${escapeXml(l.serie)}</sac:DocumentSerialID>
      <sac:DocumentNumberID>${l.numero}</sac:DocumentNumberID>
      <sac:VoidReasonDescription><![CDATA[${l.motivo}]]></sac:VoidReasonDescription>
    </sac:VoidedDocumentsLine>`;
}

function signatureBlock(emisorRuc: string, emisorRazonSocial: string, id: string): string {
    return `<cac:Signature>
    <cbc:ID>${id}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${emisorRuc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${emisorRazonSocial}]]></cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignSUNAT</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>`;
}

export function buildComunicacionBajaXml(data: ComunicacionBajaData): BuiltBaja {
    // Nombre de archivo y cbc:ID usan la fecha de GENERACION (IssueDate).
    // La fecha de emision de los documentos va en cbc:ReferenceDate.
    const fechaGen = ymd(data.fechaGeneracion).replace(/-/g, "");
    const raId = `RA-${fechaGen}-${data.correlativo}`;
    const fileName = `${data.emisorRuc}-RA-${fechaGen}-${data.correlativo}`;

    const lineas = data.lineas.map((l, i) => voidedLine(l, i)).join("\n    ");

    const xml = `${xmlDecl()}
<VoidedDocuments ${RA_NS}>
  ${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.0</cbc:CustomizationID>
  <cbc:ID>${raId}</cbc:ID>
  <cbc:ReferenceDate>${ymd(data.fechaReferencia)}</cbc:ReferenceDate>
  <cbc:IssueDate>${ymd(data.fechaGeneracion)}</cbc:IssueDate>
  ${signatureBlock(data.emisorRuc, data.emisorRazonSocial, raId)}
  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${data.emisorRuc}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${data.emisorRazonSocial}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  ${lineas}
</VoidedDocuments>`;

    return { xml, fileName };
}
