import { Prisma } from "@prisma/client";
import { prisma } from "../../data/prisma";
import { LEGACY_TENANT_ID } from "./tenant-data-context";

const EXPECTED_TABLES = {
    ComprobanteSerie: {
        ids: [1, 2, 3],
        total: "17",
        fingerprint:
            "3816b95a054867d404c33a744b4b7670ec9bdefa9b088f5c4961043ba29a798b",
        metric: '"correlativo"',
    },
    Comprobante: {
        ids: [1, 2, 3, 4, 12, 13, 15, 16, 17, 18],
        total: "49",
        fingerprint:
            "73f98914bc802caa8d7156f21ffc5c589d1ea47f4b79519716b4c34b4ab2daaf",
        metric: '"numero"',
    },
    ComprobanteItem: {
        ids: [1, 2, 3, 4, 12, 13, 15, 16, 17, 18],
        total: "14.000",
        fingerprint:
            "079aa20a54d48ccce9c929219629fa87e9f983201ce3704deee3b10f260ff921",
        metric: '"cantidad"',
    },
    SunatDispatch: {
        ids: [1, 2, 3, 4, 10, 11],
        total: "0",
        fingerprint:
            "b72a5c6eabf7750c95a353532185723a84c10a595ad89f944722fe2d568d8a42",
        metric: "0",
    },
    ResumenDiario: {
        ids: [1, 2],
        total: "3",
        fingerprint:
            "adbc35dfd2b9c1d59a6d29e8732025dc8c58fe07129cc7148561532d2a1bcf8f",
        metric: '"correlativo"',
    },
    ComunicacionBaja: {
        ids: [1],
        total: "1",
        fingerprint:
            "64764627b5a69ac74589c0109e5247dc8b72a2f80022e0955ea258eb8a8b4198",
        metric: '"correlativo"',
    },
    SunatEmisorConfig: {
        ids: [],
        total: "0",
        fingerprint:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        metric: "0",
    },
} as const;

const REQUIRED_CONSTRAINTS = [
    "ComprobanteSerie_tenantId_fkey",
    "Comprobante_tenantId_fkey",
    "ComprobanteItem_tenantId_fkey",
    "SunatDispatch_tenantId_fkey",
    "ResumenDiario_tenantId_fkey",
    "ComunicacionBaja_tenantId_fkey",
    "SunatEmisorConfig_tenantId_fkey",
    "ComprobanteSerie_store_tenant_fkey",
    "Comprobante_afectado_tenant_fkey",
    "Comprobante_order_tenant_fkey",
    "Comprobante_serie_tenant_fkey",
    "Comprobante_resumen_tenant_fkey",
    "Comprobante_baja_tenant_fkey",
    "ComprobanteItem_comprobante_tenant_fkey",
    "SunatDispatch_comprobante_tenant_fkey",
    "SunatEmisorConfig_updated_user_tenant_fkey",
] as const;

const REQUIRED_INDEXES = [
    "ComprobanteSerie_tenantId_tipo_serie_key",
    "Comprobante_tenantId_nombreArchivo_key",
    "Comprobante_tenantId_tipo_serie_numero_key",
    "ResumenDiario_tenantId_fileName_key",
    "ComunicacionBaja_tenantId_fileName_key",
    "SunatEmisorConfig_tenantId_key",
] as const;

type SnapshotRow = {
    rowCount: number;
    ids: number[];
    total: string;
    fingerprint: string;
    foreignTenantRows: number;
};

export type SunatReconciliationSummary = {
    migration: string;
    tenantId: string;
    tables: Array<{
        table: keyof typeof EXPECTED_TABLES;
        rowCount: number;
        ids: number[];
        total: string;
        fingerprint: string;
    }>;
    tenantColumnsNotNull: number;
    validatedConstraints: number;
    requiredIndexes: number;
    crossTenantReferences: number;
    duplicateFiscalKeys: number;
};

async function inspectTable(
    table: keyof typeof EXPECTED_TABLES,
): Promise<SnapshotRow> {
    const expected = EXPECTED_TABLES[table];
    const rows = await prisma.$queryRawUnsafe<SnapshotRow[]>(
        `SELECT
             COUNT(*)::int AS "rowCount",
             COALESCE(array_agg(id ORDER BY id), ARRAY[]::int[]) AS ids,
             COALESCE(SUM(${expected.metric}), 0)::text AS total,
             encode(
                 sha256(
                     convert_to(
                         COALESCE(
                             string_agg(
                                 (to_jsonb(t) - 'tenantId')::text,
                                 E'\\n'
                                 ORDER BY id
                             ),
                             ''
                         ),
                         'UTF8'
                     )
                 ),
                 'hex'
             ) AS fingerprint,
             COUNT(*) FILTER (
                 WHERE "tenantId" <> $1::uuid
             )::int AS "foreignTenantRows"
         FROM "${table}" AS t
         WHERE id = ANY($2::int[])`,
        LEGACY_TENANT_ID,
        [...expected.ids],
    );
    const row = rows[0];
    if (!row) throw new Error(`No se pudo inspeccionar ${table}`);
    return row;
}

function assertSnapshot(
    table: keyof typeof EXPECTED_TABLES,
    actual: SnapshotRow,
): void {
    const expected = EXPECTED_TABLES[table];
    if (
        JSON.stringify(actual.ids) !== JSON.stringify(expected.ids)
        || actual.rowCount !== expected.ids.length
        || actual.total !== expected.total
        || actual.fingerprint !== expected.fingerprint
        || actual.foreignTenantRows !== 0
    ) {
        throw new Error(
            `Reconciliacion TEN-007 inesperada en ${table}: `
            + JSON.stringify(actual),
        );
    }
}

async function countCrossTenantReferences(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM (
            SELECT serie.id
            FROM "ComprobanteSerie" AS serie
            JOIN "Store" AS store ON store.id = serie."storeId"
            WHERE serie."tenantId" <> store."tenantId"

            UNION ALL

            SELECT comprobante.id
            FROM "Comprobante" AS comprobante
            JOIN "Order" AS orden ON orden.id = comprobante."orderId"
            WHERE comprobante."tenantId" <> orden."tenantId"

            UNION ALL

            SELECT comprobante.id
            FROM "Comprobante" AS comprobante
            JOIN "ComprobanteSerie" AS serie
              ON serie.id = comprobante."serieRefId"
            WHERE comprobante."tenantId" <> serie."tenantId"

            UNION ALL

            SELECT comprobante.id
            FROM "Comprobante" AS comprobante
            JOIN "Comprobante" AS afectado
              ON afectado.id = comprobante."comprobanteAfectadoId"
            WHERE comprobante."tenantId" <> afectado."tenantId"

            UNION ALL

            SELECT comprobante.id
            FROM "Comprobante" AS comprobante
            JOIN "ResumenDiario" AS resumen
              ON resumen.id = comprobante."resumenDiarioId"
            WHERE comprobante."tenantId" <> resumen."tenantId"

            UNION ALL

            SELECT comprobante.id
            FROM "Comprobante" AS comprobante
            JOIN "ComunicacionBaja" AS baja
              ON baja.id = comprobante."comunicacionBajaId"
            WHERE comprobante."tenantId" <> baja."tenantId"

            UNION ALL

            SELECT item.id
            FROM "ComprobanteItem" AS item
            JOIN "Comprobante" AS comprobante
              ON comprobante.id = item."comprobanteId"
            WHERE item."tenantId" <> comprobante."tenantId"

            UNION ALL

            SELECT dispatch.id
            FROM "SunatDispatch" AS dispatch
            JOIN "Comprobante" AS comprobante
              ON comprobante.id = dispatch."comprobanteId"
            WHERE dispatch."tenantId" <> comprobante."tenantId"

            UNION ALL

            SELECT config.id
            FROM "SunatEmisorConfig" AS config
            WHERE config."updatedById" IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM "TenantMembership" AS membership
                  WHERE membership."userId" = config."updatedById"
                    AND membership."tenantId" = config."tenantId"
              )
        ) AS conflicts
    `;
    return Number(rows[0]?.count ?? 0n);
}

async function countDuplicateFiscalKeys(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM (
            SELECT "tenantId", tipo::text, serie, NULL::int AS numero
            FROM "ComprobanteSerie"
            GROUP BY "tenantId", tipo, serie
            HAVING COUNT(*) > 1

            UNION ALL

            SELECT "tenantId", tipo::text, serie, numero
            FROM "Comprobante"
            GROUP BY "tenantId", tipo, serie, numero
            HAVING COUNT(*) > 1

            UNION ALL

            SELECT "tenantId", 'ARCHIVO', "nombreArchivo", NULL::int
            FROM "Comprobante"
            GROUP BY "tenantId", "nombreArchivo"
            HAVING COUNT(*) > 1
        ) AS duplicates
    `;
    return Number(rows[0]?.count ?? 0n);
}

export async function inspectSunatTenantMigration():
Promise<SunatReconciliationSummary> {
    const migrationRows = await prisma.$queryRawUnsafe<Array<{
        migration_name: string;
    }>>(
        `SELECT migration_name
         FROM "_prisma_migrations"
         WHERE migration_name = '20260729230000_tenant_scope_sunat'
           AND finished_at IS NOT NULL
           AND rolled_back_at IS NULL`,
    );
    if (migrationRows.length !== 1) {
        throw new Error("La migracion TEN-007 no esta aplicada");
    }

    const tables = await Promise.all(
        (Object.keys(EXPECTED_TABLES) as Array<keyof typeof EXPECTED_TABLES>)
            .map(async (table) => {
                const snapshot = await inspectTable(table);
                assertSnapshot(table, snapshot);
                return {
                    table,
                    rowCount: snapshot.rowCount,
                    ids: snapshot.ids,
                    total: snapshot.total,
                    fingerprint: snapshot.fingerprint,
                };
            }),
    );

    const [
        columns,
        constraints,
        indexes,
        crossTenantReferences,
        duplicateFiscalKeys,
    ] = await Promise.all([
        prisma.$queryRaw<Array<{
            table_name: string;
            is_nullable: string;
        }>>`
            SELECT table_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND column_name = 'tenantId'
              AND table_name IN (${Prisma.join(Object.keys(EXPECTED_TABLES))})
        `,
        prisma.$queryRaw<Array<{
            conname: string;
            convalidated: boolean;
        }>>`
            SELECT conname, convalidated
            FROM pg_constraint
            WHERE connamespace = current_schema()::regnamespace
              AND conname IN (${Prisma.join([...REQUIRED_CONSTRAINTS])})
        `,
        prisma.$queryRaw<Array<{ indexname: string }>>`
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND indexname IN (${Prisma.join([...REQUIRED_INDEXES])})
        `,
        countCrossTenantReferences(),
        countDuplicateFiscalKeys(),
    ]);

    const missingColumns = Object.keys(EXPECTED_TABLES).filter(
        (table) => !columns.some((column) => column.table_name === table),
    );
    const nullableColumns = columns.filter(
        (column) => column.is_nullable !== "NO",
    );
    if (missingColumns.length > 0 || nullableColumns.length > 0) {
        throw new Error(
            `tenantId SUNAT incompleto: faltan=${missingColumns.join(",")}; `
            + `nullable=${nullableColumns.map((row) => row.table_name).join(",")}`,
        );
    }

    const constraintNames = new Set(constraints.map((row) => row.conname));
    const missingConstraints = REQUIRED_CONSTRAINTS.filter(
        (name) => !constraintNames.has(name),
    );
    if (
        missingConstraints.length > 0
        || constraints.some((row) => !row.convalidated)
    ) {
        throw new Error(
            `Restricciones TEN-007 incompletas: ${missingConstraints.join(",")}`,
        );
    }

    const indexNames = new Set(indexes.map((row) => row.indexname));
    const missingIndexes = REQUIRED_INDEXES.filter(
        (name) => !indexNames.has(name),
    );
    if (missingIndexes.length > 0) {
        throw new Error(
            `Indices TEN-007 incompletos: ${missingIndexes.join(",")}`,
        );
    }
    if (crossTenantReferences !== 0 || duplicateFiscalKeys !== 0) {
        throw new Error(
            `Invariantes TEN-007 invalidas: cross=${crossTenantReferences}, `
            + `duplicados=${duplicateFiscalKeys}`,
        );
    }

    return {
        migration: migrationRows[0]!.migration_name,
        tenantId: LEGACY_TENANT_ID,
        tables,
        tenantColumnsNotNull: columns.length,
        validatedConstraints: constraints.length,
        requiredIndexes: indexes.length,
        crossTenantReferences,
        duplicateFiscalKeys,
    };
}
