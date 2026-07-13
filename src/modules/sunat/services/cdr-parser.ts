import { SunatDispatchStatus } from "@prisma/client";

function extractTag(xml: string, tag: string): string | undefined {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
    return m?.[1]?.trim();
}

function extractAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "gi");
    return [...xml.matchAll(re)].map((m) => (m[1] ?? "").trim());
}

function decode(v: string): string {
    return v
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

export interface ParsedCdr {
    cdrCode?: string | undefined;
    cdrDescription?: string | undefined;
    cdrNotes: string[];
    status: SunatDispatchStatus;
}

// Interpreta el ApplicationResponse (CDR) segun el codigo de respuesta:
// 0 = aceptado, 2000-3999 = rechazado, >= 4000 = aceptado con observaciones.
export function parseCdr(cdrXml: string): ParsedCdr {
    const code = extractTag(cdrXml, "ResponseCode");
    const descriptionRaw = extractTag(cdrXml, "Description");
    const notes = extractAll(cdrXml, "Note").map(decode);
    const description = descriptionRaw ? decode(descriptionRaw) : undefined;

    if (!code) {
        return { cdrCode: undefined, cdrDescription: description, cdrNotes: notes, status: "ERROR" };
    }

    if (code === "0") {
        return { cdrCode: code, cdrDescription: description, cdrNotes: notes, status: "ACCEPTED" };
    }

    const n = Number(code);
    if (Number.isInteger(n) && n >= 4000) {
        return { cdrCode: code, cdrDescription: description, cdrNotes: notes, status: "ACCEPTED_WITH_OBSERVATIONS" };
    }

    return { cdrCode: code, cdrDescription: description, cdrNotes: notes, status: "REJECTED" };
}
