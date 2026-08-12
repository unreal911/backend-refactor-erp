import { describe, expect, it, vi } from "vitest";
import { seedDefaultPaymentMethodsForTenant } from "../src/data/payment-method-bootstrap";

describe("bootstrap de métodos de pago", () => {
    it("es idempotente ante conflicto por código o por nombre", async () => {
        const execute = vi.fn().mockResolvedValue(0);
        await seedDefaultPaymentMethodsForTenant(
            "00000000-0000-4000-8000-000000000001",
            { $executeRawUnsafe: execute } as never,
        );
        expect(execute).toHaveBeenCalledTimes(6);
        for (const [sql] of execute.mock.calls) {
            expect(sql).toContain("ON CONFLICT DO NOTHING");
            expect(sql).not.toContain('ON CONFLICT ("tenantId", "code")');
        }
    });
});
