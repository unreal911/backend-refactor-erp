import { prisma } from './prisma';

const MARKETPLACE_AUTH_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "MarketplaceCustomer" (
        "id" SERIAL NOT NULL,
        "firstName" TEXT NOT NULL,
        "lastName" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "phone" TEXT NOT NULL,
        "address" TEXT,
        "password" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MarketplaceCustomer_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceCustomer_email_key" ON "MarketplaceCustomer"(lower("email"))',
    'CREATE INDEX IF NOT EXISTS "MarketplaceCustomer_phone_idx" ON "MarketplaceCustomer"("phone")',
];

export async function ensureMarketplaceAuthSchema(): Promise<void> {
    for (const statement of MARKETPLACE_AUTH_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }

    await prisma.$executeRawUnsafe(
        'ALTER TABLE "MarketplaceCustomer" ADD COLUMN IF NOT EXISTS "address" TEXT',
    );
}
