import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { tenantPrisma } from "../../data/tenant-prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { TenantDataContext } from "../tenant/tenant-data-context";

type TenantTable = { tableName: string };
type JsonRow = { data: unknown };

const EXPORT_FORMAT = "tienda-tenant-export-v1";
const BATCH_SIZE = 1_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const SENSITIVE_KEYS = new Set([
    "password",
    "passwordhash",
    "tokenhash",
    "verificationtokenhash",
    "trialprovisioningtokenhash",
    "solpasswordenc",
    "certp12enc",
    "certpasswordenc",
    "xmlbase64",
    "cdrzipbase64",
    "rawresponsexml",
    "bucket",
    "objectkey",
    "kmskeyarn",
    "ipaddress",
    "useragent",
    "authorization",
    "cookie",
]);

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
        output[key] = sanitize(inner);
    }
    return output;
}

function maxExportBytes(): number {
    const configured = Number(process.env.TENANT_EXPORT_MAX_BYTES ?? DEFAULT_MAX_BYTES);
    return Number.isFinite(configured)
        ? Math.min(500 * 1024 * 1024, Math.max(1024 * 1024, Math.floor(configured)))
        : DEFAULT_MAX_BYTES;
}

function assertSafeIdentifier(value: string): string {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
        throw new Error("Nombre de tabla no permitido en exportacion");
    }
    return value;
}

export type TenantLogicalExport = {
    body: string;
    sha256: string;
    filename: string;
    tableCount: number;
    rowCount: number;
};

export class TenantExportService {
    static async createCurrentTenantExport(now = new Date()): Promise<TenantLogicalExport> {
        const tenantId = TenantDataContext.requireTenantId();
        const tenant = await tenantPrisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true,
                slug: true,
                name: true,
                legalName: true,
                ruc: true,
                status: true,
                kind: true,
                planCode: true,
                trialStartedAt: true,
                trialEndsAt: true,
                readOnlyAt: true,
                graceEndsAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (!tenant) throw CustomError.notFound("Empresa no encontrada");
        if (tenant.status === "PURGED") {
            throw CustomError.notFound("Los datos de la empresa ya fueron purgados");
        }

        const descriptors = await tenantPrisma.$queryRaw<TenantTable[]>(Prisma.sql`
            SELECT DISTINCT columns.table_name AS "tableName"
            FROM information_schema.columns AS columns
            INNER JOIN information_schema.columns AS identity_column
                ON identity_column.table_schema = columns.table_schema
               AND identity_column.table_name = columns.table_name
               AND identity_column.column_name = 'id'
            WHERE columns.table_schema = 'public'
              AND columns.column_name = 'tenantId'
            ORDER BY columns.table_name
        `);

        const tables: Array<{
            name: string;
            rowCount: number;
            sha256: string;
            rows: unknown[];
        }> = [];
        let totalRows = 0;
        let approximateBytes = 0;
        const maximumBytes = maxExportBytes();

        for (const descriptor of descriptors) {
            const tableName = assertSafeIdentifier(descriptor.tableName);
            const rows: unknown[] = [];
            let offset = 0;
            while (true) {
                const page = await tenantPrisma.$queryRawUnsafe<JsonRow[]>(
                    `SELECT to_jsonb(source_row) AS data
                     FROM "${tableName}" AS source_row
                     WHERE source_row."tenantId" = $1::uuid
                     ORDER BY source_row."id"::text
                     LIMIT $2 OFFSET $3`,
                    tenantId,
                    BATCH_SIZE,
                    offset,
                );
                for (const row of page) {
                    const clean = sanitize(row.data);
                    approximateBytes += Buffer.byteLength(JSON.stringify(clean), "utf8");
                    if (approximateBytes > maximumBytes) {
                        throw new CustomError(
                            "La exportacion supera el limite seguro configurado; solicite una exportacion operativa",
                            413,
                        );
                    }
                    rows.push(clean);
                }
                offset += page.length;
                if (page.length < BATCH_SIZE) break;
            }
            const serializedRows = JSON.stringify(rows);
            totalRows += rows.length;
            tables.push({
                name: tableName,
                rowCount: rows.length,
                sha256: sha256(serializedRows),
                rows,
            });
        }

        const unsigned = {
            format: EXPORT_FORMAT,
            generatedAt: now.toISOString(),
            tenant: sanitize(tenant),
            manifest: {
                tableCount: tables.length,
                rowCount: totalRows,
                tables: tables.map(({ name, rowCount, sha256: tableSha256 }) => ({
                    name,
                    rowCount,
                    sha256: tableSha256,
                })),
            },
            tables,
        };
        const contentSha256 = sha256(JSON.stringify(unsigned));
        const body = JSON.stringify({ ...unsigned, contentSha256 });
        return {
            body,
            sha256: sha256(body),
            filename: `tienda-${tenant.slug}-${now.toISOString().slice(0, 10)}.json`,
            tableCount: tables.length,
            rowCount: totalRows,
        };
    }
}
