import { prisma } from "../data/prisma";
import {
    verifyTenantPrismaArchitecture,
} from "../modules/tenant/tenant-prisma-verification";

async function main(): Promise<void> {
    const report = verifyTenantPrismaArchitecture();
    console.log(JSON.stringify(report, null, 2));

    if (
        report.directGlobalPrismaImports.length > 0
        || report.unexpectedPlatformImports.length > 0
        || report.unsafeTenantSqlInterpolation.length > 0
        || !report.jobPayloadValidated
    ) {
        throw new Error("La arquitectura Prisma tenant no cumple TEN-009");
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
