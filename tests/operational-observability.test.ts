import { createHash } from "node:crypto";
import { Router } from "express";
import { afterAll, describe, expect, it, vi } from "vitest";
import { platformPrisma } from "../src/data/platform-prisma";
import {
    OperationalMetrics,
    summarizeTrialUsage,
} from "../src/modules/operations/operational-metrics";
import { operationalLog } from "../src/presentation/observability/operational-logger";
import { createExpressApp } from "../src/presentation/server";

describe("observabilidad operativa", () => {
    it("propaga o crea correlation ID UUID en todas las respuestas HTTP", async () => {
        const app = createExpressApp({ routes: Router(), public_path: "public-inexistente" });
        const listener = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => listener.once("listening", resolve));
        const address = listener.address();
        if (!address || typeof address === "string") throw new Error("Listener sin puerto TCP");
        try {
            const generated = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
                headers: { "x-correlation-id": "valor-no-valido" },
            });
            expect(generated.headers.get("x-correlation-id"))
                .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

            const supplied = "3f3ad780-d157-4d6c-8f34-b65480067fc8";
            const propagated = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
                headers: { "x-correlation-id": supplied },
            });
            expect(propagated.headers.get("x-correlation-id")).toBe(supplied);
        } finally {
            await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
        }
    });

    it("cubre API, DB, cola, SUNAT, S3 y KMS sin usar RUC como etiqueta", async () => {
        OperationalMetrics.observeApi("00000000-0000-4000-8000-000000000001", 200, 12);
        OperationalMetrics.observeDependency("S3", "put", true, 20);
        OperationalMetrics.observeDependency("KMS", "decrypt", true, 15);
        OperationalMetrics.observeDependency("SUNAT", "sendBill", false, 25);
        const snapshot = await OperationalMetrics.snapshot(new Date("2026-08-02T00:00:00Z"));
        expect(snapshot).toMatchObject({
            api: { requests: expect.any(Number) },
            database: { ok: true },
            queue: { byStatus: expect.any(Object) },
            sunat: { calls: { operations: expect.any(Number) } },
            s3: { calls: { operations: expect.any(Number) } },
            kms: { calls: { operations: expect.any(Number) } },
            alerts: { policy: { channel: expect.any(String), runbook: expect.any(String) } },
        });
        const serialized = JSON.stringify(snapshot);
        expect(serialized).not.toMatch(/"ruc"\s*:/i);
        expect(createHash("sha256").update(serialized).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
        expect(summarizeTrialUsage({
            tenantId: "3f3ad780-d157-4d6c-8f34-b65480067fc8",
            usersUsed: 1n,
            productsUsed: 80n,
            ordersUsed: 10n,
            storageUsed: 50n,
            maxUsers: 1,
            maxProducts: 100,
            maxOrders: 250,
            maxStorageBytes: 100n,
            jobErrors: 2n,
        })).toEqual(expect.objectContaining({
            tenantId: "3f3ad780-d157-4d6c-8f34-b65480067fc8",
            highestQuotaRatio: 1,
            failedJobs: 2,
        }));
    });

    it("redacta conexiones, tokens, XML y secretos antes de escribir logs", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        operationalLog("error", "job.failed", {
            correlationId: "3f3ad780-d157-4d6c-8f34-b65480067fc8",
            idempotencyKey: "sale:42",
            error: "postgresql://user:pass@host/db token=abc123",
            xml: "<Invoice><Secret>valor</Secret></Invoice>",
            solPassword: "MODDATOS",
        });
        const line = String(spy.mock.calls[0]?.[0] ?? "");
        spy.mockRestore();
        expect(line).toContain("3f3ad780-d157-4d6c-8f34-b65480067fc8");
        expect(line).toContain("sale:42");
        expect(line).not.toContain("user:pass");
        expect(line).not.toContain("abc123");
        expect(line).not.toContain("<Invoice>");
        expect(line).not.toContain("MODDATOS");
    });
});

afterAll(async () => {
    await platformPrisma.$disconnect().catch(() => undefined);
});
