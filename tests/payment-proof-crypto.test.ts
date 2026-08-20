import { describe, expect, it } from "vitest";
import { openPaymentProof, protectPaymentProof } from "../src/modules/platform-admin/payment-proof-crypto";

describe("constancias privadas de pago", () => {
    it("valida el tipo real, cifra y recupera el contenido", () => {
        const original = Buffer.from("%PDF-1.7\nconstancia de prueba", "utf8");
        const protectedProof = protectPaymentProof({
            filename: "constancia.pdf",
            data: original.toString("base64"),
        });

        expect(protectedProof.contentType).toBe("application/pdf");
        expect(protectedProof.ciphertext.equals(original)).toBe(false);
        expect(openPaymentProof(protectedProof).equals(original)).toBe(true);
    });

    it("rechaza contenido cuyo MIME real no está permitido", () => {
        expect(() => protectPaymentProof({
            filename: "falso.pdf",
            data: Buffer.from("no es un documento").toString("base64"),
        })).toThrow("PDF, JPG, PNG o WebP");
    });
});
