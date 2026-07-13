import {
    AFECTACION_IGV,
    IGV_PORCENTAJE,
    LEYENDA,
    TIPO_OPERACION,
    TRIBUTO,
    categoriaTributaria,
    tributoPorAfectacion,
} from "../catalogs/sunat-catalogs";
import { amount, escapeXml, hms, qty, unitAmount, xmlDecl, ymd } from "../utils/xml";
import {
    BuiltDocument,
    ComprobanteData,
    ComprobanteLineaData,
} from "./comprobante-data";

const CATALOG_07_URI = "urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07";

function ublNamespaces(root: "Invoice" | "CreditNote" | "DebitNote"): string {
    return `xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"`;
}

// Placeholder de firma: xml-crypto insertara aqui el ds:Signature real.
const UBL_EXTENSIONS_PLACEHOLDER = `<ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent></ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

function signatureBlock(data: ComprobanteData): string {
    return `<cac:Signature>
    <cbc:ID>${escapeXml(`${data.serie}-${data.numero}`)}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${data.emisor.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${data.emisor.razonSocial}]]></cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignSUNAT</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>`;
}

function supplierParty(data: ComprobanteData): string {
    return `<cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${data.emisor.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${data.emisor.razonSocial}]]></cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${data.emisor.razonSocial}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${data.emisor.ubigeo ?? "150101"}</cbc:ID>
          <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;
}

function customerParty(data: ComprobanteData): string {
    return `<cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${data.cliente.tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXml(data.cliente.numDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${data.cliente.nombre}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
}

// TaxTotal a nivel documento, agrupando por tributo segun los totales.
function documentTaxTotal(data: ComprobanteData): string {
    const t = data.totales;
    const subtotales: string[] = [];

    if (t.gravado > 0 || t.igv > 0) {
        subtotales.push(taxSubtotal(t.gravado, t.igv, TRIBUTO.IGV, "S"));
    }
    if (t.exonerado > 0) {
        subtotales.push(taxSubtotal(t.exonerado, 0, TRIBUTO.EXONERADO, "E"));
    }
    if (t.inafecto > 0) {
        subtotales.push(taxSubtotal(t.inafecto, 0, TRIBUTO.INAFECTO, "O"));
    }
    if (t.isc > 0) {
        subtotales.push(taxSubtotal(t.gravado, t.isc, TRIBUTO.ISC, "S"));
    }

    return `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="${data.moneda}">${amount(t.igv + t.isc)}</cbc:TaxAmount>
    ${subtotales.join("\n    ")}
  </cac:TaxTotal>`;
}

function taxSubtotal(
    base: number,
    tax: number,
    tributo: { id: string; name: string; code: string },
    categoria: "S" | "E" | "O",
    moneda = "PEN",
): string {
    return `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${moneda}">${amount(base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${moneda}">${amount(tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID schemeID="UN/ECE 5305" schemeName="Tax Category Identifier" schemeAgencyName="United Nations Economic Commission for Europe">${categoria}</cbc:ID>
        <cac:TaxScheme>
          <cbc:ID schemeID="UN/ECE 5153" schemeName="Codigo de tributos" schemeAgencyName="PE:SUNAT">${tributo.id}</cbc:ID>
          <cbc:Name>${tributo.name}</cbc:Name>
          <cbc:TaxTypeCode>${tributo.code}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
}

// Linea de detalle (InvoiceLine / CreditNoteLine / DebitNoteLine).
function line(item: ComprobanteLineaData, moneda: string, quantityTag: string, rootTag: string): string {
    const tributo = tributoPorAfectacion(item.afectacionIgv);
    const categoria = categoriaTributaria(item.afectacionIgv);
    const percent = item.afectacionIgv === AFECTACION_IGV.GRAVADO ? IGV_PORCENTAJE : 0;

    return `<cac:${rootTag}>
    <cbc:ID>${item.linea}</cbc:ID>
    <cbc:${quantityTag} unitCode="${escapeXml(item.unidadMedida)}">${qty(item.cantidad)}</cbc:${quantityTag}>
    <cbc:LineExtensionAmount currencyID="${moneda}">${amount(item.valorVenta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${moneda}">${unitAmount(item.precioUnitario)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${moneda}">${amount(item.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${moneda}">${amount(item.valorVenta)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${moneda}">${amount(item.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeID="UN/ECE 5305" schemeAgencyName="United Nations Economic Commission for Europe">${categoria}</cbc:ID>
          <cbc:Percent>${percent.toFixed(2)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="Afectacion del IGV" listURI="${CATALOG_07_URI}">${item.afectacionIgv}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID schemeID="UN/ECE 5153" schemeAgencyName="PE:SUNAT">${tributo.id}</cbc:ID>
            <cbc:Name>${tributo.name}</cbc:Name>
            <cbc:TaxTypeCode>${tributo.code}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${item.descripcion}]]></cbc:Description>${
          item.codigoProducto
              ? `\n      <cac:SellersItemIdentification><cbc:ID>${escapeXml(item.codigoProducto.slice(0, 30))}</cbc:ID></cac:SellersItemIdentification>`
              : ""
      }
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${moneda}">${unitAmount(item.valorUnitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${rootTag}>`;
}

function leyendas(data: ComprobanteData): string {
    return `<cbc:Note languageLocaleID="${LEYENDA.MONTO_EN_LETRAS}"><![CDATA[${data.leyendaMontoLetras}]]></cbc:Note>`;
}

function nombreArchivo(data: ComprobanteData): string {
    return `${data.emisor.ruc}-${data.tipoCodigo}-${data.serie}-${data.numero}`;
}

// ---- Factura / Boleta (01 / 03) ----
export function buildInvoiceXml(data: ComprobanteData): BuiltDocument {
    const moneda = data.moneda;
    const lineas = data.lineas.map((it) => line(it, moneda, "InvoicedQuantity", "InvoiceLine")).join("\n  ");

    const xml = `${xmlDecl()}
<Invoice ${ublNamespaces("Invoice")}>
  ${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${data.serie}-${data.numero}</cbc:ID>
  <cbc:IssueDate>${ymd(data.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${hms(data.fechaEmision)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="${TIPO_OPERACION.VENTA_INTERNA}" name="Tipo de Operacion" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01" listSchemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51">${data.tipoCodigo}</cbc:InvoiceTypeCode>
  ${leyendas(data)}
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe">${moneda}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${data.lineas.length}</cbc:LineCountNumeric>
  ${signatureBlock(data)}
  ${supplierParty(data)}
  ${customerParty(data)}
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
  </cac:PaymentTerms>
  ${documentTaxTotal(data)}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${moneda}">${amount(data.totales.valorVenta)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${amount(data.totales.precioVenta)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${amount(data.totales.precioVenta)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineas}
</Invoice>`;

    return { xml, nombreArchivo: nombreArchivo(data), documentTypeCode: data.tipoCodigo };
}

// ---- Nota de Credito / Debito (07 / 08) ----
export function buildNoteXml(data: ComprobanteData): BuiltDocument {
    if (!data.nota) {
        throw new Error("Falta informacion de la nota (motivo y comprobante afectado)");
    }
    const isCredit = data.tipoCodigo === "07";
    const root = isCredit ? "CreditNote" : "DebitNote";
    const lineTag = isCredit ? "CreditNoteLine" : "DebitNoteLine";
    const qtyTag = isCredit ? "CreditedQuantity" : "DebitedQuantity";
    const monetaryTotalTag = isCredit ? "LegalMonetaryTotal" : "RequestedMonetaryTotal";
    const responseTag = isCredit ? "DiscrepancyResponse" : "DiscrepancyResponse";
    const moneda = data.moneda;
    const lineas = data.lineas.map((it) => line(it, moneda, qtyTag, lineTag)).join("\n  ");

    const xml = `${xmlDecl()}
<${root} ${ublNamespaces(root)}>
  ${UBL_EXTENSIONS_PLACEHOLDER}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${data.serie}-${data.numero}</cbc:ID>
  <cbc:IssueDate>${ymd(data.fechaEmision)}</cbc:IssueDate>
  <cbc:IssueTime>${hms(data.fechaEmision)}</cbc:IssueTime>
  ${leyendas(data)}
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe">${moneda}</cbc:DocumentCurrencyCode>
  <cac:${responseTag}>
    <cbc:ReferenceID>${escapeXml(data.nota.serieNumeroAfectado)}</cbc:ReferenceID>
    <cbc:ResponseCode>${escapeXml(data.nota.codigoMotivo)}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${data.nota.descripcionMotivo}]]></cbc:Description>
  </cac:${responseTag}>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${escapeXml(data.nota.serieNumeroAfectado)}</cbc:ID>
      <cbc:DocumentTypeCode>${data.nota.tipoDocAfectado}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  ${signatureBlock(data)}
  ${supplierParty(data)}
  ${customerParty(data)}
  ${documentTaxTotal(data)}
  <cac:${monetaryTotalTag}>
    <cbc:LineExtensionAmount currencyID="${moneda}">${amount(data.totales.valorVenta)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${moneda}">${amount(data.totales.precioVenta)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${moneda}">${amount(data.totales.precioVenta)}</cbc:PayableAmount>
  </cac:${monetaryTotalTag}>
  ${lineas}
</${root}>`;

    return { xml, nombreArchivo: nombreArchivo(data), documentTypeCode: data.tipoCodigo };
}

export function buildComprobanteXml(data: ComprobanteData): BuiltDocument {
    if (data.tipoCodigo === "07" || data.tipoCodigo === "08") {
        return buildNoteXml(data);
    }
    return buildInvoiceXml(data);
}
