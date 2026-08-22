import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const OPERATIONAL_ROOTS = [
    "src/presentation/services",
    "src/modules/sunat/config",
    "src/modules/sunat/services",
];

const PLATFORM_SERVICE_FILES = new Set([
    "src/presentation/services/audit-log.service.ts",
    "src/presentation/services/auth.service.ts",
    "src/presentation/services/permission.service.ts",
    "src/presentation/services/role.service.ts",
    "src/presentation/services/user.service.ts",
]);

export type TenantPrismaVerification = {
    operationalFiles: number;
    directGlobalPrismaImports: string[];
    unexpectedPlatformImports: string[];
    unsafeTenantSqlInterpolation: string[];
    jobPayloadValidated: boolean;
};

function sourceFiles(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return entry.isFile() && path.endsWith(".ts") ? [path] : [];
    });
}

function normalizedRelative(root: string, path: string): string {
    return relative(root, path).replaceAll("\\", "/");
}

export function verifyTenantPrismaArchitecture(
    workspaceRoot = process.cwd(),
): TenantPrismaVerification {
    const files = OPERATIONAL_ROOTS.flatMap((root) =>
        sourceFiles(join(workspaceRoot, root))
    );
    const directGlobalPrismaImports: string[] = [];
    const unexpectedPlatformImports: string[] = [];
    const unsafeTenantSqlInterpolation: string[] = [];

    for (const file of files) {
        const name = normalizedRelative(workspaceRoot, file);
        const source = readFileSync(file, "utf8");
        if (/from\s+["'][^"']*data\/prisma["']/.test(source)) {
            directGlobalPrismaImports.push(name);
        }
        if (
            /from\s+["'][^"']*data\/platform-prisma["']/.test(source)
            && !PLATFORM_SERVICE_FILES.has(name)
        ) {
            unexpectedPlatformImports.push(name);
        }
        if (
            /\$(?:queryRawUnsafe|executeRawUnsafe)(?:<[^>]+>)?\(\s*`[\s\S]*?\$\{[^}]*tenantId/i
                .test(source)
        ) {
            unsafeTenantSqlInterpolation.push(name);
        }
    }

    const jobSource = readFileSync(
        join(workspaceRoot, "src/scripts/sunat-jobs.ts"),
        "utf8",
    );
    const jobPayloadValidated =
        /validateJobPayload\(/.test(jobSource)
        && /runTenantDatabaseTransaction\(payload\.tenantId/.test(jobSource);

    return {
        operationalFiles: files.length,
        directGlobalPrismaImports,
        unexpectedPlatformImports,
        unsafeTenantSqlInterpolation,
        jobPayloadValidated,
    };
}
