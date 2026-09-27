import { describe, expect, it } from "vitest";
import {
    normalizeOwnerPhone,
    OwnerSignupDto,
    VerifyOwnerEmailDto,
} from "../src/modules/registration/owner-registration.dto";

const validSignup = {
    firstName: "  María  José ",
    lastName: " Pérez ",
    email: " OWNER@Example.COM ",
    password: "Segura-2026!Clave",
    businessName: " Mi Tienda ",
    termsAccepted: true,
};

describe("EMP-001 DTO de registro", () => {
    it("rechaza cuerpos ausentes sin lanzar excepciones", () => {
        const [error, dto] = OwnerSignupDto.create(null);
        expect(error).toBeDefined();
        expect(dto).toBeUndefined();
    });

    it("normaliza identidad y correo", () => {
        const [error, dto] = OwnerSignupDto.create(validSignup);
        expect(error).toBeUndefined();
        expect(dto).toMatchObject({
            firstName: "María José",
            lastName: "Pérez",
            email: "owner@example.com",
            businessName: "Mi Tienda",
            termsAccepted: true,
        });
    });

    it("normaliza un número internacional para WhatsApp", () => {
        const [error, dto] = OwnerSignupDto.create({
            ...validSignup,
            email: undefined,
            phone: " 00 51 (999) 888-777 ",
        }, { emailEnabled: false });

        expect(error).toBeUndefined();
        expect(dto).toMatchObject({
            email: null,
            phone: "+51999888777",
        });
        expect(normalizeOwnerPhone("999888777")).toBe("+51999888777");
        expect(normalizeOwnerPhone("+14155552671")).toBeNull();
    });

    it("bloquea correo cuando el canal está deshabilitado", () => {
        const [error, dto] = OwnerSignupDto.create(validSignup, { emailEnabled: false });
        expect(error).toMatch(/correo.*deshabilitado/i);
        expect(dto).toBeUndefined();
    });

    it.each([
        ["corta", "Aa1!corta"],
        ["sin mayúscula", "segura-2026!clave"],
        ["sin minúscula", "SEGURA-2026!CLAVE"],
        ["sin número", "Segura-Clave!larga"],
        ["sin símbolo", "Segura2026Clave"],
    ])("rechaza contraseña %s", (_label, password) => {
        const [error] = OwnerSignupDto.create({ ...validSignup, password });
        expect(error).toMatch(/contraseña/i);
    });

    it("rechaza contraseñas que bcrypt truncaría después de 72 bytes", () => {
        const [error, dto] = OwnerSignupDto.create({
            ...validSignup,
            password: `Segura-2026!${"ñ".repeat(31)}`,
        });
        expect(error).toMatch(/72 bytes/);
        expect(dto).toBeUndefined();
    });

    it("exige aceptación explícita de términos", () => {
        const [error] = OwnerSignupDto.create({
            ...validSignup,
            termsAccepted: false,
        });
        expect(error).toMatch(/términos/i);
    });

    it("solo acepta tokens opacos con formato base64url", () => {
        const token = "a".repeat(43);
        expect(VerifyOwnerEmailDto.create({ token })[0]).toBeUndefined();
        expect(VerifyOwnerEmailDto.create({ token: "token con espacios" })[0])
            .toMatch(/inválid[ao]/i);
    });

    it("acepta un OTP sólo cuando está ligado al número que lo recibió", () => {
        expect(VerifyOwnerEmailDto.create({
            token: "428193",
            identifier: "999 888 777",
        })[1]).toMatchObject({ token: "428193", identifier: "+51999888777" });
        expect(VerifyOwnerEmailDto.create({ token: "428193" })[0])
            .toMatch(/número de WhatsApp/i);
    });
});
