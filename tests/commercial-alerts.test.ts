import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPaymentAlert, buildQuotaAlert, commercialAlertThreshold } from "../src/modules/lifecycle/commercial-alert.service";

describe("alertas comerciales", () => {
    it("acompaña el pago desde revisión hasta aprobación", () => {
        const request = { id: "payment-1", code: "PAY-001", planVersion: { plan: { displayName: "Negocio" } } };
        expect(buildPaymentAlert({ ...request, status: "PENDING_REVIEW" })).toMatchObject({
            key: "payment:payment-1", type: "PAYMENT_REVIEW", title: "Tu pago está en revisión", percent: 10,
        });
        expect(buildPaymentAlert({ ...request, status: "APPROVED" })).toMatchObject({
            key: "payment:payment-1", type: "PAYMENT_APPROVED", severity: "SUCCESS", title: "Pago realizado", percent: 20,
        });
        expect(buildPaymentAlert({ ...request, status: "REJECTED" })).toBeNull();
    });

    it("usa el contrato RLS app.tenant_id compartido por el runtime", () => {
        const migration = readFileSync(resolve(
            process.cwd(),
            "prisma/migrations/20260813210000_fix_commercial_alert_rls/migration.sql",
        ), "utf8");
        const statements = migration
            .split("\n")
            .filter((line) => !line.trimStart().startsWith("--"))
            .join("\n");
        expect(statements).toContain('"current_tenant_id"()');
        expect(statements).not.toContain("app.current_tenant_id");
    });

    it("escala en 70, 85 y 100 por ciento", () => {
        expect(commercialAlertThreshold(69)).toBeNull();
        expect(commercialAlertThreshold(70)).toBe(70);
        expect(commercialAlertThreshold(91)).toBe(85);
        expect(commercialAlertThreshold(100)).toBe(100);
    });

    it("genera una alerta estable con consumo y limite", () => {
        expect(buildQuotaAlert("products", "Productos", 18, 20)).toMatchObject({
            key: "quota:products",
            severity: "WARNING",
            percent: 85,
            metadata: { used: "18", limit: "20", actualPercent: 90 },
        });
    });

    it("usa umbrales 75 y 80 para almacenamiento", () => {
        expect(buildQuotaAlert("storage", "Almacenamiento", 79n, 100n, [75, 80, 100])).toMatchObject({ percent: 75 });
        expect(buildQuotaAlert("storage", "Almacenamiento", 80n, 100n, [75, 80, 100])).toMatchObject({ percent: 80 });
    });
});
