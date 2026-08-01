import { describe, expect, it } from "vitest";
import {
    OwnerSignupAbuseRequestDto,
    SignupAbuseListDto,
    SignupAbuseReviewDto,
} from "../src/modules/registration/owner-signup-abuse.dto";

describe("EMP-002 DTO antiabuso", () => {
    it("exige CAPTCHA y una señal de dispositivo opaca", () => {
        expect(OwnerSignupAbuseRequestDto.create({}, "device-identifier-1234")[0])
            .toMatch(/humana/i);
        expect(OwnerSignupAbuseRequestDto.create({ captchaToken: "ok" }, "corto")[0])
            .toMatch(/dispositivo/i);
        expect(OwnerSignupAbuseRequestDto.create(
            { captchaToken: "turnstile-token" },
            "device_identifier-1234",
        )[0]).toBeUndefined();
        const [, derived] = OwnerSignupAbuseRequestDto.create(
            { captchaToken: "turnstile-token" },
            undefined,
            "Mozilla/5.0|es-PE",
        );
        expect(derived?.deviceId).toBe("derived:Mozilla/5.0|es-PE");
    });

    it("acepta el nombre de campo automático de Turnstile", () => {
        const [error, dto] = OwnerSignupAbuseRequestDto.create({
            "cf-turnstile-response": "turnstile-token",
        }, "device-identifier-1234");
        expect(error).toBeUndefined();
        expect(dto?.captchaToken).toBe("turnstile-token");
    });

    it("limita la paginación de soporte", () => {
        expect(SignupAbuseListDto.create({ page: 1, limit: 100 })[0]).toBeUndefined();
        expect(SignupAbuseListDto.create({ page: 0 })[0]).toBeDefined();
        expect(SignupAbuseListDto.create({ limit: 101 })[0]).toBeDefined();
    });

    it("prohíbe PII y excepciones indefinidas en notas", () => {
        expect(SignupAbuseReviewDto.create({
            outcome: "FALSE_POSITIVE",
            note: "contactar a persona@example.com",
        })[0]).toMatch(/texto libre/i);
        expect(SignupAbuseReviewDto.create({
            outcome: "FALSE_POSITIVE",
            overrideHours: 169,
        })[0]).toMatch(/168/);
        expect(SignupAbuseReviewDto.create({
            outcome: "CONFIRMED_ABUSE",
            noteCode: "AUTOMATION_CONFIRMED",
        })[0]).toBeUndefined();
    });
});
