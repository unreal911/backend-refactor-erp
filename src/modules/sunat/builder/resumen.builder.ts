import { TIPO_DOC_IDENTIDAD } from "../catalogs/sunat-catalogs";
import { amount, xmlDecl, ymd } from "../utils/xml";

// Estado de la linea en el resumen (catalogo 19): 1=adicionar, 2=modificar, 3=anular.
export type ResumenLineaEstado = "1" | "2" | "3";

export interface ResumenBoletaLinea {
    tipoCodigo: string; // 03 (boleta) / 07 / 08
    serieNumero: string; // B001-1
    clienteTipoDoc: string; // catalogo 06
    clienteNumDoc: string;
    estado: ResumenLineaEstado;
    // Solo para notas (07/08): documento afectado (la boleta original).
    docReferenciaTipo?: string | undefined; // 03
    docReferenciaSerieNumero?: string | undefined; // B001-1
    // Totales de la boleta
    totalPrecioVenta: number; // importe total (con impuestos)
    gravado: number;
    exonerado: number;
    inafecto: number;
    gratuito: number;
    igv: number;
    isc: number;
}

export interface ResumenDiarioData {
    correlativo: number;
    fechaReferencia: Date; // fecha de emision de las boletas
    fechaGeneracion: Date; // fecha de generacion del resumen
    emisorRuc: string;
    emisorRazonSocial: string;
    moneda: string;
    lineas: ResumenBoletaLinea[];
}

export interface BuiltResumen {
    xml: string;
    fileName: string; // RUC-RC-YYYYMMDD-N (sin extension)
}

const RC_NS = `xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1"
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

function billingPayment(paidAmount: number, instructionId: string, moneda: string): string {
    return `<sac:BillingPayment>
        <cbc:PaidAmount currencyID="${moneda}">${amount(paidAmount)}</cbc:PaidAmount>
        <cbc:InstructionID>${instructionId}</cbc:InstructionID>
      </sac:BillingPayment>`;
}

function customerParty(l: ResumenBoletaLinea): string {
    if (l.clienteTipoDoc === TIPO_DOC_IDENTIDAD.NONE || !l.clienteNumDoc || l.clienteNumDoc === "0") {
        return "";
    }
    return `<cac:AccountingCustomerParty>
        <cbc:CustomerAssignedAccountID>${l.clienteNumDoc}</cbc:CustomerAssignedAccountID>
        <cbc:AdditionalAccountID>${l.clienteTipoDoc}</cbc:AdditionalAccountID>
      </cac:AccountingCustomerParty>`;
}

// Referencia al documento afectado; obligatoria para notas (07/08) en el resumen.
function billingReference(l: ResumenBoletaLinea): string {
    if (!l.docReferenciaSerieNumero || !l.docReferenciaTipo) return "";
    return `<cac:BillingReference>
        <cac:InvoiceDocumentReference>
          <cbc:ID>${l.docReferenciaSerieNumero}</cbc:ID>
          <cbc:DocumentTypeCode>${l.docReferenciaTipo}</cbc:DocumentTypeCode>
        </cac:InvoiceDocumentReference>
      </cac:BillingReference>`;
}

function summaryLine(l: ResumenBoletaLinea, index: number, moneda: string): string {
    // InstructionID (catalogo): 01=gravado, 02=exonerado, 03=inafecto, 05=ISC
    const payments: string[] = [];
    if (l.gravado > 0) payments.push(billingPayment(l.gravado, "01", moneda));
    if (l.exonerado > 0) payments.push(billingPayment(l.exonerado, "02", moneda));
    if (l.inafecto > 0) payments.push(billingPayment(l.inafecto, "03", moneda));
    if (l.gratuito > 0) payments.push(billingPayment(l.gratuito, "06", moneda));

    return `<sac:SummaryDocumentsLine>
      <cbc:LineID>${index + 1}</cbc:LineID>
      <cbc:DocumentTypeCode>${l.tipoCodigo}</cbc:DocumentTypeCode>
      <cbc:ID>${l.serieNumero}</cbc:ID>
      ${customerParty(l)}
      ${billingReference(l)}
      <cac:Status>
        <cbc:ConditionCode>${l.estado}</cbc:ConditionCode>
      </cac:Status>
      <sac:TotalAmount currencyID="${moneda}">${amount(l.totalPrecioVenta)}</sac:TotalAmount>
      ${payments.join("\n      ")}
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${moneda}">${amount(l.igv + l.isc)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxAmount currencyID="${moneda}">${amount(l.igv)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cac:TaxScheme>
              <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">1000</cbc:ID>
              <cbc:Name>IGV</cbc:Name>
              <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
    </sac:SummaryDocumentsLine>`;
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

export function buildResumenDiarioXml(data: ResumenDiarioData): BuiltResumen {
    // El nombre del archivo y el cbc:ID usan la fecha de GENERACION (IssueDate).
    // La fecha de emision de las boletas va en cbc:ReferenceDate (regla SUNAT 2346).
    const fechaGen = ymd(data.fechaGeneracion).replace(/-/g, "");
    const rcId = `RC-${fechaGen}-${data.correlativo}`;
    const fileName = `${data.emisorRuc}-RC-${fechaGen}-${data.correlativo}`;
    const moneda = data.moneda;

    const lineas = data.lineas.map((l, i) => summaryLine(l, i, moneda)).join("\n    ");

    const xml = `${xmlDecl()}
<SummaryDocuments ${RC_NS}>
  ${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${rcId}</cbc:ID>
  <cbc:ReferenceDate>${ymd(data.fechaReferencia)}</cbc:ReferenceDate>
  <cbc:IssueDate>${ymd(data.fechaGeneracion)}</cbc:IssueDate>
  ${signatureBlock(data.emisorRuc, data.emisorRazonSocial, rcId)}
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
</SummaryDocuments>`;

    return { xml, fileName };
}
