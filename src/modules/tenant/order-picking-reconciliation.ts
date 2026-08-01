import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const TABLES = {
    orderIds: "Order",
    orderItemIds: "OrderItem",
    reservationIds: "Reservation",
    pickingSessionIds: "PickingSession",
    pickingItemIds: "PickingItem",
    sharedResponsibilityIds: "PickingSharedResponsibility",
    responsibilityRequestIds: "PickingResponsibilityRequest",
    contributionIds: "PickingItemContribution",
    unpickRequestIds: "PickingUnpickRequest",
    orderItemDetailIds: "PickingOrderItemDetail",
} as const;

type SealedOrderPickingIds = {
    [Key in keyof typeof TABLES]: number[];
};

type SnapshotRow = {
    id: number;
    data: string;
};

type StateGroup = {
    scope: string;
    status: string;
    count: number;
};

type OrderPickingTotals = {
    orderSubtotal: string;
    orderTax: string;
    orderTotal: string;
    itemQuantity: number;
    itemReserved: number;
    itemPicked: number;
    itemShortage: number;
    itemReturned: number;
    itemSubtotal: string;
    reservationQuantity: number;
    pickingQuantity: number;
    pickingPicked: number;
    contributionQuantity: number;
    detailPicked: number;
};

const BASELINE_COUNTS: Record<keyof SealedOrderPickingIds, number> = {
    orderIds: 42,
    orderItemIds: 106,
    reservationIds: 161,
    pickingSessionIds: 14,
    pickingItemIds: 14,
    sharedResponsibilityIds: 0,
    responsibilityRequestIds: 0,
    contributionIds: 1,
    unpickRequestIds: 0,
    orderItemDetailIds: 99,
};

const BASELINE_TOTALS: OrderPickingTotals = {
    orderSubtotal: "4240.00",
    orderTax: "510.48",
    orderTotal: "4750.48",
    itemQuantity: 265,
    itemReserved: 235,
    itemPicked: 121,
    itemShortage: 12,
    itemReturned: 0,
    itemSubtotal: "4762.00",
    reservationQuantity: 356,
    pickingQuantity: 131,
    pickingPicked: 95,
    contributionQuantity: 4,
    detailPicked: 118,
};

const BASELINE_STATES: StateGroup[] = [
    { scope: "Order", status: "CANCELLED", count: 17 },
    { scope: "Order", status: "DELIVERED", count: 25 },
    { scope: "OrderItem", status: "PARTIAL", count: 3 },
    { scope: "OrderItem", status: "PENDING", count: 52 },
    { scope: "OrderItem", status: "PICKED", count: 51 },
    { scope: "PickingSession", status: "CANCELLED", count: 7 },
    { scope: "PickingSession", status: "COMPLETED", count: 7 },
    { scope: "Reservation", status: "COMPLETED", count: 37 },
    { scope: "Reservation", status: "RELEASED", count: 124 },
];

const TENANT_CONSTRAINTS = [
    "Reservation_inventory_tenant_fkey",
    "Reservation_variant_tenant_fkey",
    "Reservation_order_tenant_fkey",
    "Reservation_order_item_tenant_fkey",
    "Reservation_user_tenant_fkey",
    "PickingSession_order_tenant_fkey",
    "PickingSession_user_tenant_fkey",
    "PickingItem_session_tenant_fkey",
    "PickingItem_variant_tenant_fkey",
    "Order_source_store_tenant_fkey",
    "Order_fulfillment_store_tenant_fkey",
    "Order_seller_tenant_fkey",
    "Order_picker_tenant_fkey",
    "Order_dispenser_tenant_fkey",
    "Order_cancelled_by_tenant_fkey",
    "Order_return_responsible_tenant_fkey",
    "Order_return_delegated_by_tenant_fkey",
    "OrderItem_order_tenant_fkey",
    "OrderItem_variant_tenant_fkey",
    "OrderItem_store_tenant_fkey",
    "OrderItem_removed_by_tenant_fkey",
    "PickingSharedResponsibility_order_tenant_fkey",
    "PickingSharedResponsibility_user_tenant_fkey",
    "PickingSharedResponsibility_assigner_tenant_fkey",
    "PickingResponsibilityRequest_order_tenant_fkey",
    "PickingResponsibilityRequest_requester_tenant_fkey",
    "PickingResponsibilityRequest_resolver_tenant_fkey",
    "PickingItemContribution_order_tenant_fkey",
    "PickingItemContribution_item_tenant_fkey",
    "PickingItemContribution_user_tenant_fkey",
    "PickingUnpickRequest_order_tenant_fkey",
    "PickingUnpickRequest_item_tenant_fkey",
    "PickingUnpickRequest_requester_tenant_fkey",
    "PickingUnpickRequest_resolver_tenant_fkey",
    "PickingOrderItemDetail_order_tenant_fkey",
    "PickingOrderItemDetail_order_item_tenant_fkey",
    "PickingOrderItemDetail_picking_item_tenant_fkey",
    "PickingOrderItemDetail_variant_tenant_fkey",
] as const;

export type OrderPickingReconciliationSummary = SealedOrderPickingIds & {
    counts: {
        orders: number;
        orderItems: number;
        reservations: number;
        pickingSessions: number;
        pickingItems: number;
        sharedResponsibilities: number;
        responsibilityRequests: number;
        contributions: number;
        unpickRequests: number;
        orderItemDetails: number;
    };
    totals: OrderPickingTotals;
    stateGroups: StateGroup[];
    ordersWithIdempotencyKey: number;
    removedItems: {
        count: number;
        withReason: number;
        withNote: number;
        withResponsible: number;
        withResponsibleName: number;
    };
    crossTenantReferences: number;
    tenantConstraintCount: number;
    invalidPickingRows: Array<{
        id: number;
        orderId: number;
        quantity: number;
        pickedQuantity: number;
        excess: number;
    }>;
    pickingGuardValidated: boolean;
    quarantinedDifferences: Array<{
        code: "QUARANTINED_LEGACY_PICKING_OVERFLOW";
        rowId: number;
        excess: number;
    }>;
    fingerprints: Record<string, string> & {
        logicalOperations: string;
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

function readSealedIds(
    details: Prisma.JsonValue | null,
): SealedOrderPickingIds | null {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        return null;
    }
    const record = details as Record<string, unknown>;
    const sealed = Object.fromEntries(
        Object.keys(TABLES).map((key) => [key, parseIds(record[key])]),
    ) as SealedOrderPickingIds;
    return sealed.orderIds.length > 0
        && sealed.orderItemIds.length > 0
        && sealed.reservationIds.length > 0
        && sealed.pickingSessionIds.length > 0
        && sealed.pickingItemIds.length > 0
        && sealed.orderItemDetailIds.length > 0
        ? sealed
        : null;
}

async function loadSnapshotRows(tableName: string): Promise<SnapshotRow[]> {
    const operationalRows = await prisma.$queryRawUnsafe<SnapshotRow[]>(
        `SELECT id, to_jsonb(t)::text AS data
         FROM "${tableName}" t
         WHERE "tenantId" = $1::uuid
         ORDER BY id`,
        LEGACY_TENANT_ID,
    );
    if (
        tableName !== "PickingItem"
        && tableName !== "PickingOrderItemDetail"
    ) {
        return operationalRows;
    }
    const quarantineTable = await prisma.$queryRawUnsafe<Array<{
        exists: boolean;
    }>>(
        `SELECT to_regclass(
            current_schema() || '."TenantMigrationQuarantine"'
         ) IS NOT NULL AS exists`,
    );
    if (!quarantineTable[0]?.exists) return operationalRows;

    const archivedRows = tableName === "PickingItem"
        ? await prisma.$queryRawUnsafe<SnapshotRow[]>(
            `SELECT
                ("originalData"->>'id')::int AS id,
                "originalData"::text AS data
             FROM "TenantMigrationQuarantine"
             WHERE "tenantId"=$1::uuid
               AND "storyId"='MIG-011'
               AND "sourceTable"='PickingItem'
               AND "sourceKey"='8'
               AND "reasonCode"=
                   'QUARANTINED_LEGACY_PICKING_OVERFLOW'`,
            LEGACY_TENANT_ID,
        )
        : await prisma.$queryRawUnsafe<SnapshotRow[]>(
            `SELECT
                (detail.value->>'id')::int AS id,
                detail.value::text AS data
             FROM "TenantMigrationQuarantine" quarantine
             CROSS JOIN LATERAL jsonb_array_elements(
                 quarantine."relatedData"->'pickingOrderItemDetails'
             ) detail(value)
             WHERE quarantine."tenantId"=$1::uuid
               AND quarantine."storyId"='MIG-011'
               AND quarantine."sourceTable"='PickingItem'
               AND quarantine."sourceKey"='8'
               AND quarantine."reasonCode"=
                   'QUARANTINED_LEGACY_PICKING_OVERFLOW'`,
            LEGACY_TENANT_ID,
        );
    const logicalRows = new Map(
        operationalRows.map((row) => [row.id, row]),
    );
    for (const archivedRow of archivedRows) {
        logicalRows.set(archivedRow.id, archivedRow);
    }
    return [...logicalRows.values()].sort((left, right) => left.id - right.id);
}

function selectedRows(
    rows: SnapshotRow[],
    ids: number[] | undefined,
): SnapshotRow[] {
    if (!ids) return rows;
    const selected = new Set(ids);
    return rows.filter((row) => selected.has(row.id));
}

function parsed(rows: SnapshotRow[]): Array<Record<string, unknown>> {
    return rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
}

function numeric(row: Record<string, unknown>, key: string): number {
    return Number(row[key] ?? 0);
}

function moneyTotal(
    rows: Array<Record<string, unknown>>,
    key: string,
): string {
    const cents = rows.reduce(
        (sum, row) => sum + Math.round(numeric(row, key) * 100),
        0,
    );
    return (cents / 100).toFixed(2);
}

function integerTotal(
    rows: Array<Record<string, unknown>>,
    key: string,
): number {
    return rows.reduce((sum, row) => sum + numeric(row, key), 0);
}

function stateGroups(
    scope: string,
    rows: Array<Record<string, unknown>>,
): StateGroup[] {
    const groups = new Map<string, number>();
    for (const row of rows) {
        const status = String(row.status ?? "(NULL)");
        groups.set(status, (groups.get(status) ?? 0) + 1);
    }
    return [...groups.entries()]
        .map(([status, count]) => ({ scope, status, count }))
        .sort((left, right) => left.status.localeCompare(right.status));
}

async function assertPickingGuard(): Promise<boolean> {
    const [rows, quarantine] = await Promise.all([
        prisma.$queryRaw<Array<{ convalidated: boolean }>>`
            SELECT convalidated
            FROM pg_constraint
            WHERE conrelid = '"PickingItem"'::regclass
              AND conname = 'PickingItem_quantity_bounds_check'
        `,
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT CASE
                WHEN to_regclass(
                    current_schema() || '."TenantMigrationQuarantine"'
                ) IS NULL THEN 0
                ELSE (
                    SELECT COUNT(*)::int
                    FROM "TenantMigrationQuarantine"
                    WHERE "tenantId"=$1::uuid
                      AND "storyId"='MIG-011'
                      AND "sourceTable"='PickingItem'
                      AND "sourceKey"='8'
                )
             END AS count`,
            LEGACY_TENANT_ID,
        ).catch(() => [{ count: 0 }]),
    ]);
    if (rows.length !== 1) {
        throw new Error("Falta PickingItem_quantity_bounds_check");
    }
    const validated = Boolean(rows[0]?.convalidated);
    const quarantineCount = Number(quarantine[0]?.count ?? 0);
    if (
        (!validated && quarantineCount !== 0)
        || (validated && quarantineCount !== 1)
    ) {
        throw new Error(
            "La guarda de picking no coincide con el estado de cuarentena",
        );
    }
    return validated;
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
            `Restricciones tenant incompletas o no validadas: ${missing.join(", ")}`,
        );
    }
    return rows.length;
}

async function countCrossTenantReferences(): Promise<number> {
    const queries = [
        `SELECT COUNT(*)::int AS count
         FROM "Order" o
         LEFT JOIN "Store" source ON source.id=o."sourceStoreId"
         LEFT JOIN "Store" fulfillment ON fulfillment.id=o."fulfillmentStoreId"
         LEFT JOIN "TenantMembership" seller
           ON seller."tenantId"=o."tenantId" AND seller."userId"=o."sellerUserId"
         LEFT JOIN "TenantMembership" picker
           ON picker."tenantId"=o."tenantId" AND picker."userId"=o."pickerUserId"
         LEFT JOIN "TenantMembership" dispenser
           ON dispenser."tenantId"=o."tenantId" AND dispenser."userId"=o."dispenserUserId"
         LEFT JOIN "TenantMembership" canceller
           ON canceller."tenantId"=o."tenantId" AND canceller."userId"=o."cancelledByUserId"
         LEFT JOIN "TenantMembership" returner
           ON returner."tenantId"=o."tenantId" AND returner."userId"=o."returnResponsibleUserId"
         LEFT JOIN "TenantMembership" delegator
           ON delegator."tenantId"=o."tenantId" AND delegator."userId"=o."returnResponsibilityDelegatedById"
         WHERE o."tenantId"=$1::uuid AND (
           source.id IS NULL OR source."tenantId"<>o."tenantId"
           OR (o."fulfillmentStoreId" IS NOT NULL AND (
             fulfillment.id IS NULL OR fulfillment."tenantId"<>o."tenantId"
           ))
           OR (o."sellerUserId" IS NOT NULL AND seller."userId" IS NULL)
           OR (o."pickerUserId" IS NOT NULL AND picker."userId" IS NULL)
           OR (o."dispenserUserId" IS NOT NULL AND dispenser."userId" IS NULL)
           OR (o."cancelledByUserId" IS NOT NULL AND canceller."userId" IS NULL)
           OR (o."returnResponsibleUserId" IS NOT NULL AND returner."userId" IS NULL)
           OR (o."returnResponsibilityDelegatedById" IS NOT NULL AND delegator."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "OrderItem" oi
         LEFT JOIN "Order" o ON o.id=oi."orderId"
         LEFT JOIN "ProductVariant" v ON v.id=oi."variantId"
         LEFT JOIN "Store" s ON s.id=oi."fulfillmentStoreId"
         LEFT JOIN "TenantMembership" remover
           ON remover."tenantId"=oi."tenantId" AND remover."userId"=oi."removedById"
         WHERE oi."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>oi."tenantId"
           OR v.id IS NULL OR v."tenantId"<>oi."tenantId"
           OR (oi."fulfillmentStoreId" IS NOT NULL AND (
             s.id IS NULL OR s."tenantId"<>oi."tenantId"
           ))
           OR (oi."removedById" IS NOT NULL AND remover."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "Reservation" r
         LEFT JOIN "Inventory" i ON i.id=r."inventoryId"
         LEFT JOIN "ProductVariant" v ON v.id=r."variantId"
         LEFT JOIN "Order" o ON o.id=r."orderId"
         LEFT JOIN "OrderItem" oi ON oi.id=r."orderItemId"
         LEFT JOIN "TenantMembership" member
           ON member."tenantId"=r."tenantId" AND member."userId"=r."reservedById"
         WHERE r."tenantId"=$1::uuid AND (
           i.id IS NULL OR i."tenantId"<>r."tenantId"
           OR v.id IS NULL OR v."tenantId"<>r."tenantId"
           OR (r."orderId" IS NOT NULL AND (o.id IS NULL OR o."tenantId"<>r."tenantId"))
           OR (r."orderItemId" IS NOT NULL AND (
             oi.id IS NULL OR oi."tenantId"<>r."tenantId"
           ))
           OR (r."reservedById" IS NOT NULL AND member."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingSession" ps
         LEFT JOIN "Order" o ON o.id=ps."orderId"
         LEFT JOIN "TenantMembership" member
           ON member."tenantId"=ps."tenantId" AND member."userId"=ps."assignedUserId"
         WHERE ps."tenantId"=$1::uuid AND (
           (ps."orderId" IS NOT NULL AND (o.id IS NULL OR o."tenantId"<>ps."tenantId"))
           OR (ps."assignedUserId" IS NOT NULL AND member."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingItem" pi
         LEFT JOIN "PickingSession" ps ON ps.id=pi."sessionId"
         LEFT JOIN "ProductVariant" v ON v.id=pi."variantId"
         WHERE pi."tenantId"=$1::uuid AND (
           ps.id IS NULL OR ps."tenantId"<>pi."tenantId"
           OR v.id IS NULL OR v."tenantId"<>pi."tenantId"
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingSharedResponsibility" x
         LEFT JOIN "Order" o ON o.id=x."orderId"
         LEFT JOIN "TenantMembership" member
           ON member."tenantId"=x."tenantId" AND member."userId"=x."userId"
         LEFT JOIN "TenantMembership" assigner
           ON assigner."tenantId"=x."tenantId" AND assigner."userId"=x."assignedByUserId"
         WHERE x."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>x."tenantId" OR member."userId" IS NULL
           OR (x."assignedByUserId" IS NOT NULL AND assigner."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingResponsibilityRequest" x
         LEFT JOIN "Order" o ON o.id=x."orderId"
         LEFT JOIN "TenantMembership" requester
           ON requester."tenantId"=x."tenantId" AND requester."userId"=x."requesterUserId"
         LEFT JOIN "TenantMembership" resolver
           ON resolver."tenantId"=x."tenantId" AND resolver."userId"=x."resolvedByUserId"
         WHERE x."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>x."tenantId" OR requester."userId" IS NULL
           OR (x."resolvedByUserId" IS NOT NULL AND resolver."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingItemContribution" x
         LEFT JOIN "Order" o ON o.id=x."orderId"
         LEFT JOIN "PickingItem" pi ON pi.id=x."pickingItemId"
         LEFT JOIN "TenantMembership" member
           ON member."tenantId"=x."tenantId" AND member."userId"=x."userId"
         WHERE x."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>x."tenantId"
           OR pi.id IS NULL OR pi."tenantId"<>x."tenantId"
           OR member."userId" IS NULL
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingUnpickRequest" x
         LEFT JOIN "Order" o ON o.id=x."orderId"
         LEFT JOIN "PickingItem" pi ON pi.id=x."pickingItemId"
         LEFT JOIN "TenantMembership" requester
           ON requester."tenantId"=x."tenantId" AND requester."userId"=x."requesterUserId"
         LEFT JOIN "TenantMembership" resolver
           ON resolver."tenantId"=x."tenantId" AND resolver."userId"=x."resolvedByUserId"
         WHERE x."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>x."tenantId"
           OR pi.id IS NULL OR pi."tenantId"<>x."tenantId"
           OR requester."userId" IS NULL
           OR (x."resolvedByUserId" IS NOT NULL AND resolver."userId" IS NULL)
         )`,
        `SELECT COUNT(*)::int AS count
         FROM "PickingOrderItemDetail" x
         LEFT JOIN "Order" o ON o.id=x."orderId"
         LEFT JOIN "OrderItem" oi ON oi.id=x."orderItemId"
         LEFT JOIN "PickingItem" pi ON pi.id=x."pickingItemId"
         LEFT JOIN "ProductVariant" v ON v.id=x."variantId"
         WHERE x."tenantId"=$1::uuid AND (
           o.id IS NULL OR o."tenantId"<>x."tenantId"
           OR oi.id IS NULL OR oi."tenantId"<>x."tenantId"
           OR (x."pickingItemId" IS NOT NULL AND (
             pi.id IS NULL OR pi."tenantId"<>x."tenantId"
           ))
           OR v.id IS NULL OR v."tenantId"<>x."tenantId"
         )`,
    ];
    const results = await Promise.all(queries.map((query) =>
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            query,
            LEGACY_TENANT_ID,
        ),
    ));
    return results.reduce(
        (sum, rows) => sum + Number(rows[0]?.count ?? 0),
        0,
    );
}

export async function inspectOrderPickingMigration(): Promise<OrderPickingReconciliationSummary> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-007",
            },
        },
        select: { details: true },
    });
    const sealed = readSealedIds(checkpoint?.details ?? null);
    const entries = await Promise.all(
        Object.entries(TABLES).map(async ([key, tableName]) => {
            const allRows = await loadSnapshotRows(tableName);
            return [
                key,
                selectedRows(
                    allRows,
                    sealed?.[key as keyof SealedOrderPickingIds],
                ),
            ] as const;
        }),
    );
    const snapshots = Object.fromEntries(entries) as Record<
        keyof SealedOrderPickingIds,
        SnapshotRow[]
    >;

    for (const key of Object.keys(TABLES) as Array<keyof SealedOrderPickingIds>) {
        const actual = snapshots[key].length;
        const expected = BASELINE_COUNTS[key];
        if (actual !== expected) {
            throw new Error(
                `Conteo inesperado para ${TABLES[key]}: ${actual}/${expected}`,
            );
        }
    }

    const orders = parsed(snapshots.orderIds);
    const orderItems = parsed(snapshots.orderItemIds);
    const reservations = parsed(snapshots.reservationIds);
    const sessions = parsed(snapshots.pickingSessionIds);
    const pickingItems = parsed(snapshots.pickingItemIds);
    const contributions = parsed(snapshots.contributionIds);
    const details = parsed(snapshots.orderItemDetailIds);

    const totals = {
        orderSubtotal: moneyTotal(orders, "subtotal"),
        orderTax: moneyTotal(orders, "tax"),
        orderTotal: moneyTotal(orders, "total"),
        itemQuantity: integerTotal(orderItems, "quantity"),
        itemReserved: integerTotal(orderItems, "reserved"),
        itemPicked: integerTotal(orderItems, "picked"),
        itemShortage: integerTotal(orderItems, "shortageQuantity"),
        itemReturned: integerTotal(orderItems, "returnedQuantity"),
        itemSubtotal: moneyTotal(orderItems, "subtotal"),
        reservationQuantity: integerTotal(reservations, "quantity"),
        pickingQuantity: integerTotal(pickingItems, "quantity"),
        pickingPicked: integerTotal(pickingItems, "pickedQuantity"),
        contributionQuantity: integerTotal(contributions, "quantity"),
        detailPicked: integerTotal(details, "pickedQuantity"),
    };
    if (JSON.stringify(totals) !== JSON.stringify(BASELINE_TOTALS)) {
        throw new Error(
            `Totales operativos inesperados: ${JSON.stringify(totals)}`,
        );
    }

    const states = [
        ...stateGroups("Order", orders),
        ...stateGroups("OrderItem", orderItems),
        ...stateGroups("PickingSession", sessions),
        ...stateGroups("Reservation", reservations),
    ];
    if (JSON.stringify(states) !== JSON.stringify(BASELINE_STATES)) {
        throw new Error(
            `Estados operativos inesperados: ${JSON.stringify(states)}`,
        );
    }

    const codeSet = new Set(orders.map((row) => String(row.code)));
    const idempotencyKeys = orders
        .map((row) => row.idempotencyKey)
        .filter((value): value is string => typeof value === "string");
    if (
        codeSet.size !== orders.length
        || new Set(idempotencyKeys).size !== idempotencyKeys.length
    ) {
        throw new Error("Existen códigos o claves idempotentes duplicados");
    }

    const removedRows = orderItems.filter((row) => row.removedAt !== null);
    const removedItems = {
        count: removedRows.length,
        withReason: removedRows.filter(
            (row) => typeof row.removedReason === "string",
        ).length,
        withNote: removedRows.filter(
            (row) => typeof row.removedNote === "string",
        ).length,
        withResponsible: removedRows.filter(
            (row) => row.removedById !== null,
        ).length,
        withResponsibleName: removedRows.filter(
            (row) => typeof row.removedByName === "string",
        ).length,
    };
    if (JSON.stringify(removedItems) !== JSON.stringify({
        count: 4,
        withReason: 4,
        withNote: 0,
        withResponsible: 4,
        withResponsibleName: 4,
    })) {
        throw new Error(
            `Soft-delete histórico inesperado: ${JSON.stringify(removedItems)}`,
        );
    }

    const sessionOrder = new Map(
        sessions.map((row) => [numeric(row, "id"), numeric(row, "orderId")]),
    );
    const invalidPickingRows = pickingItems
        .filter((row) =>
            numeric(row, "quantity") <= 0
            || numeric(row, "pickedQuantity") < 0
            || numeric(row, "pickedQuantity") > numeric(row, "quantity")
        )
        .map((row) => ({
            id: numeric(row, "id"),
            orderId: sessionOrder.get(numeric(row, "sessionId")) ?? 0,
            quantity: numeric(row, "quantity"),
            pickedQuantity: numeric(row, "pickedQuantity"),
            excess:
                numeric(row, "pickedQuantity") - numeric(row, "quantity"),
        }));
    if (JSON.stringify(invalidPickingRows) !== JSON.stringify([{
        id: 8,
        orderId: 17,
        quantity: 13,
        pickedQuantity: 21,
        excess: 8,
    }])) {
        throw new Error(
            `Cuarentena de picking inesperada: ${JSON.stringify(invalidPickingRows)}`,
        );
    }

    const [crossTenantReferences, tenantConstraintCount, pickingGuardValidated] =
        await Promise.all([
            countCrossTenantReferences(),
            assertTenantConstraints(),
            assertPickingGuard(),
        ]);
    if (crossTenantReferences !== 0) {
        throw new Error(
            `Existen ${crossTenantReferences} relaciones operativas cruzadas`,
        );
    }

    const sealedIds = Object.fromEntries(
        (Object.keys(TABLES) as Array<keyof SealedOrderPickingIds>).map(
            (key) => [key, snapshots[key].map((row) => row.id)],
        ),
    ) as SealedOrderPickingIds;
    const fingerprints = Object.fromEntries(
        (Object.keys(TABLES) as Array<keyof SealedOrderPickingIds>).map(
            (key) => [TABLES[key], digest(snapshots[key].map((row) => row.data))],
        ),
    ) as Record<string, string> & { logicalOperations: string };
    fingerprints.logicalOperations = digest(
        Object.fromEntries(
            (Object.keys(TABLES) as Array<keyof SealedOrderPickingIds>).map(
                (key) => [key, snapshots[key].map((row) => row.data)],
            ),
        ),
    );

    return {
        ...sealedIds,
        counts: {
            orders: snapshots.orderIds.length,
            orderItems: snapshots.orderItemIds.length,
            reservations: snapshots.reservationIds.length,
            pickingSessions: snapshots.pickingSessionIds.length,
            pickingItems: snapshots.pickingItemIds.length,
            sharedResponsibilities: snapshots.sharedResponsibilityIds.length,
            responsibilityRequests: snapshots.responsibilityRequestIds.length,
            contributions: snapshots.contributionIds.length,
            unpickRequests: snapshots.unpickRequestIds.length,
            orderItemDetails: snapshots.orderItemDetailIds.length,
        },
        totals,
        stateGroups: states,
        ordersWithIdempotencyKey: idempotencyKeys.length,
        removedItems,
        crossTenantReferences,
        tenantConstraintCount,
        invalidPickingRows,
        pickingGuardValidated,
        quarantinedDifferences: [{
            code: "QUARANTINED_LEGACY_PICKING_OVERFLOW",
            rowId: 8,
            excess: 8,
        }],
        fingerprints,
    };
}

export async function reconcileOrderPickingMigration(): Promise<OrderPickingReconciliationSummary> {
    const [checkpoint, movementCheckpoint] = await Promise.all([
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-007",
                },
            },
        }),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-006",
                },
            },
        }),
    ]);
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-007");
    if (movementCheckpoint?.status !== TenantMigrationStatus.COMPLETED) {
        throw new Error("MIG-006 debe estar COMPLETED antes de MIG-007");
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
        const summary = await inspectOrderPickingMigration();
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
                        "docs/migration/order-picking-reconciliation-policy.md",
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
                        "docs/migration/order-picking-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
