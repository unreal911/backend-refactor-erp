import { Prisma } from '@prisma/client';
import { tenantPrisma as prisma } from '../../data/tenant-prisma';
import { CustomError } from '../../domain/errors/custom.error';
import { TenantDataContext } from '../tenant/tenant-data-context';
import { operatorsFor, reportSource } from './report.registry';
import { ParsedReportRequest, ReportCellValue, ReportFieldDefinition, ReportResult, ReportSourceId } from './report.types';

type SqlSource = {
    from: Prisma.Sql;
    select: Prisma.Sql;
    tenant: Prisma.Sql;
    fields: Record<string, Prisma.Sql>;
};

function salesSource(): SqlSource {
    const channel = Prisma.sql`CASE
        WHEN COALESCE(o."note", '') ILIKE '%POS-%' OR COALESCE(o."note", '') ILIKE '%METODO DE PAGO%' THEN 'POS'
        WHEN COALESCE(o."note", '') ILIKE '%ECOMMERCE%' OR o."code" LIKE 'MK-%' THEN 'ECOMMERCE'
        ELSE 'INTERNO' END`;
    const fields = {
        code: Prisma.sql`o."code"`, createdAt: Prisma.sql`o."createdAt"`, channel,
        status: Prisma.sql`o."status"::text`, customer: Prisma.sql`COALESCE(c."name", o."clientName", 'Sin cliente')`,
        documentNumber: Prisma.sql`COALESCE(c."documentNumber", o."clienteNumDoc", '')`,
        store: Prisma.sql`s."name"`, seller: Prisma.sql`TRIM(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", ''))`,
        receiptType: Prisma.sql`COALESCE(o."comprobanteTipo", 'NOTA')`, subtotal: Prisma.sql`o."subtotal"`,
        tax: Prisma.sql`o."tax"`, total: Prisma.sql`o."total"`,
    };
    return {
        fields,
        tenant: Prisma.sql`o."tenantId"`,
        from: Prisma.sql`FROM "Order" o
            LEFT JOIN "Customer" c ON c."id" = o."customerId" AND c."tenantId" = o."tenantId"
            INNER JOIN "Store" s ON s."id" = o."sourceStoreId" AND s."tenantId" = o."tenantId"
            LEFT JOIN "User" u ON u."id" = o."sellerUserId"`,
        select: Prisma.sql`SELECT
            ${fields.code} AS "code", ${fields.createdAt} AS "createdAt", ${fields.channel} AS "channel",
            ${fields.status} AS "status", ${fields.customer} AS "customer", ${fields.documentNumber} AS "documentNumber",
            ${fields.store} AS "store", ${fields.seller} AS "seller", ${fields.receiptType} AS "receiptType",
            ${fields.subtotal} AS "subtotal", ${fields.tax} AS "tax", ${fields.total} AS "total"`,
    };
}

function productsSource(): SqlSource {
    const fields = {
        product: Prisma.sql`p."name"`, category: Prisma.sql`cat."name"`, sku: Prisma.sql`pv."sku"`,
        barcode: Prisma.sql`COALESCE(pv."barcode", '')`, color: Prisma.sql`COALESCE(col."name", 'Sin color')`,
        size: Prisma.sql`COALESCE(sz."name", 'Sin talla')`, price: Prisma.sql`pv."price"`,
        active: Prisma.sql`(p."isActive" AND pv."isActive")`, createdAt: Prisma.sql`pv."createdAt"`,
    };
    return {
        fields,
        tenant: Prisma.sql`pv."tenantId"`,
        from: Prisma.sql`FROM "ProductVariant" pv
            INNER JOIN "Product" p ON p."id" = pv."productId" AND p."tenantId" = pv."tenantId"
            INNER JOIN "Category" cat ON cat."id" = p."categoryId" AND cat."tenantId" = p."tenantId"
            LEFT JOIN "Color" col ON col."id" = pv."colorId" AND col."tenantId" = pv."tenantId"
            LEFT JOIN "Size" sz ON sz."id" = pv."sizeId" AND sz."tenantId" = pv."tenantId"`,
        select: Prisma.sql`SELECT
            ${fields.product} AS "product", ${fields.category} AS "category", ${fields.sku} AS "sku",
            ${fields.barcode} AS "barcode", ${fields.color} AS "color", ${fields.size} AS "size",
            ${fields.price} AS "price", ${fields.active} AS "active", ${fields.createdAt} AS "createdAt"`,
    };
}

function customersSource(): SqlSource {
    const fields = {
        name: Prisma.sql`c."name"`, documentType: Prisma.sql`COALESCE(c."documentType", '')`,
        documentNumber: Prisma.sql`COALESCE(c."documentNumber", '')`, email: Prisma.sql`COALESCE(c."email", '')`,
        phone: Prisma.sql`COALESCE(c."phone", '')`, address: Prisma.sql`COALESCE(c."address", '')`,
        active: Prisma.sql`c."isActive"`, ordersCount: Prisma.sql`COALESCE(stats."ordersCount", 0)`,
        purchasedTotal: Prisma.sql`COALESCE(stats."purchasedTotal", 0)`, createdAt: Prisma.sql`c."createdAt"`,
    };
    return {
        fields,
        tenant: Prisma.sql`c."tenantId"`,
        from: Prisma.sql`FROM "Customer" c
            LEFT JOIN (
                SELECT "tenantId", "customerId", COUNT(*)::int AS "ordersCount", COALESCE(SUM("total"), 0) AS "purchasedTotal"
                FROM "Order" WHERE "customerId" IS NOT NULL AND "status" <> 'CANCELLED'
                GROUP BY "tenantId", "customerId"
            ) stats ON stats."customerId" = c."id" AND stats."tenantId" = c."tenantId"`,
        select: Prisma.sql`SELECT
            ${fields.name} AS "name", ${fields.documentType} AS "documentType", ${fields.documentNumber} AS "documentNumber",
            ${fields.email} AS "email", ${fields.phone} AS "phone", ${fields.address} AS "address",
            ${fields.active} AS "active", ${fields.ordersCount} AS "ordersCount",
            ${fields.purchasedTotal} AS "purchasedTotal", ${fields.createdAt} AS "createdAt"`,
    };
}

function inventorySource(): SqlSource {
    const fields = {
        store: Prisma.sql`s."name"`, storeCode: Prisma.sql`s."code"`, storeType: Prisma.sql`s."type"::text`,
        product: Prisma.sql`p."name"`, category: Prisma.sql`cat."name"`, sku: Prisma.sql`pv."sku"`,
        color: Prisma.sql`COALESCE(col."name", 'Sin color')`, size: Prisma.sql`COALESCE(sz."name", 'Sin talla')`,
        price: Prisma.sql`pv."price"`, stock: Prisma.sql`i."stock"`, reservedStock: Prisma.sql`i."reservedStock"`,
        availableStock: Prisma.sql`(i."stock" - i."reservedStock")`, updatedAt: Prisma.sql`i."updatedAt"`,
    };
    return {
        fields,
        tenant: Prisma.sql`i."tenantId"`,
        from: Prisma.sql`FROM "Inventory" i
            INNER JOIN "Store" s ON s."id" = i."storeId" AND s."tenantId" = i."tenantId"
            INNER JOIN "ProductVariant" pv ON pv."id" = i."variantId" AND pv."tenantId" = i."tenantId"
            INNER JOIN "Product" p ON p."id" = pv."productId" AND p."tenantId" = i."tenantId"
            INNER JOIN "Category" cat ON cat."id" = p."categoryId" AND cat."tenantId" = i."tenantId"
            LEFT JOIN "Color" col ON col."id" = pv."colorId" AND col."tenantId" = i."tenantId"
            LEFT JOIN "Size" sz ON sz."id" = pv."sizeId" AND sz."tenantId" = i."tenantId"`,
        select: Prisma.sql`SELECT
            ${fields.store} AS "store", ${fields.storeCode} AS "storeCode", ${fields.storeType} AS "storeType",
            ${fields.product} AS "product", ${fields.category} AS "category", ${fields.sku} AS "sku",
            ${fields.color} AS "color", ${fields.size} AS "size", ${fields.price} AS "price",
            ${fields.stock} AS "stock", ${fields.reservedStock} AS "reservedStock",
            ${fields.availableStock} AS "availableStock", ${fields.updatedAt} AS "updatedAt"`,
    };
}

const SQL_SOURCES: Record<ReportSourceId, () => SqlSource> = {
    sales: salesSource, products: productsSource, customers: customersSource, inventory: inventorySource,
};

function finiteNumber(value: unknown, label: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw CustomError.badRequest(`El valor de ${label} debe ser numerico`);
    return parsed;
}

function booleanValue(value: unknown): boolean {
    if (value === true || String(value).toLowerCase() === 'true' || String(value) === '1') return true;
    if (value === false || String(value).toLowerCase() === 'false' || String(value) === '0') return false;
    throw CustomError.badRequest('El filtro de estado debe ser verdadero o falso');
}

function dateValue(value: unknown, label: string): string {
    const text = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw CustomError.badRequest(`La fecha de ${label} no es valida`);
    }
    return text;
}

function filterSql(expression: Prisma.Sql, field: ReportFieldDefinition, filter: ParsedReportRequest['filters'][number]): Prisma.Sql {
    if (!operatorsFor(field.type).includes(filter.operator)) throw CustomError.badRequest('Operador de filtro no valido');
    if (field.type === 'text') {
        const value = String(filter.value ?? '').trim();
        if (filter.operator === 'contains') return Prisma.sql`COALESCE((${expression})::text, '') ILIKE ${`%${value}%`}`;
        if (filter.operator === 'startsWith') return Prisma.sql`COALESCE((${expression})::text, '') ILIKE ${`${value}%`}`;
        if (filter.operator === 'isEmpty') return Prisma.sql`COALESCE(TRIM((${expression})::text), '') = ''`;
        return Prisma.sql`LOWER(COALESCE((${expression})::text, '')) = LOWER(${value})`;
    }
    if (field.type === 'number') {
        const value = finiteNumber(filter.value, field.label);
        if (filter.operator === 'greaterThan') return Prisma.sql`(${expression}) > ${value}`;
        if (filter.operator === 'lessThan') return Prisma.sql`(${expression}) < ${value}`;
        if (filter.operator === 'between') return Prisma.sql`(${expression}) BETWEEN ${value} AND ${finiteNumber(filter.valueTo, field.label)}`;
        return Prisma.sql`(${expression}) = ${value}`;
    }
    if (field.type === 'boolean') return Prisma.sql`(${expression}) = ${booleanValue(filter.value)}`;
    const value = dateValue(filter.value, field.label);
    if (filter.operator === 'after') return Prisma.sql`(${expression})::date > ${value}::date`;
    if (filter.operator === 'before') return Prisma.sql`(${expression})::date < ${value}::date`;
    if (filter.operator === 'between') return Prisma.sql`(${expression})::date BETWEEN ${value}::date AND ${dateValue(filter.valueTo, field.label)}::date`;
    return Prisma.sql`(${expression})::date = ${value}::date`;
}

function normalizeCell(value: unknown): ReportCellValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
        return Number(value.toNumber());
    }
    return String(value);
}

export class ReportService {
    async execute(request: ParsedReportRequest): Promise<ReportResult> {
        const tenantId = TenantDataContext.requireTenantId();
        const definition = reportSource(request.source);
        const source = SQL_SOURCES[request.source]();
        const fields = new Map(definition.fields.map((field) => [field.key, field]));
        const filters: Prisma.Sql[] = [Prisma.sql`${source.tenant} = ${tenantId}::uuid`];
        for (const filter of request.filters) {
            const expression = source.fields[filter.field];
            const field = fields.get(filter.field);
            if (!expression || !field) throw CustomError.badRequest('Campo de filtro no valido');
            filters.push(filterSql(expression, field, filter));
        }
        const where = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
        const orderBy = source.fields[request.sort.field] || source.fields[definition.defaultColumns[0] || ''];
        if (!orderBy) throw CustomError.badRequest('Orden del reporte no valido');
        const direction = Prisma.raw(request.sort.direction === 'asc' ? 'ASC' : 'DESC');
        const [rawRows, totals] = await Promise.all([
            prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
                ${source.select} ${source.from} ${where}
                ORDER BY ${orderBy} ${direction}
                LIMIT ${request.limit}
            `),
            prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
                SELECT COUNT(*) AS total ${source.from} ${where}
            `),
        ]);
        const selectedFields = request.columns.map((key) => fields.get(key)).filter((field): field is ReportFieldDefinition => Boolean(field));
        const rows = rawRows.map((row) => Object.fromEntries(
            request.columns.map((column) => [column, normalizeCell(row[column])]),
        ));
        const total = Number(totals[0]?.total ?? 0);
        return {
            source: {
                id: definition.id, label: definition.label, description: definition.description,
                defaultColumns: definition.defaultColumns, fields: definition.fields,
            },
            columns: selectedFields,
            rows,
            total,
            truncated: total > rows.length,
        };
    }
}
