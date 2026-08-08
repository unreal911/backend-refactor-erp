import nodemailer from "nodemailer";
import { envs } from "../../config/envs";
import { platformPrisma } from "../../data/platform-prisma";

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
        const transport = nodemailer.createTransport({
            host: envs.SMTP_HOST,
            port: envs.SMTP_PORT,
            secure: envs.SMTP_SECURE,
            auth: envs.SMTP_USER && envs.SMTP_PASSWORD
                ? { user: envs.SMTP_USER, pass: envs.SMTP_PASSWORD }
                : undefined,
        });
        await transport.sendMail({
            from: envs.SMTP_FROM,
            to: recipient,
            subject: `Tu prueba de ${tenant.name} ha finalizado`,
            text: [
                `La prueba de ${tenant.name} ha finalizado y ahora está en modo de solo lectura.`,
                `Puedes consultar o exportar tus datos hasta ${tenant.graceEndsAt.toISOString()}.`,
                `Exportar o contratar: ${envs.TRIAL_EXPORT_URL}`,
                "Después del periodo de gracia se eliminarán los datos no sujetos a retención legal.",
            ].join("\n\n"),
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
