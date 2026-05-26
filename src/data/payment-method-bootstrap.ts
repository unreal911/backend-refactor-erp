import { prisma } from './prisma';

const PAYMENT_METHOD_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "PaymentMethod" (
        "id" SERIAL NOT NULL,
        "name" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "displayOrder" INTEGER NOT NULL DEFAULT 0,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "PaymentMethod_name_key" ON "PaymentMethod"("name")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "PaymentMethod_code_key" ON "PaymentMethod"("code")',
    'CREATE INDEX IF NOT EXISTS "PaymentMethod_isActive_idx" ON "PaymentMethod"("isActive")',
    'CREATE INDEX IF NOT EXISTS "PaymentMethod_displayOrder_idx" ON "PaymentMethod"("displayOrder")'
];

const DEFAULT_PAYMENT_METHODS: Array<{ name: string; code: string; displayOrder: number }> = [
    { name: 'Efectivo', code: 'EFECTIVO', displayOrder: 10 },
    { name: 'Tarjeta', code: 'TARJETA', displayOrder: 20 },
    { name: 'Yape', code: 'YAPE', displayOrder: 30 },
    { name: 'Plin', code: 'PLIN', displayOrder: 40 },
    { name: 'Transferencia', code: 'TRANSFERENCIA', displayOrder: 50 },
    { name: 'Nequi', code: 'NEQUI', displayOrder: 60 },
];

export async function ensurePaymentMethodSchema(): Promise<void> {
    for (const statement of PAYMENT_METHOD_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }

    for (const method of DEFAULT_PAYMENT_METHODS) {
        await prisma.$executeRawUnsafe(
            `INSERT INTO "PaymentMethod" ("name", "code", "displayOrder", "isActive", "updatedAt")
             VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)
             ON CONFLICT ("code") DO UPDATE
             SET "name" = EXCLUDED."name",
                 "displayOrder" = EXCLUDED."displayOrder",
                 "updatedAt" = CURRENT_TIMESTAMP`,
            method.name,
            method.code,
            method.displayOrder,
        );
    }
}
