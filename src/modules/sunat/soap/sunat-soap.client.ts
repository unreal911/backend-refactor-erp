// Cliente SOAP para el billService de SUNAT (WS-Security UsernameToken).
// Soporta sendBill (sincrono) y sendSummary/getStatus (asincrono, para
// resumen diario de boletas y comunicacion de baja).

export interface SoapCredentials {
    username: string; // RUC + usuario SOL concatenados
    password: string;
}

export interface SendBillInput {
    endpoint: string;
    credentials: SoapCredentials;
    fileName: string; // *.zip
    zipBuffer: Buffer;
}

export interface SendBillResponse {
    ok: boolean;
    applicationResponseBase64?: string | undefined; // CDR (zip) en base64
    faultCode?: string | undefined;
    faultString?: string | undefined;
    rawResponseXml: string;
}

export interface SendSummaryResponse {
    ok: boolean;
    ticket?: string | undefined;
    faultCode?: string | undefined;
    faultString?: string | undefined;
    rawResponseXml: string;
}

export interface GetStatusResponse {
    ok: boolean;
    statusCode?: string | undefined; // 0=ok, 98=en proceso, 99=con errores
    applicationResponseBase64?: string | undefined;
    faultCode?: string | undefined;
    faultString?: string | undefined;
    rawResponseXml: string;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function extractTag(xml: string, tag: string): string | undefined {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
    return m?.[1]?.trim();
}

function decodeXml(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value
        .replace(/&#(\d+);/g, (_m, c: string) => String.fromCodePoint(Number(c)))
        .replace(/&#x([\da-f]+);/gi, (_m, c: string) => String.fromCodePoint(parseInt(c, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

export class SunatSoapClient {
    constructor(private readonly timeoutMs = 30000) {}

    private header(cred: SoapCredentials): string {
        return `<soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(cred.username)}</wsse:Username>
        <wsse:Password>${escapeXml(cred.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>`;
    }

    private envelope(cred: SoapCredentials, body: string): string {
        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  ${this.header(cred)}
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
    }

    private async post(endpoint: string, envelope: string): Promise<{ status: number; ok: boolean; body: string }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
                body: envelope,
                signal: controller.signal,
            });
            const body = await res.text();
            return { status: res.status, ok: res.ok, body };
        } finally {
            clearTimeout(timeout);
        }
    }

    async sendBill(input: SendBillInput): Promise<SendBillResponse> {
        const body = `<ser:sendBill><fileName>${escapeXml(input.fileName)}</fileName><contentFile>${input.zipBuffer.toString("base64")}</contentFile></ser:sendBill>`;
        try {
            const { status, ok, body: resBody } = await this.post(input.endpoint, this.envelope(input.credentials, body));
            const appResponse = extractTag(resBody, "applicationResponse");
            const faultCode = extractTag(resBody, "faultcode");
            const faultString = decodeXml(extractTag(resBody, "faultstring"));

            if (!ok || faultCode || faultString) {
                return {
                    ok: false,
                    faultCode: faultCode ?? `HTTP_${status}`,
                    faultString: faultString ?? `Error HTTP ${status}`,
                    rawResponseXml: resBody,
                };
            }
            return { ok: Boolean(appResponse), applicationResponseBase64: appResponse, rawResponseXml: resBody };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Error de red";
            return { ok: false, faultCode: "NETWORK_ERROR", faultString: message, rawResponseXml: "" };
        }
    }

    async sendSummary(input: SendBillInput): Promise<SendSummaryResponse> {
        const body = `<ser:sendSummary><fileName>${escapeXml(input.fileName)}</fileName><contentFile>${input.zipBuffer.toString("base64")}</contentFile></ser:sendSummary>`;
        try {
            const { status, ok, body: resBody } = await this.post(input.endpoint, this.envelope(input.credentials, body));
            const ticket = extractTag(resBody, "ticket");
            const faultCode = extractTag(resBody, "faultcode");
            const faultString = decodeXml(extractTag(resBody, "faultstring"));

            if (!ok || faultCode || faultString || !ticket) {
                return {
                    ok: false,
                    faultCode: faultCode ?? `HTTP_${status}`,
                    faultString: faultString ?? `Error HTTP ${status}`,
                    rawResponseXml: resBody,
                };
            }
            return { ok: true, ticket, rawResponseXml: resBody };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Error de red";
            return { ok: false, faultCode: "NETWORK_ERROR", faultString: message, rawResponseXml: "" };
        }
    }

    async getStatus(endpoint: string, cred: SoapCredentials, ticket: string): Promise<GetStatusResponse> {
        const body = `<ser:getStatus><ticket>${escapeXml(ticket)}</ticket></ser:getStatus>`;
        try {
            const { status, ok, body: resBody } = await this.post(endpoint, this.envelope(cred, body));
            const statusCode = extractTag(resBody, "statusCode");
            const content = extractTag(resBody, "content");
            const faultCode = extractTag(resBody, "faultcode");
            const faultString = decodeXml(extractTag(resBody, "faultstring"));

            if (!ok || faultCode || faultString) {
                return {
                    ok: false,
                    faultCode: faultCode ?? `HTTP_${status}`,
                    faultString: faultString ?? `Error HTTP ${status}`,
                    rawResponseXml: resBody,
                };
            }
            return { ok: true, statusCode, applicationResponseBase64: content, rawResponseXml: resBody };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Error de red";
            return { ok: false, faultCode: "NETWORK_ERROR", faultString: message, rawResponseXml: "" };
        }
    }
}
