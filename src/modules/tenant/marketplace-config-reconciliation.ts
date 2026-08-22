import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const EXPECTED_KEYS = [
    "brand_display_mode",
    "company_address",
    "company_email",
    "company_legal_name",
    "company_logo_url",
    "company_name",
    "company_phone",
    "company_ruc",
    "marketplace_allowed_payment_method_ids",
    "marketplace_auto_reserve_stock_enabled",
    "marketplace_hero_heading",
    "marketplace_include_igv_enabled",
    "marketplace_payment_methods_enabled",
    "marketplace_product_variants_1",
    "picking_responsibility_flow_enabled",
    "pos_boleta_enabled",
    "pos_factura_enabled",
    "return_responsibility_management_enabled",
] as const;

const EXPECTED_FLAGS: Record<string, string> = {
    marketplace_auto_reserve_stock_enabled: "false",
    marketplace_include_igv_enabled: "false",
    marketplace_payment_methods_enabled: "false",
    picking_responsibility_flow_enabled: "true",
    pos_boleta_enabled: "true",
    pos_factura_enabled: "true",
    return_responsibility_management_enabled: "true",
};

const EXPECTED_METHODS = [
    { id: 1, name: "Efectivo", code: "EFECTIVO", displayOrder: 10, isActive: true },
    { id: 2, name: "Tarjeta", code: "TARJETA", displayOrder: 20, isActive: true },
    { id: 3, name: "Yape", code: "YAPE", displayOrder: 30, isActive: true },
    { id: 4, name: "Plin", code: "PLIN", displayOrder: 40, isActive: true },
    { id: 5, name: "Transferencia", code: "TRANSFERENCIA", displayOrder: 50, isActive: true },
    { id: 6, name: "Nequi", code: "NEQUI", displayOrder: 60, isActive: true },
] as const;

const BASELINE_FINGERPRINTS = {
    customers:
        "59df5801d9d607b23a049fd06d9745e32651d69574660203f2b66f3470fd0ef8",
    paymentMethods:
        "2ea8b29ec16c6470f588ee0698f7c3c9bc5af5cb4831778cb88042c522ce1afa",
    settings:
        "06e556c6aeadecbb47dfa70270b28b3a7fc22afa323f51ad0e4944028ddbffc6",
    tenantProfile:
        "b6c46ac451e860ab55fe6b3bff3d86ddd87ddbb796bd73bed986dbffed9da192",
} as const;

const TENANT_CONSTRAINTS = [
    "MarketplaceCustomer_tenantId_fkey",
    "PaymentMethod_tenantId_fkey",
    "SystemSetting_tenantId_fkey",
] as const;

const TENANT_INDEXES = [
    "MarketplaceCustomer_tenantId_email_key",
    "PaymentMethod_tenantId_name_key",
    "PaymentMethod_tenantId_code_key",
    "SystemSetting_tenantId_key_key",
] as const;

type SnapshotRow = {
    id: number;
    data: string;
};

type SealedIds = {
    marketplaceCustomerIds: number[];
    paymentMethodIds: number[];
    systemSettingIds: number[];
};

const BASELINE_IDS: SealedIds = {
    marketplaceCustomerIds: [
        1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26,
    ],
    paymentMethodIds: [1, 2, 3, 4, 5, 6],
    systemSettingIds: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 392, 718, 719, 720,
    ],
};

type CustomerData = {
    id: number;
    password: string;
    isActive: boolean;
    address: string | null;
    email: string;
};

type PaymentMethodData = {
    id: number;
    name: string;
    code: string;
    displayOrder: number;
    isActive: boolean;
};

type SettingData = {
    id: number;
    key: string;
    value: string;
};

export type MarketplaceConfigReconciliationSummary = SealedIds & {
    counts: {
        marketplaceCustomers: number;
        activeMarketplaceCustomers: number;
        customersWithAddress: number;
        paymentMethods: number;
        activePaymentMethods: number;
        systemSettings: number;
    };
    passwordEvidence: {
        bcryptCompatible: number;
        costGroups: Array<{ cost: number; count: number }>;
        duplicateEmails: number;
    };
    paymentMethods: Array<{
        id: number;
        name: string;
        code: string;
        displayOrder: number;
        isActive: boolean;
    }>;
    paymentMethodClassification: "TENANT_CONFIGURATION_CATALOG";
    paymentMethodIdMap: Record<string, number>;
    allowedPaymentMethodIds: number[];
    missingAllowedPaymentMethodIds: number[];
    effectiveFlags: Record<string, string>;
    settingClassifications: Array<{
        classification:
            | "COMPANY_PROFILE"
            | "WORKFLOW_FLAG"
            | "PAYMENT_METHOD_REFERENCE"
            | "MARKETPLACE_PRESENTATION"
            | "PRODUCT_VARIANT_PRESENTATION";
        count: number;
    }>;
    unknownSettings: Array<{
        key: string;
        decision: "MIGRATE_AS_TENANT_SETTING";
        jsonValid: boolean;
        referencedProductId: number;
        colorCount: number;
        sizeCount: number;
        colorImageCount: number;
        missingReferences: number;
    }>;
    tenantProfile: {
        present: Record<string, boolean>;
        mirroredFromSettings: Record<string, boolean>;
    };
    crossTenantReferences: number;
    tenantConstraintCount: number;
    tenantIndexCount: number;
    fingerprints: {
        customers: string;
        customerPasswords: string;
        paymentMethods: string;
        settings: string;
        tenantProfile: string;
        logicalConfiguration: string;
    };
};

function digest(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
}

function parseIds(value: unknown): number[] {
    return Array.isArray(value)
        ? value.filter(
            (entry): entry is number =>
                Number.isInteger(entry) && Number(entry) > 0,
        )
        : [];
}

function readSealedIds(details: Prisma.JsonValue | null): SealedIds | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const sealed = {
        marketplaceCustomerIds: parseIds(record.marketplaceCustomerIds),
        paymentMethodIds: parseIds(record.paymentMethodIds),
        systemSettingIds: parseIds(record.systemSettingIds),
    };
    return sealed.marketplaceCustomerIds.length === 14
        && sealed.paymentMethodIds.length === 6
        && sealed.systemSettingIds.length === 18
        ? sealed
        : null;
}

function hasCompletedEvidence(
    status: TenantMigrationStatus | undefined,
    details: Prisma.JsonValue | null | undefined,
): boolean {
    if (status === TenantMigrationStatus.COMPLETED) return true;
    return Boolean(
        details
        && typeof details === "object"
        && !Array.isArray(details)
        && (details as Record<string, unknown>).version === 1
        && (details as Record<string, unknown>).fingerprints,
    );
}

async function loadRows(
    tableName: "MarketplaceCustomer" | "PaymentMethod" | "SystemSetting",
    ids?: number[],
): Promise<SnapshotRow[]> {
    return prisma.$queryRawUnsafe<SnapshotRow[]>(
        `SELECT id, to_jsonb(t)::text AS data
         FROM "${tableName}" t
         WHERE "tenantId"=$1::uuid
           AND ($2::int[] IS NULL OR id=ANY($2::int[]))
         ORDER BY id`,
        LEGACY_TENANT_ID,
        ids ?? null,
    );
}

function parseRows<T>(rows: SnapshotRow[]): T[] {
    return rows.map((row) => JSON.parse(row.data) as T);
}

function normalize(value: unknown): string {
    return String(value ?? "").trim();
}

function bcryptCost(password: string): number | null {
    const match = password.match(/^\$2[aby]\$(\d{2})\$/);
    return match ? Number(match[1]) : null;
}

async function assertTenantConstraints(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{
        conname: string;
        convalidated: boolean;
    }>>`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE conname IN (${Prisma.join([...TENANT_CONSTRAINTS])})
    `;
    const found = new Set(rows.map((row) => row.conname));
    const missing = TENANT_CONSTRAINTS.filter((name) => !found.has(name));
    if (missing.length > 0 || rows.some((row) => !row.convalidated)) {
        throw new Error(
            `Restricciones tenant incompletas: ${missing.join(", ")}`,
        );
    }
    return rows.length;
}

async function assertTenantIndexes(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname=current_schema()
          AND indexname IN (${Prisma.join([...TENANT_INDEXES])})
    `;
    const found = new Set(rows.map((row) => row.indexname));
    const missing = TENANT_INDEXES.filter((name) => !found.has(name));
    if (missing.length > 0) {
        throw new Error(`Índices tenant incompletos: ${missing.join(", ")}`);
    }
    return rows.length;
}

async function validateDynamicSetting(
    setting: SettingData,
): Promise<MarketplaceConfigReconciliationSummary["unknownSettings"][number]> {
    const productId = Number(
        setting.key.replace("marketplace_product_variants_", ""),
    );
    let value: {
        colorIds?: unknown;
        sizeIds?: unknown;
        colorImages?: unknown;
    };
    try {
        value = JSON.parse(setting.value) as typeof value;
    } catch {
        throw new Error(`${setting.key} no contiene JSON válido`);
    }
    const colorIds = parseIds(value.colorIds);
    const sizeIds = parseIds(value.sizeIds);
    const colorImages = Array.isArray(value.colorImages)
        ? value.colorImages.filter(
            (entry): entry is { colorId: number; imageUrl: string } =>
                Boolean(entry)
                && typeof entry === "object"
                && Number.isInteger(
                    Number((entry as Record<string, unknown>).colorId),
                )
                && normalize(
                    (entry as Record<string, unknown>).imageUrl,
                ).length > 0,
        )
        : [];
    const [productCount, colorCount, sizeCount] = await Promise.all([
        prisma.product.count({
            where: { tenantId: LEGACY_TENANT_ID, id: productId },
        }),
        prisma.color.count({
            where: {
                tenantId: LEGACY_TENANT_ID,
                id: { in: colorIds },
            },
        }),
        prisma.size.count({
            where: {
                tenantId: LEGACY_TENANT_ID,
                id: { in: sizeIds },
            },
        }),
    ]);
    const imageColorIds = new Set(
        colorImages.map((entry) => Number(entry.colorId)),
    );
    const missingReferences =
        (productCount === 1 ? 0 : 1)
        + (colorIds.length - colorCount)
        + (sizeIds.length - sizeCount)
        + [...imageColorIds].filter((id) => !colorIds.includes(id)).length;
    return {
        key: setting.key,
        decision: "MIGRATE_AS_TENANT_SETTING",
        jsonValid: true,
        referencedProductId: productId,
        colorCount: colorIds.length,
        sizeCount: sizeIds.length,
        colorImageCount: colorImages.length,
        missingReferences,
    };
}

export async function inspectMarketplaceConfigMigration():
Promise<MarketplaceConfigReconciliationSummary> {
    const [checkpoint, dependency] = await Promise.all([
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-009",
                },
            },
            select: { details: true },
        }),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-008",
                },
            },
            select: { status: true, details: true },
        }),
    ]);
    if (!hasCompletedEvidence(
        dependency?.status,
        dependency?.details,
    )) {
        throw new Error("MIG-008 debe estar COMPLETED antes de MIG-009");
    }
    const sealed = readSealedIds(checkpoint?.details ?? null) ?? BASELINE_IDS;
    const [customerRows, paymentRows, settingRows] = await Promise.all([
        loadRows("MarketplaceCustomer", sealed.marketplaceCustomerIds),
        loadRows("PaymentMethod", sealed.paymentMethodIds),
        loadRows("SystemSetting", sealed.systemSettingIds),
    ]);
    if (
        customerRows.length !== 14
        || paymentRows.length !== 6
        || settingRows.length !== 18
    ) {
        throw new Error(
            `Conteos MIG-009 inesperados: `
            + `${customerRows.length}/${paymentRows.length}/`
            + settingRows.length,
        );
    }

    const customers = parseRows<CustomerData>(customerRows);
    const methods = parseRows<PaymentMethodData>(paymentRows);
    const settings = parseRows<SettingData>(settingRows);
    const settingMap = new Map(
        settings.map((setting) => [setting.key, setting.value]),
    );
    const actualKeys = settings
        .map((setting) => setting.key)
        .sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(actualKeys) !== JSON.stringify(EXPECTED_KEYS)) {
        throw new Error(
            `Inventario de SystemSetting inesperado: ${actualKeys.join(", ")}`,
        );
    }

    const methodSummary = methods
        .map((row) => ({
            id: Number(row.id),
            name: String(row.name),
            code: String(row.code),
            displayOrder: Number(row.displayOrder),
            isActive: Boolean(row.isActive),
        }))
        .sort((left, right) => left.displayOrder - right.displayOrder);
    if (JSON.stringify(methodSummary) !== JSON.stringify(EXPECTED_METHODS)) {
        throw new Error(
            `Catálogo de pagos inesperado: ${JSON.stringify(methodSummary)}`,
        );
    }

    const parsedAllowedIds = (() => {
        try {
            return parseIds(JSON.parse(
                settingMap.get(
                    "marketplace_allowed_payment_method_ids",
                ) ?? "[]",
            ));
        } catch {
            return [];
        }
    })();
    const paymentMethodIdMap = Object.fromEntries(
        methods.map((method) => [String(method.id), method.id]),
    );
    const mappedAllowedIds = parsedAllowedIds.map(
        (id) => paymentMethodIdMap[String(id)] ?? 0,
    );
    const activeMethodIds = new Set(
        methods.filter((row) => row.isActive).map((row) => Number(row.id)),
    );
    const missingAllowedPaymentMethodIds = mappedAllowedIds.filter(
        (id) => !activeMethodIds.has(id),
    );
    if (
        JSON.stringify(mappedAllowedIds) !== JSON.stringify([1, 2, 3, 4, 5, 6])
        || missingAllowedPaymentMethodIds.length > 0
    ) {
        throw new Error("La lista de métodos permitidos quedó inconsistente");
    }

    const effectiveFlags = Object.fromEntries(
        Object.keys(EXPECTED_FLAGS)
            .sort()
            .map((key) => [key, normalize(settingMap.get(key)).toLowerCase()]),
    );
    if (JSON.stringify(effectiveFlags) !== JSON.stringify(
        Object.fromEntries(Object.entries(EXPECTED_FLAGS).sort()),
    )) {
        throw new Error(
            `Flags efectivos inesperados: ${JSON.stringify(effectiveFlags)}`,
        );
    }

    const costs = new Map<number, number>();
    for (const customer of customers) {
        const cost = bcryptCost(customer.password);
        if (cost === null) continue;
        costs.set(cost, (costs.get(cost) ?? 0) + 1);
    }
    const costGroups = [...costs.entries()]
        .map(([cost, count]) => ({ cost, count }))
        .sort((left, right) => left.cost - right.cost);
    const duplicateEmails = customers.length - new Set(
        customers.map((row) => normalize(row.email).toLowerCase()),
    ).size;
    if (
        JSON.stringify(costGroups) !== JSON.stringify([{ cost: 10, count: 14 }])
        || duplicateEmails !== 0
    ) {
        throw new Error("Hashes o correos marketplace inesperados");
    }

    const dynamicSettings = settings.filter(
        (setting) => setting.key.startsWith(
            "marketplace_product_variants_",
        ),
    );
    const unknownSettings = await Promise.all(
        dynamicSettings.map(validateDynamicSetting),
    );
    if (
        unknownSettings.length !== 1
        || unknownSettings[0]?.key !== "marketplace_product_variants_1"
        || unknownSettings[0].colorCount !== 3
        || unknownSettings[0].sizeCount !== 4
        || unknownSettings[0].colorImageCount !== 3
        || unknownSettings[0].missingReferences !== 0
    ) {
        throw new Error(
            `Clave dinámica inesperada: ${JSON.stringify(unknownSettings)}`,
        );
    }

    const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: LEGACY_TENANT_ID },
        select: {
            id: true,
            name: true,
            legalName: true,
            ruc: true,
            address: true,
            contactPhone: true,
            contactEmail: true,
            logoUrl: true,
        },
    });
    const profilePairs = {
        name: [tenant.name, settingMap.get("company_name")],
        legalName: [
            tenant.legalName,
            settingMap.get("company_legal_name"),
        ],
        ruc: [tenant.ruc, settingMap.get("company_ruc")],
        address: [tenant.address, settingMap.get("company_address")],
        phone: [tenant.contactPhone, settingMap.get("company_phone")],
        email: [tenant.contactEmail, settingMap.get("company_email")],
        logo: [tenant.logoUrl, settingMap.get("company_logo_url")],
    } as const;
    const tenantProfile = {
        present: Object.fromEntries(
            Object.entries(profilePairs).map(
                ([key, [value]]) => [key, normalize(value).length > 0],
            ),
        ),
        mirroredFromSettings: Object.fromEntries(
            Object.entries(profilePairs).map(
                ([key, [value, setting]]) =>
                    [key, normalize(value) === normalize(setting)],
            ),
        ),
    };
    if (
        Object.values(tenantProfile.mirroredFromSettings)
            .some((matches) => !matches)
        || JSON.stringify(tenantProfile.present) !== JSON.stringify({
            name: true,
            legalName: true,
            ruc: false,
            address: true,
            phone: true,
            email: false,
            logo: true,
        })
    ) {
        throw new Error("El perfil Tenant no coincide con su origen");
    }

    const fingerprints = {
        customers: digest(customerRows.map((row) => row.data)),
        customerPasswords: digest(
            customers.map((row) => [row.id, row.password]),
        ),
        paymentMethods: digest(paymentRows.map((row) => row.data)),
        settings: digest(settingRows.map((row) => row.data)),
        tenantProfile: digest(tenant),
        logicalConfiguration: digest({
            methodSummary,
            mappedAllowedIds,
            effectiveFlags,
            unknownSettings,
            tenantProfile,
        }),
    };
    for (const [key, expected] of Object.entries(BASELINE_FINGERPRINTS)) {
        if (fingerprints[key as keyof typeof fingerprints] !== expected) {
            throw new Error(`Huella MIG-009 inesperada para ${key}`);
        }
    }

    const [tenantConstraintCount, tenantIndexCount, crossRows] =
        await Promise.all([
            assertTenantConstraints(),
            assertTenantIndexes(),
            prisma.$queryRaw<Array<{ count: number }>>`
                SELECT (
                    (SELECT COUNT(*)
                     FROM "MarketplaceCustomer" row
                     LEFT JOIN "Tenant" tenant ON tenant.id=row."tenantId"
                     WHERE row."tenantId"=${LEGACY_TENANT_ID}::uuid
                       AND tenant.id IS NULL)
                    +
                    (SELECT COUNT(*)
                     FROM "PaymentMethod" row
                     LEFT JOIN "Tenant" tenant ON tenant.id=row."tenantId"
                     WHERE row."tenantId"=${LEGACY_TENANT_ID}::uuid
                       AND tenant.id IS NULL)
                    +
                    (SELECT COUNT(*)
                     FROM "SystemSetting" row
                     LEFT JOIN "Tenant" tenant ON tenant.id=row."tenantId"
                     WHERE row."tenantId"=${LEGACY_TENANT_ID}::uuid
                       AND tenant.id IS NULL)
                )::int AS count
            `,
        ]);
    const crossTenantReferences = Number(crossRows[0]?.count ?? 0);
    if (crossTenantReferences !== 0) {
        throw new Error("Existen filas de configuración sin tenant");
    }

    return {
        marketplaceCustomerIds: customerRows.map((row) => row.id),
        paymentMethodIds: paymentRows.map((row) => row.id),
        systemSettingIds: settingRows.map((row) => row.id),
        counts: {
            marketplaceCustomers: customers.length,
            activeMarketplaceCustomers:
                customers.filter((row) => row.isActive).length,
            customersWithAddress:
                customers.filter((row) => normalize(row.address)).length,
            paymentMethods: methods.length,
            activePaymentMethods:
                methods.filter((row) => row.isActive).length,
            systemSettings: settings.length,
        },
        passwordEvidence: {
            bcryptCompatible: [...costs.values()].reduce(
                (sum, count) => sum + count,
                0,
            ),
            costGroups,
            duplicateEmails,
        },
        paymentMethods: methodSummary,
        paymentMethodClassification: "TENANT_CONFIGURATION_CATALOG",
        paymentMethodIdMap,
        allowedPaymentMethodIds: mappedAllowedIds,
        missingAllowedPaymentMethodIds,
        effectiveFlags,
        settingClassifications: [
            { classification: "COMPANY_PROFILE", count: 7 },
            { classification: "WORKFLOW_FLAG", count: 7 },
            { classification: "PAYMENT_METHOD_REFERENCE", count: 1 },
            { classification: "MARKETPLACE_PRESENTATION", count: 2 },
            { classification: "PRODUCT_VARIANT_PRESENTATION", count: 1 },
        ],
        unknownSettings,
        tenantProfile,
        crossTenantReferences,
        tenantConstraintCount,
        tenantIndexCount,
        fingerprints,
    };
}

export async function reconcileMarketplaceConfigMigration():
Promise<MarketplaceConfigReconciliationSummary> {
    const [checkpoint, dependency] = await Promise.all([
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-009",
                },
            },
        }),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-008",
                },
            },
        }),
    ]);
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-009");
    if (!hasCompletedEvidence(
        dependency?.status,
        dependency?.details,
    )) {
        throw new Error("MIG-008 debe estar COMPLETED antes de MIG-009");
    }

    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? new Date(),
            completedAt: null,
        },
    });
    try {
        const summary = await inspectMarketplaceConfigMigration();
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt: new Date(),
                details: {
                    version: 1,
                    transformation: "IN_PLACE",
                    tenantId: LEGACY_TENANT_ID,
                    policy:
                        "docs/migration/marketplace-config-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
                    ...summary,
                } as Prisma.InputJsonObject,
            },
        });
        return summary;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.FAILED,
                completedAt: null,
                details: {
                    version: 1,
                    policy:
                        "docs/migration/marketplace-config-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
