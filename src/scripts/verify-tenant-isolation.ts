import { Prisma } from "@prisma/client";
import { runStartupBootstraps } from "../bootstrap/startup";
import { envs } from "../config/envs";
import { prisma } from "../data/prisma";
import {
    LEGACY_TENANT_ID,
    TenantDataContext,
} from "../modules/tenant/tenant-data-context";

const TENANT_TABLES = [
    "Category",
    "Color",
    "Size",
    "Product",
    "ProductImage",
    "ProductVariant",
    "Store",
    "Inventory",
    "InventoryMovement",
    "StockTransfer",
    "StockTransferItem",
    "Reservation",
    "PickingSession",
    "PickingItem",
    "Order",
    "OrderItem",
    "OrderReturn",
    "OrderReturnItem",
    "PaymentMethod",
    "SystemSetting",
    "MarketplaceCustomer",
    "UserActivityLog",
    "PickingSharedResponsibility",
    "PickingResponsibilityRequest",
    "PickingItemContribution",
    "PickingUnpickRequest",
    "PickingOrderItemDetail",
    "ComprobanteSerie",
    "Comprobante",
    "ComprobanteItem",
    "SunatDispatch",
    "ResumenDiario",
    "ComunicacionBaja",
    "SunatEmisorConfig",
] as const;

class ExpectedRollback extends Error {}

async function verifyTwoTenantScope(): Promise<void> {
    const owner = await prisma.user.findFirst({
        where: { isActive: true },
        select: { id: true },
    });
    if (!owner) {
        throw new Error("Se requiere un usuario activo para verificar aislamiento");
    }

    const suffix = Date.now().toString(36);
    try {
        await prisma.$transaction(async (tx) => {
            const tenantB = await tx.tenant.create({
                data: {
                    slug: `verify-isolation-${suffix}`,
                    name: `Verify isolation ${suffix}`,
                    status: "TRIAL",
                    trialStartedAt: new Date(),
                    trialEndsAt: new Date(Date.now() + 86_400_000),
                },
            });
            await tx.tenantMembership.create({
                data: {
                    tenantId: tenantB.id,
                    userId: owner.id,
                    role: "OWNER",
                    status: "ACTIVE",
                    activatedAt: new Date(),
                },
            });

            const sharedCategory = `VERIFY-CATEGORY-${suffix}`;
            const sharedStoreCode = `VERIFY-STORE-${suffix}`;
            const sharedSku = `VERIFY-SKU-${suffix}`;

            const companyA = await TenantDataContext.run(LEGACY_TENANT_ID, async () => {
                const category = await tx.category.create({ data: { name: sharedCategory } });
                const store = await tx.store.create({
                    data: { name: "Verify A", code: sharedStoreCode },
                });
                const product = await tx.product.create({
                    data: {
                        name: `Verify product A ${suffix}`,
                        categoryId: category.id,
                        variants: {
                            create: {
                                sku: sharedSku,
                                price: 10,
                            },
                        },
                    },
                    include: { variants: true },
                });
                return { category, store, product, variant: product.variants[0]! };
            });

            const companyB = await TenantDataContext.run(tenantB.id, async () => {
                const category = await tx.category.create({ data: { name: sharedCategory } });
                const store = await tx.store.create({
                    data: { name: "Verify B", code: sharedStoreCode },
                });
                const product = await tx.product.create({
                    data: {
                        name: `Verify product B ${suffix}`,
                        categoryId: category.id,
                        variants: {
                            create: {
                                sku: sharedSku,
                                price: 20,
                            },
                        },
                    },
                    include: { variants: true },
                });
                return { category, store, product, variant: product.variants[0]! };
            });

            if (
                companyA.variant.tenantId !== LEGACY_TENANT_ID
                || companyB.variant.tenantId !== tenantB.id
            ) {
                throw new Error("La escritura anidada no propago tenantId");
            }

            const visibleFromA = await TenantDataContext.run(
                LEGACY_TENANT_ID,
                async () => await tx.product.findUnique({ where: { id: companyB.product.id } }),
            );
            if (visibleFromA !== null) {
                throw new Error("Empresa A pudo leer un producto de Empresa B");
            }

            const crossUpdate = await TenantDataContext.run(
                LEGACY_TENANT_ID,
                async () => await tx.store.updateMany({
                    where: { id: companyB.store.id },
                    data: { name: "cross-tenant-write" },
                }),
            );
            if (crossUpdate.count !== 0) {
                throw new Error("Empresa A pudo mutar una tienda de Empresa B");
            }

            throw new ExpectedRollback();
        });
    } catch (error) {
        if (error instanceof ExpectedRollback) return;
        throw error;
    }
}

async function verifyCrossRelationRejected(): Promise<void> {
    const owner = await prisma.user.findFirst({
        where: { isActive: true },
        select: { id: true },
    });
    if (!owner) throw new Error("Usuario de verificacion no disponible");

    const suffix = `${Date.now().toString(36)}-cross`;
    try {
        await prisma.$transaction(async (tx) => {
            const tenantB = await tx.tenant.create({
                data: {
                    slug: `verify-${suffix}`,
                    name: `Verify ${suffix}`,
                    status: "TRIAL",
                    trialStartedAt: new Date(),
                    trialEndsAt: new Date(Date.now() + 86_400_000),
                },
            });
            await tx.tenantMembership.create({
                data: {
                    tenantId: tenantB.id,
                    userId: owner.id,
                    role: "OWNER",
                    status: "ACTIVE",
                    activatedAt: new Date(),
                },
            });

            const companyB = await TenantDataContext.run(tenantB.id, async () => {
                const category = await tx.category.create({
                    data: { name: `Cross category ${suffix}` },
                });
                const store = await tx.store.create({
                    data: { name: `Cross store ${suffix}`, code: `CROSS-${suffix}` },
                });
                const product = await tx.product.create({
                    data: {
                        name: `Cross product ${suffix}`,
                        categoryId: category.id,
                        variants: {
                            create: {
                                sku: `CROSS-SKU-${suffix}`,
                                price: 10,
                            },
                        },
                    },
                    include: { variants: true },
                });
                return { store, variant: product.variants[0]! };
            });

            await TenantDataContext.run(
                LEGACY_TENANT_ID,
                async () => await tx.inventory.create({
                    data: {
                        storeId: companyB.store.id,
                        variantId: companyB.variant.id,
                        stock: 1,
                    },
                }),
            );
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Relacion cruzada de tenant|constraint/i.test(message)) return;
        throw error;
    }
    throw new Error("PostgreSQL no rechazo una relacion cruzada");
}

async function main(): Promise<void> {
    await runStartupBootstraps(envs.DATABASE_URL);

    const [columns, constraints, invalidAudit, checkpoints] = await Promise.all([
        prisma.$queryRaw<Array<{ table_name: string; is_nullable: string }>>(
            Prisma.sql`
                SELECT table_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND column_name = 'tenantId'
                  AND table_name IN (${Prisma.join(TENANT_TABLES)})
            `,
        ),
        prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`
                SELECT COUNT(*)::bigint AS count
                FROM pg_constraint
                WHERE connamespace = current_schema()::regnamespace
                  AND conname LIKE '%\_tenant\_fkey' ESCAPE '\'
            `,
        ),
        prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`
                SELECT COUNT(*)::bigint AS count
                FROM "AuditLog"
                WHERE ("dataScope" = 'TENANT' AND "tenantId" IS NULL)
                   OR ("dataScope" IN ('PLATFORM', 'QUARANTINE') AND "tenantId" IS NOT NULL)
            `,
        ),
        prisma.tenantMigrationCheckpoint.count({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: {
                    in: [
                        "MIG-004",
                        "MIG-005",
                        "MIG-006",
                        "MIG-007",
                        "MIG-008",
                        "MIG-009",
                        "MIG-010",
                        "MIG-011",
                    ],
                },
                status: "COMPLETED",
            },
        }),
    ]);

    const columnByTable = new Map(columns.map((column) => [column.table_name, column]));
    const missing = TENANT_TABLES.filter((table) => !columnByTable.has(table));
    const nullable = columns.filter((column) => column.is_nullable !== "NO");
    if (missing.length || nullable.length) {
        throw new Error(
            `tenantId incompleto: faltan=${missing.join(",") || "ninguna"}, nullable=${nullable.map((row) => row.table_name).join(",") || "ninguna"}`,
        );
    }
    if (Number(invalidAudit[0]?.count ?? 0n) !== 0) {
        throw new Error("AuditLog contiene clasificaciones tenant invalidas");
    }
    if (checkpoints !== 8) {
        throw new Error(`Checkpoints completados inesperados: ${checkpoints}/8`);
    }

    await verifyTwoTenantScope();
    await verifyCrossRelationRejected();

    console.info("[tenant-isolation] READY");
    console.info(`[tenant-isolation] Tablas con tenantId NOT NULL: ${TENANT_TABLES.length}`);
    console.info(`[tenant-isolation] Restricciones compuestas: ${Number(constraints[0]?.count ?? 0n)}`);
    console.info("[tenant-isolation] SKU/codigo repetible entre empresas: verificado");
    console.info("[tenant-isolation] Lectura, mutacion y relacion cruzadas: bloqueadas");
    console.info("[tenant-isolation] AuditLog TENANT/PLATFORM/QUARANTINE: consistente");
}

main()
    .catch((error) => {
        console.error("[tenant-isolation] FAILED", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
