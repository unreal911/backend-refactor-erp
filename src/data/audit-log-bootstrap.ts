import { prisma } from './prisma';

const AUDIT_LOG_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "AuditLog" (
        "id" SERIAL NOT NULL,
        "actorUserId" INTEGER,
        "actorEmail" TEXT,
        "actorRole" TEXT,
        "method" TEXT NOT NULL,
        "path" TEXT NOT NULL,
        "statusCode" INTEGER NOT NULL,
        "durationMs" INTEGER NOT NULL,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "requestQuery" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "requestParams" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "requestBody" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC)',
    'CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId")',
    'CREATE INDEX IF NOT EXISTS "AuditLog_method_idx" ON "AuditLog"("method")',
    'CREATE INDEX IF NOT EXISTS "AuditLog_statusCode_idx" ON "AuditLog"("statusCode")',
    'CREATE INDEX IF NOT EXISTS "AuditLog_path_idx" ON "AuditLog"("path")',
];

export async function ensureAuditLogSchema(): Promise<void> {
    for (const statement of AUDIT_LOG_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }
}
