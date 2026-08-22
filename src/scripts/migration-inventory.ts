import "dotenv/config";
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client, QueryResultRow } from "pg";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

interface TableMetadata {
    name: string;
    type: string;
}

interface ColumnMetadata {
    table: string;
    name: string;
    position: number;
    dataType: string;
    databaseType: string;
    nullable: boolean;
    hasDefault: boolean;
    identity: boolean;
    generated: string;
}

interface ConstraintMetadata {
    table: string;
    name: string;
    type: string;
    definition: string;
}

interface IndexMetadata {
    table: string;
    name: string;
    definition: string;
}

interface SequenceMetadata {
    name: string;
    dataType: string;
    start: string;
    increment: string;
    lastValue: string | null;
}

interface ForeignKeyMetadata {
    name: string;
    childTable: string;
    parentTable: string;
    childColumns: string[];
    parentColumns: string[];
}

export interface InventoryFinding {
    id: string;
    category: "ORPHAN" | "DUPLICATE" | "INVALID" | "MEDIA" | "UNSTRUCTURED";
    subject: string;
    affectedRows: number;
    suggestedAction: "MIGRATE" | "TRANSFORM" | "ARCHIVE" | "QUARANTINE" | "EXCLUDE";
    decisionStatus: "PENDING_APPROVAL";
    detail: string;
}

export interface MigrationInventoryReport {
    reportVersion: 1;
    generatedAt: string;
    scope: "LEGACY_BASELINE";
    safety: {
        transactionReadOnly: true;
        isolationLevel: "repeatable read";
        containsRowValues: false;
        fetchedRemoteMedia: false;
    };
    database: {
        schema: string;
        postgresVersion: string;
        transactionReadOnlyVerified: boolean;
    };
    schemaInventory: {
        schemaHash: string;
        tables: TableMetadata[];
        columns: ColumnMetadata[];
        constraints: ConstraintMetadata[];
        indexes: IndexMetadata[];
        sequences: SequenceMetadata[];
        extensions: string[];
        views: string[];
        appliedMigrations: Array<{
            name: string;
            checksum: string;
            finishedAt: string | null;
            rolledBackAt: string | null;
        }>;
    };
    dataBaseline: {
        tableCounts: Record<string, number>;
        stateCounts: Record<string, Record<string, number>>;
        controlTotals: Record<string, string>;
        sequencePositions: Record<string, string | null>;
        baselineHash: string;
    };
    integrity: {
        orphanForeignKeys: Array<{
            constraint: string;
            childTable: string;
            parentTable: string;
            affectedRows: number;
        }>;
        logicalDuplicates: Array<{
            rule: string;
            table: string;
            duplicateGroups: number;
            affectedRows: number;
        }>;
        invalidValues: Array<{
            rule: string;
            table: string;
            affectedRows: number;
        }>;
    };
    media: {
        totalReferences: number;
        httpsReferences: number;
        httpReferences: number;
        malformedOrUnsupported: number;
        duplicateReferenceGroups: number;
        cloudinaryReferences: number;
        hostCounts: Record<string, number>;
        remoteAvailabilityChecked: boolean;
        remoteReachable: number;
        remoteMissing: number;
        remoteIndeterminate: number;
    };
    unstructuredData: {
        ordersWithNote: number;
        ordersWithPaymentMethodEvidence: number;
        ordersWithPaymentReferenceEvidence: number;
        ordersWithAmountOrChangeEvidence: number;
        structuredPaymentTablePresent: boolean;
    };
    findings: InventoryFinding[];
    comparison?: BaselineComparison;
}

export interface BaselineComparison {
    previousGeneratedAt: string;
    schemaChanged: boolean;
    changedTableCounts: Array<{ table: string; before: number; after: number }>;
    changedControlTotals: Array<{ metric: string; before: string; after: string }>;
    changedSequencePositions: Array<{
        sequence: string;
        before: string | null;
        after: string | null;
    }>;
    changedFindings: Array<{ finding: string; before: number; after: number }>;
}

interface DuplicateRule {
    id: string;
    table: string;
    expression: string;
}

interface InvalidRule {
    id: string;
    table: string;
    expression: string;
}

const STATE_COLUMNS: Record<string, string[]> = {
    Order: ["status", "returnResponsibilityStatus"],
    OrderItem: ["status"],
    Reservation: ["status"],
    PickingSession: ["status"],
    StockTransfer: ["status"],
    PickingResponsibilityRequest: ["status", "mode"],
    PickingUnpickRequest: ["status"],
};

const CONTROL_TOTAL_COLUMNS: Record<string, string[]> = {
    Inventory: ["stock", "reservedStock"],
    InventoryMovement: ["quantity", "previousStock", "newStock"],
    StockTransferItem: ["quantity"],
    Reservation: ["quantity"],
    PickingItem: ["quantity", "pickedQuantity"],
    PickingItemContribution: ["quantity"],
    PickingOrderItemDetail: ["pickedQuantity"],
    Order: ["subtotal", "tax", "total"],
    OrderItem: [
        "quantity",
        "reserved",
        "picked",
        "shortageQuantity",
        "returnedQuantity",
        "subtotal",
    ],
    OrderReturn: ["totalQuantity", "totalAmount"],
    OrderReturnItem: ["quantity", "subtotal"],
};

const DUPLICATE_RULES: DuplicateRule[] = [
    { id: "category_name_normalized", table: "Category", expression: `lower(btrim("name"))` },
    { id: "color_name_normalized", table: "Color", expression: `lower(btrim("name"))` },
    { id: "size_name_normalized", table: "Size", expression: `lower(btrim("name"))` },
    { id: "variant_sku_normalized", table: "ProductVariant", expression: `lower(btrim("sku"))` },
    { id: "store_code_normalized", table: "Store", expression: `lower(btrim("code"))` },
    { id: "transfer_code_normalized", table: "StockTransfer", expression: `lower(btrim("code"))` },
    { id: "order_code_normalized", table: "Order", expression: `lower(btrim("code"))` },
    { id: "user_email_normalized", table: "User", expression: `lower(btrim("email"))` },
    {
        id: "marketplace_customer_email_normalized",
        table: "MarketplaceCustomer",
        expression: `lower(btrim("email"))`,
    },
    { id: "role_name_normalized", table: "Role", expression: `lower(btrim("name"))` },
    { id: "permission_code_normalized", table: "Permission", expression: `lower(btrim("code"))` },
    { id: "payment_method_code_normalized", table: "PaymentMethod", expression: `lower(btrim("code"))` },
    { id: "system_setting_key_normalized", table: "SystemSetting", expression: `lower(btrim("key"))` },
];

const INVALID_RULES: InvalidRule[] = [
    { id: "inventory_negative_stock", table: "Inventory", expression: `"stock" < 0` },
    {
        id: "inventory_invalid_reserved_stock",
        table: "Inventory",
        expression: `"reservedStock" < 0 OR "reservedStock" > "stock"`,
    },
    { id: "reservation_non_positive", table: "Reservation", expression: `"quantity" <= 0` },
    {
        id: "picking_quantity_invalid",
        table: "PickingItem",
        expression: `"quantity" <= 0 OR "pickedQuantity" < 0 OR "pickedQuantity" > "quantity"`,
    },
    {
        id: "transfer_same_origin_destination",
        table: "StockTransfer",
        expression: `"fromStoreId" = "toStoreId"`,
    },
    {
        id: "transfer_item_non_positive",
        table: "StockTransferItem",
        expression: `"quantity" <= 0`,
    },
    {
        id: "order_negative_total",
        table: "Order",
        expression: `"subtotal" < 0 OR "tax" < 0 OR "total" < 0`,
    },
    {
        id: "order_item_quantity_invalid",
        table: "OrderItem",
        expression:
            `"quantity" <= 0 OR "reserved" < 0 OR "picked" < 0 `
            + `OR "shortageQuantity" < 0 OR "returnedQuantity" < 0 `
            + `OR "reserved" > "quantity" OR "picked" > "quantity" `
            + `OR "returnedQuantity" > "quantity" OR "subtotal" < 0`,
    },
    {
        id: "return_negative_total",
        table: "OrderReturn",
        expression: `"totalQuantity" < 0 OR "totalAmount" < 0`,
    },
    {
        id: "return_item_invalid",
        table: "OrderReturnItem",
        expression: `"quantity" <= 0 OR "unitPrice" < 0 OR "subtotal" < 0`,
    },
];

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function canonicalize(value: JsonValue): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const object = value as Record<string, JsonValue>;
        return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key] ?? null)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

export function stableHash(value: JsonValue): string {
    return crypto.createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function numberValue(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Valor numérico inválido en inventario: ${value}`);
    return parsed;
}

function textValue(value: unknown): string {
    return value === null || value === undefined ? "0" : String(value);
}

async function queryRows<T extends QueryResultRow>(
    client: Client,
    text: string,
    values: unknown[] = [],
): Promise<T[]> {
    return (await client.query<T>(text, values)).rows;
}

function hasTable(tableNames: Set<string>, table: string): boolean {
    return tableNames.has(table);
}

function hasColumn(columnNames: Map<string, Set<string>>, table: string, column: string): boolean {
    return columnNames.get(table)?.has(column) ?? false;
}

async function readSchemaInventory(
    client: Client,
    schema: string,
): Promise<MigrationInventoryReport["schemaInventory"]> {
    const tables = await queryRows<{ table_name: string; table_type: string }>(
        client,
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema],
    );
    const columns = await queryRows<{
        table_name: string;
        column_name: string;
        ordinal_position: number;
        data_type: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
        is_identity: string;
        is_generated: string;
    }>(
        client,
        `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
                is_nullable, column_default, is_identity, is_generated
         FROM information_schema.columns
         WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [schema],
    );
    const constraints = await queryRows<{
        table_name: string;
        constraint_name: string;
        constraint_type: string;
        definition: string;
    }>(
        client,
        `SELECT rel.relname AS table_name,
                con.conname AS constraint_name,
                con.contype::text AS constraint_type,
                pg_get_constraintdef(con.oid, true) AS definition
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = con.connamespace
         WHERE ns.nspname = $1
         ORDER BY rel.relname, con.conname`,
        [schema],
    );
    const indexes = await queryRows<{
        tablename: string;
        indexname: string;
        indexdef: string;
    }>(
        client,
        `SELECT tablename, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = $1
         ORDER BY tablename, indexname`,
        [schema],
    );
    const sequences = await queryRows<{
        sequence_name: string;
        data_type: string;
        start_value: string;
        increment: string;
    }>(
        client,
        `SELECT sequence_name, data_type, start_value, increment
         FROM information_schema.sequences
         WHERE sequence_schema = $1
         ORDER BY sequence_name`,
        [schema],
    );
    const sequenceMetadata: SequenceMetadata[] = [];
    for (const sequence of sequences) {
        const last = await queryRows<{ last_value: string | number | null }>(
            client,
            `SELECT last_value FROM ${quoteIdentifier(schema)}.${quoteIdentifier(sequence.sequence_name)}`,
        );
        sequenceMetadata.push({
            name: sequence.sequence_name,
            dataType: sequence.data_type,
            start: sequence.start_value,
            increment: sequence.increment,
            lastValue: last[0]?.last_value === null || last[0]?.last_value === undefined
                ? null
                : String(last[0].last_value),
        });
    }
    const extensions = await queryRows<{ extname: string }>(
        client,
        `SELECT extname FROM pg_extension ORDER BY extname`,
    );
    const views = await queryRows<{ table_name: string }>(
        client,
        `SELECT table_name
         FROM information_schema.views
         WHERE table_schema = $1
         ORDER BY table_name`,
        [schema],
    );
    const migrationsTable = tables.some((table) => table.table_name === "_prisma_migrations");
    const appliedMigrations = migrationsTable
        ? await queryRows<{
            migration_name: string;
            checksum: string;
            finished_at: Date | null;
            rolled_back_at: Date | null;
        }>(
            client,
            `SELECT migration_name, checksum, finished_at, rolled_back_at
             FROM ${quoteIdentifier(schema)}."_prisma_migrations"
             ORDER BY started_at, migration_name`,
        )
        : [];

    const normalized = {
        tables: tables.map((row) => ({ name: row.table_name, type: row.table_type })),
        columns: columns.map((row) => ({
            table: row.table_name,
            name: row.column_name,
            position: numberValue(row.ordinal_position),
            dataType: row.data_type,
            databaseType: row.udt_name,
            nullable: row.is_nullable === "YES",
            hasDefault: row.column_default !== null,
            identity: row.is_identity === "YES",
            generated: row.is_generated,
        })),
        constraints: constraints.map((row) => ({
            table: row.table_name,
            name: row.constraint_name,
            type: row.constraint_type,
            definition: row.definition,
        })),
        indexes: indexes.map((row) => ({
            table: row.tablename,
            name: row.indexname,
            definition: row.indexdef,
        })),
        sequences: sequenceMetadata,
        extensions: extensions.map((row) => row.extname),
        views: views.map((row) => row.table_name),
        appliedMigrations: appliedMigrations.map((row) => ({
            name: row.migration_name,
            checksum: row.checksum,
            finishedAt: row.finished_at?.toISOString() ?? null,
            rolledBackAt: row.rolled_back_at?.toISOString() ?? null,
        })),
    };

    const structuralInventory = {
        ...normalized,
        sequences: normalized.sequences.map(({ lastValue: _lastValue, ...sequence }) => sequence),
    };

    return {
        schemaHash: stableHash(structuralInventory as unknown as JsonValue),
        ...normalized,
    };
}

async function readTableCounts(
    client: Client,
    schema: string,
    tables: TableMetadata[],
): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of tables.filter((candidate) => candidate.type === "BASE TABLE")) {
        const rows = await queryRows<{ count: string }>(
            client,
            `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table.name)}`,
        );
        counts[table.name] = numberValue(rows[0]?.count ?? 0);
    }
    return counts;
}

async function readStateCounts(
    client: Client,
    schema: string,
    tableNames: Set<string>,
    columnNames: Map<string, Set<string>>,
): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [table, columns] of Object.entries(STATE_COLUMNS)) {
        if (!hasTable(tableNames, table)) continue;
        for (const column of columns) {
            if (!hasColumn(columnNames, table, column)) continue;
            const rows = await queryRows<{ value: string | null; count: string }>(
                client,
                `SELECT COALESCE(${quoteIdentifier(column)}::text, '(NULL)') AS value,
                        COUNT(*)::text AS count
                 FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
                 GROUP BY ${quoteIdentifier(column)}
                 ORDER BY value`,
            );
            result[`${table}.${column}`] = Object.fromEntries(
                rows.map((row) => [row.value ?? "(NULL)", numberValue(row.count)]),
            );
        }
    }
    return result;
}

async function readControlTotals(
    client: Client,
    schema: string,
    tableNames: Set<string>,
    columnNames: Map<string, Set<string>>,
): Promise<Record<string, string>> {
    const totals: Record<string, string> = {};
    for (const [table, columns] of Object.entries(CONTROL_TOTAL_COLUMNS)) {
        if (!hasTable(tableNames, table)) continue;
        for (const column of columns) {
            if (!hasColumn(columnNames, table, column)) continue;
            const rows = await queryRows<{ total: string | null }>(
                client,
                `SELECT COALESCE(SUM(${quoteIdentifier(column)}), 0)::text AS total
                 FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
            );
            totals[`${table}.${column}`] = textValue(rows[0]?.total);
        }
    }
    return totals;
}

async function readForeignKeys(client: Client, schema: string): Promise<ForeignKeyMetadata[]> {
    const rows = await queryRows<{
        constraint_name: string;
        child_table: string;
        parent_table: string;
        child_columns: string[];
        parent_columns: string[];
    }>(
        client,
        `SELECT con.conname AS constraint_name,
                child.relname AS child_table,
                parent.relname AS parent_table,
                array_agg(child_att.attname::text ORDER BY keys.ordinality) AS child_columns,
                array_agg(parent_att.attname::text ORDER BY keys.ordinality) AS parent_columns
         FROM pg_constraint con
         JOIN pg_class child ON child.oid = con.conrelid
         JOIN pg_class parent ON parent.oid = con.confrelid
         JOIN pg_namespace ns ON ns.oid = con.connamespace
         CROSS JOIN LATERAL
             unnest(con.conkey, con.confkey) WITH ORDINALITY
             AS keys(child_attnum, parent_attnum, ordinality)
         JOIN pg_attribute child_att
           ON child_att.attrelid = child.oid AND child_att.attnum = keys.child_attnum
         JOIN pg_attribute parent_att
           ON parent_att.attrelid = parent.oid AND parent_att.attnum = keys.parent_attnum
         WHERE con.contype = 'f' AND ns.nspname = $1
         GROUP BY con.conname, child.relname, parent.relname
         ORDER BY child.relname, con.conname`,
        [schema],
    );
    return rows.map((row) => ({
        name: row.constraint_name,
        childTable: row.child_table,
        parentTable: row.parent_table,
        childColumns: row.child_columns,
        parentColumns: row.parent_columns,
    }));
}

async function detectOrphans(
    client: Client,
    schema: string,
    foreignKeys: ForeignKeyMetadata[],
): Promise<MigrationInventoryReport["integrity"]["orphanForeignKeys"]> {
    const result: MigrationInventoryReport["integrity"]["orphanForeignKeys"] = [];
    for (const foreignKey of foreignKeys) {
        const join = foreignKey.childColumns
            .map(
                (column, index) =>
                    `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(
                        foreignKey.parentColumns[index] ?? "",
                    )}`,
            )
            .join(" AND ");
        const present = foreignKey.childColumns
            .map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`)
            .join(" AND ");
        const missing = `parent.${quoteIdentifier(foreignKey.parentColumns[0] ?? "")} IS NULL`;
        const rows = await queryRows<{ count: string }>(
            client,
            `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.childTable)} child
             LEFT JOIN ${quoteIdentifier(schema)}.${quoteIdentifier(foreignKey.parentTable)} parent
               ON ${join}
             WHERE ${present} AND ${missing}`,
        );
        const affectedRows = numberValue(rows[0]?.count ?? 0);
        if (affectedRows > 0) {
            result.push({
                constraint: foreignKey.name,
                childTable: foreignKey.childTable,
                parentTable: foreignKey.parentTable,
                affectedRows,
            });
        }
    }
    return result;
}

async function detectDuplicates(
    client: Client,
    schema: string,
    tableNames: Set<string>,
): Promise<MigrationInventoryReport["integrity"]["logicalDuplicates"]> {
    const result: MigrationInventoryReport["integrity"]["logicalDuplicates"] = [];
    for (const rule of DUPLICATE_RULES) {
        if (!hasTable(tableNames, rule.table)) continue;
        const rows = await queryRows<{ duplicate_groups: string; affected_rows: string }>(
            client,
            `SELECT COUNT(*)::text AS duplicate_groups,
                    COALESCE(SUM(group_count), 0)::text AS affected_rows
             FROM (
                 SELECT COUNT(*) AS group_count
                 FROM ${quoteIdentifier(schema)}.${quoteIdentifier(rule.table)}
                 GROUP BY ${rule.expression}
                 HAVING COUNT(*) > 1
             ) duplicates`,
        );
        const duplicateGroups = numberValue(rows[0]?.duplicate_groups ?? 0);
        const affectedRows = numberValue(rows[0]?.affected_rows ?? 0);
        if (duplicateGroups > 0) {
            result.push({
                rule: rule.id,
                table: rule.table,
                duplicateGroups,
                affectedRows,
            });
        }
    }
    return result;
}

async function detectInvalidValues(
    client: Client,
    schema: string,
    tableNames: Set<string>,
): Promise<MigrationInventoryReport["integrity"]["invalidValues"]> {
    const result: MigrationInventoryReport["integrity"]["invalidValues"] = [];
    for (const rule of INVALID_RULES) {
        if (!hasTable(tableNames, rule.table)) continue;
        const rows = await queryRows<{ count: string }>(
            client,
            `SELECT COUNT(*)::text AS count
             FROM ${quoteIdentifier(schema)}.${quoteIdentifier(rule.table)}
             WHERE ${rule.expression}`,
        );
        const affectedRows = numberValue(rows[0]?.count ?? 0);
        if (affectedRows > 0) {
            result.push({
                rule: rule.id,
                table: rule.table,
                affectedRows,
            });
        }
    }
    return result;
}

async function readMediaInventory(
    client: Client,
    schema: string,
    tableNames: Set<string>,
    columnNames: Map<string, Set<string>>,
    checkRemoteAvailability: boolean,
): Promise<MigrationInventoryReport["media"]> {
    const references: string[] = [];
    const mediaColumns: Array<{ table: string; column: string; where?: string }> = [
        { table: "ProductImage", column: "url" },
        { table: "ProductVariant", column: "imageUrl" },
        {
            table: "SystemSetting",
            column: "value",
            where: `"key" = 'company_logo_url'`,
        },
    ];
    for (const item of mediaColumns) {
        if (!hasTable(tableNames, item.table) || !hasColumn(columnNames, item.table, item.column)) {
            continue;
        }
        const rows = await queryRows<{ value: string | null }>(
            client,
            `SELECT ${quoteIdentifier(item.column)} AS value
             FROM ${quoteIdentifier(schema)}.${quoteIdentifier(item.table)}
             WHERE ${quoteIdentifier(item.column)} IS NOT NULL
               ${item.where ? `AND ${item.where}` : ""}`,
        );
        for (const row of rows) {
            if (row.value) references.push(row.value);
        }
    }

    let httpsReferences = 0;
    let httpReferences = 0;
    let malformedOrUnsupported = 0;
    let cloudinaryReferences = 0;
    const hosts = new Map<string, number>();
    const exactCounts = new Map<string, number>();
    for (const reference of references) {
        exactCounts.set(reference, (exactCounts.get(reference) ?? 0) + 1);
        try {
            const parsed = new URL(reference);
            if (parsed.protocol === "https:") httpsReferences += 1;
            else if (parsed.protocol === "http:") httpReferences += 1;
            else {
                malformedOrUnsupported += 1;
                continue;
            }
            const host = parsed.hostname.toLowerCase();
            hosts.set(host, (hosts.get(host) ?? 0) + 1);
            if (host === "res.cloudinary.com" || host.endsWith(".cloudinary.com")) {
                cloudinaryReferences += 1;
            }
        } catch {
            malformedOrUnsupported += 1;
        }
    }

    let remoteReachable = 0;
    let remoteMissing = 0;
    let remoteIndeterminate = 0;
    if (checkRemoteAvailability) {
        const uniqueNetworkReferences = [...new Set(references)].filter((reference) => {
            try {
                const parsed = new URL(reference);
                return parsed.protocol === "http:" || parsed.protocol === "https:";
            } catch {
                return false;
            }
        });
        const concurrency = 5;
        for (let index = 0; index < uniqueNetworkReferences.length; index += concurrency) {
            const batch = uniqueNetworkReferences.slice(index, index + concurrency);
            const statuses = await Promise.all(
                batch.map(async (reference): Promise<"reachable" | "missing" | "indeterminate"> => {
                    try {
                        const response = await fetch(reference, {
                            method: "HEAD",
                            redirect: "follow",
                            signal: AbortSignal.timeout(5_000),
                        });
                        if (response.status === 404 || response.status === 410) return "missing";
                        if (response.ok || (response.status >= 300 && response.status < 400)) {
                            return "reachable";
                        }
                        return "indeterminate";
                    } catch {
                        return "indeterminate";
                    }
                }),
            );
            remoteReachable += statuses.filter((status) => status === "reachable").length;
            remoteMissing += statuses.filter((status) => status === "missing").length;
            remoteIndeterminate += statuses.filter((status) => status === "indeterminate").length;
        }
    }

    return {
        totalReferences: references.length,
        httpsReferences,
        httpReferences,
        malformedOrUnsupported,
        duplicateReferenceGroups: [...exactCounts.values()].filter((count) => count > 1).length,
        cloudinaryReferences,
        hostCounts: Object.fromEntries([...hosts.entries()].sort(([left], [right]) => left.localeCompare(right))),
        remoteAvailabilityChecked: checkRemoteAvailability,
        remoteReachable,
        remoteMissing,
        remoteIndeterminate,
    };
}

async function readUnstructuredData(
    client: Client,
    schema: string,
    tableNames: Set<string>,
    columnNames: Map<string, Set<string>>,
): Promise<MigrationInventoryReport["unstructuredData"]> {
    const empty = {
        ordersWithNote: 0,
        ordersWithPaymentMethodEvidence: 0,
        ordersWithPaymentReferenceEvidence: 0,
        ordersWithAmountOrChangeEvidence: 0,
        structuredPaymentTablePresent:
            hasTable(tableNames, "Payment") || hasTable(tableNames, "OrderPayment"),
    };
    if (!hasTable(tableNames, "Order") || !hasColumn(columnNames, "Order", "note")) {
        return empty;
    }

    const rows = await queryRows<{
        with_note: string;
        with_method: string;
        with_reference: string;
        with_amount: string;
    }>(
        client,
        `SELECT
             COUNT(*) FILTER (WHERE "note" IS NOT NULL AND btrim("note") <> '')::text AS with_note,
             COUNT(*) FILTER (
                 WHERE "note" ~* '(metodo[_ ]?pago|método de pago|metodo de pago)'
             )::text AS with_method,
             COUNT(*) FILTER (WHERE "note" ~* '(^|[|[:space:]])ref[[:space:]]*:')::text
                 AS with_reference,
             COUNT(*) FILTER (
                 WHERE "note" ~* '(monto recibido|monto pagado|pagado|vuelto|cambio)[[:space:]]*:'
             )::text AS with_amount
         FROM ${quoteIdentifier(schema)}."Order"`,
    );
    return {
        ordersWithNote: numberValue(rows[0]?.with_note ?? 0),
        ordersWithPaymentMethodEvidence: numberValue(rows[0]?.with_method ?? 0),
        ordersWithPaymentReferenceEvidence: numberValue(rows[0]?.with_reference ?? 0),
        ordersWithAmountOrChangeEvidence: numberValue(rows[0]?.with_amount ?? 0),
        structuredPaymentTablePresent: empty.structuredPaymentTablePresent,
    };
}

export function buildFindingDecisions(
    integrity: MigrationInventoryReport["integrity"],
    media: MigrationInventoryReport["media"],
    unstructuredData: MigrationInventoryReport["unstructuredData"],
): InventoryFinding[] {
    const findings: InventoryFinding[] = [];
    for (const orphan of integrity.orphanForeignKeys) {
        findings.push({
            id: `orphan:${orphan.constraint}`,
            category: "ORPHAN",
            subject: `${orphan.childTable}->${orphan.parentTable}`,
            affectedRows: orphan.affectedRows,
            suggestedAction: "QUARANTINE",
            decisionStatus: "PENDING_APPROVAL",
            detail: "Relación foránea sin padre verificable; no migrar silenciosamente.",
        });
    }
    for (const duplicate of integrity.logicalDuplicates) {
        findings.push({
            id: `duplicate:${duplicate.rule}`,
            category: "DUPLICATE",
            subject: duplicate.table,
            affectedRows: duplicate.affectedRows,
            suggestedAction: "TRANSFORM",
            decisionStatus: "PENDING_APPROVAL",
            detail: `${duplicate.duplicateGroups} grupos lógicos requieren una regla de resolución.`,
        });
    }
    for (const invalid of integrity.invalidValues) {
        findings.push({
            id: `invalid:${invalid.rule}`,
            category: "INVALID",
            subject: invalid.table,
            affectedRows: invalid.affectedRows,
            suggestedAction: "QUARANTINE",
            decisionStatus: "PENDING_APPROVAL",
            detail: "El valor no cumple la invariante objetivo y requiere decisión explícita.",
        });
    }
    if (media.totalReferences > 0) {
        findings.push({
            id: "media:external-references",
            category: "MEDIA",
            subject: "ProductImage/ProductVariant/SystemSetting",
            affectedRows: media.totalReferences,
            suggestedAction: "MIGRATE",
            decisionStatus: "PENDING_APPROVAL",
            detail: "Conservar referencias o migrarlas mediante manifiesto; disponibilidad remota no consultada.",
        });
    }
    if (media.malformedOrUnsupported > 0) {
        findings.push({
            id: "media:malformed-or-unsupported",
            category: "MEDIA",
            subject: "referencias de imagen/logo",
            affectedRows: media.malformedOrUnsupported,
            suggestedAction: "QUARANTINE",
            decisionStatus: "PENDING_APPROVAL",
            detail: "Referencia sin URL HTTP(S) válida; no descargar ni descartar automáticamente.",
        });
    }
    if (media.remoteMissing > 0) {
        findings.push({
            id: "media:remote-missing",
            category: "MEDIA",
            subject: "referencias de imagen/logo",
            affectedRows: media.remoteMissing,
            suggestedAction: "QUARANTINE",
            decisionStatus: "PENDING_APPROVAL",
            detail: "La verificación HEAD devolvió 404/410; no se descargó contenido.",
        });
    }
    if (unstructuredData.ordersWithPaymentMethodEvidence > 0) {
        findings.push({
            id: "unstructured:payment-in-order-note",
            category: "UNSTRUCTURED",
            subject: "Order.note",
            affectedRows: unstructuredData.ordersWithPaymentMethodEvidence,
            suggestedAction: "TRANSFORM",
            decisionStatus: "PENDING_APPROVAL",
            detail: unstructuredData.structuredPaymentTablePresent
                ? "Conciliar la evidencia de nota con la tabla de pagos."
                : "Definir modelo destino antes de estructurar la evidencia; no inventar transacciones.",
        });
    }
    return findings;
}

function findingCounts(report: MigrationInventoryReport): Record<string, number> {
    return Object.fromEntries(report.findings.map((finding) => [finding.id, finding.affectedRows]));
}

export function buildBaselineComparison(
    previous: MigrationInventoryReport,
    current: MigrationInventoryReport,
): BaselineComparison {
    const tableNames = new Set([
        ...Object.keys(previous.dataBaseline.tableCounts),
        ...Object.keys(current.dataBaseline.tableCounts),
    ]);
    const metricNames = new Set([
        ...Object.keys(previous.dataBaseline.controlTotals),
        ...Object.keys(current.dataBaseline.controlTotals),
    ]);
    const previousSequencePositions = previous.dataBaseline.sequencePositions ?? {};
    const currentSequencePositions = current.dataBaseline.sequencePositions ?? {};
    const sequenceNames = new Set([
        ...Object.keys(previousSequencePositions),
        ...Object.keys(currentSequencePositions),
    ]);
    const previousFindings = findingCounts(previous);
    const currentFindings = findingCounts(current);
    const findingNames = new Set([...Object.keys(previousFindings), ...Object.keys(currentFindings)]);

    return {
        previousGeneratedAt: previous.generatedAt,
        schemaChanged:
            previous.schemaInventory.schemaHash !== current.schemaInventory.schemaHash,
        changedTableCounts: [...tableNames]
            .sort()
            .map((table) => ({
                table,
                before: previous.dataBaseline.tableCounts[table] ?? 0,
                after: current.dataBaseline.tableCounts[table] ?? 0,
            }))
            .filter((item) => item.before !== item.after),
        changedControlTotals: [...metricNames]
            .sort()
            .map((metric) => ({
                metric,
                before: previous.dataBaseline.controlTotals[metric] ?? "0",
                after: current.dataBaseline.controlTotals[metric] ?? "0",
            }))
            .filter((item) => item.before !== item.after),
        changedSequencePositions: [...sequenceNames]
            .sort()
            .map((sequence) => ({
                sequence,
                before: previousSequencePositions[sequence] ?? null,
                after: currentSequencePositions[sequence] ?? null,
            }))
            .filter((item) => item.before !== item.after),
        changedFindings: [...findingNames]
            .sort()
            .map((finding) => ({
                finding,
                before: previousFindings[finding] ?? 0,
                after: currentFindings[finding] ?? 0,
            }))
            .filter((item) => item.before !== item.after),
    };
}

function reportMarkdown(report: MigrationInventoryReport, jsonFileName: string): string {
    const orphanRows = report.integrity.orphanForeignKeys.reduce(
        (sum, item) => sum + item.affectedRows,
        0,
    );
    const duplicateRows = report.integrity.logicalDuplicates.reduce(
        (sum, item) => sum + item.affectedRows,
        0,
    );
    const invalidRows = report.integrity.invalidValues.reduce(
        (sum, item) => sum + item.affectedRows,
        0,
    );
    const pending = report.findings.filter(
        (finding) => finding.decisionStatus === "PENDING_APPROVAL",
    );
    const comparison = report.comparison
        ? [
            "",
            "## Comparación",
            "",
            `- Esquema cambió: ${report.comparison.schemaChanged ? "sí" : "no"}.`,
            `- Conteos modificados: ${report.comparison.changedTableCounts.length}.`,
            `- Totales modificados: ${report.comparison.changedControlTotals.length}.`,
            `- Secuencias modificadas: ${report.comparison.changedSequencePositions.length}.`,
            `- Hallazgos modificados: ${report.comparison.changedFindings.length}.`,
        ].join("\n")
        : "";

    return `# Línea base de migración heredada

- Generada: ${report.generatedAt}
- JSON verificable: \`${jsonFileName}\`
- Schema SHA-256: \`${report.schemaInventory.schemaHash}\`
- Baseline SHA-256: \`${report.dataBaseline.baselineHash}\`
- Transacción: \`READ ONLY / REPEATABLE READ\`
- Valores de filas incluidos: no
- Descargas remotas realizadas: no

## Checklist

- [x] Tablas: ${report.schemaInventory.tables.length}
- [x] Columnas: ${report.schemaInventory.columns.length}
- [x] Restricciones: ${report.schemaInventory.constraints.length}
- [x] Índices: ${report.schemaInventory.indexes.length}
- [x] Secuencias: ${report.schemaInventory.sequences.length}
- [x] Migraciones Prisma registradas: ${report.schemaInventory.appliedMigrations.length}
- [x] Conteos por tabla: ${Object.keys(report.dataBaseline.tableCounts).length}
- [x] Grupos de estado: ${Object.keys(report.dataBaseline.stateCounts).length}
- [x] Totales de control: ${Object.keys(report.dataBaseline.controlTotals).length}
- [x] Huérfanos detectados: ${orphanRows}
- [x] Filas en grupos duplicados: ${duplicateRows}
- [x] Valores inválidos: ${invalidRows}
- [x] Referencias de medios: ${report.media.totalReferences}
- [${report.media.remoteAvailabilityChecked ? "x" : " "}] Disponibilidad remota comprobada con HEAD: ${report.media.remoteReachable} accesibles, ${report.media.remoteMissing} ausentes, ${report.media.remoteIndeterminate} indeterminadas
- [x] Pedidos con evidencia de pago en nota: ${report.unstructuredData.ordersWithPaymentMethodEvidence}
- [ ] Decisiones pendientes de aprobación: ${pending.length}

## Decisiones pendientes

${pending.length === 0
        ? "No se detectaron hallazgos que requieran decisión."
        : pending
            .map(
                (finding) =>
                    `- [ ] \`${finding.id}\`: ${finding.suggestedAction} `
                    + `(${finding.affectedRows} filas/referencias).`,
            )
            .join("\n")}
${comparison}
`;
}

function parseComparePath(args: string[]): string | undefined {
    const index = args.indexOf("--compare");
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (!value) throw new Error("--compare requiere la ruta de un reporte JSON anterior");
    return path.resolve(value);
}

async function collectReport(
    client: Client,
    checkRemoteAvailability: boolean,
): Promise<MigrationInventoryReport> {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
        const contextRows = await queryRows<{
            schema_name: string;
            postgres_version: string;
            transaction_read_only: string;
        }>(
            client,
            `SELECT current_schema() AS schema_name,
                    current_setting('server_version') AS postgres_version,
                    current_setting('transaction_read_only') AS transaction_read_only`,
        );
        const context = contextRows[0];
        if (!context || context.transaction_read_only !== "on") {
            throw new Error("La transacción de inventario no está en modo read-only");
        }
        const schema = context.schema_name;
        const schemaInventory = await readSchemaInventory(client, schema);
        const tableNames = new Set(schemaInventory.tables.map((table) => table.name));
        const columnNames = new Map<string, Set<string>>();
        for (const column of schemaInventory.columns) {
            const names = columnNames.get(column.table) ?? new Set<string>();
            names.add(column.name);
            columnNames.set(column.table, names);
        }

        const tableCounts = await readTableCounts(client, schema, schemaInventory.tables);
        const stateCounts = await readStateCounts(client, schema, tableNames, columnNames);
        const controlTotals = await readControlTotals(client, schema, tableNames, columnNames);
        const sequencePositions = Object.fromEntries(
            schemaInventory.sequences.map((sequence) => [sequence.name, sequence.lastValue]),
        );
        const foreignKeys = await readForeignKeys(client, schema);
        const integrity = {
            orphanForeignKeys: await detectOrphans(client, schema, foreignKeys),
            logicalDuplicates: await detectDuplicates(client, schema, tableNames),
            invalidValues: await detectInvalidValues(client, schema, tableNames),
        };
        const media = await readMediaInventory(
            client,
            schema,
            tableNames,
            columnNames,
            checkRemoteAvailability,
        );
        const unstructuredData = await readUnstructuredData(
            client,
            schema,
            tableNames,
            columnNames,
        );
        const findings = buildFindingDecisions(integrity, media, unstructuredData);
        const baselineHash = stableHash({
            tableCounts,
            stateCounts,
            controlTotals,
            sequencePositions,
            integrity,
            media: {
                totalReferences: media.totalReferences,
                httpsReferences: media.httpsReferences,
                httpReferences: media.httpReferences,
                malformedOrUnsupported: media.malformedOrUnsupported,
                duplicateReferenceGroups: media.duplicateReferenceGroups,
                cloudinaryReferences: media.cloudinaryReferences,
                hostCounts: media.hostCounts,
            },
            unstructuredData,
        } as unknown as JsonValue);

        return {
            reportVersion: 1,
            generatedAt: new Date().toISOString(),
            scope: "LEGACY_BASELINE",
            safety: {
                transactionReadOnly: true,
                isolationLevel: "repeatable read",
                containsRowValues: false,
                fetchedRemoteMedia: false,
            },
            database: {
                schema,
                postgresVersion: context.postgres_version,
                transactionReadOnlyVerified: true,
            },
            schemaInventory,
            dataBaseline: {
                tableCounts,
                stateCounts,
                controlTotals,
                sequencePositions,
                baselineHash,
            },
            integrity,
            media,
            unstructuredData,
            findings,
        };
    } finally {
        await client.query("ROLLBACK");
    }
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new Error("DATABASE_URL es obligatorio");

    const client = new Client({
        connectionString: databaseUrl,
        application_name: "migration-inventory-read-only",
    });
    await client.connect();
    let report: MigrationInventoryReport;
    try {
        report = await collectReport(
            client,
            process.argv.slice(2).includes("--check-media"),
        );
    } finally {
        await client.end();
    }

    const comparePath = parseComparePath(process.argv.slice(2));
    if (comparePath) {
        const previous = JSON.parse(
            await readFile(comparePath, "utf8"),
        ) as MigrationInventoryReport;
        report.comparison = buildBaselineComparison(previous, report);
    }

    const reportsDirectory = path.resolve(process.cwd(), "reports", "migration-inventory");
    await mkdir(reportsDirectory, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/g, "-");
    const baseName = `legacy-baseline-${stamp}`;
    const jsonFileName = `${baseName}.json`;
    const markdownFileName = `${baseName}.md`;
    const jsonPath = path.join(reportsDirectory, jsonFileName);
    const markdownPath = path.join(reportsDirectory, markdownFileName);

    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, reportMarkdown(report, jsonFileName), "utf8");

    console.info("[migration-inventory] Inventario read-only completado");
    console.info(`[migration-inventory] Tablas: ${report.schemaInventory.tables.length}`);
    console.info(`[migration-inventory] Hallazgos pendientes: ${report.findings.length}`);
    console.info(`[migration-inventory] Schema SHA-256: ${report.schemaInventory.schemaHash}`);
    console.info(`[migration-inventory] Baseline SHA-256: ${report.dataBaseline.baselineHash}`);
    console.info(`[migration-inventory] JSON: ${jsonPath}`);
    console.info(`[migration-inventory] Markdown: ${markdownPath}`);
}

if (require.main === module) {
    void main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[migration-inventory] Error: ${message}`);
        process.exitCode = 1;
    });
}
