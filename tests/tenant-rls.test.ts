import { afterAll, describe, expect, it } from "vitest";
import {
    prisma,
    runTenantDatabaseTransaction,
} from "../src/data/prisma";
import { tenantPrisma } from "../src/data/tenant-prisma";
import {
    RLS_TABLES,
    verifyTenantRls,
} from "../src/modules/tenant/tenant-rls-verification";
import {
    LEGACY_TENANT_ID,
    TenantDataContext,
} from "../src/modules/tenant/tenant-data-context";

describe("TEN-008: RLS forzado", () => {
    it("falla cerrado y aisla dos empresas con el rol de aplicacion", async () => {
        const summary = await verifyTenantRls();
        expect(summary.tablesWithForcedRls).toBe(RLS_TABLES.length);
        expect(summary.policies).toBe(RLS_TABLES.length);
        expect(summary.role.superuser).toBe(false);
        expect(summary.role.bypassRls).toBe(false);
        expect(summary.role.ownedTables).toBe(0);
        expect(summary.noContextRows).toBe(0);
        expect(summary.noContextWriteBlocked).toBe(true);
        expect(summary.companyARows).toBe(1);
        expect(summary.companyBRows).toBe(1);
        expect(summary.crossTenantUpdates).toBe(0);
        expect(summary.crossTenantWriteBlocked).toBe(true);
        expect(summary.poolContextCleared).toBe(true);
        expect(summary.prismaScopedRows).toBe(1);
        expect(summary.prismaCrossTenantUpdates).toBe(0);
    });

    it("rechaza el repositorio empresarial fuera de una unidad tenant RLS", async () => {
        expect(() => tenantPrisma.category.findMany()).toThrow(
            /Contexto tenant requerido/,
        );

        await expect(
            TenantDataContext.run(
                LEGACY_TENANT_ID,
                () => tenantPrisma.category.findMany(),
            ),
        ).rejects.toThrow(/Transaccion tenant RLS requerida/);

        const visibleRows = await runTenantDatabaseTransaction(
            LEGACY_TENANT_ID,
            () => tenantPrisma.category.count(),
        );
        expect(visibleRows).toBeGreaterThanOrEqual(0);

        expect(() => tenantPrisma.category.findMany()).toThrow(
            /Contexto tenant requerido/,
        );
    });
});

afterAll(async () => {
    await prisma.$disconnect();
});
