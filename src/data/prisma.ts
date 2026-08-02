import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { envs } from "../config/envs";
import { TenantDataContext } from "../modules/tenant/tenant-data-context";

const connectionString = envs.DATABASE_URL;

const adapter = new PrismaPg({ connectionString });
const basePrisma = new PrismaClient({ adapter });

const TENANT_MODELS = new Set([
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
    "TenantInvitation",
    "ComprobanteSerie",
    "Comprobante",
    "ComprobanteItem",
    "SunatDispatch",
    "ResumenDiario",
    "ComunicacionBaja",
    "SunatEmisorConfig",
]);

const READ_OPERATIONS = new Set([
    "findUnique",
    "findUniqueOrThrow",
    "findFirst",
    "findFirstOrThrow",
    "findMany",
    "count",
    "aggregate",
    "groupBy",
]);

const WRITE_WHERE_OPERATIONS = new Set([
    "update",
    "updateMany",
    "delete",
    "deleteMany",
]);

function isPlainObject(value: unknown): value is Record<string, any> {
    if (!value || typeof value !== "object") return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function tenantScopedCreatePayload(payload: any, tenantId: string): any {
    if (Array.isArray(payload)) {
        return payload.map((row) => tenantScopedCreatePayload(row, tenantId));
    }
    if (!isPlainObject(payload)) {
        return payload;
    }

    const scoped: Record<string, any> = {
        ...payload,
        tenantId,
    };
    for (const [key, value] of Object.entries(scoped)) {
        if (!value || typeof value !== "object") continue;

        if (key === "create") {
            scoped[key] = tenantScopedCreatePayload(value, tenantId);
            continue;
        }
        if (key === "createMany") {
            const createMany = value as Record<string, any>;
            scoped[key] = {
                ...createMany,
                data: tenantScopedCreatePayload(createMany.data, tenantId),
            };
            continue;
        }
        if (key === "connectOrCreate") {
            const connectOrCreate = value as Record<string, any>;
            scoped[key] = {
                ...connectOrCreate,
                create: tenantScopedCreatePayload(connectOrCreate.create, tenantId),
            };
            continue;
        }

        scoped[key] = tenantScopedNestedRelations(value, tenantId);
    }
    return scoped;
}

function tenantScopedNestedRelations(value: any, tenantId: string): any {
    if (Array.isArray(value)) {
        return value.map((item) => tenantScopedNestedRelations(item, tenantId));
    }
    if (!isPlainObject(value)) {
        return value;
    }

    const next: Record<string, any> = { ...value };
    for (const [key, inner] of Object.entries(next)) {
        if (key === "create") {
            next[key] = tenantScopedCreatePayload(inner, tenantId);
        } else if (key === "createMany" && inner && typeof inner === "object") {
            const createMany = inner as Record<string, any>;
            next[key] = {
                ...createMany,
                data: tenantScopedCreatePayload(createMany.data, tenantId),
            };
        } else if (inner && typeof inner === "object") {
            next[key] = tenantScopedNestedRelations(inner, tenantId);
        }
    }
    return next;
}

function tenantScopedArgs(operation: string, args: Record<string, any>, tenantId: string) {
    if (READ_OPERATIONS.has(operation) || WRITE_WHERE_OPERATIONS.has(operation)) {
        args.where = {
            ...(args.where ?? {}),
            tenantId,
        };
        return args;
    }

    if (operation === "create") {
        args.data = tenantScopedCreatePayload(args.data ?? {}, tenantId);
        return args;
    }

    if (operation === "createMany" || operation === "createManyAndReturn") {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        args.data = rows.map((row) => tenantScopedCreatePayload(row, tenantId));
        return args;
    }

    if (operation === "upsert") {
        args.where = {
            ...(args.where ?? {}),
            tenantId,
        };
        args.create = tenantScopedCreatePayload(args.create ?? {}, tenantId);
        return args;
    }

    return args;
}

const scopedPrisma = basePrisma.$extends({
    name: "tenant-data-scope",
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                const tenantId = TenantDataContext.currentTenantId();
                if (!tenantId || !model || !TENANT_MODELS.has(model)) {
                    return query(args);
                }

                return query(tenantScopedArgs(operation, args as Record<string, any>, tenantId));
            },
        },
    },
}) as unknown as PrismaClient;

function activeClient(): PrismaClient | Prisma.TransactionClient {
    return TenantDataContext.currentTransactionClient() ?? scopedPrisma;
}

const prisma = new Proxy(scopedPrisma, {
    get(_target, property) {
        const transactionClient =
            TenantDataContext.currentTransactionClient();

        if (transactionClient && property === "$transaction") {
            return async (
                input:
                    | Array<Promise<unknown>>
                    | ((tx: Prisma.TransactionClient) => Promise<unknown>),
            ) => {
                if (typeof input === "function") {
                    return input(transactionClient);
                }
                return Promise.all(input);
            };
        }

        const client = activeClient() as unknown as Record<
            PropertyKey,
            unknown
        >;
        const value = client[property];
        return typeof value === "function"
            ? value.bind(client)
            : value;
    },
}) as unknown as PrismaClient;

export async function runTenantDatabaseTransaction<T>(
    tenantId: string,
    callback: () => T | Promise<T>,
): Promise<T> {
    const normalizedTenantId = String(tenantId || "").trim();
    if (!normalizedTenantId) {
        throw new Error("tenantId requerido para abrir la transaccion RLS");
    }
    const activeTransaction = TenantDataContext.currentTransactionClient();
    if (activeTransaction) {
        if (TenantDataContext.requireTenantId() !== normalizedTenantId) {
            throw new Error(
                "No se puede cambiar de tenant dentro de una transaccion RLS",
            );
        }
        return callback();
    }

    return scopedPrisma.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe(
                `SET LOCAL ROLE "tienda_tenant_app"`,
            );
            await tx.$queryRawUnsafe(
                `SELECT set_config('app.tenant_id', $1, true)`,
                normalizedTenantId,
            );
            return TenantDataContext.runWithTransaction(
                normalizedTenantId,
                tx,
                callback,
            );
        },
        {
            maxWait: 10_000,
            timeout: 120_000,
        },
    );
}

const platformPrisma = basePrisma;
export const TENANT_PRISMA_RUNTIME_MARKER = true;

export { platformPrisma, prisma };
