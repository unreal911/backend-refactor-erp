import { createHash } from "node:crypto";
import {
    Prisma,
    TenantMigrationStatus,
} from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const BASELINE = {
    orders: 42,
    orderItems: 106,
    returns: 0,
    returnItems: 0,
    returnedQuantity: 0,
    returnQuantity: 0,
    returnAmount: "0.00",
    notes: 40,
    paymentEvidence: 18,
    ordersWithoutPaymentEvidence: 24,
    paymentNoteHash:
        "55f47f8bc824a9a7b452cf3fd40fb9c77352ee98676ed59c3e949256126c1890",
} as const;

const TENANT_CONSTRAINTS = [
    "OrderReturn_order_tenant_fkey",
    "OrderReturn_store_tenant_fkey",
    "OrderReturn_user_tenant_fkey",
    "OrderReturnItem_return_tenant_fkey",
    "OrderReturnItem_order_item_tenant_fkey",
    "OrderReturnItem_variant_tenant_fkey",
] as const;

const RETURN_GUARDS = [
    "OrderItem_returned_quantity_check",
    "OrderReturn_totals_check",
    "OrderReturnItem_amounts_check",
] as const;

type SnapshotRow = {
    id: number;
    data: string;
};

type ReturnGroup = {
    scope: "ORDER" | "STORE" | "DATE";
    key: string;
    count: number;
    quantity: number;
    amount: string;
};

export type LegacyPaymentEvidence = {
    method: string;
    reference: string;
    amountLabel: "monto recibido" | "monto pagado" | "pagado";
    amount: string;
    amountCents: number;
    changeLabel: "vuelto" | "cambio";
    change: string;
    changeCents: number;
};

export type ReturnPaymentReconciliationSummary = {
    orderIds: number[];
    orderItemIds: number[];
    returnIds: number[];
    returnItemIds: number[];
    counts: {
        orders: number;
        orderItems: number;
        returns: number;
        returnItems: number;
        restockedReturns: number;
        spoilageReturns: number;
    };
    totals: {
        returnedQuantity: number;
        returnQuantity: number;
        returnAmount: string;
    };
    paymentEvidence: {
        notes: number;
        parsed: number;
        withMethod: number;
        withReference: number;
        withAmount: number;
        withChange: number;
        ordersWithoutPaymentEvidence: number;
        structuredPaymentTables: number;
        methodGroups: Array<{ method: string; count: number }>;
    };
    returnGroups: ReturnGroup[];
    reconciliationViolations: number;
    crossTenantReferences: number;
    tenantConstraintCount: number;
    returnGuardCount: number;
    fingerprints: {
        returns: string;
        returnItems: string;
        orderItemReturned: string;
        paymentNotes: string;
        paymentEvidence: string;
        logicalReturns: string;
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

function normalizeLabel(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, " ");
}

function parseMoneyCents(value: string): number | null {
    const compact = value
        .trim()
        .replace(/^s\/?\s*/i, "")
        .replace(/\s/g, "");
    if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(compact)) return null;
    const normalized = compact.replace(",", ".");
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

/**
 * Lee la evidencia POS heredada sin convertirla en una transacción de pago.
 * El texto original permanece íntegro en Order.note.
 */
export function parseLegacyPaymentEvidence(
    note: string | null | undefined,
): LegacyPaymentEvidence | null {
    if (!note?.trim()) return null;
    const fields = new Map<string, string>();
    for (const part of note.split("|")) {
        const separator = part.indexOf(":");
        if (separator < 0) continue;
        const label = normalizeLabel(part.slice(0, separator));
        const value = part.slice(separator + 1).trim();
        if (label && value) fields.set(label, value);
    }

    const method = fields.get("metodo de pago")
        ?? fields.get("metodo pago");
    const reference = fields.get("ref");
    const amountEntry = ([
        "monto recibido",
        "monto pagado",
        "pagado",
    ] as const).find((label) => fields.has(label));
    const changeEntry = (["vuelto", "cambio"] as const)
        .find((label) => fields.has(label));
    if (!method || !reference || !amountEntry || !changeEntry) return null;

    const amount = fields.get(amountEntry)!;
    const change = fields.get(changeEntry)!;
    const amountCents = parseMoneyCents(amount);
    const changeCents = parseMoneyCents(change);
    if (amountCents === null || changeCents === null) return null;

    return {
        method,
        reference,
        amountLabel: amountEntry,
        amount,
        amountCents,
        changeLabel: changeEntry,
        change,
        changeCents,
    };
}

function readDependencyIds(
    details: Prisma.JsonValue | null,
): { orderIds: number[]; orderItemIds: number[] } {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        throw new Error("MIG-007 no contiene IDs sellados");
    }
    const record = details as Record<string, unknown>;
    const orderIds = parseIds(record.orderIds);
    const orderItemIds = parseIds(record.orderItemIds);
    if (
        orderIds.length !== BASELINE.orders
        || orderItemIds.length !== BASELINE.orderItems
    ) {
        throw new Error(
            `IDs sellados de MIG-007 inesperados: `
            + `${orderIds.length}/${orderItemIds.length}`,
        );
    }
    return { orderIds, orderItemIds };
}

async function loadRows(
    tableName: "OrderReturn" | "OrderReturnItem",
    parentIds: number[],
): Promise<SnapshotRow[]> {
    const parentColumn = tableName === "OrderReturn"
        ? "orderId"
        : "orderItemId";
    return prisma.$queryRawUnsafe<SnapshotRow[]>(
        `SELECT id, to_jsonb(t)::text AS data
         FROM "${tableName}" t
         WHERE "tenantId"=$1::uuid
           AND "${parentColumn}"=ANY($2::int[])
         ORDER BY id`,
        LEGACY_TENANT_ID,
        parentIds,
    );
}

function moneyTotal(values: Array<number | Prisma.Decimal>): string {
    const cents = values.reduce<number>(
        (sum, value) => sum + Math.round(Number(value) * 100),
        0,
    );
    return (cents / 100).toFixed(2);
}

async function assertConstraints(
    names: readonly string[],
): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{
        conname: string;
        convalidated: boolean;
    }>>`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE conname IN (${Prisma.join([...names])})
    `;
    const found = new Set(rows.map((row) => row.conname));
    const missing = names.filter((name) => !found.has(name));
    if (missing.length > 0 || rows.some((row) => !row.convalidated)) {
        throw new Error(
            `Restricciones incompletas o no validadas: ${missing.join(", ")}`,
        );
    }
    return rows.length;
}

async function countStructuredPaymentTables(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema=current_schema()
          AND table_name IN ('Payment', 'OrderPayment')
    `;
    return Number(rows[0]?.count ?? 0);
}

async function countCrossTenantReferences(): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT (
            (SELECT COUNT(*)
             FROM "OrderReturn" r
             LEFT JOIN "Order" o ON o.id=r."orderId"
             LEFT JOIN "Store" s ON s.id=r."storeId"
             LEFT JOIN "TenantMembership" m
               ON m."tenantId"=r."tenantId"
              AND m."userId"=r."responsibleUserId"
             WHERE r."tenantId"=$1::uuid
               AND (
                 o.id IS NULL OR o."tenantId"<>r."tenantId"
                 OR s.id IS NULL OR s."tenantId"<>r."tenantId"
                 OR (
                   r."responsibleUserId" IS NOT NULL
                   AND m."userId" IS NULL
                 )
               ))
            +
            (SELECT COUNT(*)
             FROM "OrderReturnItem" ri
             LEFT JOIN "OrderReturn" r ON r.id=ri."returnId"
             LEFT JOIN "OrderItem" oi ON oi.id=ri."orderItemId"
             LEFT JOIN "ProductVariant" v ON v.id=ri."variantId"
             WHERE ri."tenantId"=$1::uuid
               AND (
                 r.id IS NULL OR r."tenantId"<>ri."tenantId"
                 OR oi.id IS NULL OR oi."tenantId"<>ri."tenantId"
                 OR v.id IS NULL OR v."tenantId"<>ri."tenantId"
               ))
        )::int AS count`,
        LEGACY_TENANT_ID,
    );
    return Number(rows[0]?.count ?? 0);
}

function buildReturnGroups(
    returns: Array<{
        orderId: number;
        storeId: number;
        createdAt: Date;
        totalQuantity: number;
        totalAmount: Prisma.Decimal;
    }>,
): ReturnGroup[] {
    const groups = new Map<string, ReturnGroup>();
    const add = (
        scope: ReturnGroup["scope"],
        key: string,
        quantity: number,
        amount: number,
    ) => {
        const groupKey = `${scope}:${key}`;
        const current = groups.get(groupKey) ?? {
            scope,
            key,
            count: 0,
            quantity: 0,
            amount: "0.00",
        };
        current.count += 1;
        current.quantity += quantity;
        current.amount = (
            Number(current.amount) + amount
        ).toFixed(2);
        groups.set(groupKey, current);
    };
    for (const row of returns) {
        const amount = Number(row.totalAmount);
        add("ORDER", String(row.orderId), row.totalQuantity, amount);
        add("STORE", String(row.storeId), row.totalQuantity, amount);
        add(
            "DATE",
            row.createdAt.toISOString().slice(0, 10),
            row.totalQuantity,
            amount,
        );
    }
    return [...groups.values()].sort((left, right) =>
        `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`)
    );
}

export async function inspectReturnPaymentMigration():
Promise<ReturnPaymentReconciliationSummary> {
    const migration7 = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-007",
            },
        },
        select: { status: true, details: true },
    });
    if (migration7?.status !== TenantMigrationStatus.COMPLETED) {
        throw new Error("MIG-007 debe estar COMPLETED antes de MIG-008");
    }
    const { orderIds, orderItemIds } = readDependencyIds(migration7.details);

    const [
        orders,
        orderItems,
        returns,
        returnItems,
        returnRows,
        returnItemRows,
        crossTenantReferences,
        tenantConstraintCount,
        returnGuardCount,
        structuredPaymentTables,
    ] = await Promise.all([
        prisma.order.findMany({
            where: { tenantId: LEGACY_TENANT_ID, id: { in: orderIds } },
            select: { id: true, note: true },
            orderBy: { id: "asc" },
        }),
        prisma.orderItem.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                id: { in: orderItemIds },
            },
            select: {
                id: true,
                orderId: true,
                variantId: true,
                quantity: true,
                shortageQuantity: true,
                returnedQuantity: true,
            },
            orderBy: { id: "asc" },
        }),
        prisma.orderReturn.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                orderId: { in: orderIds },
            },
            include: { items: true },
            orderBy: { id: "asc" },
        }),
        prisma.orderReturnItem.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                orderItemId: { in: orderItemIds },
            },
            orderBy: { id: "asc" },
        }),
        loadRows("OrderReturn", orderIds),
        loadRows("OrderReturnItem", orderItemIds),
        countCrossTenantReferences(),
        assertConstraints(TENANT_CONSTRAINTS),
        assertConstraints(RETURN_GUARDS),
        countStructuredPaymentTables(),
    ]);

    const notes = orders.filter((row) => row.note?.trim());
    const evidence = orders
        .map((row) => ({
            orderId: row.id,
            parsed: parseLegacyPaymentEvidence(row.note),
        }))
        .filter(
            (row): row is {
                orderId: number;
                parsed: LegacyPaymentEvidence;
            } => row.parsed !== null,
        );
    const methodMap = new Map<string, number>();
    for (const row of evidence) {
        methodMap.set(
            row.parsed.method,
            (methodMap.get(row.parsed.method) ?? 0) + 1,
        );
    }
    const methodGroups = [...methodMap.entries()]
        .map(([method, count]) => ({ method, count }))
        .sort((left, right) => left.method.localeCompare(right.method));
    const paymentNoteHash = digest(
        orders.map((row) => [row.id, row.note]),
    );

    let reconciliationViolations = 0;
    const returnedByItem = new Map<number, number>();
    for (const row of returnItems) {
        returnedByItem.set(
            row.orderItemId,
            (returnedByItem.get(row.orderItemId) ?? 0) + row.quantity,
        );
    }
    const itemById = new Map(orderItems.map((row) => [row.id, row]));
    const returnById = new Map(returns.map((row) => [row.id, row]));
    for (const row of returnItems) {
        const item = itemById.get(row.orderItemId);
        const header = returnById.get(row.returnId);
        if (
            !item
            || !header
            || row.variantId !== item.variantId
            || item.orderId !== header.orderId
        ) {
            reconciliationViolations += 1;
        }
    }
    for (const row of orderItems) {
        const itemReturned = returnedByItem.get(row.id) ?? 0;
        const delivered = Math.max(
            0,
            row.quantity - row.shortageQuantity,
        );
        if (
            row.returnedQuantity !== itemReturned
            || row.returnedQuantity > delivered
        ) {
            reconciliationViolations += 1;
        }
    }
    for (const header of returns) {
        const quantity = header.items.reduce(
            (sum, row) => sum + row.quantity,
            0,
        );
        const amount = moneyTotal(
            header.items.map((row) => row.subtotal),
        );
        if (
            header.totalQuantity !== quantity
            || Number(header.totalAmount).toFixed(2) !== amount
        ) {
            reconciliationViolations += 1;
        }
    }

    const totals = {
        returnedQuantity: orderItems.reduce(
            (sum, row) => sum + row.returnedQuantity,
            0,
        ),
        returnQuantity: returns.reduce(
            (sum, row) => sum + row.totalQuantity,
            0,
        ),
        returnAmount: moneyTotal(
            returns.map((row) => row.totalAmount),
        ),
    };
    const counts = {
        orders: orders.length,
        orderItems: orderItems.length,
        returns: returns.length,
        returnItems: returnItems.length,
        restockedReturns: returns.filter((row) => row.restock).length,
        spoilageReturns: returns.filter((row) => !row.restock).length,
    };
    const paymentEvidence = {
        notes: notes.length,
        parsed: evidence.length,
        withMethod: evidence.filter((row) => row.parsed.method).length,
        withReference:
            evidence.filter((row) => row.parsed.reference).length,
        withAmount: evidence.filter(
            (row) => Number.isInteger(row.parsed.amountCents),
        ).length,
        withChange: evidence.filter(
            (row) => Number.isInteger(row.parsed.changeCents),
        ).length,
        ordersWithoutPaymentEvidence: orders.length - evidence.length,
        structuredPaymentTables,
        methodGroups,
    };

    const actualBaseline = {
        orders: counts.orders,
        orderItems: counts.orderItems,
        returns: counts.returns,
        returnItems: counts.returnItems,
        returnedQuantity: totals.returnedQuantity,
        returnQuantity: totals.returnQuantity,
        returnAmount: totals.returnAmount,
        notes: paymentEvidence.notes,
        paymentEvidence: paymentEvidence.parsed,
        ordersWithoutPaymentEvidence:
            paymentEvidence.ordersWithoutPaymentEvidence,
        paymentNoteHash,
    };
    if (JSON.stringify(actualBaseline) !== JSON.stringify(BASELINE)) {
        throw new Error(
            `Línea base MIG-008 inesperada: ${JSON.stringify(actualBaseline)}`,
        );
    }
    if (
        paymentEvidence.withMethod !== BASELINE.paymentEvidence
        || paymentEvidence.withReference !== BASELINE.paymentEvidence
        || paymentEvidence.withAmount !== BASELINE.paymentEvidence
        || paymentEvidence.withChange !== BASELINE.paymentEvidence
        || JSON.stringify(methodGroups) !== JSON.stringify([{
            method: "Efectivo",
            count: 18,
        }])
    ) {
        throw new Error("La evidencia de pago heredada está incompleta");
    }
    if (
        structuredPaymentTables !== 0
        || reconciliationViolations !== 0
        || crossTenantReferences !== 0
    ) {
        throw new Error(
            `Violaciones MIG-008: pagos=${structuredPaymentTables}, `
            + `conciliación=${reconciliationViolations}, `
            + `tenant=${crossTenantReferences}`,
        );
    }

    const paymentManifest = evidence.map((row) => ({
        orderId: row.orderId,
        method: row.parsed.method,
        referenceHash: digest(row.parsed.reference),
        amountCents: row.parsed.amountCents,
        changeCents: row.parsed.changeCents,
    }));
    return {
        orderIds,
        orderItemIds,
        returnIds: returns.map((row) => row.id),
        returnItemIds: returnItems.map((row) => row.id),
        counts,
        totals,
        paymentEvidence,
        returnGroups: buildReturnGroups(returns),
        reconciliationViolations,
        crossTenantReferences,
        tenantConstraintCount,
        returnGuardCount,
        fingerprints: {
            returns: digest(returnRows.map((row) => row.data)),
            returnItems: digest(returnItemRows.map((row) => row.data)),
            orderItemReturned: digest(orderItems.map((row) => [
                row.id,
                row.returnedQuantity,
            ])),
            paymentNotes: paymentNoteHash,
            paymentEvidence: digest(paymentManifest),
            logicalReturns: digest({
                returns: returnRows.map((row) => row.data),
                returnItems: returnItemRows.map((row) => row.data),
                groups: buildReturnGroups(returns),
            }),
        },
    };
}

export async function reconcileReturnPaymentMigration():
Promise<ReturnPaymentReconciliationSummary> {
    const [checkpoint, dependency] = await Promise.all([
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-008",
                },
            },
        }),
        prisma.tenantMigrationCheckpoint.findUnique({
            where: {
                tenantId_storyId: {
                    tenantId: LEGACY_TENANT_ID,
                    storyId: "MIG-007",
                },
            },
        }),
    ]);
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-008");
    if (dependency?.status !== TenantMigrationStatus.COMPLETED) {
        throw new Error("MIG-007 debe estar COMPLETED antes de MIG-008");
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
        const summary = await inspectReturnPaymentMigration();
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
                        "docs/migration/return-payment-reconciliation-policy.md",
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
                        "docs/migration/return-payment-reconciliation-policy.md",
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
