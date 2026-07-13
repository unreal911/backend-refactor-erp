import { describe, expect, it } from "vitest";

import { montoEnLetras } from "../src/modules/sunat/utils/number-to-words";

describe("montoEnLetras", () => {
    it("convierte cero", () => {
        expect(montoEnLetras(0)).toBe("CERO CON 00/100 SOLES");
    });

    it("convierte enteros simples con centavos", () => {
        expect(montoEnLetras(118)).toBe("CIENTO DIECIOCHO CON 00/100 SOLES");
        expect(montoEnLetras(1.5)).toBe("UNO CON 50/100 SOLES");
    });

    it("ejemplo de la doc: 1858.59", () => {
        expect(montoEnLetras(1858.59)).toBe("MIL OCHOCIENTOS CINCUENTA Y OCHO CON 59/100 SOLES");
    });

    it("maneja el rango veinti-", () => {
        expect(montoEnLetras(21)).toBe("VEINTIUNO CON 00/100 SOLES");
        expect(montoEnLetras(20)).toBe("VEINTE CON 00/100 SOLES");
    });

    it("centena exacta = CIEN, no CIENTO", () => {
        expect(montoEnLetras(100)).toBe("CIEN CON 00/100 SOLES");
        expect(montoEnLetras(101)).toBe("CIENTO UNO CON 00/100 SOLES");
    });

    it("miles y un millon", () => {
        expect(montoEnLetras(1000)).toBe("MIL CON 00/100 SOLES");
        expect(montoEnLetras(1_000_000)).toBe("UN MILLON CON 00/100 SOLES");
        expect(montoEnLetras(2_000_000)).toBe("DOS MILLONES CON 00/100 SOLES");
    });

    it("redondea centavos a 2 decimales", () => {
        expect(montoEnLetras(0.005)).toBe("CERO CON 01/100 SOLES");
        expect(montoEnLetras(99.999)).toBe("CIEN CON 00/100 SOLES");
    });

    it("permite otra moneda", () => {
        expect(montoEnLetras(5, "DOLARES AMERICANOS")).toBe("CINCO CON 00/100 DOLARES AMERICANOS");
    });
});
