import { prisma } from './prisma';

const USER_ACTIVITY_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "UserActivityLog" (
        "id" SERIAL NOT NULL,
        "userId" INTEGER,
        "userEmail" TEXT,
        "userRole" TEXT,
        "module" TEXT NOT NULL,
        "actionType" TEXT NOT NULL,
        "actionLabel" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" INTEGER,
        "entityCode" TEXT,
        "description" TEXT,
        "products" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UserActivityLog_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE INDEX IF NOT EXISTS "UserActivityLog_createdAt_idx" ON "UserActivityLog"("createdAt" DESC)',
    'CREATE INDEX IF NOT EXISTS "UserActivityLog_userId_idx" ON "UserActivityLog"("userId")',
    'CREATE INDEX IF NOT EXISTS "UserActivityLog_module_idx" ON "UserActivityLog"("module")',
    'CREATE INDEX IF NOT EXISTS "UserActivityLog_actionType_idx" ON "UserActivityLog"("actionType")',
    'CREATE INDEX IF NOT EXISTS "UserActivityLog_entity_idx" ON "UserActivityLog"("entityType", "entityId")',
];

export async function ensureUserActivitySchema(): Promise<void> {
    for (const statement of USER_ACTIVITY_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }
}
