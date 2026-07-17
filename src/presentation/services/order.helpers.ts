import { OrderStatusEnum } from "../../domain/dtos/update-order-status.dto";
import { CreateMarketplaceOrderDto } from "../../domain/dtos/create-marketplace-order.dto";
import { PickingResponsibilityMode } from "../../domain/dtos/delegate-picking-responsibility.dto";
import {
    MarketplaceGuideItem,
    MarketplacePaymentMethod,
    PickingResponsibilityRequestRow,
    PickingSharedResponsibilityRow,
} from "./order.types";

// Helpers puros (sin acceso a BD ni estado de instancia) extraidos de OrderService
// para reducir el tamano del god object. No deben depender de `prisma` ni de `this`.

export const SIMPLE_COLOR_NAME = '__SIN_COLOR__';
export const SIMPLE_SIZE_NAME = '__SIN_TALLA__';
export const MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX = 'MKT_GUIDE_ITEMS:';

export function isSimpleColorToken(name?: string | null): boolean {
    return String(name || '').trim() === SIMPLE_COLOR_NAME;
}

export function isSimpleSizeToken(name?: string | null): boolean {
    return String(name || '').trim() === SIMPLE_SIZE_NAME;
}

export function sanitizeVariantForPresentation(variant: any) {
    if (!variant) return variant;

    // Modelo unificado: dimension ausente = colorId/sizeId null. Se toleran
    // centinelas viejos (__SIN_*) por si quedaran datos sin migrar.
    const hasColor = variant?.colorId != null && !isSimpleColorToken(variant?.color?.name);
    const hasSize = variant?.sizeId != null && !isSimpleSizeToken(variant?.size?.name);

    const normalizedColor = hasColor
        ? variant.color
        : { id: 0, name: hasSize ? 'Sin color' : 'Unico' };

    const normalizedSize = hasSize
        ? variant.size
        : { id: 0, name: hasColor ? 'Sin talla' : 'Unica' };

    return {
        ...variant,
        color: normalizedColor,
        size: normalizedSize,
    };
}

export function encodeMarketplaceGuideItems(items: Array<{
    colorName?: string | undefined;
    sizeName?: string | undefined;
    displayVariantId?: number | undefined;
}>, keepEmpty = false): string | null {
    const mapped = items
        .map((item) => ({
            colorName: typeof item.colorName === 'string' ? item.colorName.trim() : '',
            sizeName: typeof item.sizeName === 'string' ? item.sizeName.trim() : '',
            displayVariantId: Number(item.displayVariantId || 0),
        }));
    // keepEmpty preserva la alineacion posicional (indice = posicion del item en
    // el pedido). Sin el, se descartan las entradas vacias (comportamiento original
    // al crear el pedido desde marketplace, donde todos los items traen guide).
    const normalized = (keepEmpty ? mapped : mapped.filter((item) => item.colorName.length > 0 || item.sizeName.length > 0))
        .map((item) => ({
            colorName: item.colorName || undefined,
            sizeName: item.sizeName || undefined,
            displayVariantId: item.displayVariantId > 0 ? item.displayVariantId : undefined,
        }));

    if (!normalized.length || (!keepEmpty && normalized.every((item) => !item.colorName && !item.sizeName))) {
        return null;
    }

    return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64');
}

/**
 * Reescribe (o inserta) el token MKT_GUIDE_ITEMS: dentro del `note` del pedido,
 * conservando el resto de metadatos. Devuelve el note actualizado.
 */
export function upsertMarketplaceGuideItemsInNote(note: string | null | undefined, encoded: string | null): string {
    const parts = String(note || '')
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !part.startsWith(MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX));
    if (encoded) {
        parts.push(`${MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX}${encoded}`);
    }
    return parts.join(' | ');
}

export function decodeMarketplaceGuideItems(note?: string | null): MarketplaceGuideItem[] {
    const text = String(note || '').trim();
    if (!text) return [];

    const parts = text.split('|').map((part) => part.trim());
    const token = parts.find((part) => part.startsWith(MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX));
    if (!token) return [];

    const payload = token.slice(MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX.length).trim();
    if (!payload) return [];

    try {
        const raw = Buffer.from(payload, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.map((entry: any) => {
            const guide: MarketplaceGuideItem = {};

            if (typeof entry?.colorName === 'string' && entry.colorName.trim().length > 0) {
                guide.colorName = entry.colorName.trim();
            }

            if (typeof entry?.sizeName === 'string' && entry.sizeName.trim().length > 0) {
                guide.sizeName = entry.sizeName.trim();
            }

            if (Number.isInteger(Number(entry?.displayVariantId)) && Number(entry?.displayVariantId) > 0) {
                guide.displayVariantId = Number(entry.displayVariantId);
            }

            return guide;
        });
    } catch {
        return [];
    }
}

export function applyGuideToVariant(variant: any, guide: MarketplaceGuideItem | undefined) {
    if (!variant || !guide) return variant;

    const colorName = String(guide.colorName || '').trim();
    const sizeName = String(guide.sizeName || '').trim();
    if (!colorName && !sizeName) {
        return variant;
    }

    const color = colorName
        ? { ...(variant?.color || { id: 0, hex: null }), name: colorName }
        : variant?.color;
    const size = sizeName
        ? { ...(variant?.size || { id: 0 }), name: sizeName }
        : variant?.size;

    return {
        ...variant,
        color,
        size,
    };
}

export function sanitizeOrderVariantsForPresentation(order: any) {
    if (!order) return order;
    const guideItems = decodeMarketplaceGuideItems(order?.note);

    const sanitizedItems = Array.isArray(order?.items)
        ? order.items.map((item: any, index: number) => ({
            ...item,
            fulfillmentStoreId: item?.fulfillmentStoreId || order?.fulfillmentStoreId || order?.sourceStoreId || null,
            fulfillmentStore: item?.fulfillmentStore || order?.fulfillmentStore || order?.sourceStore || null,
            variant: applyGuideToVariant(
                sanitizeVariantForPresentation(item?.variant),
                guideItems[index],
            ),
        }))
        : [];

    const sanitizedPickingSession = order?.pickingSession
        ? {
            ...order.pickingSession,
            items: Array.isArray(order.pickingSession?.items)
                ? order.pickingSession.items.map((item: any) => ({
                    ...item,
                    variant: sanitizeVariantForPresentation(item?.variant),
                }))
                : [],
        }
        : order?.pickingSession;

    const sanitizedReservations = Array.isArray(order?.reservations)
        ? order.reservations.map((reservation: any) => ({
            ...reservation,
            inventory: reservation?.inventory
                ? {
                    ...reservation.inventory,
                    variant: sanitizeVariantForPresentation(reservation.inventory?.variant),
                }
                : reservation?.inventory,
        }))
        : [];

    return {
        ...order,
        items: sanitizedItems,
        pickingSession: sanitizedPickingSession,
        reservations: sanitizedReservations,
    };
}

export function buildMarketplaceOrderScopeWhere() {
    return {
        OR: [
            { note: { contains: 'CHANNEL: ECOMMERCE', mode: 'insensitive' as const } },
            { code: { startsWith: 'MK-' } },
        ],
    };
}

export function resolvePreferredResponsibleUserId(...candidates: Array<number | null | undefined>): number | null {
    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return null;
}

export function detectSalesChannel(note?: string | null, code?: string | null): 'POS' | 'ECOMMERCE' | 'INTERNAL' {
    const text = (note || '').toUpperCase();
    const orderCode = String(code || '').trim().toUpperCase();
    if (text.includes('POS-') || text.includes('METODO DE PAGO')) {
        return 'POS';
    }
    if (text.includes('ECOMMERCE') || orderCode.startsWith('MK-')) {
        return 'ECOMMERCE';
    }
    return 'INTERNAL';
}

export function parseBooleanSetting(rawValue: string | null | undefined, fallback: boolean): boolean {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return fallback;
}

export function parseNumberArraySetting(rawValue: string | null | undefined): number[] {
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            return normalizePositiveIds(parsed);
        }
    } catch {
        // fallback CSV mode
    }

    return normalizePositiveIds(String(rawValue).split(','));
}

export function normalizePositiveIds(values: unknown[]): number[] {
    const unique = new Set<number>();
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed > 0) {
            unique.add(parsed);
        }
    }
    return Array.from(unique.values());
}

export function normalizePickingResponsibilityMode(rawValue: unknown, fallback: PickingResponsibilityMode = 'SHARED'): PickingResponsibilityMode {
    const normalized = String(rawValue || '').trim().toUpperCase();
    if (normalized === 'TRANSFER') return 'TRANSFER';
    if (normalized === 'SHARED') return 'SHARED';
    return fallback;
}

export function mapPickingSharedResponsibilityRows(rows: PickingSharedResponsibilityRow[]) {
    return rows.map((row) => ({
        id: Number(row.id),
        user: {
            id: Number(row.userId),
            firstName: String(row.userFirstName || ''),
            lastName: String(row.userLastName || ''),
            email: String(row.userEmail || ''),
        },
        source: String(row.source || 'DELEGATION'),
        note: row.note || null,
        assignedBy: row.assignedByUserId
            ? {
                id: Number(row.assignedByUserId),
                firstName: String(row.assignedByFirstName || ''),
                lastName: String(row.assignedByLastName || ''),
                email: String(row.assignedByEmail || ''),
            }
            : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
    }));
}

export function mapPickingResponsibilityRequestRows(rows: PickingResponsibilityRequestRow[]) {
    return rows
        .filter((row) => String(row.status || '').toUpperCase() === 'PENDING')
        .map((row) => ({
            id: Number(row.id),
            requester: {
                id: Number(row.requesterUserId),
                firstName: String(row.requesterFirstName || ''),
                lastName: String(row.requesterLastName || ''),
                email: String(row.requesterEmail || ''),
            },
            mode: normalizePickingResponsibilityMode(row.mode, 'SHARED'),
            note: row.note || null,
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        }));
}

export function resolveTaxAmount(subtotal: number, includeIgv: boolean): number {
    if (!includeIgv) {
        return 0;
    }
    return subtotal * 0.18;
}

export function mapPublicOrderStatus(status: OrderStatusEnum): 'Proforma recibida' | 'En revision' | 'Esperando stock' | 'Confirmado' | 'En preparacion' | 'Listo para entrega' | 'Entregado' | 'Cancelado pendiente de devolucion' | 'Cancelado' {
    const map: Record<OrderStatusEnum, 'Proforma recibida' | 'En revision' | 'Esperando stock' | 'Confirmado' | 'En preparacion' | 'Listo para entrega' | 'Entregado' | 'Cancelado pendiente de devolucion' | 'Cancelado'> = {
        [OrderStatusEnum.PENDING]: 'Proforma recibida',
        [OrderStatusEnum.CONFIRMED]: 'Confirmado',
        [OrderStatusEnum.WAITING_TRANSFER]: 'Esperando stock',
        [OrderStatusEnum.PREPARING]: 'En preparacion',
        [OrderStatusEnum.READY]: 'Listo para entrega',
        [OrderStatusEnum.DELIVERED]: 'Entregado',
        [OrderStatusEnum.RETURN_PENDING]: 'Cancelado pendiente de devolucion',
        [OrderStatusEnum.CANCELLED]: 'Cancelado',
        [OrderStatusEnum.WAITING_STOCK]: 'Esperando stock',
    };
    return map[status];
}

export function mapSimpleUser(user: any) {
    if (!user) {
        return null;
    }

    return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
    };
}

export function buildMarketplaceNote(
    dto: CreateMarketplaceOrderDto,
    autoNote?: string,
    paymentMethod?: MarketplacePaymentMethod | null,
): string {
    const chunks: string[] = ['CHANNEL: ECOMMERCE', 'ORIGIN: MARKETPLACE'];
    chunks.push(`DELIVERY_TYPE: ${dto.deliveryType}`);

    if (dto.companyName) chunks.push(`EMPRESA: ${dto.companyName}`);
    if (dto.ruc) chunks.push(`RUC: ${dto.ruc}`);
    if (dto.deliveryType === 'DELIVERY') {
        if (dto.deliveryAddress) chunks.push(`DIRECCION: ${dto.deliveryAddress}`);
        if (dto.deliveryReference) chunks.push(`REFERENCIA: ${dto.deliveryReference}`);
    }
    if (dto.deliveryType === 'PICKUP' && dto.pickupStoreId) {
        chunks.push(`RECOJO_TIENDA_ID: ${dto.pickupStoreId}`);
    }
    if (paymentMethod) {
        chunks.push(`METODO_PAGO_ID: ${paymentMethod.id}`);
        chunks.push(`METODO_PAGO: ${paymentMethod.name}`);
    }
    const encodedGuideItems = encodeMarketplaceGuideItems(
        (dto.items || []).map((item) => {
            const guide: { colorName?: string; sizeName?: string; displayVariantId?: number } = {};
            if (item.colorName) {
                guide.colorName = item.colorName;
            }
            if (item.sizeName) {
                guide.sizeName = item.sizeName;
            }
            if (item.displayVariantId && item.displayVariantId > 0) {
                guide.displayVariantId = item.displayVariantId;
            }
            return guide;
        }),
    );
    if (encodedGuideItems) {
        chunks.push(`${MARKETPLACE_GUIDE_ITEMS_NOTE_PREFIX}${encodedGuideItems}`);
    }
    if (dto.note) chunks.push(`NOTA_CLIENTE: ${dto.note}`);
    if (autoNote) chunks.push(autoNote);

    return chunks.join(' | ');
}

export function mapPickingItemStatus(pickedQuantity: number, requestedQuantity: number): 'PENDING' | 'PARTIAL' | 'COMPLETED' {
    if (pickedQuantity <= 0) return 'PENDING';
    if (pickedQuantity >= requestedQuantity) return 'COMPLETED';
    return 'PARTIAL';
}
