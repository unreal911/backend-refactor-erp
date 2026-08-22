import { describe, expect, it } from "vitest";
import {
    verifyTenantPrismaArchitecture,
} from "../src/modules/tenant/tenant-prisma-verification";

describe("TEN-009: arquitectura Prisma tenant", () => {
    it("separa accesos empresariales y globales y parametriza tenantId", () => {
        const report = verifyTenantPrismaArchitecture();

        expect(report.operationalFiles).toBeGreaterThan(15);
        expect(report.directGlobalPrismaImports).toEqual([]);
        expect(report.unexpectedPlatformImports).toEqual([]);
        expect(report.unsafeTenantSqlInterpolation).toEqual([]);
        expect(report.jobPayloadValidated).toBe(true);
    });
});
