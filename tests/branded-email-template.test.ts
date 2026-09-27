import { describe, expect, it } from "vitest";
import {
    formatEmailExpiration,
    getEmailHeroAttachment,
    renderBrandedEmail,
} from "../src/modules/email/branded-email-template";

describe("plantilla visual de correos", () => {
    it("renderiza contenido responsive, CTA y alternativa de enlace", () => {
        const html = renderBrandedEmail({
            preheader: "Activa tu cuenta",
            eyebrow: "Bienvenido",
            title: "Empieza ahora",
            greeting: "Hola, Ana.",
            introduction: "Confirma tu correo.",
            actionLabel: "Activar mi cuenta",
            actionUrl: "https://app.example.com/verify?token=abc",
            hero: "account-activation",
            heroAlt: "Tienda de moda",
            expiration: "6 de septiembre de 2026, 10:30 p. m.",
            details: ["Configura tu negocio"],
            securityNotice: "Ignora este mensaje si no lo solicitaste.",
        });

        expect(html).toContain('lang="es"');
        expect(html).toContain('class="email-shell"');
        expect(html).toContain('src="cid:tienda-saas-account-activation"');
        expect(html).toContain("Activar mi cuenta");
        expect(html).toContain("Si el botón no funciona");
        expect(html).toContain("https://app.example.com/verify?token=abc");
    });

    it("escapa datos dinámicos en todos los bloques", () => {
        const html = renderBrandedEmail({
            preheader: "Invitación",
            eyebrow: "Equipo",
            title: '<script>alert("x")</script>',
            greeting: "Hola",
            introduction: "Te invitaron",
            actionLabel: "Aceptar",
            actionUrl: "https://app.example.com/accept?token=a&source=email",
            hero: "team-invitation",
            heroAlt: "Equipo",
            expiration: "mañana",
            detailTitle: "Detalles",
            details: ['Negocio: <img src=x onerror="alert(1)">'],
            securityNotice: "Aviso",
        });

        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("token=a&amp;source=email");
    });

    it("carga una imagen optimizada diferente para cada flujo", () => {
        const activation = getEmailHeroAttachment("account-activation");
        const recovery = getEmailHeroAttachment("password-recovery");
        const invitation = getEmailHeroAttachment("team-invitation");
        const trialExpired = getEmailHeroAttachment("trial-expired");

        expect(activation.content.byteLength).toBeGreaterThan(20_000);
        expect(recovery.content.byteLength).toBeGreaterThan(20_000);
        expect(invitation.content.byteLength).toBeGreaterThan(20_000);
        expect(trialExpired.content.byteLength).toBeGreaterThan(20_000);
        expect(new Set([
            activation.filename,
            recovery.filename,
            invitation.filename,
            trialExpired.filename,
        ]).size).toBe(4);
        expect(activation.contentType).toBe("image/jpeg");
    });

    it("muestra el vencimiento en hora de Lima", () => {
        expect(formatEmailExpiration(new Date("2026-09-06T03:30:00.000Z")))
            .toContain("10:30 p. m.");
    });
});
