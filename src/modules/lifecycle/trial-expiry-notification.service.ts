import nodemailer from "nodemailer";
import { envs } from "../../config/envs";
import { normalizeSmtpPassword, normalizeSmtpUser } from "../../config/smtp";
import { platformPrisma } from "../../data/platform-prisma";
import {
    formatEmailExpiration,
    getEmailHeroAttachment,
    renderBrandedEmail,
} from "../email/branded-email-template";

export class TrialExpiryNotificationService {
    static async send(tenantId: string): Promise<void> {
        if (!envs.SMTP_HOST || !envs.SMTP_FROM || !envs.TRIAL_EXPORT_URL) {
            throw new Error("TRIAL_NOTIFICATION_SMTP_NOT_CONFIGURED");
        }
        const tenant = await platformPrisma.tenant.findUnique({
            where: { id: tenantId },
            include: {
                memberships: {
                    where: { role: "OWNER" },
                    include: { user: { select: { email: true } } },
                    take: 1,
                },
            },
        });
        if (!tenant || tenant.status !== "EXPIRED" || !tenant.graceEndsAt) {
            throw new Error("TRIAL_EXPIRY_NOTICE_TENANT_INVALID");
        }
        const recipient = tenant.contactEmail || tenant.memberships[0]?.user.email;
        if (!recipient) throw new Error("TRIAL_EXPIRY_NOTICE_RECIPIENT_MISSING");
        const sent = await platformPrisma.tenantLifecycleEvent.findFirst({
            where: { tenantId, type: "TRIAL_PURGE_NOTICE_SENT" },
        });
        if (sent) return;
        const smtpUser = normalizeSmtpUser(envs.SMTP_USER);
        const smtpPassword = normalizeSmtpPassword(envs.SMTP_HOST, envs.SMTP_PASSWORD);
        const transport = nodemailer.createTransport({
            host: envs.SMTP_HOST,
            port: envs.SMTP_PORT,
            secure: envs.SMTP_SECURE,
            auth: smtpUser && smtpPassword
                ? { user: smtpUser, pass: smtpPassword }
                : undefined,
        });
        const graceExpiration = formatEmailExpiration(tenant.graceEndsAt);
        await transport.sendMail({
            from: envs.SMTP_FROM,
            to: recipient,
            subject: `Tu prueba de ${tenant.name} ha finalizado`,
            text: [
                `La prueba de ${tenant.name} ha finalizado y ahora está en modo de solo lectura.`,
                `Puedes consultar o exportar tus datos hasta el ${graceExpiration}.`,
                `Exportar o contratar: ${envs.TRIAL_EXPORT_URL}`,
                "Después del periodo de gracia se eliminarán los datos no sujetos a retención legal.",
            ].join("\n\n"),
            html: renderBrandedEmail({
                preheader: `La prueba de ${tenant.name} finalizó; aún puedes consultar o exportar tus datos.`,
                eyebrow: "Tu información sigue disponible",
                title: "Tu periodo de prueba ha finalizado",
                greeting: `El espacio de ${tenant.name} está ahora en modo de solo lectura.`,
                introduction: "Todavía puedes revisar tu información, exportar tus datos o elegir un plan para continuar trabajando con normalidad.",
                actionLabel: "Exportar o elegir un plan",
                actionUrl: envs.TRIAL_EXPORT_URL,
                hero: "trial-expired",
                heroAlt: "Emprendedora revisando sus datos junto a un reloj de arena y un archivo seguro",
                expiration: graceExpiration,
                expirationLabel: "Consulta y exportación disponibles hasta",
                detailTitle: "Durante el periodo de gracia puedes:",
                details: [
                    "Consultar la información de tu negocio en modo de solo lectura.",
                    "Exportar tus datos para conservar una copia.",
                    "Contratar un plan y recuperar la operación completa.",
                ],
                securityNotice: "Después de esa fecha se eliminarán los datos que no estén sujetos a retención legal.",
            }),
            attachments: [getEmailHeroAttachment("trial-expired")],
        });
        await platformPrisma.tenantLifecycleEvent.create({
            data: {
                tenantId,
                type: "TRIAL_PURGE_NOTICE_SENT",
                source: "lifecycle-worker",
                metadata: { graceEndsAt: tenant.graceEndsAt.toISOString() },
            },
        });
    }
}
