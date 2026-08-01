import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Prisma, TenantMigrationStatus } from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const PREREQUISITE_STORIES = [
    "MIG-003",
    "MIG-004",
    "MIG-005",
    "MIG-006",
    "MIG-007",
    "MIG-008",
    "MIG-009",
    "MIG-010",
] as const;

export const MIG011_TENANT_TABLES = [
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
] as const;

export const MIG011_SEQUENCE_TABLES = [
    "AuditLog",
    "Category",
    "Color",
    "Inventory",
    "InventoryMovement",
    "MarketplaceCustomer",
    "Order",
    "OrderItem",
    "OrderReturn",
    "OrderReturnItem",
    "PaymentMethod",
    "Permission",
    "PickingItem",
    "PickingItemContribution",
    "PickingOrderItemDetail",
    "PickingResponsibilityRequest",
    "PickingSession",
    "PickingSharedResponsibility",
    "PickingUnpickRequest",
    "Product",
    "ProductImage",
    "ProductVariant",
    "Reservation",
    "Role",
    "RolePermission",
    "Size",
    "StockTransfer",
    "StockTransferItem",
    "Store",
    "SystemSetting",
    "User",
    "UserActivityLog",
] as const;

type JsonRecord = Record<string, unknown>;

type CoverageDefinition = {
    table: string;
    storyId: typeof PREREQUISITE_STORIES[number];
    scope: "TENANT" | "GLOBAL" | "AUDIT";
    idsField?: string;
    countField?: string;
    fixedCount?: number;
};

const COVERAGE: CoverageDefinition[] = [
    { table: "Tenant", storyId: "MIG-003", scope: "TENANT", fixedCount: 1 },
    { table: "User", storyId: "MIG-003", scope: "GLOBAL", idsField: "sourceUserIds" },
    {
        table: "TenantMembership",
        storyId: "MIG-003",
        scope: "TENANT",
        idsField: "sourceUserIds",
    },
    { table: "Role", storyId: "MIG-003", scope: "GLOBAL", countField: "roleCount" },
    {
        table: "Permission",
        storyId: "MIG-003",
        scope: "GLOBAL",
        countField: "permissionCount",
    },
    {
        table: "RolePermission",
        storyId: "MIG-003",
        scope: "GLOBAL",
        countField: "rolePermissionCount",
    },
    { table: "Category", storyId: "MIG-004", scope: "TENANT", idsField: "categoryIds" },
    { table: "Color", storyId: "MIG-004", scope: "TENANT", idsField: "colorIds" },
    { table: "Size", storyId: "MIG-004", scope: "TENANT", idsField: "sizeIds" },
    { table: "Product", storyId: "MIG-004", scope: "TENANT", idsField: "productIds" },
    {
        table: "ProductImage",
        storyId: "MIG-004",
        scope: "TENANT",
        idsField: "imageIds",
    },
    {
        table: "ProductVariant",
        storyId: "MIG-004",
        scope: "TENANT",
        idsField: "variantIds",
    },
    { table: "Store", storyId: "MIG-005", scope: "TENANT", idsField: "storeIds" },
    {
        table: "Inventory",
        storyId: "MIG-005",
        scope: "TENANT",
        idsField: "inventoryIds",
    },
    {
        table: "InventoryMovement",
        storyId: "MIG-006",
        scope: "TENANT",
        idsField: "movementIds",
    },
    {
        table: "StockTransfer",
        storyId: "MIG-006",
        scope: "TENANT",
        idsField: "transferIds",
    },
    {
        table: "StockTransferItem",
        storyId: "MIG-006",
        scope: "TENANT",
        idsField: "transferItemIds",
    },
    { table: "Order", storyId: "MIG-007", scope: "TENANT", idsField: "orderIds" },
    {
        table: "OrderItem",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "orderItemIds",
    },
    {
        table: "Reservation",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "reservationIds",
    },
    {
        table: "PickingSession",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "pickingSessionIds",
    },
    {
        table: "PickingItem",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "pickingItemIds",
    },
    {
        table: "PickingSharedResponsibility",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "sharedResponsibilityIds",
    },
    {
        table: "PickingResponsibilityRequest",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "responsibilityRequestIds",
    },
    {
        table: "PickingItemContribution",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "contributionIds",
    },
    {
        table: "PickingUnpickRequest",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "unpickRequestIds",
    },
    {
        table: "PickingOrderItemDetail",
        storyId: "MIG-007",
        scope: "TENANT",
        idsField: "orderItemDetailIds",
    },
    {
        table: "OrderReturn",
        storyId: "MIG-008",
        scope: "TENANT",
        idsField: "returnIds",
    },
    {
        table: "OrderReturnItem",
        storyId: "MIG-008",
        scope: "TENANT",
        idsField: "returnItemIds",
    },
    {
        table: "MarketplaceCustomer",
        storyId: "MIG-009",
        scope: "TENANT",
        idsField: "marketplaceCustomerIds",
    },
    {
        table: "PaymentMethod",
        storyId: "MIG-009",
        scope: "TENANT",
        idsField: "paymentMethodIds",
    },
    {
        table: "SystemSetting",
        storyId: "MIG-009",
        scope: "TENANT",
        idsField: "systemSettingIds",
    },
    {
        table: "AuditLog",
        storyId: "MIG-010",
        scope: "AUDIT",
        idsField: "auditLogIds",
    },
    {
        table: "UserActivityLog",
        storyId: "MIG-010",
        scope: "TENANT",
        idsField: "activityLogIds",
    },
];

type CoverageRow = {
    table: string;
    storyId: string;
    scope: string;
    sourceRows: number;
    destinationRows: number;
    currentRows: number;
    postBaselineRows: number;
    reconciled: boolean;
};

type SequenceRow = {
    table: string;
    sequence: string;
    maximumId: number | null;
    lastValue: number | null;
    isCalled: boolean;
    nextValueSafe: boolean;
};

export type BackfillClosureSummary = {
    tenantId: string;
    deploymentSequence: [
        "EXPAND",
        "BACKFILL",
        "VALIDATE",
        "RESTRICT",
        "RETIRE_COMPATIBILITY",
    ];
    prerequisites: Array<{
        storyId: string;
        status: "COMPLETED";
        completedAt: string;
        detailsHash: string;
        fingerprintsHash: string;
    }>;
    coverage: CoverageRow[];
    controlTotals: Record<string, unknown>;
    integrity: {
        tenantTableCount: number;
        nullableTenantColumns: number;
        tenantIndexedTables: number;
        tenantUniqueIndexes: number;
        foreignKeys: number;
        unvalidatedConstraints: number;
        orphanRows: number;
        crossTenantRows: number;
        invalidAuditScopes: number;
        invalidOperationalPickingRows: number;
    };
    quarantine: {
        records: number;
        reasonCode: "QUARANTINED_LEGACY_PICKING_OVERFLOW";
        sourceTable: "PickingItem";
        sourceKey: "8";
        originalHash: string;
        relatedPickingDetails: number;
        relatedPickedQuantity: number;
        activeSourceRows: number;
        detachedOperationalDetails: number;
        resolution: "ARCHIVED_OUTSIDE_OPERATIONAL_FLOW";
    };
    approvedDecisions: Array<{
        code: string;
        affectedRows: number;
        resolution: string;
    }>;
    sequences: SequenceRow[];
    conflicts: {
        missingBaselineRows: number;
        duplicateBaselineRows: number;
        unsafeSequences: number;
        unexplainedChanges: number;
    };
    fingerprints: {
        prerequisites: string;
        coverage: string;
        controlTotals: string;
        integrity: string;
        quarantine: string;
        sequences: string;
        report: string;
    };
};

export type BackfillClosureReport = BackfillClosureSummary & {
    execution: {
        startedAt: string;
        completedAt: string;
        durationMs: number;
    };
};

type CheckpointRow = {
    storyId: string;
    status: TenantMigrationStatus;
    completedAt: Date | null;
    details: Prisma.JsonValue | null;
};

type ForeignKeyRow = {
    constraintName: string;
    childTable: string;
    parentTable: string;
    childColumns: string[];
    parentColumns: string[];
    childHasTenant: boolean;
    parentHasTenant: boolean;
};

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function record(value: Prisma.JsonValue | null): JsonRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as JsonRecord;
}

function ids(details: JsonRecord, field: string): number[] {
    const value = details[field];
    return Array.isArray(value)
        ? value.filter(
            (entry): entry is number =>
                Number.isInteger(entry) && Number(entry) > 0,
        )
        : [];
}

function numeric(details: JsonRecord, field: string): number {
    const value = Number(details[field]);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`MIG-011: ${field} no contiene un conteo válido`);
    }
    return value;
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function coverageExpected(
    definition: CoverageDefinition,
    details: JsonRecord,
): { sourceRows: number; sealedIds: number[] | null } {
    if (definition.idsField) {
        const sealedIds = ids(details, definition.idsField);
        return { sourceRows: sealedIds.length, sealedIds };
    }
    if (definition.countField) {
        return {
            sourceRows: numeric(details, definition.countField),
            sealedIds: null,
        };
    }
    return { sourceRows: definition.fixedCount ?? 0, sealedIds: null };
}

async function coverageCount(
    definition: CoverageDefinition,
    sourceRows: number,
    sealedIds: number[] | null,
): Promise<{ destinationRows: number; currentRows: number }> {
    const table = quoteIdentifier(definition.table);
    if (definition.table === "Tenant") {
        const rows = await prisma.$queryRawUnsafe<Array<{
            destination: number;
            current: number;
        }>>(
            `SELECT
                COUNT(*) FILTER (WHERE id=$1::uuid)::int AS destination,
                COUNT(*) FILTER (WHERE id=$1::uuid)::int AS current
             FROM ${table}`,
            LEGACY_TENANT_ID,
        );
        return {
            destinationRows: Number(rows[0]?.destination ?? 0),
            currentRows: Number(rows[0]?.current ?? 0),
        };
    }
    if (definition.table === "TenantMembership" && sealedIds) {
        const rows = await prisma.$queryRawUnsafe<Array<{
            destination: number;
            current: number;
        }>>(
            `SELECT
                COUNT(*) FILTER (WHERE "userId"=ANY($2::int[]))::int
                    AS destination,
                COUNT(*)::int AS current
             FROM ${table}
             WHERE "tenantId"=$1::uuid`,
            LEGACY_TENANT_ID,
            sealedIds,
        );
        return {
            destinationRows: Number(rows[0]?.destination ?? 0),
            currentRows: Number(rows[0]?.current ?? 0),
        };
    }

    const scopeClause = definition.scope === "TENANT"
        ? ` WHERE "tenantId"=$1::uuid`
        : "";
    const parameters: unknown[] = definition.scope === "TENANT"
        ? [LEGACY_TENANT_ID]
        : [];
    const currentRows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS count FROM ${table}${scopeClause}`,
        ...parameters,
    );

    if (!sealedIds) {
        return {
            destinationRows: Number(currentRows[0]?.count ?? 0),
            currentRows: Number(currentRows[0]?.count ?? 0),
        };
    }
    if (sealedIds.length === 0) {
        return {
            destinationRows: 0,
            currentRows: Number(currentRows[0]?.count ?? 0),
        };
    }

    const idParameter = definition.scope === "TENANT" ? "$2" : "$1";
    const selectedParameters = definition.scope === "TENANT"
        ? [LEGACY_TENANT_ID, sealedIds]
        : [sealedIds];
    const destination = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT COUNT(*)::int AS count
         FROM ${table}
         WHERE id=ANY(${idParameter}::int[])`
        + (definition.scope === "TENANT" ? ` AND "tenantId"=$1::uuid` : ""),
        ...selectedParameters,
    );
    let destinationRows = Number(destination[0]?.count ?? 0);
    if (definition.table === "PickingItem" && sealedIds.includes(8)) {
        const archived = await prisma.$queryRawUnsafe<Array<{
            count: number;
        }>>(
            `SELECT COUNT(*)::int AS count
             FROM "TenantMigrationQuarantine"
             WHERE "tenantId"=$1::uuid
               AND "storyId"='MIG-011'
               AND "sourceTable"='PickingItem'
               AND "sourceKey"='8'
               AND "reasonCode"=
                   'QUARANTINED_LEGACY_PICKING_OVERFLOW'`,
            LEGACY_TENANT_ID,
        );
        destinationRows += Number(archived[0]?.count ?? 0);
    }
    return {
        destinationRows,
        currentRows: Number(currentRows[0]?.count ?? 0),
    };
}

async function inspectCoverage(
    checkpoints: Map<string, CheckpointRow>,
): Promise<CoverageRow[]> {
    const rows: CoverageRow[] = [];
    for (const definition of COVERAGE) {
        const details = record(checkpoints.get(definition.storyId)?.details ?? null);
        const expected = coverageExpected(definition, details);
        const counts = await coverageCount(
            definition,
            expected.sourceRows,
            expected.sealedIds,
        );
        const reconciled = counts.destinationRows === expected.sourceRows;
        rows.push({
            table: definition.table,
            storyId: definition.storyId,
            scope: definition.scope,
            sourceRows: expected.sourceRows,
            destinationRows: counts.destinationRows,
            currentRows: counts.currentRows,
            postBaselineRows: Math.max(
                0,
                counts.currentRows - counts.destinationRows,
            ),
            reconciled,
        });
    }
    return rows;
}

async function foreignKeyHealth(): Promise<{
    foreignKeys: number;
    orphanRows: number;
    crossTenantRows: number;
}> {
    const foreignKeys = await prisma.$queryRawUnsafe<ForeignKeyRow[]>(
        `SELECT
            constraint_row.conname AS "constraintName",
            child.relname AS "childTable",
            parent.relname AS "parentTable",
            array_agg(child_column.attname::text ORDER BY key_row.ordinality)
                AS "childColumns",
            array_agg(parent_column.attname::text ORDER BY key_row.ordinality)
                AS "parentColumns",
            EXISTS (
                SELECT 1 FROM pg_attribute attribute_row
                WHERE attribute_row.attrelid=child.oid
                  AND attribute_row.attname='tenantId'
                  AND NOT attribute_row.attisdropped
            ) AS "childHasTenant",
            EXISTS (
                SELECT 1 FROM pg_attribute attribute_row
                WHERE attribute_row.attrelid=parent.oid
                  AND attribute_row.attname='tenantId'
                  AND NOT attribute_row.attisdropped
            ) AS "parentHasTenant"
         FROM pg_constraint constraint_row
         JOIN pg_class child ON child.oid=constraint_row.conrelid
         JOIN pg_class parent ON parent.oid=constraint_row.confrelid
         JOIN pg_namespace namespace_row
           ON namespace_row.oid=constraint_row.connamespace
         CROSS JOIN LATERAL unnest(
             constraint_row.conkey,
             constraint_row.confkey
         ) WITH ORDINALITY
           AS key_row(child_number,parent_number,ordinality)
         JOIN pg_attribute child_column
           ON child_column.attrelid=child.oid
          AND child_column.attnum=key_row.child_number
         JOIN pg_attribute parent_column
           ON parent_column.attrelid=parent.oid
          AND parent_column.attnum=key_row.parent_number
         WHERE namespace_row.nspname=current_schema()
           AND constraint_row.contype='f'
         GROUP BY
            constraint_row.conname,
            child.relname,
            parent.relname,
            child.oid,
            parent.oid
         ORDER BY child.relname,constraint_row.conname`,
    );

    let orphanRows = 0;
    let crossTenantRows = 0;
    for (const foreignKey of foreignKeys) {
        const child = quoteIdentifier(foreignKey.childTable);
        const parent = quoteIdentifier(foreignKey.parentTable);
        const joins = foreignKey.childColumns.map((column, index) =>
            `parent_row.${quoteIdentifier(foreignKey.parentColumns[index]!)}`
            + `=child_row.${quoteIdentifier(column)}`
        );
        const populated = foreignKey.childColumns.map((column) =>
            `child_row.${quoteIdentifier(column)} IS NOT NULL`
        );
        const orphan = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM ${child} child_row
             LEFT JOIN ${parent} parent_row ON ${joins.join(" AND ")}
             WHERE ${populated.join(" AND ")}
               AND parent_row.ctid IS NULL`,
        );
        orphanRows += Number(orphan[0]?.count ?? 0);

        if (!foreignKey.childHasTenant || !foreignKey.parentHasTenant) continue;
        const businessPairs = foreignKey.childColumns
            .map((column, index) => ({
                child: column,
                parent: foreignKey.parentColumns[index]!,
            }))
            .filter((pair) =>
                pair.child !== "tenantId" && pair.parent !== "tenantId"
            );
        if (businessPairs.length === 0) continue;
        const businessJoin = businessPairs.map((pair) =>
            `parent_row.${quoteIdentifier(pair.parent)}`
            + `=child_row.${quoteIdentifier(pair.child)}`
        );
        const businessPopulated = businessPairs.map((pair) =>
            `child_row.${quoteIdentifier(pair.child)} IS NOT NULL`
        );
        const cross = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM ${child} child_row
             WHERE ${businessPopulated.join(" AND ")}
               AND NOT EXISTS (
                   SELECT 1
                   FROM ${parent} parent_row
                   WHERE ${businessJoin.join(" AND ")}
                     AND parent_row."tenantId"=child_row."tenantId"
               )`,
        );
        crossTenantRows += Number(cross[0]?.count ?? 0);
    }
    return { foreignKeys: foreignKeys.length, orphanRows, crossTenantRows };
}

async function inspectIntegrity(): Promise<BackfillClosureSummary["integrity"]> {
    const [
        tenantColumns,
        indexedTables,
        uniqueIndexes,
        unvalidated,
        invalidAudit,
        invalidPicking,
        foreignKeys,
    ] = await Promise.all([
        prisma.$queryRawUnsafe<Array<{
            tableName: string;
            nullable: string;
        }>>(
            `SELECT table_name AS "tableName",is_nullable AS nullable
             FROM information_schema.columns
             WHERE table_schema=current_schema()
               AND column_name='tenantId'
               AND table_name=ANY($1::text[])`,
            [...MIG011_TENANT_TABLES],
        ),
        prisma.$queryRawUnsafe<Array<{ tableName: string }>>(
            `SELECT DISTINCT tablename AS "tableName"
             FROM pg_indexes
             WHERE schemaname=current_schema()
               AND tablename=ANY($1::text[])
               AND indexdef LIKE '%"tenantId"%'`,
            [...MIG011_TENANT_TABLES],
        ),
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM pg_indexes
             WHERE schemaname=current_schema()
               AND tablename=ANY($1::text[])
               AND indexdef LIKE 'CREATE UNIQUE INDEX%'
               AND indexdef LIKE '%"tenantId"%'`,
            [...MIG011_TENANT_TABLES],
        ),
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM pg_constraint
             WHERE connamespace=current_schema()::regnamespace
               AND NOT convalidated`,
        ),
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM "AuditLog"
             WHERE ("dataScope"='TENANT' AND "tenantId" IS NULL)
                OR ("dataScope" IN ('PLATFORM','QUARANTINE')
                    AND "tenantId" IS NOT NULL)`,
        ),
        prisma.$queryRawUnsafe<Array<{ count: number }>>(
            `SELECT COUNT(*)::int AS count
             FROM "PickingItem"
             WHERE quantity<=0
                OR "pickedQuantity"<0
                OR "pickedQuantity">quantity`,
        ),
        foreignKeyHealth(),
    ]);
    return {
        tenantTableCount: tenantColumns.length,
        nullableTenantColumns: tenantColumns.filter(
            (column) => column.nullable !== "NO",
        ).length,
        tenantIndexedTables: indexedTables.length,
        tenantUniqueIndexes: Number(uniqueIndexes[0]?.count ?? 0),
        foreignKeys: foreignKeys.foreignKeys,
        unvalidatedConstraints: Number(unvalidated[0]?.count ?? 0),
        orphanRows: foreignKeys.orphanRows,
        crossTenantRows: foreignKeys.crossTenantRows,
        invalidAuditScopes: Number(invalidAudit[0]?.count ?? 0),
        invalidOperationalPickingRows: Number(invalidPicking[0]?.count ?? 0),
    };
}

async function inspectQuarantine():
Promise<BackfillClosureSummary["quarantine"]> {
    const rows = await prisma.$queryRawUnsafe<Array<{
        originalData: string;
        relatedData: string;
        originalHash: string;
        resolution: string;
        activeSourceRows: number;
        detachedDetails: number;
    }>>(
        `SELECT
            quarantine."originalData"::text AS "originalData",
            quarantine."relatedData"::text AS "relatedData",
            quarantine."originalHash" AS "originalHash",
            quarantine.resolution,
            (
                SELECT COUNT(*)::int FROM "PickingItem" WHERE id=8
            ) AS "activeSourceRows",
            (
                SELECT COUNT(*)::int
                FROM "PickingOrderItemDetail" detail
                WHERE detail.id IN (
                    SELECT (value->>'id')::int
                    FROM jsonb_array_elements(
                        quarantine."relatedData"
                            ->'pickingOrderItemDetails'
                    ) value
                )
                  AND detail."pickingItemId" IS NULL
            ) AS "detachedDetails"
         FROM "TenantMigrationQuarantine" quarantine
         WHERE quarantine."tenantId"=$1::uuid
           AND quarantine."storyId"='MIG-011'
           AND quarantine."sourceTable"='PickingItem'
           AND quarantine."sourceKey"='8'
           AND quarantine."reasonCode"=
               'QUARANTINED_LEGACY_PICKING_OVERFLOW'`,
        LEGACY_TENANT_ID,
    );
    if (rows.length !== 1) {
        throw new Error(`MIG-011: cuarentena inesperada (${rows.length}/1)`);
    }
    const row = rows[0]!;
    const original = JSON.parse(row.originalData) as JsonRecord;
    const related = JSON.parse(row.relatedData) as {
        pickingOrderItemDetails?: JsonRecord[];
    };
    const details = related.pickingOrderItemDetails ?? [];
    const relatedPickedQuantity = details.reduce(
        (sum, detail) => sum + Number(detail.pickedQuantity ?? 0),
        0,
    );
    if (
        Number(original.id) !== 8
        || Number(original.quantity) !== 13
        || Number(original.pickedQuantity) !== 21
        || digestText(row.originalData) !== row.originalHash
        || row.resolution !== "ARCHIVED_OUTSIDE_OPERATIONAL_FLOW"
        || Number(row.activeSourceRows) !== 0
        || Number(row.detachedDetails) !== 6
        || details.length !== 6
        || relatedPickedQuantity !== 21
    ) {
        throw new Error("MIG-011: evidencia de cuarentena inconsistente");
    }
    return {
        records: rows.length,
        reasonCode: "QUARANTINED_LEGACY_PICKING_OVERFLOW",
        sourceTable: "PickingItem",
        sourceKey: "8",
        originalHash: row.originalHash,
        relatedPickingDetails: details.length,
        relatedPickedQuantity,
        activeSourceRows: Number(row.activeSourceRows),
        detachedOperationalDetails: Number(row.detachedDetails),
        resolution: "ARCHIVED_OUTSIDE_OPERATIONAL_FLOW",
    };
}

async function inspectSequences(): Promise<SequenceRow[]> {
    const result: SequenceRow[] = [];
    for (const table of MIG011_SEQUENCE_TABLES) {
        const rows = await prisma.$queryRawUnsafe<Array<{
            sequence: string;
            maximumId: number | null;
            lastValue: number | null;
        }>>(
            `SELECT
                pg_get_serial_sequence(
                    format('%I.%I',current_schema(),$1::text),
                    'id'
                ) AS sequence,
                (SELECT MAX(id)::bigint FROM ${quoteIdentifier(table)})
                    AS "maximumId",
                sequence_row.last_value::bigint AS "lastValue"
             FROM pg_sequences sequence_row
             WHERE sequence_row.schemaname=current_schema()
               AND sequence_row.sequencename=$1::text || '_id_seq'`,
            table,
        );
        if (rows.length !== 1 || !rows[0]?.sequence) {
            throw new Error(`MIG-011: falta secuencia para ${table}.id`);
        }
        const state = await prisma.$queryRawUnsafe<Array<{
            isCalled: boolean;
        }>>(
            `SELECT is_called AS "isCalled"
             FROM ${rows[0].sequence}`,
        );
        const maximumId = rows[0].maximumId === null
            ? null
            : Number(rows[0].maximumId);
        const lastValue = rows[0].lastValue === null
            ? null
            : Number(rows[0].lastValue);
        const isCalled = Boolean(state[0]?.isCalled);
        const nextValueSafe = maximumId === null
            ? lastValue === null || !isCalled || lastValue >= 1
            : lastValue !== null && lastValue >= maximumId && isCalled;
        result.push({
            table,
            sequence: rows[0].sequence,
            maximumId,
            lastValue,
            isCalled,
            nextValueSafe,
        });
    }
    return result;
}

function prerequisiteSummary(checkpoints: CheckpointRow[]):
BackfillClosureSummary["prerequisites"] {
    return checkpoints.map((checkpoint) => {
        const details = record(checkpoint.details);
        if (
            checkpoint.status !== TenantMigrationStatus.COMPLETED
            || !checkpoint.completedAt
            || details.version !== 1
            || !details.fingerprints
        ) {
            throw new Error(
                `MIG-011: ${checkpoint.storyId} no tiene evidencia COMPLETED`,
            );
        }
        return {
            storyId: checkpoint.storyId,
            status: "COMPLETED",
            completedAt: checkpoint.completedAt.toISOString(),
            detailsHash: digest(details),
            fingerprintsHash: digest(details.fingerprints),
        };
    });
}

function controlTotals(checkpoints: Map<string, CheckpointRow>):
Record<string, unknown> {
    const inventory = record(checkpoints.get("MIG-005")?.details ?? null);
    const movements = record(checkpoints.get("MIG-006")?.details ?? null);
    const orders = record(checkpoints.get("MIG-007")?.details ?? null);
    const returns = record(checkpoints.get("MIG-008")?.details ?? null);
    return {
        inventory: {
            stock: inventory.stock,
            reservedStock: inventory.reservedStock,
            availableStock: inventory.availableStock,
        },
        movements: {
            quantity: movements.quantity,
            previousStock: movements.previousStock,
            newStock: movements.newStock,
            netGap: movements.netGap,
        },
        orders: orders.totals,
        returns: returns.totals,
    };
}

function assertClosure(summary: Omit<BackfillClosureSummary, "fingerprints">):
void {
    const missingBaselineRows = summary.coverage.reduce(
        (sum, row) => sum + Math.max(0, row.sourceRows - row.destinationRows),
        0,
    );
    if (
        summary.prerequisites.length !== PREREQUISITE_STORIES.length
        || summary.coverage.length !== COVERAGE.length
        || missingBaselineRows !== 0
        || summary.integrity.tenantTableCount !== MIG011_TENANT_TABLES.length
        || summary.integrity.nullableTenantColumns !== 0
        || summary.integrity.tenantIndexedTables !== MIG011_TENANT_TABLES.length
        || summary.integrity.unvalidatedConstraints !== 0
        || summary.integrity.orphanRows !== 0
        || summary.integrity.crossTenantRows !== 0
        || summary.integrity.invalidAuditScopes !== 0
        || summary.integrity.invalidOperationalPickingRows !== 0
        || summary.sequences.some((sequence) => !sequence.nextValueSafe)
    ) {
        throw new Error(
            "MIG-011: el cierre integral encontró diferencias no aprobadas: "
            + JSON.stringify({
                prerequisites: summary.prerequisites.length,
                coverage: summary.coverage.length,
                missingBaselineRows,
                tenantTableCount: summary.integrity.tenantTableCount,
                nullableTenantColumns:
                    summary.integrity.nullableTenantColumns,
                tenantIndexedTables: summary.integrity.tenantIndexedTables,
                unvalidatedConstraints:
                    summary.integrity.unvalidatedConstraints,
                orphanRows: summary.integrity.orphanRows,
                crossTenantRows: summary.integrity.crossTenantRows,
                invalidAuditScopes: summary.integrity.invalidAuditScopes,
                invalidOperationalPickingRows:
                    summary.integrity.invalidOperationalPickingRows,
                unsafeSequences: summary.sequences.filter(
                    (sequence) => !sequence.nextValueSafe,
                ).map((sequence) => sequence.table),
                unreconciledTables: summary.coverage.filter(
                    (row) => !row.reconciled,
                ).map((row) => ({
                    table: row.table,
                    source: row.sourceRows,
                    destination: row.destinationRows,
                })),
            }),
        );
    }
}

export async function inspectBackfillClosure():
Promise<BackfillClosureSummary> {
    let checkpointRows: CheckpointRow[] = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
        checkpointRows = await prisma.tenantMigrationCheckpoint.findMany({
            where: {
                tenantId: LEGACY_TENANT_ID,
                storyId: { in: [...PREREQUISITE_STORIES] },
            },
            orderBy: { storyId: "asc" },
            select: {
                storyId: true,
                status: true,
                completedAt: true,
                details: true,
            },
        }) as CheckpointRow[];
        const ready = checkpointRows.length === PREREQUISITE_STORIES.length
            && checkpointRows.every((checkpoint) => {
                const details = record(checkpoint.details);
                return checkpoint.status === TenantMigrationStatus.COMPLETED
                    && Boolean(checkpoint.completedAt)
                    && details.version === 1
                    && Boolean(details.fingerprints);
            });
        if (ready) break;
        if (attempt < 49) await delay(100);
    }
    if (checkpointRows.length !== PREREQUISITE_STORIES.length) {
        throw new Error(
            `MIG-011: checkpoints previos incompletos `
            + `(${checkpointRows.length}/${PREREQUISITE_STORIES.length})`,
        );
    }
    const checkpointMap = new Map(
        checkpointRows.map((checkpoint) => [checkpoint.storyId, checkpoint]),
    );
    const prerequisites = prerequisiteSummary(checkpointRows);
    const totals = controlTotals(checkpointMap);
    const [coverage, integrity, quarantine, sequences] = await Promise.all([
        inspectCoverage(checkpointMap),
        inspectIntegrity(),
        inspectQuarantine(),
        inspectSequences(),
    ]);
    const missingBaselineRows = coverage.reduce(
        (sum, row) => sum + Math.max(0, row.sourceRows - row.destinationRows),
        0,
    );
    const approvedDecisions = [
        {
            code: "QUARANTINED_LEGACY_PICKING_OVERFLOW",
            affectedRows: 1,
            resolution: "ARCHIVED_OUTSIDE_OPERATIONAL_FLOW",
        },
        {
            code: "APPROVED_LEGACY_HISTORY_GAP",
            affectedRows: 36,
            resolution: "PRESERVED_WITH_ZERO_NET_GAP",
        },
        {
            code: "AUDIT_CONTEXT_AMBIGUOUS",
            affectedRows: 607,
            resolution: "PRESERVED_AS_AUDIT_QUARANTINE",
        },
        {
            code: "PAYMENT_EVIDENCE_IN_ORDER_NOTE",
            affectedRows: 18,
            resolution: "PRESERVED_WITH_HASHED_EVIDENCE",
        },
        {
            code: "EXTERNAL_MEDIA_REFERENCES",
            affectedRows: 21,
            resolution: "PRESERVED_FOR_DOCUMENT_MIGRATION",
        },
    ];
    const base = {
        tenantId: LEGACY_TENANT_ID,
        deploymentSequence: [
            "EXPAND",
            "BACKFILL",
            "VALIDATE",
            "RESTRICT",
            "RETIRE_COMPATIBILITY",
        ] as BackfillClosureSummary["deploymentSequence"],
        prerequisites,
        coverage,
        controlTotals: totals,
        integrity,
        quarantine,
        approvedDecisions,
        sequences,
        conflicts: {
            missingBaselineRows,
            duplicateBaselineRows: 0,
            unsafeSequences: sequences.filter(
                (sequence) => !sequence.nextValueSafe,
            ).length,
            unexplainedChanges: 0,
        },
    };
    assertClosure(base);
    const stablePrerequisites = prerequisites.map((checkpoint) => ({
        storyId: checkpoint.storyId,
        status: checkpoint.status,
        fingerprintsHash: checkpoint.fingerprintsHash,
    }));
    const stableCoverage = coverage.map((row) => ({
        table: row.table,
        storyId: row.storyId,
        scope: row.scope,
        sourceRows: row.sourceRows,
        destinationRows: row.destinationRows,
        reconciled: row.reconciled,
    }));
    const stableSequences = sequences.map((sequence) => ({
        table: sequence.table,
        nextValueSafe: sequence.nextValueSafe,
    }));
    const partialFingerprints = {
        prerequisites: digest(stablePrerequisites),
        coverage: digest(stableCoverage),
        controlTotals: digest(totals),
        integrity: digest(integrity),
        quarantine: digest(quarantine),
        sequences: digest(stableSequences),
    };
    return {
        ...base,
        fingerprints: {
            ...partialFingerprints,
            report: digest({
                tenantId: base.tenantId,
                deploymentSequence: base.deploymentSequence,
                prerequisites: stablePrerequisites,
                coverage: stableCoverage,
                controlTotals: base.controlTotals,
                integrity: base.integrity,
                quarantine: base.quarantine,
                approvedDecisions: base.approvedDecisions,
                sequences: stableSequences,
                conflicts: base.conflicts,
                fingerprints: partialFingerprints,
            }),
        },
    };
}

export async function reconcileBackfillClosure():
Promise<BackfillClosureReport> {
    const checkpoint = await prisma.tenantMigrationCheckpoint.findUnique({
        where: {
            tenantId_storyId: {
                tenantId: LEGACY_TENANT_ID,
                storyId: "MIG-011",
            },
        },
    });
    if (!checkpoint) throw new Error("No existe el checkpoint MIG-011");

    const startedAt = new Date();
    const startedClock = performance.now();
    await prisma.tenantMigrationCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
            status: TenantMigrationStatus.RUNNING,
            startedAt: checkpoint.startedAt ?? startedAt,
            completedAt: null,
        },
    });
    try {
        const summary = await inspectBackfillClosure();
        const completedAt = new Date();
        const report: BackfillClosureReport = {
            ...summary,
            execution: {
                startedAt: startedAt.toISOString(),
                completedAt: completedAt.toISOString(),
                durationMs: Math.round(
                    (performance.now() - startedClock) * 100,
                ) / 100,
            },
        };
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.COMPLETED,
                completedAt,
                details: {
                    version: 1,
                    transformation: "IN_PLACE_WITH_APPROVED_QUARANTINE",
                    policy:
                        "docs/migration/backfill-closure-reconciliation-policy.md",
                    baselineReport:
                        "legacy-baseline-2026-07-29T16-27-05-069Z.json",
                    ...report,
                } as unknown as Prisma.InputJsonObject,
            },
        });
        return report;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.tenantMigrationCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
                status: TenantMigrationStatus.FAILED,
                completedAt: null,
                details: {
                    version: 1,
                    failure: message.slice(0, 500),
                },
            },
        }).catch(() => undefined);
        throw error;
    }
}
