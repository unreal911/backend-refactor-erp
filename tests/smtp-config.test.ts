import { describe, expect, it } from "vitest";
import {
    assertGmailSmtpTransport,
    assertSmtpAuthPair,
    normalizeSmtpPassword,
} from "../src/config/smtp";

describe("configuración SMTP de Gmail", () => {
    it("quita los espacios de una contraseña de aplicación agrupada", () => {
        expect(normalizeSmtpPassword("smtp.gmail.com", "abcd efgh ijkl mnop"))
            .toBe("abcdefghijklmnop");
    });

    it("acepta Gmail con SSL directo en 465", () => {
        expect(() => assertGmailSmtpTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            user: "pruebas@gmail.com",
            password: "abcdefghijklmnop",
        })).not.toThrow();
    });

    it("acepta Gmail con STARTTLS en 587", () => {
        expect(() => assertGmailSmtpTransport({
            host: "smtp.gmail.com",
            port: 587,
            secure: false,
            user: "pruebas@gmail.com",
            password: "abcdefghijklmnop",
        })).not.toThrow();
    });

    it("rechaza el puerto/seguridad incompatibles de Gmail", () => {
        expect(() => assertGmailSmtpTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: false,
            user: "pruebas@gmail.com",
            password: "abcdefghijklmnop",
        })).toThrow(/puerto 465/);
    });

    it("rechaza la contraseña normal o una app password incompleta", () => {
        expect(() => assertGmailSmtpTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            user: "pruebas@gmail.com",
            password: "password-normal",
        })).toThrow(/16 caracteres/);
    });

    it("mantiene la regla de usuario y contraseña juntos", () => {
        expect(() => assertSmtpAuthPair("pruebas@gmail.com", ""))
            .toThrow(/configurarse juntos/);
    });
});
