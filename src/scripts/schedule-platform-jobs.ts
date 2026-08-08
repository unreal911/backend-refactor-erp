import { platformPrisma } from "../data/platform-prisma";
import { TenantLifecycleService } from "../modules/lifecycle/tenant-lifecycle.service";
import { SunatJobQueue } from "../modules/platform/sunat-job-queue";

function limaDate(now = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}

async function main(): Promise<void> {
    const queue = new SunatJobQueue();
    const date = limaDate();
    const summaryDate = limaDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const tenants = await platformPrisma.tenant.findMany({
        where: { status: { in: ["TRIAL", "ACTIVE"] } },
        select: { id: true, trialEndsAt: true, sunatEmisorConfigs: { select: { certNotAfter: true }, take: 1 } },
        orderBy: { id: "asc" },
    });
    let certificateJobs = 0;
    for (const tenant of tenants) {
        if (tenant.sunatEmisorConfigs[0]?.certNotAfter) {
            await queue.enqueue({
                tenantId: tenant.id,
                type: "CHECK_CERTIFICATE_EXPIRY",
                idempotencyKey: `certificate-expiry:${date}`,
                correlationId: `certificate-expiry:${date}:${tenant.id}`,
                payload: { tenantId: tenant.id },
            });
            certificateJobs += 1;
        }
    }
    const summaryStart = new Date(`${summaryDate}T00:00:00.000Z`);
    const summaryEnd = new Date(summaryStart.getTime() + 24 * 60 * 60 * 1000);
    const pendingSummaryTenants = await platformPrisma.comprobante.findMany({
        where: {
            tenant: { status: { in: ["TRIAL", "ACTIVE"] } },
            estado: "BORRADOR",
            resumenDiarioId: null,
            fechaEmision: { gte: summaryStart, lt: summaryEnd },
            OR: [
                { tipo: "BOLETA" },
                {
                    tipo: { in: ["NOTA_CREDITO", "NOTA_DEBITO"] },
                    comprobanteAfectado: { tipo: "BOLETA" },
                },
            ],
        },
        select: { tenantId: true },
        distinct: ["tenantId"],
    });
    for (const pending of pendingSummaryTenants) {
        await queue.enqueue({
            tenantId: pending.tenantId,
            type: "SEND_SUMMARY",
            idempotencyKey: `summary:${summaryDate}`,
            correlationId: `summary:${summaryDate}:${pending.tenantId}`,
            payload: { tenantId: pending.tenantId, date: summaryDate },
        });
    }
    const trials = await TenantLifecycleService.expireDueTrials();
    console.log(JSON.stringify({
        checkedTenants: tenants.length,
        certificateJobs,
        summaryJobs: pendingSummaryTenants.length,
        summaryDate,
        expiredTrials: trials.expired,
        date,
    }));
}

void main()
    .catch((caught) => {
        console.error("[platform-scheduler]", caught instanceof Error ? caught.message : "scheduler failed");
        process.exitCode = 1;
    })
    .finally(() => platformPrisma.$disconnect());
