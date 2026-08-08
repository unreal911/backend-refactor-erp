import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import { SunatJobQueue } from "../src/modules/platform/sunat-job-queue";

let tenantId = "";
const tag = `${Date.now().toString(36)}-${process.pid}`;

beforeAll(async () => {
    const tenant = await platformPrisma.tenant.create({
        data: { slug: `queue-${tag}`, name: "Queue test", status: "ACTIVE", kind: "CUSTOMER" },
    });
    tenantId = tenant.id;
});

afterAll(async () => {
    if (tenantId) {
        await platformPrisma.sunatJob.deleteMany({ where: { tenantId } });
        await platformPrisma.tenant.delete({ where: { id: tenantId } });
    }
    await platformPrisma.$disconnect();
});

describe("SUN-011 cola durable", () => {
    it("deduplica, reclama y completa con ownership del worker", async () => {
        const queue = new SunatJobQueue();
        const input = {
            tenantId,
            type: "CHECK_CERTIFICATE_EXPIRY" as const,
            idempotencyKey: "certificate:queue-test",
            correlationId: "correlation:queue-test",
            payload: { tenantId },
            nextRunAt: new Date("2000-01-01T00:00:00Z"),
        };
        const first = await queue.enqueue(input);
        const replay = await queue.enqueue(input);
        expect(replay.id).toBe(first.id);
        const claimed = await queue.claim("worker-a");
        expect(claimed?.id).toBe(first.id);
        await expect(queue.complete(first.id, "worker-b")).rejects.toThrow();
        await queue.complete(first.id, "worker-a");
        expect((await platformPrisma.sunatJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SUCCEEDED");
    });

    it("aplica backoff y recupera locks vencidos", async () => {
        const queue = new SunatJobQueue();
        const job = await queue.enqueue({
            tenantId,
            type: "CHECK_CERTIFICATE_EXPIRY",
            idempotencyKey: "certificate:queue-failure",
            correlationId: "correlation:queue-failure",
            payload: { tenantId },
            maxAttempts: 3,
            nextRunAt: new Date("2000-01-01T00:00:01Z"),
        });
        const claimed = await queue.claim("worker-failure");
        expect(claimed?.id).toBe(job.id);
        const failedAt = new Date("2026-08-02T12:00:00Z");
        await queue.fail(job.id, "worker-failure", new Error("token=never-log-this"), failedAt);
        const failed = await platformPrisma.sunatJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(failed.status).toBe("FAILED");
        expect(failed.nextRunAt.getTime()).toBeGreaterThan(failedAt.getTime());
        expect(failed.lastErrorSafe).not.toContain("never-log-this");

        await platformPrisma.sunatJob.update({
            where: { id: job.id },
            data: { status: "RUNNING", lockedBy: "dead-worker", lockedAt: new Date("2026-08-02T10:00:00Z") },
        });
        expect(await queue.recoverStaleLocks(new Date("2026-08-02T12:00:00Z"), 15)).toBeGreaterThanOrEqual(1);
        expect((await platformPrisma.sunatJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
        await platformPrisma.sunatJob.update({
            where: { id: job.id },
            data: { status: "DEAD", completedAt: new Date("2026-08-02T12:00:00Z") },
        });
    });

    it("difiere tickets pendientes sin consumir intentos", async () => {
        const queue = new SunatJobQueue();
        const job = await queue.enqueue({
            tenantId,
            type: "POLL_TICKET",
            idempotencyKey: "ticket:pending",
            correlationId: "ticket:pending",
            payload: { tenantId, ownerType: "RESUMEN", ownerId: 1 },
            nextRunAt: new Date("2000-01-01T00:00:02Z"),
        });
        const claimed = await queue.claim("worker-pending");
        expect(claimed?.id).toBe(job.id);
        expect(claimed?.attempts).toBe(1);
        const nextRunAt = new Date("2026-08-02T12:02:00Z");
        await queue.defer(job.id, "worker-pending", nextRunAt, "SUNAT_TICKET_PENDING");
        const deferred = await platformPrisma.sunatJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(deferred.status).toBe("PENDING");
        expect(deferred.attempts).toBe(0);
        expect(deferred.nextRunAt).toEqual(nextRunAt);
        expect(deferred.lastErrorCode).toBe("SUNAT_TICKET_PENDING");
    });
});
