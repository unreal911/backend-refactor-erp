import { CustomError } from '../../domain/errors/custom.error';
import {
    ParsedReportRequest,
    PublicReportSource,
    ReportFieldDefinition,
    ReportFieldType,
    ReportFilterInput,
    ReportOperator,
    ReportRequestInput,
    ReportSourceId,
} from './report.types';

type InternalSource = PublicReportSource & {
    permission: string;
    defaultSort: { field: string; direction: 'asc' | 'desc' };
};

const text = (key: string, label: string): ReportFieldDefinition => ({ key, label, type: 'text' });
const number = (key: string, label: string): ReportFieldDefinition => ({ key, label, type: 'number' });
const date = (key: string, label: string): ReportFieldDefinition => ({ key, label, type: 'date' });
const boolean = (key: string, label: string): ReportFieldDefinition => ({ key, label, type: 'boolean' });

const SOURCES: Record<ReportSourceId, InternalSource> = {
    sales: {
        id: 'sales',
        label: 'Ventas y pedidos',
        description: 'Una fila por venta, con cliente, tienda, vendedor, estado e importes.',
        permission: 'orders.view',
        defaultColumns: ['code', 'createdAt', 'channel', 'status', 'customer', 'store', 'total'],
        defaultSort: { field: 'createdAt', direction: 'desc' },
        fields: [
            text('code', 'Codigo'), date('createdAt', 'Fecha'), text('channel', 'Canal'),
            text('status', 'Estado'), text('customer', 'Cliente'), text('documentNumber', 'Documento'),
            text('store', 'Tienda de origen'), text('seller', 'Vendedor'),
            text('receiptType', 'Comprobante'), number('subtotal', 'Subtotal'),
            number('tax', 'IGV'), number('total', 'Total'),
        ],
    },
    products: {
        id: 'products',
        label: 'Productos y variantes',
        description: 'Catalogo por SKU, categoria, color, talla, precio y estado.',
        permission: 'products.view',
        defaultColumns: ['product', 'category', 'sku', 'color', 'size', 'price', 'active'],
        defaultSort: { field: 'product', direction: 'asc' },
        fields: [
            text('product', 'Producto'), text('category', 'Categoria'), text('sku', 'SKU'),
            text('barcode', 'Codigo de barras'), text('color', 'Color'), text('size', 'Talla'),
            number('price', 'Precio'), boolean('active', 'Activo'), date('createdAt', 'Fecha de creacion'),
        ],
    },
    customers: {
        id: 'customers',
        label: 'Clientes',
        description: 'Directorio de clientes con contacto y resumen historico de compras.',
        permission: 'customers.view',
        defaultColumns: ['name', 'documentNumber', 'phone', 'email', 'ordersCount', 'purchasedTotal'],
        defaultSort: { field: 'name', direction: 'asc' },
        fields: [
            text('name', 'Cliente'), text('documentType', 'Tipo de documento'),
            text('documentNumber', 'Documento'), text('email', 'Correo'), text('phone', 'Telefono'),
            text('address', 'Direccion'), boolean('active', 'Activo'),
            number('ordersCount', 'Cantidad de compras'), number('purchasedTotal', 'Total comprado'),
            date('createdAt', 'Fecha de registro'),
        ],
    },
    inventory: {
        id: 'inventory',
        label: 'Inventario por tienda',
        description: 'Existencias por tienda y SKU, incluyendo reservado y disponible.',
        permission: 'inventory.view',
        defaultColumns: ['store', 'product', 'sku', 'color', 'size', 'stock', 'reservedStock', 'availableStock'],
        defaultSort: { field: 'product', direction: 'asc' },
        fields: [
            text('store', 'Tienda'), text('storeCode', 'Codigo de tienda'), text('storeType', 'Tipo de tienda'),
            text('product', 'Producto'), text('category', 'Categoria'), text('sku', 'SKU'),
            text('color', 'Color'), text('size', 'Talla'), number('price', 'Precio'),
            number('stock', 'Stock fisico'), number('reservedStock', 'Stock reservado'),
            number('availableStock', 'Stock disponible'), date('updatedAt', 'Ultima actualizacion'),
        ],
    },
};

const OPERATORS: Record<ReportFieldType, ReportOperator[]> = {
    text: ['contains', 'equals', 'startsWith', 'isEmpty'],
    number: ['equals', 'greaterThan', 'lessThan', 'between'],
    date: ['on', 'after', 'before', 'between'],
    boolean: ['equals'],
};

export function reportSource(source: unknown): InternalSource {
    const id = String(source || '') as ReportSourceId;
    const definition = SOURCES[id];
    if (!definition) throw CustomError.badRequest('La fuente del reporte no es valida');
    return definition;
}

export function canUseReportSource(source: InternalSource, permissions: string[] = []): boolean {
    const normalized = permissions.map((item) => String(item).toLowerCase());
    return normalized.includes('*') || normalized.includes(source.permission.toLowerCase());
}

export function publicReportSources(permissions: string[] = []): PublicReportSource[] {
    return Object.values(SOURCES)
        .filter((source) => canUseReportSource(source, permissions))
        .map(({ permission: _permission, defaultSort: _defaultSort, ...source }) => source);
}

export function operatorsFor(type: ReportFieldType): ReportOperator[] {
    return OPERATORS[type];
}

export function parseReportRequest(input: ReportRequestInput, maxLimit: number): ParsedReportRequest {
    const source = reportSource(input.source);
    const fields = new Map(source.fields.map((field) => [field.key, field]));
    const requestedColumns = Array.isArray(input.columns) ? input.columns.map(String) : source.defaultColumns;
    const columns = [...new Set(requestedColumns)].filter((field) => fields.has(field));
    if (columns.length === 0) throw CustomError.badRequest('Selecciona al menos una columna');
    if (columns.length > source.fields.length) throw CustomError.badRequest('La seleccion de columnas no es valida');

    const rawFilters = Array.isArray(input.filters) ? input.filters : [];
    if (rawFilters.length > 12) throw CustomError.badRequest('Solo se permiten hasta 12 filtros');
    const filters: ReportFilterInput[] = rawFilters.map((raw) => {
        const candidate = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const field = String(candidate.field || '');
        const definition = fields.get(field);
        if (!definition) throw CustomError.badRequest(`Campo de filtro no valido: ${field}`);
        const operator = String(candidate.operator || '') as ReportOperator;
        if (!operatorsFor(definition.type).includes(operator)) {
            throw CustomError.badRequest(`Operador no valido para ${definition.label}`);
        }
        if (operator !== 'isEmpty' && (candidate.value === undefined || candidate.value === '')) {
            throw CustomError.badRequest(`Completa el valor del filtro ${definition.label}`);
        }
        if (operator === 'between' && (candidate.valueTo === undefined || candidate.valueTo === '')) {
            throw CustomError.badRequest(`Completa ambos valores del filtro ${definition.label}`);
        }
        return { field, operator, value: candidate.value, valueTo: candidate.valueTo };
    });

    const rawSort = input.sort && typeof input.sort === 'object' ? input.sort as Record<string, unknown> : {};
    const sortField = String(rawSort.field || source.defaultSort.field);
    const sort = {
        field: fields.has(sortField) ? sortField : source.defaultSort.field,
        direction: String(rawSort.direction || source.defaultSort.direction).toLowerCase() === 'asc'
            ? 'asc' as const
            : 'desc' as const,
    };
    const requestedLimit = Number(input.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, maxLimit)
        : Math.min(100, maxLimit);
    return { source: source.id, columns, filters, sort, limit };
}
