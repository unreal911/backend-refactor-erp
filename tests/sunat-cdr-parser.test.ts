import { describe, expect, it } from "vitest";

import { parseCdr } from "../src/modules/sunat/services/cdr-parser";

function cdr(code: string, description: string, notes: string[] = []): string {
    const notesXml = notes.map((n) => `<cbc:Note>${n}</cbc:Note>`).join("");
    return `<?xml version="1.0"?>
    <ar:ApplicationResponse xmlns:ar="urn:oasis" xmlns:cbc="urn:cbc" xmlns:cac="urn:cac">
        <cac:DocumentResponse>
            <cac:Response>
                <cbc:ResponseCode>${code}</cbc:ResponseCode>
                <cbc:Description>${description}</cbc:Description>
                ${notesXml}
            </cac:Response>
        </cac:DocumentResponse>
    </ar:ApplicationResponse>`;
}

describe("parseCdr", () => {
    it("code 0 => ACCEPTED", () => {
        const r = parseCdr(cdr("0", "La Boleta numero B001-4, ha sido aceptada"));
        expect(r.status).toBe("ACCEPTED");
        expect(r.cdrCode).toBe("0");
        expect(r.cdrDescription).toBe("La Boleta numero B001-4, ha sido aceptada");
    });

    it("code >= 4000 => ACCEPTED_WITH_OBSERVATIONS con notas", () => {
        const r = parseCdr(cdr("0", "aceptada con obs", ["4267 - dato x", "4255 - dato y"]));
        // Sin observaciones el code sigue siendo 0 (ACCEPTED); las notas se preservan.
        expect(r.cdrNotes).toEqual(["4267 - dato x", "4255 - dato y"]);

        const obs = parseCdr(cdr("4000", "con observaciones", ["obs A"]));
        expect(obs.status).toBe("ACCEPTED_WITH_OBSERVATIONS");
        expect(obs.cdrNotes).toEqual(["obs A"]);
    });

    it("codes 2000-3999 => REJECTED", () => {
        expect(parseCdr(cdr("2335", "rechazado")).status).toBe("REJECTED");
        expect(parseCdr(cdr("3030", "emisor")).status).toBe("REJECTED");
    });

    it("sin ResponseCode => ERROR", () => {
        const r = parseCdr("<x><cbc:Description>algo</cbc:Description></x>");
        expect(r.status).toBe("ERROR");
        expect(r.cdrCode).toBeUndefined();
    });

    it("decodifica entidades XML en descripcion y notas", () => {
        const r = parseCdr(cdr("0", "a &amp; b &lt;ok&gt;", ["1 &quot;dos&quot;"]));
        expect(r.cdrDescription).toBe("a & b <ok>");
        expect(r.cdrNotes).toEqual(['1 "dos"']);
    });
});
