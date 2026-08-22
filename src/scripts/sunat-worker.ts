import "../instrumentation/sentry-worker";
import { randomUUID } from "node:crypto";
import { SunatJobType } from "@prisma/client";
import { platformPrisma } from "../data/platform-prisma";
import { runTenantDatabaseTransaction } from "../data/prisma";
import { TenantLifecycleService } from "../modules/lifecycle/tenant-lifecycle.service";
import { TrialExpiryNotificationService } from "../modules/lifecycle/trial-expiry-notification.service";
import { SunatJobQueue } from "../modules/platform/sunat-job-queue";
import { ComprobanteService } from "../modules/sunat/services/comprobante.service";
import { SunatPdfService } from "../modules/sunat/services/sunat-pdf.service";
import { getSunatArtifactServiceFromEnvironment } from "../modules/sunat/services/sunat-artifact.service";
import { operationalLog } from "../presentation/observability/operational-logger";
import { captureOperationalException, flushSentry } from "../presentation/observability/sentry";

type WorkerPayload = {
    tenantId: string;
    date?: string;
    ownerType?: "RESUMEN" | "BAJA";
    ownerId?: number;
};

const queue = new SunatJobQueue();
const service = new ComprobanteService();
const workerId = `${process.env.RAILWAY_REPLICA_ID ?? "local"}:${process.pid}:${randomUUID()}`;
const once = process.argv.includes("--once");
const drain = process.argv.includes("--drain");
const configuredDrainMaxJobs = Number(process.env.WORKER_DRAIN_MAX_JOBS ?? 50);
const drainMaxJobs = Number.isFinite(configuredDrainMaxJobs)
    ? Math.min(500, Math.max(1, Math.trunc(configuredDrainMaxJobs)))
    : 50;
const configuredPollMs = Number(process.env.WORKER_POLL_MS ?? 2000);
const pollMs = Number.isFinite(configuredPollMs)
    ? Math.min(60_000, Math.max(250, configuredPollMs))
    : 2000;
const configuredTicketPollSeconds = Number(process.env.SUNAT_TICKET_POLL_SECONDS ?? 120);
const ticketPollSeconds = Number.isFinite(configuredTicketPollSeconds)
    ? Math.min(3600, Math.max(30, configuredTicketPollSeconds))
    : 120;
let stopping = false;

class DeferredJobError extends Error {}

function validateJobPayload(type: SunatJobType, input: unknown): WorkerPayload {
    if (!input || typeof input !== "object") throw new Error("Payload de job inválido");
    const value = input as Record<string, unknown>;
    const tenantId = String(value.tenantId ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
        throw new Error("El payload del job requiere tenantId UUID válido");
    }
    const date = value.date === undefined ? undefined : String(value.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Fecha de job inválida");
    const ownerType = value.ownerType === "RESUMEN" || value.ownerType === "BAJA"
        ? value.ownerType
        : undefined;
    const ownerId = value.ownerId === undefined ? undefined : Number(value.ownerId);
    if (type === "POLL_TICKET" && (!ownerType || !Number.isInteger(ownerId) || ownerId! < 1)) {
        throw new Error("POLL_TICKET requiere ownerType y ownerId");
    }
    if (type === "GENERATE_PDF" && (!Number.isInteger(ownerId) || ownerId! < 1)) {
        throw new Error("GENERATE_PDF requiere ownerId");
    }
    return {
        tenantId,
        ...(date ? { date } : {}),
        ...(ownerType ? { ownerType } : {}),
        ...(ownerId ? { ownerId } : {}),
    };
}

async function execute(type: SunatJobType, payload: WorkerPayload): Promise<void> {
    if (type === "PURGE_TRIAL") {
        await runTenantDatabaseTransaction(payload.tenantId, async () => {
            const pendingArtifacts = await platformPrisma.sunatArtifact.count({
                where: { tenantId: payload.tenantId, storageStatus: { not: "DELETED" } },
            });
            const artifacts = getSunatArtifactServiceFromEnvironment();
            if (pendingArtifacts > 0 && !artifacts) {
                throw new Error("PURGE_REQUIRES_DOCUMENT_STORAGE");
            }
            await artifacts?.deleteAllForCurrentTenant();
        });
        await TenantLifecycleService.purgeDueTrials(new Date(), payload.tenantId);
        return;
    }
    if (type === "NOTIFY_TRIAL_EXPIRY") {
        await TrialExpiryNotificationService.send(payload.tenantId);
        return;
    }
    const tenant = await platformPrisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { status: true },
    });
    if (!tenant || (tenant.status !== "ACTIVE" && tenant.status !== "SUSPENDED")) {
        throw new Error("TENANT_NOT_OPERATIONAL");
    }
    await runTenantDatabaseTransaction(payload.tenantId, async () => {
        switch (type) {
            case "SEND_SUMMARY":
                await service.generarResumenDiario(payload.date);
                return;
            case "POLL_TICKET":
                if (payload.ownerType === "RESUMEN") {
                    const result = await service.consultarResumen(payload.ownerId!);
                    if (result.status === "PENDING") throw new DeferredJobError("SUNAT_TICKET_PENDING");
                } else {
                    const result = await service.consultarBaja(payload.ownerId!);
                    if (result.status === "PENDING") throw new DeferredJobError("SUNAT_TICKET_PENDING");
                }
                return;
            case "CHECK_CERTIFICATE_EXPIRY":
                await TenantLifecycleService.checkCertificateExpiry();
                return;
            case "GENERATE_PDF":
                await new SunatPdfService().generate(payload.ownerId!);
                return;
            case "MIGRATE_ARTIFACTS":
            case "REENCRYPT_SECRETS":
                throw new Error(`JOB_HANDLER_PENDING_${type}`);
            default:
                throw new Error(`JOB_TYPE_UNSUPPORTED_${type satisfies never}`);
        }
    });
}

async function runOne(): Promise<boolean> {
    const job = await queue.claim(workerId);
    if (!job) return false;
    operationalLog("info", "job.claimed", {
        jobId: job.id,
        tenantId: job.tenantId,
        type: job.type,
        correlationId: job.correlationId,
        idempotencyKey: job.idempotencyKey,
        attempt: job.attempts,
    });
    try {
        const payload = validateJobPayload(job.type, job.payload);
        if (payload.tenantId !== job.tenantId) throw new Error("JOB_TENANT_MISMATCH");
        await execute(job.type, payload);
        await queue.complete(job.id, workerId);
        operationalLog("info", "job.completed", {
            jobId: job.id,
            tenantId: job.tenantId,
            type: job.type,
            correlationId: job.correlationId,
            idempotencyKey: job.idempotencyKey,
        });
    } catch (caught) {
        operationalLog("error", "job.failed", {
            jobId: job.id,
            tenantId: job.tenantId,
            type: job.type,
            correlationId: job.correlationId,
            idempotencyKey: job.idempotencyKey,
            error: caught instanceof Error ? caught.message : String(caught),
        });
        if (caught instanceof DeferredJobError) {
            await queue.defer(
                job.id,
                workerId,
                new Date(Date.now() + ticketPollSeconds * 1000),
                "SUNAT_TICKET_PENDING",
            );
        } else {
            captureOperationalException(caught, {
                operation: "worker.job",
                tenantId: job.tenantId,
                correlationId: job.correlationId,
                tags: { job_type: job.type },
                context: {
                    jobId: job.id,
                    idempotencyKey: job.idempotencyKey,
                    attempt: job.attempts,
                },
            });
            await queue.fail(job.id, workerId, caught);
        }
    }
    return true;
}

async function main(): Promise<void> {
    await queue.recoverStaleLocks();
    let processed = 0;
    do {
        const worked = await runOne();
        if (once) return;
        if (drain) {
            if (!worked || ++processed >= drainMaxJobs) return;
            continue;
        }
        if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs));
    } while (!stopping);
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

void main()
    .catch((caught) => {
        operationalLog("error", "worker.crashed", {
            error: caught instanceof Error ? caught.message : "worker error",
        });
        captureOperationalException(caught, { operation: "worker.main", level: "fatal" });
        process.exitCode = 1;
    })
    .finally(async () => {
        await flushSentry();
        await platformPrisma.$disconnect();
    });
