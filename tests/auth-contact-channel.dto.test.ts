import { describe, expect, it } from "vitest";
import {
    PasswordResetConfirmDto,
    PasswordResetRequestDto,
} from "../src/modules/auth/password-reset.dto";
import { CreateTenantInvitationDto } from "../src/modules/invitations/tenant-invitation.dto";

describe("canales de acceso por WhatsApp", () => {
    it("acepta recuperación por correo o teléfono peruano", () => {
        expect(PasswordResetRequestDto.create({ identifier: " ANA@Example.COM " })[1])
            .toMatchObject({ identifier: "ana@example.com", channel: "email" });
        expect(PasswordResetRequestDto.create({ identifier: "999 888 777" })[1])
            .toMatchObject({ identifier: "+51999888777", channel: "whatsapp" });
    });

    it("acepta invitaciones por correo o WhatsApp, pero no ambos", () => {
        expect(CreateTenantInvitationDto.create({
            phone: "999888777",
            role: "SELLER",
        })[1]).toMatchObject({
            email: null,
            phone: "+51999888777",
        });
        expect(CreateTenantInvitationDto.create({
            email: "ana@example.com",
            phone: "999888777",
            role: "SELLER",
        })[0]).toMatch(/no ambos/i);
    });

    it("exige teléfono para ligar un OTP de recuperación a su destinatario", () => {
        expect(PasswordResetConfirmDto.create({
            token: "428193",
            identifier: "999888777",
            password: "Nueva!Clave2026",
        })[1]).toMatchObject({
            token: "428193",
            identifier: "+51999888777",
        });
        expect(PasswordResetConfirmDto.create({
            token: "428193",
            password: "Nueva!Clave2026",
        })[0]).toMatch(/número de WhatsApp/i);
    });
});
