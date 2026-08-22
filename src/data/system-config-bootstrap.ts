import { prisma } from './prisma';
import {
    COMPANY_ADDRESS_KEY,
    COMPANY_EMAIL_KEY,
    COMPANY_LEGAL_NAME_KEY,
    COMPANY_LOGO_URL_KEY,
    COMPANY_NAME_KEY,
    COMPANY_PHONE_KEY,
    COMPANY_RUC_KEY,
    MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
    MARKETPLACE_INCLUDE_IGV_KEY,
    MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
    MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
    PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
} from './system-config-keys';

const SYSTEM_CONFIG_SCHEMA_STATEMENTS: string[] = [
    `CREATE TABLE IF NOT EXISTS "SystemSetting" (
        "id" SERIAL NOT NULL,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS "SystemSetting_key_key" ON "SystemSetting"("key")',
];

const DEFAULT_SYSTEM_SETTINGS: Array<{ key: string; value: string }> = [
    { key: RETURN_RESPONSIBILITY_MANAGEMENT_KEY, value: 'true' },
    { key: PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY, value: 'false' },
    { key: MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY, value: 'false' },
    { key: MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY, value: '[]' },
    { key: MARKETPLACE_INCLUDE_IGV_KEY, value: 'true' },
    { key: MARKETPLACE_AUTO_RESERVE_STOCK_KEY, value: 'false' },
    { key: COMPANY_NAME_KEY, value: 'B2B Marketplace' },
    { key: COMPANY_LEGAL_NAME_KEY, value: '' },
    { key: COMPANY_RUC_KEY, value: '' },
    { key: COMPANY_ADDRESS_KEY, value: '' },
    { key: COMPANY_PHONE_KEY, value: '' },
    { key: COMPANY_EMAIL_KEY, value: '' },
    { key: COMPANY_LOGO_URL_KEY, value: '' },
];

export async function ensureSystemConfigSchema(): Promise<void> {
    for (const statement of SYSTEM_CONFIG_SCHEMA_STATEMENTS) {
        await prisma.$executeRawUnsafe(statement);
    }

    await seedDefaultSystemSettings();
}

export async function seedDefaultSystemSettingsForTenant(
    tenantId: string,
    dbClient: Pick<typeof prisma, '$executeRawUnsafe'> = prisma,
    company: {
        name?: string;
        legalName?: string | null;
        ruc?: string | null;
        email?: string | null;
    } = {},
): Promise<void> {
    const tenantValues: Record<string, string | undefined> = {
        [COMPANY_NAME_KEY]: company.name,
        [COMPANY_LEGAL_NAME_KEY]: company.legalName ?? undefined,
        [COMPANY_RUC_KEY]: company.ruc ?? undefined,
        [COMPANY_EMAIL_KEY]: company.email ?? undefined,
    };
    for (const setting of DEFAULT_SYSTEM_SETTINGS) {
        await dbClient.$executeRawUnsafe(
            `INSERT INTO "SystemSetting" ("tenantId", "key", "value")
             VALUES ($1::uuid, $2, $3)
             ON CONFLICT ("tenantId", "key") DO NOTHING`,
            tenantId,
            setting.key,
            tenantValues[setting.key] ?? setting.value,
        );
    }
}

export async function seedDefaultSystemSettings(): Promise<void> {
    const tenants = await prisma.tenant.findMany({
        where: {
            status: { in: ['TRIAL', 'ACTIVE'] },
        },
        select: { id: true },
    });

    for (const tenant of tenants) {
        await seedDefaultSystemSettingsForTenant(tenant.id);
    }
}
