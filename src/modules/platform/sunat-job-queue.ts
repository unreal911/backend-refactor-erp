import { Prisma, SunatJobStatus, SunatJobType } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

export type EnqueueSunatJobInput = {
    tenantId: string;
    type: SunatJobType;
    idempotencyKey: string;
    correlationId: string;
    payload: Prisma.InputJsonValue;
    nextRunAt?: Date;
    maxAttempts?: number;
};

function sanitizeError(value: unknown): { code: string; message: string } {
    const candidate = value as { code?: unknown; name?: unknown; message?: unknown } | null;
    const code = String(candidate?.code ?? candidate?.name ?? "JOB_ERROR")
        .replace(/[^A-Za-z0-9_.-]/g, "_")
        .slice(0, 80);
    const message = String(candidate?.message ?? value ?? "Error de job")
        .replace(/(password|token|secret|authorization|clave|pfx)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_CONNECTION]")
        .slice(0, 500);
    return { code, message };
}

export class SunatJobQueue {
    async enqueue(input: EnqueueSunatJobInput) {
        const idempotencyKey = String(input.idempotencyKey || "").trim();
        const correlationId = String(input.correlationId || "").trim();
        if (!idempotencyKey || idempotencyKey.length > 200) {
            throw new Error("El job requiere idempotencyKey válida");
        }
        if (!correlationId || correlationId.length > 200) {
            throw new Error("El job requiere correlationId válida");
        }
        const maxAttempts = input.maxAttempts ?? 5;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
            throw new Error("maxAttempts debe estar entre 1 y 20");
        }
        return platformPrisma.sunatJob.upsert({
            where: {
                tenantId_type_idempotencyKey: {
                    tenantId: input.tenantId,
                    type: input.type,
                    idempotencyKey,
                },
            },
            create: {
                tenantId: input.tenantId,
                type: input.type,
                idempotencyKey,
                correlationId,
                payload: input.payload,
                nextRunAt: input.nextRunAt ?? new Date(),
                maxAttempts,
            },
            update: {},
        });
    }

    async claim(workerId: string, now = new Date()) {
        const normalizedWorkerId = String(workerId || "").trim().slice(0, 120);
        if (!normalizedWorkerId) throw new Error("workerId requerido");
        return platformPrisma.$transaction(async (tx) => {
            const rows = await tx.$queryRawUnsafe<Array<{
                id: string;
                tenantId: string;
                type: SunatJobType;
                status: SunatJobStatus;
                idempotencyKey: string;
                correlationId: string;
                payload: Prisma.JsonValue;
                attempts: number;
                maxAttempts: number;
                nextRunAt: Date;
                lockedAt: Date | null;
                lockedBy: string | null;
            }>>(
                `WITH candidate AS (
                    SELECT "id"
                    FROM "SunatJob"
                    WHERE "status" IN ('PENDING', 'FAILED')
                      AND "nextRunAt" <= $1
                      AND "attempts" < "maxAttempts"
                    ORDER BY "nextRunAt", "createdAt", "id"
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE "SunatJob" AS job
                SET "status" = 'RUNNING',
                    "attempts" = job."attempts" + 1,
                    "lockedAt" = $1,
                    "lockedBy" = $2,
                    "updatedAt" = CURRENT_TIMESTAMP
                FROM candidate
                WHERE job."id" = candidate."id"
                RETURNING job."id", job."tenantId", job."type", job."status",
                          job."idempotencyKey", job."correlationId", job."payload",
                          job."attempts", job."maxAttempts", job."nextRunAt",
                          job."lockedAt", job."lockedBy"`,
                now,
                normalizedWorkerId,
            );
            return rows[0] ?? null;
        });
    }

    async complete(id: string, workerId: string, now = new Date()): Promise<void> {
        const updated = await platformPrisma.sunatJob.updateMany({
            where: { id, status: "RUNNING", lockedBy: workerId },
            data: {
                status: "SUCCEEDED",
                completedAt: now,
                lockedAt: null,
                lockedBy: null,
                lastErrorCode: null,
                lastErrorSafe: null,
            },
        });
        if (updated.count !== 1) throw new Error("El job ya no pertenece a este worker");
    }

    async fail(id: string, workerId: string, caught: unknown, now = new Date()): Promise<void> {
        const job = await platformPrisma.sunatJob.findFirst({
            where: { id, status: "RUNNING", lockedBy: workerId },
        });
        if (!job) throw new Error("El job ya no pertenece a este worker");
        const terminal = job.attempts >= job.maxAttempts;
        const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, job.attempts - 1)));
        const safe = sanitizeError(caught);
        await platformPrisma.sunatJob.update({
            where: { id: job.id },
            data: {
                status: terminal ? "DEAD" : "FAILED",
                nextRunAt: new Date(now.getTime() + delaySeconds * 1000),
                completedAt: terminal ? now : null,
                lockedAt: null,
                lockedBy: null,
                lastErrorCode: safe.code,
                lastErrorSafe: safe.message,
            },
        });
    }

    async defer(
        id: string,
        workerId: string,
        nextRunAt: Date,
        reason = "JOB_DEFERRED",
    ): Promise<void> {
        if (!(nextRunAt instanceof Date) || Number.isNaN(nextRunAt.getTime())) {
            throw new Error("nextRunAt invalido");
        }
        const safeReason = String(reason || "JOB_DEFERRED")
            .replace(/[^A-Za-z0-9_.-]/g, "_")
            .slice(0, 80);
        const updated = await platformPrisma.sunatJob.updateMany({
            where: {
                id,
                status: "RUNNING",
                lockedBy: workerId,
                attempts: { gt: 0 },
            },
            data: {
                status: "PENDING",
                attempts: { decrement: 1 },
                nextRunAt,
                completedAt: null,
                lockedAt: null,
                lockedBy: null,
                lastErrorCode: safeReason,
                lastErrorSafe: "El proveedor aun no tiene una respuesta final",
            },
        });
        if (updated.count !== 1) throw new Error("El job ya no pertenece a este worker");
    }

    async recoverStaleLocks(now = new Date(), staleAfterMinutes = 15): Promise<number> {
        const threshold = new Date(now.getTime() - staleAfterMinutes * 60_000);
        const recovered = await platformPrisma.sunatJob.updateMany({
            where: { status: "RUNNING", lockedAt: { lt: threshold } },
            data: {
                status: "FAILED",
                nextRunAt: now,
                lockedAt: null,
                lockedBy: null,
                lastErrorCode: "STALE_LOCK_RECOVERED",
                lastErrorSafe: "El worker anterior dejó de responder; el job fue recuperado",
            },
        });
        return recovered.count;
    }
}
