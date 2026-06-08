import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import { CreateOrderDto } from "../../domain/dtos/create-order.dto";
import { UpdateOrderStatusDto, OrderStatusEnum } from "../../domain/dtos/update-order-status.dto";
import { ListOrderDto } from "../../domain/dtos/list-order.dto";
import { AssignOrderResponsibleDto } from "../../domain/dtos/assign-order-responsible.dto";
import { UpdateOrderPickingDto } from "../../domain/dtos/update-order-picking.dto";
import { CreateMarketplaceOrderDto } from "../../domain/dtos/create-marketplace-order.dto";
import { TrackMarketplaceOrderDto } from "../../domain/dtos/track-marketplace-order.dto";
import { DelegateOrderReturnDto } from "../../domain/dtos/delegate-order-return.dto";
import { ListMarketplaceOrdersDto } from "../../domain/dtos/list-marketplace-orders.dto";
import { DelegatePickingResponsibilityDto, PickingResponsibilityMode } from "../../domain/dtos/delegate-picking-responsibility.dto";
import { RequestPickingResponsibilityDto } from "../../domain/dtos/request-picking-responsibility.dto";
import { ResolvePickingResponsibilityRequestDto } from "../../domain/dtos/resolve-picking-responsibility-request.dto";
import { RequestPickingUnpickActionDto } from "../../domain/dtos/request-picking-unpick-action.dto";
import { ResolvePickingUnpickActionDto } from "../../domain/dtos/resolve-picking-unpick-action.dto";
import {
    MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
    MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
    MARKETPLACE_INCLUDE_IGV_KEY,
    MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
    PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
} from "../../data/system-config-keys";

type MarketplacePaymentMethod = {
    id: number;
    name: string;
    code: string;
    displayOrder: number;
    isActive: boolean;
};

type MarketplacePaymentSettings = {
    enabled: boolean;
    allowedPaymentMethodIds: number[];
    includeIgv: boolean;
    autoReserveStock: boolean;
};

type MarketplaceGuideItem = {
    colorName?: string;
    sizeName?: string;
    displayVariantId?: number;
};

type PickingSharedResponsibilityRow = {
    id: number;
    orderId: number;
    userId: number;
    assignedByUserId: number | null;
    source: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    userFirstName: string | null;
    userLastName: string | null;
    userEmail: string | null;
    assignedByFirstName: string | null;
    assignedByLastName: string | null;
    assignedByEmail: string | null;
};

type PickingResponsibilityRequestRow = {
    id: number;
    orderId: number;
    requesterUserId: number;
    mode: string;
    status: string;
    note: string | null;
    resolvedByUserId: number | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    requesterFirstName: string | null;
    requesterLastName: string | null;
    requesterEmail: string | null;
    resolvedByFirstName: string | null;
    resolvedByLastName: string | null;
    resolvedByEmail: string | null;
};

type PickingResponsibilityContext = {
    enabled: boolean;
    primaryResponsible: {
        id: number;
        firstName: string;
        lastName: string;
        email: string;
    } | null;
    sharedResponsibles: Array<{
        id: number;
        user: {
            id: number;
            firstName: string;
            lastName: string;
            email: string;
        };
        source: string;
        note: string | null;
        assignedBy: {
            id: number;
            firstName: string;
            lastName: string;
            email: string;
        } | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    pendingRequests: Array<{
        id: number;
        requester: {
            id: number;
            firstName: string;
            lastName: string;
            email: string;
        };
        mode: PickingResponsibilityMode;
        note: string | null;
        createdAt: Date;
    }>;
};

type PickingItemContributionRow = {
    id: number;
    orderId: number;
    pickingItemId: number;
    userId: number;
    quantity: number;
    createdAt: Date;
    updatedAt: Date;
    userFirstName: string | null;
    userLastName: string | null;
    userEmail: string | null;
};

type PickingUnpickRequestRow = {
    id: number;
    orderId: number;
    pickingItemId: number;
    requesterUserId: number;
    quantity: number;
    status: string;
    note: string | null;
    resolvedByUserId: number | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    requesterFirstName: string | null;
    requesterLastName: string | null;
    requesterEmail: string | null;
    resolvedByFirstName: string | null;
    resolvedByLastName: string | null;
    resolvedByEmail: string | null;
};

type PickingOrderItemDetailRow = {
    id: number;
    orderId: number;
    orderItemId: number;
    pickingItemId: number | null;
    variantId: number;
    pickedQuantity: number;
    createdAt: Date;
    updatedAt: Date;
};

export class OrderService {
    private readonly simpleColorName = '__SIN_COLOR__';
    private readonly simpleSizeName = '__SIN_TALLA__';
    private readonly marketplaceGuideItemsNotePrefix = 'MKT_GUIDE_ITEMS:';

    constructor() {}

    private isSimpleColorToken(name?: string | null): boolean {
        return String(name || '').trim() === this.simpleColorName;
    }

    private isSimpleSizeToken(name?: string | null): boolean {
        return String(name || '').trim() === this.simpleSizeName;
    }

    private sanitizeVariantForPresentation(variant: any) {
        if (!variant) return variant;

        const rawColorName = String(variant?.color?.name || '').trim();
        const rawSizeName = String(variant?.size?.name || '').trim();
        const isSimpleColor = this.isSimpleColorToken(rawColorName);
        const isSimpleSize = this.isSimpleSizeToken(rawSizeName);

        const normalizedColor = variant?.color
            ? {
                ...variant.color,
                name: isSimpleColor
                    ? (isSimpleSize ? 'Unico' : 'Sin color')
                    : variant.color.name,
            }
            : variant?.color;

        const normalizedSize = variant?.size
            ? {
                ...variant.size,
                name: isSimpleSize
                    ? (isSimpleColor ? 'Unica' : 'Sin talla')
                    : variant.size.name,
            }
            : variant?.size;

        return {
            ...variant,
            color: normalizedColor,
            size: normalizedSize,
        };
    }

    private encodeMarketplaceGuideItems(items: Array<{
        colorName?: string;
        sizeName?: string;
        displayVariantId?: number;
    }>): string | null {
        const normalized = items
            .map((item) => ({
                colorName: typeof item.colorName === 'string' ? item.colorName.trim() : '',
                sizeName: typeof item.sizeName === 'string' ? item.sizeName.trim() : '',
                displayVariantId: Number(item.displayVariantId || 0),
            }))
            .filter((item) => item.colorName.length > 0 || item.sizeName.length > 0)
            .map((item) => ({
                colorName: item.colorName || undefined,
                sizeName: item.sizeName || undefined,
                displayVariantId: item.displayVariantId > 0 ? item.displayVariantId : undefined,
            }));

        if (!normalized.length) {
            return null;
        }

        return Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64');
    }

    private decodeMarketplaceGuideItems(note?: string | null): MarketplaceGuideItem[] {
        const text = String(note || '').trim();
        if (!text) return [];

        const parts = text.split('|').map((part) => part.trim());
        const token = parts.find((part) => part.startsWith(this.marketplaceGuideItemsNotePrefix));
        if (!token) return [];

        const payload = token.slice(this.marketplaceGuideItemsNotePrefix.length).trim();
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

    private applyGuideToVariant(variant: any, guide: MarketplaceGuideItem | undefined) {
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

    private sanitizeOrderVariantsForPresentation(order: any) {
        if (!order) return order;
        const guideItems = this.decodeMarketplaceGuideItems(order?.note);

        const sanitizedItems = Array.isArray(order?.items)
            ? order.items.map((item: any, index: number) => ({
                ...item,
                fulfillmentStoreId: item?.fulfillmentStoreId || order?.fulfillmentStoreId || order?.sourceStoreId || null,
                fulfillmentStore: item?.fulfillmentStore || order?.fulfillmentStore || order?.sourceStore || null,
                variant: this.applyGuideToVariant(
                    this.sanitizeVariantForPresentation(item?.variant),
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
                        variant: this.sanitizeVariantForPresentation(item?.variant),
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
                        variant: this.sanitizeVariantForPresentation(reservation.inventory?.variant),
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

    private buildMarketplaceOrderScopeWhere() {
        return {
            OR: [
                { note: { contains: 'CHANNEL: ECOMMERCE', mode: 'insensitive' as const } },
                { code: { startsWith: 'MK-' } },
            ],
        };
    }

    private resolvePreferredResponsibleUserId(...candidates: Array<number | null | undefined>): number | null {
        for (const candidate of candidates) {
            const parsed = Number(candidate);
            if (Number.isInteger(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return null;
    }

    private detectSalesChannel(note?: string | null): 'POS' | 'ECOMMERCE' | 'INTERNAL' {
        const text = (note || '').toUpperCase();
        if (text.includes('POS-') || text.includes('METODO DE PAGO')) {
            return 'POS';
        }
        if (text.includes('ECOMMERCE')) {
            return 'ECOMMERCE';
        }
        return 'INTERNAL';
    }

    private parseBooleanSetting(rawValue: string | null | undefined, fallback: boolean): boolean {
        const normalized = String(rawValue || '').trim().toLowerCase();
        if (!normalized) return fallback;
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
        return fallback;
    }

    private parseNumberArraySetting(rawValue: string | null | undefined): number[] {
        if (!rawValue) return [];

        try {
            const parsed = JSON.parse(rawValue);
            if (Array.isArray(parsed)) {
                return this.normalizePositiveIds(parsed);
            }
        } catch {
            // fallback CSV mode
        }

        return this.normalizePositiveIds(String(rawValue).split(','));
    }

    private normalizePositiveIds(values: unknown[]): number[] {
        const unique = new Set<number>();
        for (const value of values) {
            const parsed = Number(value);
            if (Number.isInteger(parsed) && parsed > 0) {
                unique.add(parsed);
            }
        }
        return Array.from(unique.values());
    }

    private async getSystemSettingValue(key: string, dbClient: any = prisma): Promise<string | null> {
        const rowsRaw = await dbClient.$queryRaw(
            Prisma.sql`SELECT "value" FROM "SystemSetting" WHERE "key" = ${key} LIMIT 1`,
        );
        const rows = rowsRaw as Array<{ value: string }>;
        return rows?.[0]?.value ?? null;
    }

    private async isReturnResponsibilityManagementEnabled(dbClient: any = prisma): Promise<boolean> {
        try {
            const setting = await this.getSystemSettingValue(RETURN_RESPONSIBILITY_MANAGEMENT_KEY, dbClient);
            return this.parseBooleanSetting(setting, true);
        } catch {
            return true;
        }
    }

    private normalizePickingResponsibilityMode(rawValue: unknown, fallback: PickingResponsibilityMode = 'SHARED'): PickingResponsibilityMode {
        const normalized = String(rawValue || '').trim().toUpperCase();
        return normalized === 'TRANSFER' ? 'TRANSFER' : fallback;
    }

    private async isPickingResponsibilityFlowEnabled(dbClient: any = prisma): Promise<boolean> {
        try {
            const setting = await this.getSystemSettingValue(PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY, dbClient);
            return this.parseBooleanSetting(setting, false);
        } catch {
            return false;
        }
    }

    private mapPickingSharedResponsibilityRows(rows: PickingSharedResponsibilityRow[]) {
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

    private mapPickingResponsibilityRequestRows(rows: PickingResponsibilityRequestRow[]) {
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
                mode: this.normalizePickingResponsibilityMode(row.mode, 'SHARED'),
                note: row.note || null,
                createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
            }));
    }

    private async listPickingSharedResponsibilityRows(orderId: number, dbClient: any = prisma): Promise<PickingSharedResponsibilityRow[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    psr."id",
                    psr."orderId",
                    psr."userId",
                    psr."assignedByUserId",
                    psr."source",
                    psr."note",
                    psr."createdAt",
                    psr."updatedAt",
                    u."firstName" AS "userFirstName",
                    u."lastName" AS "userLastName",
                    u."email" AS "userEmail",
                    assigner."firstName" AS "assignedByFirstName",
                    assigner."lastName" AS "assignedByLastName",
                    assigner."email" AS "assignedByEmail"
                FROM "PickingSharedResponsibility" psr
                INNER JOIN "User" u ON u."id" = psr."userId"
                LEFT JOIN "User" assigner ON assigner."id" = psr."assignedByUserId"
                WHERE psr."orderId" = ${orderId}
                  AND psr."isActive" = true
                ORDER BY psr."createdAt" ASC
            `,
        );
        return rows as PickingSharedResponsibilityRow[];
    }

    private async listPickingResponsibilityRequestRows(orderId: number, dbClient: any = prisma): Promise<PickingResponsibilityRequestRow[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    prr."id",
                    prr."orderId",
                    prr."requesterUserId",
                    prr."mode",
                    prr."status",
                    prr."note",
                    prr."resolvedByUserId",
                    prr."resolvedAt",
                    prr."createdAt",
                    prr."updatedAt",
                    requester."firstName" AS "requesterFirstName",
                    requester."lastName" AS "requesterLastName",
                    requester."email" AS "requesterEmail",
                    resolver."firstName" AS "resolvedByFirstName",
                    resolver."lastName" AS "resolvedByLastName",
                    resolver."email" AS "resolvedByEmail"
                FROM "PickingResponsibilityRequest" prr
                INNER JOIN "User" requester ON requester."id" = prr."requesterUserId"
                LEFT JOIN "User" resolver ON resolver."id" = prr."resolvedByUserId"
                WHERE prr."orderId" = ${orderId}
                ORDER BY prr."createdAt" DESC
            `,
        );
        return rows as PickingResponsibilityRequestRow[];
    }

    private async buildPickingResponsibilityContext(
        orderId: number,
        primaryResponsibleUser: any | null,
        dbClient: any = prisma,
    ): Promise<PickingResponsibilityContext> {
        const enabled = await this.isPickingResponsibilityFlowEnabled(dbClient);
        const [sharedRows, requestRows] = await Promise.all([
            this.listPickingSharedResponsibilityRows(orderId, dbClient),
            this.listPickingResponsibilityRequestRows(orderId, dbClient),
        ]);

        const primaryResponsible = primaryResponsibleUser
            ? {
                id: Number(primaryResponsibleUser.id),
                firstName: String(primaryResponsibleUser.firstName || ''),
                lastName: String(primaryResponsibleUser.lastName || ''),
                email: String(primaryResponsibleUser.email || ''),
            }
            : null;

        return {
            enabled,
            primaryResponsible,
            sharedResponsibles: this.mapPickingSharedResponsibilityRows(sharedRows),
            pendingRequests: this.mapPickingResponsibilityRequestRows(requestRows),
        };
    }

    private async isActiveSharedResponsible(orderId: number, userId: number, dbClient: any = prisma): Promise<boolean> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "PickingSharedResponsibility"
                WHERE "orderId" = ${orderId}
                  AND "userId" = ${userId}
                  AND "isActive" = true
                LIMIT 1
            `,
        ) as Array<{ id: number }>;
        return rows.length > 0;
    }

    private async canUserOperatePicking(orderId: number, actorUserId: number, primaryResponsibleUserId?: number | null, dbClient: any = prisma): Promise<boolean> {
        const flowEnabled = await this.isPickingResponsibilityFlowEnabled(dbClient);
        if (!flowEnabled) {
            return true;
        }

        if (Number(primaryResponsibleUserId || 0) === Number(actorUserId)) {
            return true;
        }

        return this.isActiveSharedResponsible(orderId, actorUserId, dbClient);
    }

    private async ensurePrimaryPickerCanDelegate(orderId: number, actorUserId: number, dbClient: any = prisma): Promise<any> {
        const order = await dbClient.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        const flowEnabled = await this.isPickingResponsibilityFlowEnabled(dbClient);
        if (!flowEnabled) {
            return order;
        }

        const primaryUserId = Number(order.pickerUserId || 0);
        if (!primaryUserId) {
            throw CustomError.badRequest('La orden no tiene responsable principal de picking');
        }

        if (primaryUserId !== Number(actorUserId)) {
            throw CustomError.forbidden('Solo el responsable principal puede delegar picking');
        }

        return order;
    }

    private async upsertSharedPickingResponsibility(
        orderId: number,
        userId: number,
        assignedByUserId: number,
        source: 'DELEGATION' | 'REQUEST_APPROVAL',
        note?: string,
        dbClient: any = prisma,
    ): Promise<void> {
        const existingRows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "PickingSharedResponsibility"
                WHERE "orderId" = ${orderId}
                  AND "userId" = ${userId}
                LIMIT 1
            `,
        ) as Array<{ id: number }>;

        if (existingRows.length > 0) {
            await dbClient.$executeRaw(
                Prisma.sql`
                    UPDATE "PickingSharedResponsibility"
                    SET "isActive" = true,
                        "assignedByUserId" = ${assignedByUserId},
                        "source" = ${source},
                        "note" = ${note ?? null},
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "id" = ${existingRows[0]!.id}
                `,
            );
            return;
        }

        await dbClient.$executeRaw(
            Prisma.sql`
                INSERT INTO "PickingSharedResponsibility" (
                    "orderId",
                    "userId",
                    "assignedByUserId",
                    "source",
                    "note",
                    "isActive"
                )
                VALUES (
                    ${orderId},
                    ${userId},
                    ${assignedByUserId},
                    ${source},
                    ${note ?? null},
                    true
                )
            `,
        );
    }

    private async listPickingItemContributionRows(orderId: number, dbClient: any = prisma): Promise<PickingItemContributionRow[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    pic."id",
                    pic."orderId",
                    pic."pickingItemId",
                    pic."userId",
                    pic."quantity",
                    pic."createdAt",
                    pic."updatedAt",
                    u."firstName" AS "userFirstName",
                    u."lastName" AS "userLastName",
                    u."email" AS "userEmail"
                FROM "PickingItemContribution" pic
                INNER JOIN "User" u ON u."id" = pic."userId"
                WHERE pic."orderId" = ${orderId}
                  AND pic."quantity" > 0
                ORDER BY pic."pickingItemId" ASC, pic."createdAt" ASC
            `,
        );
        return rows as PickingItemContributionRow[];
    }

    private async listPickingUnpickRequestRows(orderId: number, dbClient: any = prisma): Promise<PickingUnpickRequestRow[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    pur."id",
                    pur."orderId",
                    pur."pickingItemId",
                    pur."requesterUserId",
                    pur."quantity",
                    pur."status",
                    pur."note",
                    pur."resolvedByUserId",
                    pur."resolvedAt",
                    pur."createdAt",
                    pur."updatedAt",
                    requester."firstName" AS "requesterFirstName",
                    requester."lastName" AS "requesterLastName",
                    requester."email" AS "requesterEmail",
                    resolver."firstName" AS "resolvedByFirstName",
                    resolver."lastName" AS "resolvedByLastName",
                    resolver."email" AS "resolvedByEmail"
                FROM "PickingUnpickRequest" pur
                INNER JOIN "User" requester ON requester."id" = pur."requesterUserId"
                LEFT JOIN "User" resolver ON resolver."id" = pur."resolvedByUserId"
                WHERE pur."orderId" = ${orderId}
                ORDER BY pur."createdAt" DESC
            `,
        );
        return rows as PickingUnpickRequestRow[];
    }

    private async listPickingOrderItemDetailRows(orderId: number, dbClient: any = prisma): Promise<PickingOrderItemDetailRow[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    "id",
                    "orderId",
                    "orderItemId",
                    "pickingItemId",
                    "variantId",
                    "pickedQuantity",
                    "createdAt",
                    "updatedAt"
                FROM "PickingOrderItemDetail"
                WHERE "orderId" = ${orderId}
                ORDER BY "orderItemId" ASC
            `,
        );
        return rows as PickingOrderItemDetailRow[];
    }

    private buildPickingOrderItemDetailMap(rows: PickingOrderItemDetailRow[]): Map<number, PickingOrderItemDetailRow> {
        const map = new Map<number, PickingOrderItemDetailRow>();

        for (const row of rows) {
            const orderItemId = Number(row?.orderItemId || 0);
            if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;
            map.set(orderItemId, row);
        }

        return map;
    }

    private buildFallbackPickedAllocationByOrderItemId(order: any, sessionItems: any[]): Map<number, number> {
        const fallback = new Map<number, number>();
        const orderItems = Array.isArray(order?.items)
            ? [...order.items].sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0))
            : [];
        const orderItemsByVariant = new Map<number, any[]>();

        for (const item of orderItems) {
            const variantId = Number(item?.variantId || 0);
            if (!Number.isInteger(variantId) || variantId < 1) continue;
            const bucket = orderItemsByVariant.get(variantId) || [];
            bucket.push(item);
            orderItemsByVariant.set(variantId, bucket);
        }

        for (const [variantId, variantOrderItems] of orderItemsByVariant.entries()) {
            const hasPersistedPicked = variantOrderItems.some((item: any) => Number(item?.picked || 0) > 0);

            if (hasPersistedPicked) {
                for (const item of variantOrderItems) {
                    const orderItemId = Number(item?.id || 0);
                    if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;
                    fallback.set(orderItemId, Math.max(0, Number(item?.picked || 0)));
                }
                continue;
            }

            const sessionItem = sessionItems.find((candidate: any) => Number(candidate?.variantId || 0) === variantId);
            const pickedFromSession = Math.max(0, Number(sessionItem?.pickedQuantity || 0));
            const pickedAllocations = this.allocateQuantityAcrossOrderItems(variantOrderItems, pickedFromSession);

            pickedAllocations.forEach((quantity, orderItemId) => {
                fallback.set(orderItemId, Math.max(0, Number(quantity || 0)));
            });
        }

        return fallback;
    }

    private getOrderItemMaxPickableQuantity(order: any, orderItem: any): number {
        const requestedQuantity = Math.max(0, Number(orderItem?.quantity || 0));
        if (requestedQuantity <= 0) {
            return 0;
        }

        const reservedQuantity = Math.max(0, Number(orderItem?.reserved || 0));
        if (reservedQuantity > 0) {
            return Math.min(requestedQuantity, reservedQuantity);
        }

        const reservedByVariant = this.getReservedQuantityForVariant(order, Number(orderItem?.variantId || 0));
        if (reservedByVariant <= 0) {
            return 0;
        }

        return Math.min(requestedQuantity, reservedByVariant);
    }

    private async syncPickingOrderItemDetailsForOrder(
        order: any,
        dbClient: any = prisma,
        options?: { forcePickedFromOrderItems?: boolean },
    ): Promise<Map<number, PickingOrderItemDetailRow>> {
        const orderId = Number(order?.id || 0);
        if (!Number.isInteger(orderId) || orderId < 1) {
            return new Map<number, PickingOrderItemDetailRow>();
        }

        const orderItems = Array.isArray(order?.items)
            ? [...order.items].sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0))
            : [];
        if (!orderItems.length) {
            return new Map<number, PickingOrderItemDetailRow>();
        }

        const sessionItems = Array.isArray(order?.pickingSession?.items) ? order.pickingSession.items : [];
        const pickingItemIdByVariant = new Map<number, number>();
        for (const sessionItem of sessionItems) {
            const variantId = Number(sessionItem?.variantId || 0);
            const pickingItemId = Number(sessionItem?.id || 0);
            if (!Number.isInteger(variantId) || variantId < 1) continue;
            if (!Number.isInteger(pickingItemId) || pickingItemId < 1) continue;
            pickingItemIdByVariant.set(variantId, pickingItemId);
        }

        const fallbackPickedByOrderItemId = this.buildFallbackPickedAllocationByOrderItemId(order, sessionItems);
        const existingRows = await this.listPickingOrderItemDetailRows(orderId, dbClient);
        const existingByOrderItemId = this.buildPickingOrderItemDetailMap(existingRows);

        for (const orderItem of orderItems) {
            const orderItemId = Number(orderItem?.id || 0);
            const variantId = Number(orderItem?.variantId || 0);
            if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;
            if (!Number.isInteger(variantId) || variantId < 1) continue;

            const pickingItemIdForVariant = Number(pickingItemIdByVariant.get(variantId) || 0);
            const normalizedPickingItemId = Number.isInteger(pickingItemIdForVariant) && pickingItemIdForVariant > 0
                ? pickingItemIdForVariant
                : null;

            const rowLimit = this.getOrderItemMaxPickableQuantity(order, orderItem);
            const existing = existingByOrderItemId.get(orderItemId);
            const basePickedQuantity = options?.forcePickedFromOrderItems
                ? Math.max(0, Number(orderItem?.picked || 0))
                : existing
                    ? Math.max(0, Number(existing.pickedQuantity || 0))
                    : Math.max(
                        0,
                        Number(fallbackPickedByOrderItemId.get(orderItemId) ?? Number(orderItem?.picked || 0)),
                    );
            const nextPickedQuantity = Math.max(0, Math.min(rowLimit, basePickedQuantity));

            const needsUpsert = !existing
                || Number(existing.orderId || 0) !== orderId
                || Number(existing.variantId || 0) !== variantId
                || Number(existing.pickingItemId || 0) !== Number(normalizedPickingItemId || 0)
                || Number(existing.pickedQuantity || 0) !== nextPickedQuantity;

            if (!needsUpsert) {
                continue;
            }

            await dbClient.$executeRaw(
                Prisma.sql`
                    INSERT INTO "PickingOrderItemDetail" (
                        "orderId",
                        "orderItemId",
                        "pickingItemId",
                        "variantId",
                        "pickedQuantity"
                    )
                    VALUES (
                        ${orderId},
                        ${orderItemId},
                        ${normalizedPickingItemId},
                        ${variantId},
                        ${nextPickedQuantity}
                    )
                    ON CONFLICT ("orderItemId")
                    DO UPDATE SET
                        "orderId" = EXCLUDED."orderId",
                        "pickingItemId" = EXCLUDED."pickingItemId",
                        "variantId" = EXCLUDED."variantId",
                        "pickedQuantity" = EXCLUDED."pickedQuantity",
                        "updatedAt" = CURRENT_TIMESTAMP
                `,
            );
        }

        const refreshedRows = await this.listPickingOrderItemDetailRows(orderId, dbClient);
        return this.buildPickingOrderItemDetailMap(refreshedRows);
    }

    private async syncOrderItemsFromPickingOrderItemDetailMap(order: any, detailMap: Map<number, PickingOrderItemDetailRow>, dbClient: any = prisma): Promise<void> {
        const orderItems = Array.isArray(order?.items) ? order.items : [];

        for (const orderItem of orderItems) {
            const orderItemId = Number(orderItem?.id || 0);
            if (!Number.isInteger(orderItemId) || orderItemId < 1) continue;

            const requestedQuantity = Math.max(0, Number(orderItem?.quantity || 0));
            const rowLimit = this.getOrderItemMaxPickableQuantity(order, orderItem);
            const pickedFromDetail = Math.max(0, Number(detailMap.get(orderItemId)?.pickedQuantity || 0));
            const nextPickedQuantity = Math.min(requestedQuantity, rowLimit, pickedFromDetail);
            const nextStatus = this.mapOrderItemStatusFromPicked(nextPickedQuantity, requestedQuantity);

            await dbClient.orderItem.update({
                where: { id: orderItemId },
                data: {
                    picked: nextPickedQuantity,
                    status: nextStatus,
                },
            });
        }
    }

    private async recalculatePickingItemPickedQuantityFromDetails(
        orderId: number,
        pickingItemId: number,
        dbClient: any = prisma,
    ): Promise<number> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT COALESCE(SUM("pickedQuantity"), 0) AS "pickedQuantity"
                FROM "PickingOrderItemDetail"
                WHERE "orderId" = ${orderId}
                  AND "pickingItemId" = ${pickingItemId}
            `,
        ) as Array<{ pickedQuantity: number }>;

        const nextPickedQuantity = Math.max(0, Number(rows?.[0]?.pickedQuantity || 0));
        await dbClient.pickingItem.update({
            where: { id: pickingItemId },
            data: { pickedQuantity: nextPickedQuantity },
        });

        return nextPickedQuantity;
    }

    private buildPickingItemContributionMap(rows: PickingItemContributionRow[]) {
        const map = new Map<number, Array<{
            id: number;
            user: { id: number; firstName: string; lastName: string; email: string };
            quantity: number;
            createdAt: Date;
            updatedAt: Date;
        }>>();

        for (const row of rows) {
            const pickingItemId = Number(row.pickingItemId || 0);
            if (!Number.isInteger(pickingItemId) || pickingItemId < 1) continue;

            const entry = {
                id: Number(row.id),
                user: {
                    id: Number(row.userId),
                    firstName: String(row.userFirstName || ''),
                    lastName: String(row.userLastName || ''),
                    email: String(row.userEmail || ''),
                },
                quantity: Math.max(0, Number(row.quantity || 0)),
                createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
                updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
            };

            const bucket = map.get(pickingItemId) || [];
            bucket.push(entry);
            map.set(pickingItemId, bucket);
        }

        return map;
    }

    private buildPendingUnpickRequestMap(rows: PickingUnpickRequestRow[]) {
        const map = new Map<number, Array<{
            id: number;
            pickingItemId: number;
            requester: { id: number; firstName: string; lastName: string; email: string };
            quantity: number;
            note: string | null;
            createdAt: Date;
        }>>();

        for (const row of rows) {
            const status = String(row.status || '').toUpperCase();
            if (status !== 'PENDING') continue;

            const pickingItemId = Number(row.pickingItemId || 0);
            if (!Number.isInteger(pickingItemId) || pickingItemId < 1) continue;

            const entry = {
                id: Number(row.id),
                pickingItemId,
                requester: {
                    id: Number(row.requesterUserId),
                    firstName: String(row.requesterFirstName || ''),
                    lastName: String(row.requesterLastName || ''),
                    email: String(row.requesterEmail || ''),
                },
                quantity: Math.max(0, Number(row.quantity || 0)),
                note: row.note || null,
                createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
            };

            const bucket = map.get(pickingItemId) || [];
            bucket.push(entry);
            map.set(pickingItemId, bucket);
        }

        return map;
    }

    private async getPickingItemUserContribution(
        orderId: number,
        pickingItemId: number,
        userId: number,
        dbClient: any = prisma,
    ): Promise<number> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT "quantity"
                FROM "PickingItemContribution"
                WHERE "orderId" = ${orderId}
                  AND "pickingItemId" = ${pickingItemId}
                  AND "userId" = ${userId}
                LIMIT 1
            `,
        ) as Array<{ quantity: number }>;

        return Math.max(0, Number(rows?.[0]?.quantity || 0));
    }

    private async updatePickingItemUserContribution(
        orderId: number,
        pickingItemId: number,
        userId: number,
        deltaQuantity: number,
        dbClient: any = prisma,
    ): Promise<number> {
        const normalizedDelta = Number(deltaQuantity);
        if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
            return this.getPickingItemUserContribution(orderId, pickingItemId, userId, dbClient);
        }

        const existingRows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT "id", "quantity"
                FROM "PickingItemContribution"
                WHERE "orderId" = ${orderId}
                  AND "pickingItemId" = ${pickingItemId}
                  AND "userId" = ${userId}
                LIMIT 1
            `,
        ) as Array<{ id: number; quantity: number }>;

        if (!existingRows.length) {
            const initialQuantity = Math.max(0, Math.round(normalizedDelta));
            if (initialQuantity <= 0) {
                return 0;
            }
            await dbClient.$executeRaw(
                Prisma.sql`
                    INSERT INTO "PickingItemContribution" (
                        "orderId",
                        "pickingItemId",
                        "userId",
                        "quantity"
                    )
                    VALUES (
                        ${orderId},
                        ${pickingItemId},
                        ${userId},
                        ${initialQuantity}
                    )
                `,
            );
            return initialQuantity;
        }

        const currentQuantity = Math.max(0, Number(existingRows[0]!.quantity || 0));
        const nextQuantity = Math.max(0, currentQuantity + Math.round(normalizedDelta));
        await dbClient.$executeRaw(
            Prisma.sql`
                UPDATE "PickingItemContribution"
                SET "quantity" = ${nextQuantity},
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ${existingRows[0]!.id}
            `,
        );

        return nextQuantity;
    }

    private async getMarketplacePaymentSettings(dbClient: any = prisma): Promise<MarketplacePaymentSettings> {
        const [enabledRaw, allowedIdsRaw, includeIgvRaw, autoReserveStockRaw] = await Promise.all([
            this.getSystemSettingValue(MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY, dbClient),
            this.getSystemSettingValue(MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY, dbClient),
            this.getSystemSettingValue(MARKETPLACE_INCLUDE_IGV_KEY, dbClient),
            this.getSystemSettingValue(MARKETPLACE_AUTO_RESERVE_STOCK_KEY, dbClient),
        ]);

        return {
            enabled: this.parseBooleanSetting(enabledRaw, false),
            allowedPaymentMethodIds: this.parseNumberArraySetting(allowedIdsRaw),
            includeIgv: this.parseBooleanSetting(includeIgvRaw, true),
            autoReserveStock: this.parseBooleanSetting(autoReserveStockRaw, false),
        };
    }

    private resolveTaxAmount(subtotal: number, includeIgv: boolean): number {
        if (!includeIgv) {
            return 0;
        }
        return subtotal * 0.18;
    }

    private async listActivePaymentMethods(dbClient: any = prisma): Promise<MarketplacePaymentMethod[]> {
        const rows = await dbClient.$queryRaw(
            Prisma.sql`
                SELECT
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive"
                FROM "PaymentMethod"
                WHERE "isActive" = true
                ORDER BY "displayOrder" ASC, "name" ASC
            `,
        ) as MarketplacePaymentMethod[];

        return rows.map((row) => ({
            id: Number(row.id),
            name: String(row.name),
            code: String(row.code),
            displayOrder: Number(row.displayOrder || 0),
            isActive: Boolean(row.isActive),
        }));
    }

    private filterAllowedPaymentMethods(methods: MarketplacePaymentMethod[], settings: MarketplacePaymentSettings): MarketplacePaymentMethod[] {
        if (settings.allowedPaymentMethodIds.length === 0) {
            return methods;
        }

        const allowedSet = new Set(settings.allowedPaymentMethodIds);
        const filtered = methods.filter((method) => allowedSet.has(Number(method.id)));

        return filtered.length > 0 ? filtered : methods;
    }

    private async resolveMarketplacePaymentMethod(
        paymentMethodId: number | undefined,
        dbClient: any = prisma,
    ): Promise<MarketplacePaymentMethod | null> {
        const settings = await this.getMarketplacePaymentSettings(dbClient);
        if (!settings.enabled) {
            return null;
        }

        const activeMethods = await this.listActivePaymentMethods(dbClient);
        const availableMethods = this.filterAllowedPaymentMethods(activeMethods, settings);

        if (availableMethods.length === 0) {
            throw CustomError.badRequest('No hay metodos de pago disponibles para el marketplace');
        }

        if (!paymentMethodId) {
            throw CustomError.badRequest('Selecciona un metodo de pago para continuar');
        }

        const selectedMethod = availableMethods.find((method) => Number(method.id) === Number(paymentMethodId));
        if (!selectedMethod) {
            throw CustomError.badRequest('El metodo de pago seleccionado no esta disponible');
        }

        return selectedMethod;
    }

    private mapPublicOrderStatus(status: OrderStatusEnum): 'Pedido recibido' | 'En revision' | 'Esperando stock' | 'Confirmado' | 'En preparacion' | 'Listo para entrega' | 'Entregado' | 'Cancelado pendiente de devolucion' | 'Cancelado' {
        const map: Record<OrderStatusEnum, 'Pedido recibido' | 'En revision' | 'Esperando stock' | 'Confirmado' | 'En preparacion' | 'Listo para entrega' | 'Entregado' | 'Cancelado pendiente de devolucion' | 'Cancelado'> = {
            [OrderStatusEnum.PENDING]: 'En revision',
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

    private mapSimpleUser(user: any) {
        if (!user) {
            return null;
        }

        return {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
        };
    }

    private buildMarketplaceNote(
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
        const encodedGuideItems = this.encodeMarketplaceGuideItems(
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
            chunks.push(`${this.marketplaceGuideItemsNotePrefix}${encodedGuideItems}`);
        }
        if (dto.note) chunks.push(`NOTA_CLIENTE: ${dto.note}`);
        if (autoNote) chunks.push(autoNote);

        return chunks.join(' | ');
    }

    private resolvePickedQuantity(orderItem: any, order?: any): number {
        const pickedFromOrderItem = Math.max(0, Number(orderItem?.picked || 0));
        const orderItemsForVariant = this.getOrderItemsForVariant(order, Number(orderItem?.variantId || 0));
        if (orderItemsForVariant.length > 1) {
            return pickedFromOrderItem;
        }

        if (pickedFromOrderItem > 0) {
            return pickedFromOrderItem;
        }

        const sessionItems = order?.pickingSession?.items || [];
        const pickedFromSession = sessionItems.find(
            (sessionItem: any) => Number(sessionItem.variantId) === Number(orderItem?.variantId),
        );
        return Number(pickedFromSession?.pickedQuantity || 0);
    }

    private mapPickingItemStatus(pickedQuantity: number, requestedQuantity: number): 'PENDING' | 'PARTIAL' | 'COMPLETED' {
        if (pickedQuantity <= 0) return 'PENDING';
        if (pickedQuantity >= requestedQuantity) return 'COMPLETED';
        return 'PARTIAL';
    }

    private getReservedQuantityForVariant(order: any, variantId: number): number {
        if (!order || !Array.isArray(order.reservations)) {
            return 0;
        }

        return order.reservations
            .filter((reservation: any) =>
                Number(reservation?.variantId) === Number(variantId) &&
                (reservation.status === 'ACTIVE' || reservation.status === 'COMPLETED'))
            .reduce((sum: number, reservation: any) => sum + Math.max(0, Number(reservation.quantity || 0)), 0);
    }

    private resolveMaxPickableQuantity(order: any, variantId: number, requestedQuantity: number): number {
        const safeRequested = Math.max(0, Number(requestedQuantity || 0));
        if (safeRequested <= 0) {
            return 0;
        }

        const reservedByVariant = this.getReservedQuantityForVariant(order, variantId);
        return Math.max(0, Math.min(safeRequested, reservedByVariant));
    }

    private mapOrderWithPickingSummary(order: any) {
        const items = Array.isArray(order?.items) ? order.items : [];
        const totalRequested = items.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
        const totalPicked = items.reduce((sum: number, item: any) => {
            const pickedQuantity = this.resolvePickedQuantity(item, order);
            return sum + Math.min(Number(item.quantity || 0), pickedQuantity);
        }, 0);

        const progress = totalRequested > 0 ? Math.round((totalPicked / totalRequested) * 100) : 0;

        return {
            ...order,
            items: items.map((item: any) => {
                const requestedQuantity = Number(item.quantity || 0);
                const reservedQuantity = Number(item.reserved || 0);
                const pendingStockQuantity = Math.max(0, requestedQuantity - reservedQuantity);
                const pickedQuantity = this.resolvePickedQuantity(item, order);
                const maxPickableQuantity = Math.max(0, Math.min(requestedQuantity, reservedQuantity));
                const pendingPickingQuantity = Math.max(0, requestedQuantity - pickedQuantity);
                return {
                    ...item,
                    requestedQuantity,
                    reservedQuantity,
                    maxPickableQuantity,
                    pendingStockQuantity,
                    pickedQuantity,
                    pendingQuantity: pendingPickingQuantity,
                    pendingPickingQuantity,
                    pickingStatus: this.mapPickingItemStatus(pickedQuantity, requestedQuantity),
                };
            }),
            pickingSummary: {
                totalRequested,
                totalPicked,
                progress,
            },
        };
    }

    private mapOrderWithPresentationData(order: any) {
        const sanitizedOrder = this.sanitizeOrderVariantsForPresentation(order);
        const responsible = sanitizedOrder.sellerUser || sanitizedOrder.pickerUser || sanitizedOrder.dispenserUser || null;
        const responsibleRole = sanitizedOrder.sellerUser
            ? 'SELLER'
            : sanitizedOrder.pickerUser
                ? 'PICKER'
                : sanitizedOrder.dispenserUser
                    ? 'DISPENSER'
                    : null;
        const returnFallbackUser = sanitizedOrder.returnResponsibleUser
            || sanitizedOrder.cancelledByUser
            || sanitizedOrder.dispenserUser
            || sanitizedOrder.pickerUser
            || sanitizedOrder.sellerUser
            || null;
        const returnCancelledByUser = sanitizedOrder.cancelledByUser || returnFallbackUser;
        const hasReturnDelegation = Boolean(sanitizedOrder.returnResponsibilityDelegatedById || sanitizedOrder.returnResponsibilityDelegatedBy);
        const rawReturnStatus = sanitizedOrder.returnResponsibilityStatus || null;
        const shouldTreatInitialReturnAsAccepted = (sanitizedOrder.status as OrderStatusEnum) === OrderStatusEnum.RETURN_PENDING
            && !hasReturnDelegation
            && returnFallbackUser
            && (!rawReturnStatus || rawReturnStatus === 'PENDING');
        const returnAcceptanceStatus = shouldTreatInitialReturnAsAccepted
            ? 'ACCEPTED'
            : rawReturnStatus;

        const baseMappedOrder = {
            ...sanitizedOrder,
            salesChannel: this.detectSalesChannel(sanitizedOrder.note),
            primaryResponsible: responsible
                ? {
                    id: responsible.id,
                    firstName: responsible.firstName,
                    lastName: responsible.lastName,
                    role: responsibleRole,
                }
                : null,
            returnWorkflow: sanitizedOrder.returnRequestedAt || returnFallbackUser || returnAcceptanceStatus
                ? {
                    requestedAt: sanitizedOrder.returnRequestedAt || null,
                    returnedAt: sanitizedOrder.returnedAt || null,
                    acceptanceStatus: returnAcceptanceStatus,
                    acceptedAt: sanitizedOrder.returnResponsibilityAcceptedAt
                        || (shouldTreatInitialReturnAsAccepted ? sanitizedOrder.returnRequestedAt || sanitizedOrder.updatedAt || null : null),
                    cancelledBy: this.mapSimpleUser(returnCancelledByUser),
                    responsible: this.mapSimpleUser(returnFallbackUser),
                    delegatedBy: this.mapSimpleUser(sanitizedOrder.returnResponsibilityDelegatedBy),
                }
                : null,
        };

        return this.mapOrderWithPickingSummary(baseMappedOrder);
    }

    private async attachPickingResponsibilityData(order: any, dbClient: any = prisma) {
        if (!order || !Number.isInteger(Number(order.id)) || Number(order.id) < 1) {
            return order;
        }

        const context = await this.buildPickingResponsibilityContext(
            Number(order.id),
            order.pickerUser || order.pickingSession?.assignedUser || null,
            dbClient,
        );

        return {
            ...order,
            pickingResponsibility: context,
        };
    }

    private readonly orderDetailInclude = {
        items: {
            include: {
                fulfillmentStore: true,
                variant: { include: { product: true, color: true, size: true } },
            },
            orderBy: { id: 'asc' as const },
        },
        sourceStore: true,
        fulfillmentStore: true,
        sellerUser: true,
        pickerUser: true,
        dispenserUser: true,
        cancelledByUser: true,
        returnResponsibleUser: true,
        returnResponsibilityDelegatedBy: true,
        pickingSession: {
            include: {
                assignedUser: true,
                items: {
                    orderBy: { id: 'asc' as const },
                    include: {
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
        },
        transfer: true,
        reservations: {
            include: {
                reservedBy: true,
                inventory: {
                    include: {
                        store: true,
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
        },
    };

    private async assertOrderExists(orderId: number) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true },
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }
    }

    private mapOrderItemStatusFromPicked(pickedQuantity: number, requestedQuantity: number): 'PENDING' | 'PARTIAL' | 'PICKED' {
        if (pickedQuantity <= 0) return 'PENDING';
        if (pickedQuantity >= requestedQuantity) return 'PICKED';
        return 'PARTIAL';
    }

    private getOrderItemsForVariant(order: any, variantId: number): any[] {
        if (!order || !Array.isArray(order.items)) {
            return [];
        }

        return order.items
            .filter((item: any) => Number(item?.variantId) === Number(variantId))
            .sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0));
    }

    private getRequestedQuantityForVariant(order: any, variantId: number): number {
        return this.getOrderItemsForVariant(order, variantId)
            .reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
    }

    private allocateQuantityAcrossOrderItems(orderItems: any[], totalQuantity: number): Map<number, number> {
        const allocations = new Map<number, number>();
        let remaining = Math.max(0, Number(totalQuantity || 0));

        for (const item of orderItems) {
            const requestedQuantity = Math.max(0, Number(item?.quantity || 0));
            const orderItemId = Number(item?.id || 0);
            const allocatedQuantity = Math.max(0, Math.min(requestedQuantity, remaining));

            if (orderItemId > 0) {
                allocations.set(orderItemId, allocatedQuantity);
            }

            remaining = Math.max(0, remaining - allocatedQuantity);
            if (remaining <= 0) {
                // no-op: mantenemos el recorrido para asignar 0 explicito en las lineas restantes
            }
        }

        return allocations;
    }

    private async syncPickingAndOrderStatus(orderId: number) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: true,
                pickingSession: true,
            },
        });

        if (!order || !order.pickingSession) {
            return;
        }

        const nextPickingStatus = 'IN_PROGRESS';

        await prisma.pickingSession.update({
            where: { id: order.pickingSession.id },
            data: { status: nextPickingStatus },
        });

        const currentStatus = String(order.status || '');
        if (
            currentStatus === OrderStatusEnum.CANCELLED ||
            currentStatus === OrderStatusEnum.DELIVERED ||
            currentStatus === OrderStatusEnum.RETURN_PENDING
        ) {
            return;
        }

        const nextOrderStatus = OrderStatusEnum.PREPARING;
        if (nextOrderStatus !== order.status) {
            await prisma.order.update({
                where: { id: orderId },
                data: { status: nextOrderStatus },
            });
        }
    }

    /**
     * Generar cÃ³digo Ãºnico para el pedido
     * Formato: ORD-{YYYYMMDD}-{RANDOM}
     */
    private generateOrderCode(): string {
        const now = new Date();
        const dateString = now.toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        return `ORD-${dateString}-${random}`;
    }

    /**
     * Crear un nuevo pedido
     */
    async createOrder(dto: CreateOrderDto) {
        // Validar que la tienda origen existe
        const sourceStore = await prisma.store.findUnique({
            where: { id: dto.sourceStoreId },
        });
        if (!sourceStore) {
            throw CustomError.badRequest(`La tienda origen con ID ${dto.sourceStoreId} no existe`);
        }

        // Validar que la tienda de fulfillment existe si se proporciona
        if (dto.fulfillmentStoreId) {
            const fulfillmentStore = await prisma.store.findUnique({
                where: { id: dto.fulfillmentStoreId },
            });
            if (!fulfillmentStore) {
                throw CustomError.badRequest(`La tienda de fulfillment con ID ${dto.fulfillmentStoreId} no existe`);
            }
        }

        // Validar que el usuario vendedor existe si se proporciona
        if (dto.sellerUserId) {
            const seller = await prisma.user.findUnique({
                where: { id: dto.sellerUserId },
            });
            if (!seller) {
                throw CustomError.badRequest(`El usuario vendedor con ID ${dto.sellerUserId} no existe`);
            }
        }

        // Validar que todos los productos/variantes existen
        const variantIds = Array.from(new Set(dto.items.map((item) => item.variantId)));
        const variants = await prisma.productVariant.findMany({
            where: { id: { in: variantIds } },
            include: { product: true },
        });

        if (variants.length !== variantIds.length) {
            throw CustomError.badRequest('Una o mÃ¡s variantes seleccionadas no existen');
        }

        const itemFulfillmentStoreIds = Array.from(new Set(
            dto.items
                .map((item) => item.fulfillmentStoreId)
                .filter((storeId): storeId is number => typeof storeId === 'number' && Number.isInteger(storeId) && storeId > 0)
        ));
        if (itemFulfillmentStoreIds.length > 0) {
            const stores = await prisma.store.findMany({
                where: { id: { in: itemFulfillmentStoreIds } },
                select: { id: true },
            });
            if (stores.length !== itemFulfillmentStoreIds.length) {
                throw CustomError.badRequest('Una o mas tiendas de fulfillment de los items no existen');
            }
        }

        const resolveItemFulfillmentStoreId = (item: { fulfillmentStoreId?: number | null }) => (
            item.fulfillmentStoreId || dto.fulfillmentStoreId || dto.sourceStoreId
        );
        const resolvedFulfillmentStoreIds = dto.items.map((item) => resolveItemFulfillmentStoreId(item));
        const uniqueFulfillmentStoreIds = Array.from(new Set(resolvedFulfillmentStoreIds));
        const orderFulfillmentStoreId = uniqueFulfillmentStoreIds.length === 1
            ? uniqueFulfillmentStoreIds[0] ?? null
            : dto.fulfillmentStoreId ?? null;
        const isPosOrder = this.detectSalesChannel(dto.note) === 'POS';
        const hasRemoteFulfillment = resolvedFulfillmentStoreIds.some((storeId) => Number(storeId) !== Number(dto.sourceStoreId));
        const shouldConsumeDirectStock = isPosOrder && !hasRemoteFulfillment;

        // Validar stock disponible por variante y tienda de fulfillment
        const requestedByStoreAndVariant = new Map<string, { storeId: number; variantId: number; quantity: number }>();
        for (const item of dto.items) {
            const storeId = resolveItemFulfillmentStoreId(item);
            const key = `${storeId}:${item.variantId}`;
            const current = requestedByStoreAndVariant.get(key);
            requestedByStoreAndVariant.set(key, {
                storeId,
                variantId: item.variantId,
                quantity: (current?.quantity || 0) + item.quantity,
            });
        }

        for (const request of requestedByStoreAndVariant.values()) {
            const inventory = await prisma.inventory.findUnique({
                where: {
                    storeId_variantId: {
                        storeId: request.storeId,
                        variantId: request.variantId,
                    },
                },
            });

            const availableStock = (inventory?.stock ?? 0) - (inventory?.reservedStock ?? 0);
            if (availableStock < request.quantity) {
                const variant = variants.find((v) => v.id === request.variantId);
                throw CustomError.badRequest(
                    `Stock insuficiente para ${variant?.product.name}. Disponible: ${availableStock}`
                );
            }
        }

        // Calcular totales
        const subtotal = dto.items.reduce((sum, item) => {
            return sum + item.quantity * item.unitPrice;
        }, 0);
        const includeIgv = dto.applyIgv === undefined ? true : dto.applyIgv;
        const tax = this.resolveTaxAmount(subtotal, includeIgv);
        const total = subtotal + tax;

        // Crear pedido con items
        const order: any = await prisma.order.create({
            data: {
                code: this.generateOrderCode(),
                status: shouldConsumeDirectStock
                    ? OrderStatusEnum.DELIVERED
                    : hasRemoteFulfillment
                        ? OrderStatusEnum.WAITING_TRANSFER
                        : OrderStatusEnum.PENDING,
                sourceStoreId: dto.sourceStoreId,
                fulfillmentStoreId: orderFulfillmentStoreId,
                sellerUserId: dto.sellerUserId ?? null,
                clientName: dto.clientName ?? null,
                clientEmail: dto.clientEmail ?? null,
                clientPhone: dto.clientPhone ?? null,
                subtotal,
                tax,
                total,
                note: dto.note ?? null,
                items: {
                    create: dto.items.map((item) => ({
                        variantId: item.variantId,
                        quantity: item.quantity,
                        reserved: item.quantity,
                        picked: shouldConsumeDirectStock ? item.quantity : 0,
                        unitPrice: item.unitPrice,
                        subtotal: item.quantity * item.unitPrice,
                        fulfillmentStoreId: resolveItemFulfillmentStoreId(item),
                        status: shouldConsumeDirectStock ? 'PICKED' : 'PENDING',
                    })),
                },
            },
            include: {
                items: {
                    include: {
                        fulfillmentStore: true,
                        variant: { include: { product: true, color: true, size: true } },
                    },
                },
                sourceStore: true,
                fulfillmentStore: true,
                sellerUser: true,
            },
        });

        // Crear reservas automÃ¡ticamente para cada item
        for (const item of order.items) {
            const storeToUse = item.fulfillmentStoreId || order.fulfillmentStoreId || order.sourceStoreId;
            const inventory = await this.getOrCreateInventory(storeToUse, item.variantId);

            if (shouldConsumeDirectStock) {
                const previousStock = Number(inventory.stock || 0);
                const newStock = previousStock - item.quantity;

                await prisma.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        stock: {
                            decrement: item.quantity,
                        },
                    },
                });

                await prisma.inventoryMovement.create({
                    data: {
                        type: 'OUT',
                        quantity: item.quantity,
                        previousStock,
                        newStock,
                        note: `Stock consumido por venta POS ${order.code}`,
                        responsibleUserId: dto.sellerUserId ?? null,
                        inventoryId: inventory.id,
                    },
                });
                continue;
            }

            await prisma.reservation.create({
                data: {
                    quantity: item.quantity,
                    status: 'ACTIVE',
                    inventoryId: inventory.id,
                    variantId: item.variantId,
                    orderId: order.id,
                    reservedById: dto.sellerUserId ?? null,
                },
            });
        }

        // Actualizar stock reservado en inventario
        if (!shouldConsumeDirectStock) {
            for (const item of order.items) {
                const storeToUse = item.fulfillmentStoreId || order.fulfillmentStoreId || order.sourceStoreId;
                const inventory = await this.getOrCreateInventory(storeToUse, item.variantId);
                await prisma.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        reservedStock: {
                            increment: item.quantity,
                        },
                    },
                });
            }
        }

        return order;
    }

    async createMarketplaceOrder(dto: CreateMarketplaceOrderDto) {
        const [selectedPaymentMethod, marketplaceSettings] = await Promise.all([
            this.resolveMarketplacePaymentMethod(dto.paymentMethodId),
            this.getMarketplacePaymentSettings(),
        ]);

        const sourceStore = await prisma.store.findFirst({
            where: { id: dto.sourceStoreId, isActive: true },
        });
        if (!sourceStore) {
            throw CustomError.badRequest(`La tienda origen con ID ${dto.sourceStoreId} no existe o esta inactiva`);
        }

        if (dto.pickupStoreId) {
            const pickupStore = await prisma.store.findFirst({
                where: { id: dto.pickupStoreId, isActive: true },
            });
            if (!pickupStore) {
                throw CustomError.badRequest('La tienda de recojo no existe o esta inactiva');
            }
        }

        const variantIds = Array.from(new Set(dto.items.map((item) => item.variantId)));
        const uniqueVariantIds = Array.from(new Set(variantIds));
        const variants = await prisma.productVariant.findMany({
            where: {
                id: { in: uniqueVariantIds },
                isActive: true,
                product: { isActive: true },
            },
            include: {
                product: true,
            },
        });

        if (variants.length !== uniqueVariantIds.length) {
            throw CustomError.badRequest('Una o mas variantes seleccionadas no existen o estan inactivas');
        }

        const variantMap = new Map<number, typeof variants[number]>();
        variants.forEach((variant) => variantMap.set(variant.id, variant));

        const orderCode = this.generateOrderCode().replace('ORD-', 'MK-');
        const normalizedClientName = dto.companyName
            ? `${dto.clientName} (${dto.companyName})`
            : dto.clientName;

        const summary = await prisma.$transaction(async (tx) => {
            const calculatedItems: Array<{
                variantId: number;
                requestedQuantity: number;
                reservedQuantity: number;
                pendingQuantity: number;
                availableStock: number;
                unitPrice: number;
                lineSubtotal: number;
            }> = [];
            let subtotal = 0;
            let totalRequested = 0;
            let totalReserved = 0;
            let totalPending = 0;
            const autoReserveStock = marketplaceSettings.autoReserveStock === true;
            const availableStockByVariant = new Map<number, number>();
            const inventoryIdByVariant = new Map<number, number>();

            const inventories = await tx.inventory.findMany({
                where: {
                    storeId: dto.sourceStoreId,
                    variantId: { in: uniqueVariantIds },
                },
                select: {
                    id: true,
                    variantId: true,
                    stock: true,
                    reservedStock: true,
                },
            });

            for (const inventory of inventories) {
                const availableStock = Math.max(0, Number(inventory.stock || 0) - Number(inventory.reservedStock || 0));
                availableStockByVariant.set(inventory.variantId, availableStock);
                inventoryIdByVariant.set(inventory.variantId, inventory.id);
            }

            for (const variantId of uniqueVariantIds) {
                if (!availableStockByVariant.has(variantId)) {
                    availableStockByVariant.set(variantId, 0);
                }
            }

            for (const item of dto.items) {
                const variant = variantMap.get(item.variantId);
                if (!variant) {
                    throw CustomError.badRequest(`Variante ${item.variantId} no encontrada`);
                }

                const requestedQuantity = Number(item.quantity || 0);
                const availableStock = Math.max(0, Number(availableStockByVariant.get(item.variantId) || 0));
                const reservedQuantity = autoReserveStock
                    ? Math.max(0, Math.min(requestedQuantity, availableStock))
                    : 0;
                const pendingQuantity = Math.max(0, requestedQuantity - reservedQuantity);
                const unitPrice = Number(item.unitPrice ?? variant.price ?? 0);
                const lineSubtotal = requestedQuantity * unitPrice;
                if (autoReserveStock) {
                    availableStockByVariant.set(item.variantId, Math.max(0, availableStock - reservedQuantity));
                }

                totalRequested += requestedQuantity;
                totalReserved += reservedQuantity;
                totalPending += pendingQuantity;
                subtotal += lineSubtotal;

                calculatedItems.push({
                    variantId: item.variantId,
                    requestedQuantity,
                    reservedQuantity,
                    pendingQuantity,
                    availableStock,
                    unitPrice,
                    lineSubtotal,
                });
            }

            const tax = this.resolveTaxAmount(subtotal, marketplaceSettings.includeIgv);
            const total = subtotal + tax;
            const status = OrderStatusEnum.PENDING;

            const order = await tx.order.create({
                data: {
                    code: orderCode,
                    status,
                    sourceStoreId: dto.sourceStoreId,
                    fulfillmentStoreId: dto.sourceStoreId,
                    clientName: normalizedClientName,
                    clientEmail: dto.clientEmail ?? null,
                    clientPhone: dto.clientPhone,
                    subtotal,
                    tax,
                    total,
                    note: this.buildMarketplaceNote(
                        dto,
                        autoReserveStock
                            ? 'RESERVA: automatica segun stock disponible. Pedido sujeto a validacion interna'
                            : 'RESERVA: no automatica. Pedido sujeto a validacion interna',
                        selectedPaymentMethod,
                    ),
                    items: {
                        create: calculatedItems.map((item) => ({
                            variantId: item.variantId,
                            quantity: item.requestedQuantity,
                            reserved: item.reservedQuantity,
                            picked: 0,
                            unitPrice: item.unitPrice,
                            subtotal: item.lineSubtotal,
                            status: 'PENDING',
                        })),
                    },
                },
                include: {
                    items: true,
                    sourceStore: true,
                    fulfillmentStore: true,
                },
            });

            if (autoReserveStock) {
                const reservationPayload = calculatedItems
                    .filter((item) => item.reservedQuantity > 0)
                    .map((item) => {
                        const inventoryId = inventoryIdByVariant.get(item.variantId);
                        if (!inventoryId) {
                            throw CustomError.internal(
                                `No se encontro inventario para reservar la variante ${item.variantId} en tienda ${dto.sourceStoreId}`,
                            );
                        }
                        return {
                            inventoryId,
                            variantId: item.variantId,
                            quantity: item.reservedQuantity,
                        };
                    });

                const reservedByVariant = new Map<number, number>();
                for (const reservation of reservationPayload) {
                    await tx.reservation.create({
                        data: {
                            quantity: reservation.quantity,
                            status: 'ACTIVE',
                            inventoryId: reservation.inventoryId,
                            variantId: reservation.variantId,
                            orderId: order.id,
                            reservedById: null,
                        },
                    });

                    const current = Number(reservedByVariant.get(reservation.variantId) || 0);
                    reservedByVariant.set(reservation.variantId, current + reservation.quantity);
                }

                for (const [variantId, quantity] of reservedByVariant.entries()) {
                    if (quantity <= 0) continue;

                    await tx.inventory.update({
                        where: {
                            storeId_variantId: {
                                storeId: dto.sourceStoreId,
                                variantId,
                            },
                        },
                        data: {
                            reservedStock: {
                                increment: quantity,
                            },
                        },
                    });
                }
            }

            const detailedOrder = await tx.order.findUnique({
                where: { id: order.id },
                include: this.orderDetailInclude,
            });

            if (!detailedOrder) {
                throw CustomError.internal('No se pudo recuperar el pedido marketplace creado');
            }

            return {
                order: detailedOrder,
                metrics: {
                    totalRequested,
                    totalReserved,
                    totalPending,
                },
            };
        });

        return {
            ...this.mapOrderWithPresentationData(summary.order),
            stockSummary: summary.metrics,
            reviewMessage: 'Pedido sujeto a confirmacion de disponibilidad',
        };
    }

    async getMarketplaceOrderByCode(code: string) {
        const order = await prisma.order.findFirst({
            where: {
                code,
                ...this.buildMarketplaceOrderScopeWhere(),
            },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound('Pedido no encontrado');
        }

        const mapped = this.mapOrderWithPresentationData(order);
        return {
            code: mapped.code,
            status: mapped.status,
            publicStatus: this.mapPublicOrderStatus(mapped.status as OrderStatusEnum),
            createdAt: mapped.createdAt,
            clientName: mapped.clientName,
            clientPhone: mapped.clientPhone,
            totals: {
                subtotal: Number(mapped.subtotal || 0),
                tax: Number(mapped.tax || 0),
                total: Number(mapped.total || 0),
            },
            items: (mapped.items || []).map((item: any) => ({
                variantId: item.variantId,
                productName: item.variant?.product?.name || 'Producto',
                colorName: item.variant?.color?.name || 'Sin color',
                sizeName: item.variant?.size?.name || 'Sin talla',
                requestedQuantity: Number(item.requestedQuantity ?? item.quantity ?? 0),
                reservedQuantity: Number(item.reservedQuantity ?? item.reserved ?? 0),
                pendingQuantity: Number(item.pendingStockQuantity ?? 0),
                unitPrice: Number(item.unitPrice || 0),
                subtotal: Number(item.subtotal || 0),
            })),
            reviewMessage: 'Pedido recibido. Nuestro equipo revisara disponibilidad y te contactara.',
        };
    }

    async trackMarketplaceOrder(dto: TrackMarketplaceOrderDto) {
        const order = await prisma.order.findFirst({
            where: {
                code: dto.code,
                clientPhone: dto.phone,
                ...this.buildMarketplaceOrderScopeWhere(),
            },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound('No se encontro un pedido con esos datos');
        }

        const mapped = this.mapOrderWithPresentationData(order);
        const items: Array<{
            productName: string;
            colorName: string;
            sizeName: string;
            requestedQuantity: number;
            reservedQuantity: number;
            pendingQuantity: number;
        }> = (mapped.items || []).map((item: any) => ({
            productName: item.variant?.product?.name || 'Producto',
            colorName: item.variant?.color?.name || 'Sin color',
            sizeName: item.variant?.size?.name || 'Sin talla',
            requestedQuantity: Number(item.requestedQuantity ?? item.quantity ?? 0),
            reservedQuantity: Number(item.reservedQuantity ?? item.reserved ?? 0),
            pendingQuantity: Number(item.pendingStockQuantity ?? 0),
        }));

        const hasPending = items.some((item: { pendingQuantity: number }) => item.pendingQuantity > 0);
        return {
            code: mapped.code,
            status: mapped.status,
            publicStatus: this.mapPublicOrderStatus(mapped.status as OrderStatusEnum),
            createdAt: mapped.createdAt,
            items,
            hasPending,
            reviewMessage: hasPending
                ? 'Pedido en revision: hay cantidades pendientes por confirmar'
                : 'Pedido confirmado para preparacion',
        };
    }

    async listMarketplaceOrders(dto: ListMarketplaceOrdersDto) {
        const orders = await prisma.order.findMany({
            where: {
                clientPhone: dto.phone,
                ...(dto.email ? { clientEmail: dto.email } : {}),
                ...this.buildMarketplaceOrderScopeWhere(),
            },
            include: {
                items: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: dto.take,
        });

        return this.mapMarketplaceOrderSummaries(orders);
    }

    async listMarketplaceOrdersByCustomerProfile(customer: { phone: string; email: string }, take: number = 20) {
        const phone = String(customer.phone || '').trim();
        const email = String(customer.email || '').trim().toLowerCase();

        if (!phone && !email) {
            return [];
        }

        const fallbackOr: Array<any> = [];
        if (phone) {
            fallbackOr.push({ clientPhone: phone });
        }
        if (email) {
            fallbackOr.push({ clientEmail: { equals: email, mode: 'insensitive' as const } });
        }

        if (fallbackOr.length === 0) {
            return [];
        }

        const orders = await prisma.order.findMany({
            where: {
                AND: [
                    { OR: fallbackOr },
                    this.buildMarketplaceOrderScopeWhere(),
                ],
            },
            include: {
                items: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
            take,
        });

        return this.mapMarketplaceOrderSummaries(orders);
    }

    async getMarketplaceCheckoutPaymentMethods() {
        const settings = await this.getMarketplacePaymentSettings();
        const activeMethods = await this.listActivePaymentMethods();
        const availableMethods = settings.enabled
            ? this.filterAllowedPaymentMethods(activeMethods, settings)
            : [];

        return {
            enabled: settings.enabled,
            includeIgv: settings.includeIgv,
            igvRate: 0.18,
            methods: availableMethods.map((method) => ({
                id: method.id,
                name: method.name,
                code: method.code,
            })),
        };
    }

    private mapMarketplaceOrderSummaries(orders: Array<any>) {
        return orders.map((order) => {
            const totalRequested = (order.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);
            const totalReserved = (order.items || []).reduce((sum: number, item: any) => sum + Number(item.reserved || 0), 0);
            const pendingUnits = Math.max(0, totalRequested - totalReserved);
            const hasPending = pendingUnits > 0;

            return {
                code: order.code,
                status: order.status,
                publicStatus: this.mapPublicOrderStatus(order.status as OrderStatusEnum),
                createdAt: order.createdAt,
                totals: {
                    subtotal: Number(order.subtotal || 0),
                    tax: Number(order.tax || 0),
                    total: Number(order.total || 0),
                },
                requestedUnits: totalRequested,
                reservedUnits: totalReserved,
                pendingUnits,
                hasPending,
                reviewMessage: hasPending
                    ? 'Pedido en revision: hay cantidades pendientes por confirmar'
                    : 'Pedido confirmado para preparacion',
            };
        });
    }

    async listMarketplaceStores() {
        const stores = await prisma.store.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                code: true,
                type: true,
            },
            orderBy: { name: 'asc' },
        });

        return stores;
    }

    /**
     * Obtener o crear un registro de inventario
     */
    private async getOrCreateInventory(storeId: number, variantId: number) {
        let inventory = await prisma.inventory.findUnique({
            where: {
                storeId_variantId: {
                    storeId,
                    variantId,
                },
            },
        });

        if (!inventory) {
            inventory = await prisma.inventory.create({
                data: {
                    storeId,
                    variantId,
                    stock: 0,
                    reservedStock: 0,
                },
            });
        }

        return inventory;
    }

    /**
     * Obtener pedido por ID
     */
    async getOrderById(orderId: number) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        const mapped = this.mapOrderWithPresentationData(order);
        return this.attachPickingResponsibilityData(mapped);
    }

    /**
     * Listar pedidos con filtros
     */
    async listOrders(dto: ListOrderDto) {
        const andFilters: any[] = [];

        if (dto.status) {
            andFilters.push({ status: dto.status });
        }

        if (dto.storeId) {
            andFilters.push({
                OR: [
                    { sourceStoreId: dto.storeId },
                    { fulfillmentStoreId: dto.storeId },
                    { items: { some: { fulfillmentStoreId: dto.storeId } } },
                ],
            });
        }

        if (dto.responsibleUserId) {
            andFilters.push({
                OR: [
                    { sellerUserId: dto.responsibleUserId },
                    { pickerUserId: dto.responsibleUserId },
                    { dispenserUserId: dto.responsibleUserId },
                    { returnResponsibleUserId: dto.responsibleUserId },
                ],
            });
        }

        if (dto.startDate || dto.endDate) {
            const createdAt: any = {};
            if (dto.startDate) {
                createdAt.gte = dto.startDate;
            }
            if (dto.endDate) {
                createdAt.lte = dto.endDate;
            }
            andFilters.push({ createdAt });
        }

        if (dto.search) {
            andFilters.push({
                OR: [
                    { code: { contains: dto.search, mode: 'insensitive' } },
                    { clientName: { contains: dto.search, mode: 'insensitive' } },
                    { clientEmail: { contains: dto.search, mode: 'insensitive' } },
                    { clientPhone: { contains: dto.search, mode: 'insensitive' } },
                ],
            });
        }

        if (dto.channel === 'POS') {
            andFilters.push({
                OR: [
                    { note: { contains: 'POS-', mode: 'insensitive' } },
                    { note: { contains: 'METODO DE PAGO', mode: 'insensitive' } },
                ],
            });
        }

        if (dto.channel === 'ECOMMERCE') {
            andFilters.push({
                note: { contains: 'ECOMMERCE', mode: 'insensitive' },
            });
        }

        if (dto.channel === 'INTERNAL') {
            andFilters.push({
                NOT: {
                    OR: [
                        { note: { contains: 'POS-', mode: 'insensitive' } },
                        { note: { contains: 'METODO DE PAGO', mode: 'insensitive' } },
                        { note: { contains: 'ECOMMERCE', mode: 'insensitive' } },
                    ],
                },
            });
        }

        const where = andFilters.length > 0 ? { AND: andFilters } : {};

        const skip = (dto.page - 1) * dto.limit;

        const orders = await prisma.order.findMany({
            where,
            include: {
                items: {
                    include: {
                        variant: { include: { product: true, color: true, size: true } },
                    },
                },
                sourceStore: true,
                fulfillmentStore: true,
                sellerUser: true,
                pickerUser: true,
                dispenserUser: true,
                cancelledByUser: true,
                returnResponsibleUser: true,
                returnResponsibilityDelegatedBy: true,
                pickingSession: {
                    include: {
                        assignedUser: true,
                        items: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: dto.limit,
        });

        const mappedOrders = orders.map((order) => this.mapOrderWithPresentationData(order));
        const total = await prisma.order.count({ where });

        return {
            data: mappedOrders,
            pagination: {
                page: dto.page,
                limit: dto.limit,
                total,
                totalPages: Math.ceil(total / dto.limit),
            },
        };
    }

    /**
     * Actualizar estado del pedido
     */
    async updateOrderStatus(orderId: number, dto: UpdateOrderStatusDto, responsibleUserId?: number) {
        const order: any = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                items: true,
                reservations: { include: { inventory: true } },
            },
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        const currentStatus = order.status as OrderStatusEnum;
        const targetStatus = dto.status as OrderStatusEnum;

        // Validar transicion de estados
        const validTransitions: Record<OrderStatusEnum, OrderStatusEnum[]> = {
            [OrderStatusEnum.PENDING]: [OrderStatusEnum.CONFIRMED, OrderStatusEnum.WAITING_STOCK, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.CONFIRMED]: [OrderStatusEnum.PREPARING, OrderStatusEnum.WAITING_TRANSFER, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.WAITING_STOCK]: [OrderStatusEnum.CONFIRMED, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.WAITING_TRANSFER]: [OrderStatusEnum.PREPARING, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.PREPARING]: [OrderStatusEnum.READY, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.READY]: [OrderStatusEnum.DELIVERED, OrderStatusEnum.CANCELLED, OrderStatusEnum.RETURN_PENDING],
            [OrderStatusEnum.DELIVERED]: [],
            [OrderStatusEnum.RETURN_PENDING]: [OrderStatusEnum.CANCELLED],
            [OrderStatusEnum.CANCELLED]: [],
        };

        if (!validTransitions[currentStatus].includes(targetStatus)) {
            throw CustomError.badRequest(`No se puede cambiar de ${order.status} a ${dto.status}`);
        }

        const returnResponsibilityManagementEnabled = await this.isReturnResponsibilityManagementEnabled();

        await prisma.$transaction(async (tx) => {
            const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled(tx);
            const isReturnCompletion = currentStatus === OrderStatusEnum.RETURN_PENDING && targetStatus === OrderStatusEnum.CANCELLED;
            const isCancellationRequest = (targetStatus === OrderStatusEnum.CANCELLED && currentStatus !== OrderStatusEnum.RETURN_PENDING)
                || targetStatus === OrderStatusEnum.RETURN_PENDING;
            const activeReservations = order.reservations.filter((reservation: any) => reservation.status === 'ACTIVE');
            const totalPickedUnits = order.items.reduce((sum: number, item: any) => {
                const picked = Number(item?.picked || 0);
                return sum + Math.max(0, picked);
            }, 0);
            const hasPickedUnits = totalPickedUnits > 0;

            let nextOrderStatus = targetStatus;
            const orderUpdateData: any = { updatedAt: new Date() };

            if (pickingResponsibilityFlowEnabled && targetStatus === OrderStatusEnum.CONFIRMED) {
                const confirmedByUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);
                if (!confirmedByUserId) {
                    throw CustomError.unauthorized('No se pudo identificar al usuario que confirmo el pedido');
                }

                orderUpdateData.pickerUserId = confirmedByUserId;
                await tx.pickingSession.updateMany({
                    where: { orderId },
                    data: { assignedUserId: confirmedByUserId },
                });
            }

            const releaseActiveReservations = async (actorUserId: number | null, note: string) => {
                for (const reservation of activeReservations) {
                    const previousStock = Number(reservation.inventory.stock || 0);

                    await tx.inventory.update({
                        where: { id: reservation.inventoryId },
                        data: { reservedStock: { decrement: reservation.quantity } },
                    });

                    await tx.reservation.update({
                        where: { id: reservation.id },
                        data: { status: 'RELEASED' },
                    });

                    await tx.inventoryMovement.create({
                        data: {
                            type: 'UNRESERVED',
                            quantity: reservation.quantity,
                            previousStock,
                            newStock: previousStock,
                            note,
                            responsibleUserId: actorUserId,
                            inventoryId: reservation.inventoryId,
                            reservationId: reservation.id,
                        },
                    });
                }
            };

            if (isCancellationRequest) {
                const cancelledById = this.resolvePreferredResponsibleUserId(
                    responsibleUserId,
                    order.dispenserUserId,
                    order.pickerUserId,
                    order.sellerUserId,
                );

                if (!cancelledById) {
                    throw CustomError.badRequest('No se pudo identificar al usuario que cancela para asignar la devolucion');
                }

                orderUpdateData.cancelledByUserId = cancelledById;

                await tx.pickingSession.updateMany({
                    where: {
                        orderId,
                        status: { in: ['PENDING', 'IN_PROGRESS'] },
                    },
                    data: { status: 'CANCELLED' },
                });

                if (!hasPickedUnits) {
                    await releaseActiveReservations(
                        cancelledById,
                        `Reserva liberada automaticamente por cancelacion sin picking de orden ${order.code}`,
                    );

                    nextOrderStatus = OrderStatusEnum.CANCELLED;
                    orderUpdateData.returnResponsibleUserId = null;
                    orderUpdateData.returnResponsibilityDelegatedById = null;
                    orderUpdateData.returnResponsibilityStatus = null;
                    orderUpdateData.returnRequestedAt = null;
                    orderUpdateData.returnResponsibilityAcceptedAt = null;
                    orderUpdateData.returnedAt = null;
                } else {
                    nextOrderStatus = OrderStatusEnum.RETURN_PENDING;
                    orderUpdateData.returnResponsibleUserId = returnResponsibilityManagementEnabled ? cancelledById : null;
                    orderUpdateData.returnResponsibilityDelegatedById = null;
                    orderUpdateData.returnResponsibilityStatus = returnResponsibilityManagementEnabled ? 'ACCEPTED' : null;
                    orderUpdateData.returnRequestedAt = new Date();
                    orderUpdateData.returnResponsibilityAcceptedAt = returnResponsibilityManagementEnabled ? new Date() : null;
                    orderUpdateData.returnedAt = null;
                }
            }

            if (isReturnCompletion) {
                let actorUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);

                if (returnResponsibilityManagementEnabled) {
                    const expectedResponsibleUserId = this.resolvePreferredResponsibleUserId(
                        order.returnResponsibleUserId,
                        order.cancelledByUserId,
                        order.dispenserUserId,
                        order.pickerUserId,
                        order.sellerUserId,
                    );

                    if (!expectedResponsibleUserId) {
                        throw CustomError.badRequest('El pedido no tiene responsable de devolucion asignado');
                    }

                    if (!actorUserId) {
                        throw CustomError.unauthorized('No se pudo identificar al usuario responsable de la devolucion');
                    }

                    if (actorUserId !== expectedResponsibleUserId) {
                        throw CustomError.forbidden('Solo el responsable de devolucion puede cerrar la cancelacion');
                    }

                    if (order.returnResponsibilityStatus !== 'ACCEPTED' && order.returnResponsibilityDelegatedById) {
                        throw CustomError.badRequest('La responsabilidad de devolucion debe estar aceptada antes de finalizar');
                    }

                    if (order.returnResponsibilityStatus !== 'ACCEPTED') {
                        orderUpdateData.returnResponsibleUserId = expectedResponsibleUserId;
                        orderUpdateData.returnResponsibilityStatus = 'ACCEPTED';
                        orderUpdateData.returnResponsibilityAcceptedAt = order.returnResponsibilityAcceptedAt || new Date();
                    }
                } else {
                    actorUserId = this.resolvePreferredResponsibleUserId(
                        responsibleUserId,
                        order.dispenserUserId,
                        order.pickerUserId,
                        order.sellerUserId,
                        order.cancelledByUserId,
                    );
                }

                await releaseActiveReservations(actorUserId, `Reserva liberada por devolucion de orden ${order.code}`);

                await tx.pickingSession.updateMany({
                    where: {
                        orderId,
                        status: { in: ['PENDING', 'IN_PROGRESS'] },
                    },
                    data: { status: 'CANCELLED' },
                });

                orderUpdateData.returnedAt = new Date();
            }

            if (targetStatus === OrderStatusEnum.DELIVERED) {
                const activeReservations = order.reservations.filter((reservation: any) => reservation.status === 'ACTIVE');

                for (const reservation of activeReservations) {
                    const previousStock = Number(reservation.inventory.stock || 0);
                    const newStock = previousStock - reservation.quantity;

                    await tx.inventory.update({
                        where: { id: reservation.inventoryId },
                        data: {
                            stock: { decrement: reservation.quantity },
                            reservedStock: { decrement: reservation.quantity },
                        },
                    });

                    await tx.reservation.update({
                        where: { id: reservation.id },
                        data: { status: 'COMPLETED' },
                    });

                    await tx.inventoryMovement.create({
                        data: {
                            type: 'OUT',
                            quantity: reservation.quantity,
                            previousStock,
                            newStock,
                            note: `Stock consumido por entrega de orden ${order.code}`,
                            responsibleUserId: responsibleUserId ?? order.dispenserUserId ?? null,
                            inventoryId: reservation.inventoryId,
                            reservationId: reservation.id,
                        },
                    });
                }

                await tx.orderItem.updateMany({
                    where: { orderId },
                    data: { status: 'PICKED' },
                });

                orderUpdateData.returnRequestedAt = null;
                orderUpdateData.returnedAt = null;
                orderUpdateData.returnResponsibleUserId = null;
                orderUpdateData.returnResponsibilityDelegatedById = null;
                orderUpdateData.returnResponsibilityStatus = null;
                orderUpdateData.returnResponsibilityAcceptedAt = null;
            }

            orderUpdateData.status = nextOrderStatus;

            await tx.order.update({
                where: { id: orderId },
                data: orderUpdateData,
            });

            if (nextOrderStatus === OrderStatusEnum.CANCELLED || nextOrderStatus === OrderStatusEnum.DELIVERED) {
                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingSharedResponsibility"
                        SET "isActive" = false,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "isActive" = true
                    `,
                );

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingResponsibilityRequest"
                        SET "status" = 'CANCELLED',
                            "resolvedByUserId" = ${this.resolvePreferredResponsibleUserId(responsibleUserId)},
                            "resolvedAt" = CURRENT_TIMESTAMP,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "status" = 'PENDING'
                    `,
                );

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingUnpickRequest"
                        SET "status" = 'CANCELLED',
                            "resolvedByUserId" = ${this.resolvePreferredResponsibleUserId(responsibleUserId)},
                            "resolvedAt" = CURRENT_TIMESTAMP,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "status" = 'PENDING'
                    `,
                );
            }
        });

        const updatedOrder = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        const mapped = this.mapOrderWithPresentationData(updatedOrder);
        return this.attachPickingResponsibilityData(mapped);
    }

    /**
     * Asignar responsable a un pedido
     */
    async assignResponsible(orderId: number, dto: AssignOrderResponsibleDto, actorUserId?: number) {
        const currentOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                pickerUserId: true,
                status: true,
            },
        });

        if (!currentOrder) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        // Validar que el usuario existe
        const user = await prisma.user.findUnique({
            where: { id: dto.userId },
        });

        if (!user) {
            throw CustomError.badRequest(`El usuario con ID ${dto.userId} no existe`);
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (dto.roleType === 'picker' && pickingResponsibilityFlowEnabled) {
            const actorId = this.resolvePreferredResponsibleUserId(actorUserId);
            if (!actorId) {
                throw CustomError.unauthorized('No se pudo identificar al usuario que delega picking');
            }

            const currentPrimaryUserId = Number(currentOrder.pickerUserId || 0);
            if (currentPrimaryUserId > 0 && currentPrimaryUserId !== actorId) {
                throw CustomError.forbidden('Solo el responsable principal de picking puede delegar');
            }
        }

        const updateData: any = {};

        if (dto.roleType === 'seller') {
            updateData.sellerUserId = dto.userId;
        } else if (dto.roleType === 'picker') {
            updateData.pickerUserId = dto.userId;
        } else if (dto.roleType === 'dispenser') {
            updateData.dispenserUserId = dto.userId;
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
            const order = await tx.order.update({
                where: { id: orderId },
                data: updateData,
                include: this.orderDetailInclude,
            });

            if (dto.roleType === 'picker') {
                await tx.pickingSession.updateMany({
                    where: { orderId },
                    data: { assignedUserId: dto.userId },
                });

                if (pickingResponsibilityFlowEnabled) {
                    await tx.$executeRaw(
                        Prisma.sql`
                            UPDATE "PickingSharedResponsibility"
                            SET "isActive" = false,
                                "updatedAt" = CURRENT_TIMESTAMP
                            WHERE "orderId" = ${orderId}
                              AND "userId" = ${dto.userId}
                              AND "isActive" = true
                        `,
                    );
                }
            }

            return order;
        });

        const mapped = this.mapOrderWithPresentationData(updatedOrder);
        return this.attachPickingResponsibilityData(mapped);
    }

    async requestPickingResponsibility(orderId: number, dto: RequestPickingResponsibilityDto, requesterUserId?: number) {
        const actorUserId = this.resolvePreferredResponsibleUserId(requesterUserId);
        if (!actorUserId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que solicita responsabilidad');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (!pickingResponsibilityFlowEnabled) {
            throw CustomError.badRequest('El flujo de responsabilidad en picking esta desactivado');
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        const orderStatus = String(order.status || '').toUpperCase();
        const allowedStatuses = new Set(['CONFIRMED', 'WAITING_TRANSFER', 'PREPARING', 'READY']);
        if (!allowedStatuses.has(orderStatus)) {
            throw CustomError.badRequest('El pedido no permite solicitudes de responsabilidad en su estado actual');
        }

        if (Number(order.pickerUserId || 0) === actorUserId) {
            throw CustomError.badRequest('Ya eres el responsable principal de picking');
        }

        const alreadyShared = await this.isActiveSharedResponsible(orderId, actorUserId);
        if (alreadyShared) {
            throw CustomError.badRequest('Ya participas como responsable compartido en este picking');
        }

        const mode = this.normalizePickingResponsibilityMode(dto.mode, 'SHARED');
        const existingPending = await prisma.$queryRaw<Array<{ id: number }>>(
            Prisma.sql`
                SELECT "id"
                FROM "PickingResponsibilityRequest"
                WHERE "orderId" = ${orderId}
                  AND "requesterUserId" = ${actorUserId}
                  AND "status" = 'PENDING'
                  AND "mode" = ${mode}
                LIMIT 1
            `,
        );

        if (existingPending.length > 0) {
            throw CustomError.badRequest('Ya tienes una solicitud pendiente para este pedido');
        }

        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO "PickingResponsibilityRequest" (
                    "orderId",
                    "requesterUserId",
                    "mode",
                    "status",
                    "note"
                )
                VALUES (
                    ${orderId},
                    ${actorUserId},
                    ${mode},
                    'PENDING',
                    ${dto.note ?? null}
                )
            `,
        );

        return this.getOrderPicking(orderId);
    }

    async delegatePickingResponsibility(orderId: number, dto: DelegatePickingResponsibilityDto, delegatedByUserId?: number) {
        const actorUserId = this.resolvePreferredResponsibleUserId(delegatedByUserId);
        if (!actorUserId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que delega picking');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (!pickingResponsibilityFlowEnabled) {
            throw CustomError.badRequest('El flujo de responsabilidad en picking esta desactivado');
        }

        const mode = this.normalizePickingResponsibilityMode(dto.mode, 'TRANSFER');
        const order = await this.ensurePrimaryPickerCanDelegate(orderId, actorUserId);

        const targetUser = await prisma.user.findUnique({
            where: { id: dto.userId },
        });
        if (!targetUser) {
            throw CustomError.badRequest(`El usuario con ID ${dto.userId} no existe`);
        }

        if (mode === 'TRANSFER') {
            await prisma.$transaction(async (tx) => {
                await tx.order.update({
                    where: { id: orderId },
                    data: {
                        pickerUserId: dto.userId,
                        updatedAt: new Date(),
                    },
                });

                await tx.pickingSession.updateMany({
                    where: { orderId },
                    data: { assignedUserId: dto.userId },
                });

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingSharedResponsibility"
                        SET "isActive" = false,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "userId" = ${dto.userId}
                          AND "isActive" = true
                    `,
                );

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingResponsibilityRequest"
                        SET "status" = 'APPROVED',
                            "resolvedByUserId" = ${actorUserId},
                            "resolvedAt" = CURRENT_TIMESTAMP,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "requesterUserId" = ${dto.userId}
                          AND "status" = 'PENDING'
                    `,
                );
            });
        } else {
            if (Number(order.pickerUserId || 0) === Number(dto.userId)) {
                throw CustomError.badRequest('El usuario ya es el responsable principal');
            }

            await prisma.$transaction(async (tx) => {
                await this.upsertSharedPickingResponsibility(
                    orderId,
                    dto.userId,
                    actorUserId,
                    'DELEGATION',
                    dto.note,
                    tx,
                );

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingResponsibilityRequest"
                        SET "status" = 'APPROVED',
                            "resolvedByUserId" = ${actorUserId},
                            "resolvedAt" = CURRENT_TIMESTAMP,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "requesterUserId" = ${dto.userId}
                          AND "status" = 'PENDING'
                    `,
                );
            });
        }

        return this.getOrderPicking(orderId);
    }

    async resolvePickingResponsibilityRequest(
        orderId: number,
        requestId: number,
        dto: ResolvePickingResponsibilityRequestDto,
        resolvedByUserId?: number,
    ) {
        const actorUserId = this.resolvePreferredResponsibleUserId(resolvedByUserId);
        if (!actorUserId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que resuelve la solicitud');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (!pickingResponsibilityFlowEnabled) {
            throw CustomError.badRequest('El flujo de responsabilidad en picking esta desactivado');
        }

        await this.ensurePrimaryPickerCanDelegate(orderId, actorUserId);

        const rows = await prisma.$queryRaw<Array<{
            id: number;
            requesterUserId: number;
            mode: string;
            status: string;
        }>>(
            Prisma.sql`
                SELECT "id", "requesterUserId", "mode", "status"
                FROM "PickingResponsibilityRequest"
                WHERE "id" = ${requestId}
                  AND "orderId" = ${orderId}
                LIMIT 1
            `,
        );

        if (!rows.length) {
            throw CustomError.notFound('No se encontro la solicitud de responsabilidad');
        }

        const requestRow = rows[0]!;
        const currentStatus = String(requestRow.status || '').toUpperCase();
        if (currentStatus !== 'PENDING') {
            throw CustomError.badRequest('La solicitud ya fue resuelta anteriormente');
        }

        const action = String(dto.action || '').toUpperCase();
        if (action === 'REJECT') {
            await prisma.$executeRaw(
                Prisma.sql`
                    UPDATE "PickingResponsibilityRequest"
                    SET "status" = 'REJECTED',
                        "resolvedByUserId" = ${actorUserId},
                        "resolvedAt" = CURRENT_TIMESTAMP,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "id" = ${requestId}
                `,
            );
            return this.getOrderPicking(orderId);
        }

        const requestMode = this.normalizePickingResponsibilityMode(requestRow.mode, 'SHARED');
        await prisma.$transaction(async (tx) => {
            if (requestMode === 'TRANSFER') {
                await tx.order.update({
                    where: { id: orderId },
                    data: { pickerUserId: Number(requestRow.requesterUserId), updatedAt: new Date() },
                });

                await tx.pickingSession.updateMany({
                    where: { orderId },
                    data: { assignedUserId: Number(requestRow.requesterUserId) },
                });

                await tx.$executeRaw(
                    Prisma.sql`
                        UPDATE "PickingSharedResponsibility"
                        SET "isActive" = false,
                            "updatedAt" = CURRENT_TIMESTAMP
                        WHERE "orderId" = ${orderId}
                          AND "userId" = ${Number(requestRow.requesterUserId)}
                          AND "isActive" = true
                    `,
                );
            } else {
                await this.upsertSharedPickingResponsibility(
                    orderId,
                    Number(requestRow.requesterUserId),
                    actorUserId,
                    'REQUEST_APPROVAL',
                    dto.note,
                    tx,
                );
            }

            await tx.$executeRaw(
                Prisma.sql`
                    UPDATE "PickingResponsibilityRequest"
                    SET "status" = 'APPROVED',
                        "resolvedByUserId" = ${actorUserId},
                        "resolvedAt" = CURRENT_TIMESTAMP,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "id" = ${requestId}
                `,
            );
        });

        return this.getOrderPicking(orderId);
    }

    async requestPickingUnpickAction(
        orderId: number,
        pickingItemId: number,
        dto: RequestPickingUnpickActionDto,
        requesterUserId?: number,
    ) {
        const actorUserId = this.resolvePreferredResponsibleUserId(requesterUserId);
        if (!actorUserId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que solicita la accion');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (!pickingResponsibilityFlowEnabled) {
            throw CustomError.badRequest('El flujo de responsabilidad en picking esta desactivado');
        }

        const pickingItem = await prisma.pickingItem.findUnique({
            where: { id: pickingItemId },
            include: {
                session: {
                    include: {
                        order: {
                            select: {
                                id: true,
                                status: true,
                                pickerUserId: true,
                            },
                        },
                    },
                },
            },
        });

        if (!pickingItem || !pickingItem.session?.order) {
            throw CustomError.notFound(`No se encontro el item de picking ${pickingItemId}`);
        }

        if (Number(pickingItem.session.order.id) !== Number(orderId)) {
            throw CustomError.badRequest('El item no pertenece a la orden indicada');
        }

        const validStatuses = new Set([
            OrderStatusEnum.CONFIRMED,
            OrderStatusEnum.PREPARING,
            OrderStatusEnum.WAITING_TRANSFER,
            OrderStatusEnum.READY,
        ]);
        if (!validStatuses.has(pickingItem.session.order.status as OrderStatusEnum)) {
            throw CustomError.badRequest('La orden no permite solicitudes de unpick en su estado actual');
        }

        const canOperate = await this.canUserOperatePicking(
            orderId,
            actorUserId,
            pickingItem.session.order.pickerUserId ?? pickingItem.session.assignedUserId ?? null,
        );
        if (!canOperate) {
            throw CustomError.forbidden('No tienes responsabilidad asignada para solicitar esta accion');
        }

        const currentPickedQuantity = Math.max(0, Number(pickingItem.pickedQuantity || 0));
        if (currentPickedQuantity <= 0) {
            throw CustomError.badRequest('El item no tiene unidades separadas para solicitar unpick');
        }

        const ownContribution = await this.getPickingItemUserContribution(orderId, pickingItemId, actorUserId);
        const maxRequestable = Math.max(0, currentPickedQuantity - ownContribution);
        if (maxRequestable <= 0) {
            throw CustomError.badRequest(
                'No necesitas solicitud: solo hay unidades separadas por ti en este item',
            );
        }

        const requestedQuantity = Number(dto.quantity || 0);
        if (requestedQuantity > maxRequestable) {
            throw CustomError.badRequest(`Solo puedes solicitar hasta ${maxRequestable} und para este item`);
        }

        const existingPending = await prisma.$queryRaw(
            Prisma.sql`
                SELECT "id"
                FROM "PickingUnpickRequest"
                WHERE "pickingItemId" = ${pickingItemId}
                  AND "requesterUserId" = ${actorUserId}
                  AND "status" = 'PENDING'
                LIMIT 1
            `,
        ) as Array<{ id: number }>;
        if (existingPending.length > 0) {
            throw CustomError.badRequest('Ya tienes una solicitud pendiente para este item');
        }

        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO "PickingUnpickRequest" (
                    "orderId",
                    "pickingItemId",
                    "requesterUserId",
                    "quantity",
                    "status",
                    "note"
                )
                VALUES (
                    ${orderId},
                    ${pickingItemId},
                    ${actorUserId},
                    ${requestedQuantity},
                    'PENDING',
                    ${dto.note ?? null}
                )
            `,
        );

        return this.getOrderPicking(orderId);
    }

    async resolvePickingUnpickAction(
        orderId: number,
        requestId: number,
        dto: ResolvePickingUnpickActionDto,
        resolvedByUserId?: number,
    ) {
        const actorUserId = this.resolvePreferredResponsibleUserId(resolvedByUserId);
        if (!actorUserId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que resuelve la solicitud');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        if (!pickingResponsibilityFlowEnabled) {
            throw CustomError.badRequest('El flujo de responsabilidad en picking esta desactivado');
        }

        const requestRows = await prisma.$queryRaw(
            Prisma.sql`
                SELECT
                    "id",
                    "orderId",
                    "pickingItemId",
                    "requesterUserId",
                    "quantity",
                    "status"
                FROM "PickingUnpickRequest"
                WHERE "id" = ${requestId}
                  AND "orderId" = ${orderId}
                LIMIT 1
            `,
        ) as Array<{
            id: number;
            orderId: number;
            pickingItemId: number;
            requesterUserId: number;
            quantity: number;
            status: string;
        }>;

        if (!requestRows.length) {
            throw CustomError.notFound('No se encontro la solicitud de unpick');
        }

        const requestRow = requestRows[0]!;
        const currentStatus = String(requestRow.status || '').toUpperCase();
        if (currentStatus !== 'PENDING') {
            throw CustomError.badRequest('La solicitud de unpick ya fue resuelta');
        }

        if (Number(requestRow.requesterUserId) === Number(actorUserId)) {
            throw CustomError.forbidden('No puedes aprobar o rechazar tu propia solicitud');
        }

        const pickingItem = await prisma.pickingItem.findUnique({
            where: { id: Number(requestRow.pickingItemId) },
            include: {
                session: {
                    include: {
                        order: {
                            include: {
                                items: true,
                                reservations: true,
                            },
                        },
                    },
                },
            },
        });

        if (!pickingItem || !pickingItem.session?.order) {
            throw CustomError.notFound('El item relacionado a la solicitud ya no existe');
        }

        if (Number(pickingItem.session.order.id) !== Number(orderId)) {
            throw CustomError.badRequest('La solicitud no corresponde a la orden indicada');
        }

        const canOperate = await this.canUserOperatePicking(
            orderId,
            actorUserId,
            pickingItem.session.order.pickerUserId ?? pickingItem.session.assignedUserId ?? null,
        );
        if (!canOperate) {
            throw CustomError.forbidden('No tienes responsabilidad asignada para resolver esta solicitud');
        }

        const action = String(dto.action || '').trim().toUpperCase();
        if (action === 'REJECT') {
            await prisma.$executeRaw(
                Prisma.sql`
                    UPDATE "PickingUnpickRequest"
                    SET "status" = 'REJECTED',
                        "note" = COALESCE(${dto.note ?? null}, "note"),
                        "resolvedByUserId" = ${actorUserId},
                        "resolvedAt" = CURRENT_TIMESTAMP,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "id" = ${requestId}
                `,
            );
            return this.getOrderPicking(orderId);
        }

        const requestedQuantity = Math.max(0, Number(requestRow.quantity || 0));
        if (requestedQuantity < 1) {
            throw CustomError.badRequest('La cantidad de la solicitud es invalida');
        }

        const order = pickingItem.session.order;
        const orderItemsForVariant = this.getOrderItemsForVariant(order, Number(pickingItem.variantId));
        if (orderItemsForVariant.length === 0) {
            throw CustomError.badRequest('La variante del item de picking no pertenece a la orden');
        }

        const currentPickedQuantity = Math.max(0, Number(pickingItem.pickedQuantity || 0));
        if (currentPickedQuantity < requestedQuantity) {
            throw CustomError.badRequest('La cantidad actual separada es menor a la solicitada');
        }

        const requesterContribution = await this.getPickingItemUserContribution(
            orderId,
            Number(requestRow.pickingItemId),
            Number(requestRow.requesterUserId),
        );
        const maxReducibleFromOthers = Math.max(0, currentPickedQuantity - requesterContribution);
        if (requestedQuantity > maxReducibleFromOthers) {
            throw CustomError.badRequest(
                `Ya no hay suficientes unidades de otros responsables para aprobar ${requestedQuantity} und`,
            );
        }

        const contributorRows = await prisma.$queryRaw(
            Prisma.sql`
                SELECT
                    "userId",
                    "quantity"
                FROM "PickingItemContribution"
                WHERE "orderId" = ${orderId}
                  AND "pickingItemId" = ${Number(requestRow.pickingItemId)}
                  AND "quantity" > 0
                  AND "userId" <> ${Number(requestRow.requesterUserId)}
                ORDER BY
                    CASE WHEN "userId" = ${actorUserId} THEN 0 ELSE 1 END ASC,
                    "quantity" DESC,
                    "userId" ASC
            `,
        ) as Array<{ userId: number; quantity: number }>;

        if (contributorRows.length === 0) {
            throw CustomError.badRequest('No hay responsables con unidades disponibles para aprobar esta solicitud');
        }

        const primaryResponsibleUserId = Number(order.pickerUserId || 0);
        const isPrimaryResponsibleResolver = primaryResponsibleUserId > 0 && primaryResponsibleUserId === actorUserId;
        const actorContribution = Math.max(
            0,
            Number(contributorRows.find((row) => Number(row.userId) === actorUserId)?.quantity || 0),
        );

        if (!isPrimaryResponsibleResolver && actorContribution < requestedQuantity) {
            throw CustomError.forbidden(
                'Solo el responsable principal o un colaborador con unidades suficientes puede aprobar la solicitud',
            );
        }

        let remainingToReduce = requestedQuantity;
        const reductionPlan: Array<{ userId: number; quantity: number }> = [];

        if (!isPrimaryResponsibleResolver) {
            reductionPlan.push({
                userId: actorUserId,
                quantity: requestedQuantity,
            });
            remainingToReduce = 0;
        } else {
            for (const contributor of contributorRows) {
                if (remainingToReduce <= 0) break;

                const contributorQuantity = Math.max(0, Number(contributor.quantity || 0));
                if (contributorQuantity <= 0) continue;

                const reductionQuantity = Math.min(contributorQuantity, remainingToReduce);
                reductionPlan.push({
                    userId: Number(contributor.userId),
                    quantity: reductionQuantity,
                });
                remainingToReduce -= reductionQuantity;
            }
        }

        if (remainingToReduce > 0) {
            throw CustomError.badRequest('No se pudo completar la aprobacion por cambios recientes en las contribuciones');
        }

        const nextPickedQuantity = Math.max(0, currentPickedQuantity - requestedQuantity);

        await prisma.$transaction(async (tx) => {
            for (const reduction of reductionPlan) {
                await this.updatePickingItemUserContribution(
                    orderId,
                    Number(requestRow.pickingItemId),
                    Number(reduction.userId),
                    -Math.abs(Number(reduction.quantity || 0)),
                    tx,
                );
            }

            await tx.pickingItem.update({
                where: { id: Number(requestRow.pickingItemId) },
                data: { pickedQuantity: nextPickedQuantity },
            });

            const pickedAllocations = this.allocateQuantityAcrossOrderItems(orderItemsForVariant, nextPickedQuantity);
            for (const orderItem of orderItemsForVariant) {
                const nextPickedQuantityForItem = Math.max(
                    0,
                    Number(pickedAllocations.get(Number(orderItem.id || 0)) || 0),
                );
                const requestedQuantityForItem = Math.max(0, Number(orderItem.quantity || 0));

                await tx.orderItem.update({
                    where: { id: orderItem.id },
                    data: {
                        picked: nextPickedQuantityForItem,
                        status: this.mapOrderItemStatusFromPicked(nextPickedQuantityForItem, requestedQuantityForItem),
                    },
                });

                await tx.$executeRaw(
                    Prisma.sql`
                        INSERT INTO "PickingOrderItemDetail" (
                            "orderId",
                            "orderItemId",
                            "pickingItemId",
                            "variantId",
                            "pickedQuantity"
                        )
                        VALUES (
                            ${orderId},
                            ${Number(orderItem.id)},
                            ${Number(requestRow.pickingItemId)},
                            ${Number(orderItem.variantId || pickingItem.variantId || 0)},
                            ${nextPickedQuantityForItem}
                        )
                        ON CONFLICT ("orderItemId")
                        DO UPDATE SET
                            "orderId" = EXCLUDED."orderId",
                            "pickingItemId" = EXCLUDED."pickingItemId",
                            "variantId" = EXCLUDED."variantId",
                            "pickedQuantity" = EXCLUDED."pickedQuantity",
                            "updatedAt" = CURRENT_TIMESTAMP
                    `,
                );
            }

            await this.recalculatePickingItemPickedQuantityFromDetails(orderId, Number(requestRow.pickingItemId), tx);

            await tx.$executeRaw(
                Prisma.sql`
                    UPDATE "PickingUnpickRequest"
                    SET "status" = 'APPROVED',
                        "note" = COALESCE(${dto.note ?? null}, "note"),
                        "resolvedByUserId" = ${actorUserId},
                        "resolvedAt" = CURRENT_TIMESTAMP,
                        "updatedAt" = CURRENT_TIMESTAMP
                    WHERE "id" = ${requestId}
                `,
            );
        });

        await this.syncPickingAndOrderStatus(orderId);
        return this.getOrderPicking(orderId);
    }

    /**
     * Delegar responsabilidad de devolucion de una orden cancelada
     */
    async delegateReturnResponsibility(orderId: number, dto: DelegateOrderReturnDto, delegatedByUserId?: number) {
        const returnResponsibilityManagementEnabled = await this.isReturnResponsibilityManagementEnabled();
        if (!returnResponsibilityManagementEnabled) {
            throw CustomError.badRequest('La gestion de responsabilidades de devolucion esta desactivada en configuracion');
        }

        const actorId = this.resolvePreferredResponsibleUserId(delegatedByUserId);
        if (!actorId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que delega la devolucion');
        }

        const order: any = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        if ((order.status as OrderStatusEnum) !== OrderStatusEnum.RETURN_PENDING) {
            throw CustomError.badRequest('Solo pedidos en devolucion pendiente permiten delegar responsabilidad');
        }

        const targetUser = await prisma.user.findUnique({
            where: { id: dto.userId },
        });

        if (!targetUser) {
            throw CustomError.badRequest(`El usuario con ID ${dto.userId} no existe`);
        }

        const currentReturnResponsibleId = this.resolvePreferredResponsibleUserId(
            order.returnResponsibleUserId,
            order.cancelledByUserId,
            order.dispenserUserId,
            order.pickerUserId,
            order.sellerUserId,
        );

        const canDelegate = actorId === Number(currentReturnResponsibleId || 0)
            || actorId === Number(order.cancelledByUserId || 0);

        if (!canDelegate) {
            throw CustomError.forbidden('Solo quien cancelo o el responsable actual pueden delegar la devolucion');
        }

        const isSelfAssignment = actorId === dto.userId;

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
                returnResponsibleUserId: dto.userId,
                returnResponsibilityDelegatedById: actorId,
                returnResponsibilityStatus: isSelfAssignment ? 'ACCEPTED' : 'PENDING',
                returnResponsibilityAcceptedAt: isSelfAssignment ? new Date() : null,
                updatedAt: new Date(),
            },
            include: this.orderDetailInclude,
        });

        const mapped = this.mapOrderWithPresentationData(updatedOrder);
        return this.attachPickingResponsibilityData(mapped);
    }

    /**
     * Aceptar responsabilidad de devolucion
     */
    async acceptReturnResponsibility(orderId: number, userId?: number) {
        const returnResponsibilityManagementEnabled = await this.isReturnResponsibilityManagementEnabled();
        if (!returnResponsibilityManagementEnabled) {
            throw CustomError.badRequest('La gestion de responsabilidades de devolucion esta desactivada en configuracion');
        }

        const actorId = this.resolvePreferredResponsibleUserId(userId);
        if (!actorId) {
            throw CustomError.unauthorized('No se pudo identificar al usuario que acepta la devolucion');
        }

        const order: any = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        if ((order.status as OrderStatusEnum) !== OrderStatusEnum.RETURN_PENDING) {
            throw CustomError.badRequest('Solo pedidos en devolucion pendiente permiten aceptar responsabilidad');
        }

        const expectedResponsibleUserId = this.resolvePreferredResponsibleUserId(
            order.returnResponsibleUserId,
            order.cancelledByUserId,
            order.dispenserUserId,
            order.pickerUserId,
            order.sellerUserId,
        );

        if (Number(expectedResponsibleUserId || 0) !== actorId) {
            throw CustomError.forbidden('Solo el responsable asignado puede aceptar la devolucion');
        }

        const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
                returnResponsibleUserId: actorId,
                returnResponsibilityStatus: 'ACCEPTED',
                returnResponsibilityAcceptedAt: new Date(),
                updatedAt: new Date(),
            },
            include: this.orderDetailInclude,
        });

        const mapped = this.mapOrderWithPresentationData(updatedOrder);
        return this.attachPickingResponsibilityData(mapped);
    }

    /**
     * Obtener stock remoto para multitienda
     */
    async getVariantStock(storeId: number, variantIds: number[]) {
        const inventories = await prisma.inventory.findMany({
            where: {
                storeId,
                variantId: { in: variantIds },
            },
        });

        const stockMap = new Map(inventories.map((inv) => [inv.variantId, inv]));

        return variantIds.map((variantId) => {
            const inventory = stockMap.get(variantId);
            const stock = inventory?.stock ?? 0;
            const reservedStock = inventory?.reservedStock ?? 0;
            return {
                variantId,
                stock,
                reservedStock,
                availableStock: stock - reservedStock,
            };
        });
    }

    async getRemoteStock(variantId: number, excludeStoreId: number) {
        const remoteStock = await prisma.inventory.findMany({
            where: {
                variantId,
                storeId: { not: excludeStoreId },
                store: { isActive: true },
            },
            include: { store: true, variant: { include: { product: true } } },
        });

        return remoteStock
            .map((inv) => ({
                storeId: inv.storeId,
                storeName: inv.store.name,
                storeType: inv.store.type,
                availableStock: inv.stock - inv.reservedStock,
                reservedStock: inv.reservedStock,
            }))
            .filter((s) => s.availableStock > 0)
            .sort((a, b) => b.availableStock - a.availableStock);
    }

    async getOrderReservations(orderId: number) {
        await this.assertOrderExists(orderId);

        const reservations = await prisma.reservation.findMany({
            where: { orderId },
            include: {
                reservedBy: true,
                inventory: {
                    include: {
                        store: true,
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        });

        return reservations;
    }

    async getOrderPicking(orderId: number) {
        const order = await this.getOrderById(orderId);
        const pickingSession = order?.pickingSession || null;
        const sessionItems = pickingSession?.items || [];
        const [contributionRows, unpickRequestRows, pickingDetailMap] = await Promise.all([
            this.listPickingItemContributionRows(orderId),
            this.listPickingUnpickRequestRows(orderId),
            this.syncPickingOrderItemDetailsForOrder(order),
        ]);
        const contributionsByItemId = this.buildPickingItemContributionMap(contributionRows);
        const pendingUnpickRequestsByItemId = this.buildPendingUnpickRequestMap(unpickRequestRows);
        const orderItems = Array.isArray(order?.items)
            ? [...order.items].sort((a: any, b: any) => Number(a?.id || 0) - Number(b?.id || 0))
            : [];
        const orderItemsByVariant = new Map<number, any[]>();
        for (const item of orderItems) {
            const variantId = Number(item?.variantId || 0);
            const bucket = orderItemsByVariant.get(variantId) || [];
            bucket.push(item);
            orderItemsByVariant.set(variantId, bucket);
        }

        const reservedAllocationByOrderItemId = new Map<number, number>();
        for (const [variantId, variantOrderItems] of orderItemsByVariant.entries()) {
            const totalReservedForVariant = this.getReservedQuantityForVariant(order, variantId);
            const reservedAllocations = this.allocateQuantityAcrossOrderItems(variantOrderItems, totalReservedForVariant);
            reservedAllocations.forEach((quantity, orderItemId) => {
                reservedAllocationByOrderItemId.set(orderItemId, quantity);
            });
        }

        const items = orderItems.map((item: any) => {
            const orderItemId = Number(item?.id || 0);
            const variantId = Number(item?.variantId || 0);
            const sessionItem = sessionItems.find((candidate: any) => Number(candidate?.variantId || 0) === variantId);
            const detail = pickingDetailMap.get(orderItemId);
            const requestedQuantity = Math.max(0, Number(item?.quantity || 0));
            const reservedQuantity = Math.max(
                0,
                Number(reservedAllocationByOrderItemId.get(orderItemId) ?? Number(item?.reserved || 0)),
            );
            const maxPickableQuantity = Math.max(0, Math.min(requestedQuantity, reservedQuantity));
            const pickedQuantity = Math.max(
                0,
                Math.min(maxPickableQuantity, Number(detail?.pickedQuantity ?? item?.picked ?? 0)),
            );
            const missingQuantity = Math.max(0, requestedQuantity - pickedQuantity);
            const itemStatus = this.mapPickingItemStatus(pickedQuantity, requestedQuantity);
            const effectivePickingItemId = Number(detail?.pickingItemId || 0) > 0
                ? Number(detail?.pickingItemId || 0)
                : (sessionItem?.id ?? null);

            return {
                pickingItemId: effectivePickingItemId,
                orderItemId,
                variantId,
                requestedQuantity,
                reservedQuantity,
                maxPickableQuantity,
                pickedQuantity,
                missingQuantity,
                status: itemStatus,
                variant: item.variant,
                responsibleUser: pickingSession?.assignedUser || null,
                contributions: contributionsByItemId.get(Number(effectivePickingItemId || 0)) || [],
                pendingUnpickRequests: pendingUnpickRequestsByItemId.get(Number(effectivePickingItemId || 0)) || [],
                updatedAt: detail?.updatedAt || sessionItem?.createdAt || pickingSession?.updatedAt || order.updatedAt,
            };
        });

        const totalRequested = items.reduce((sum: number, item: any) => sum + item.requestedQuantity, 0);
        const totalPicked = items.reduce((sum: number, item: any) => sum + item.pickedQuantity, 0);
        const progress = totalRequested > 0 ? Math.round((totalPicked / totalRequested) * 100) : 0;

        return {
            orderId: order.id,
            orderCode: order.code,
            orderStatus: order.status,
            pickingResponsibility: order.pickingResponsibility || {
                enabled: false,
                primaryResponsible: null,
                sharedResponsibles: [],
                pendingRequests: [],
            },
            pickingSession: pickingSession
                ? {
                    id: pickingSession.id,
                    status: pickingSession.status,
                    assignedUser: pickingSession.assignedUser || null,
                    createdAt: pickingSession.createdAt,
                    updatedAt: pickingSession.updatedAt,
                }
                : null,
            summary: {
                totalRequested,
                totalPicked,
                progress,
                completed: items.every((item: any) => item.status === 'COMPLETED'),
            },
            items,
        };
    }

    async startOrderPicking(orderId: number, responsibleUserId?: number) {
        const order = await this.getOrderById(orderId);
        const validStatuses = [OrderStatusEnum.CONFIRMED, OrderStatusEnum.PREPARING, OrderStatusEnum.WAITING_TRANSFER];

        if (!validStatuses.includes(order.status as OrderStatusEnum)) {
            throw CustomError.badRequest('Solo pedidos CONFIRMED, PREPARING o WAITING_TRANSFER pueden iniciar picking');
        }

        const activeReservations = (order.reservations || []).filter((reservation: any) => reservation.status === 'ACTIVE');
        if (activeReservations.length === 0) {
            throw CustomError.badRequest('La orden no tiene reservas activas para iniciar picking');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        const actorUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);
        const assignedUserId = this.resolvePreferredResponsibleUserId(order.pickerUserId, responsibleUserId);

        if (pickingResponsibilityFlowEnabled) {
            if (!actorUserId) {
                throw CustomError.unauthorized('No se pudo identificar al usuario que inicia picking');
            }

            if (Number(order.pickerUserId || 0) > 0) {
                const canOperate = await this.canUserOperatePicking(order.id, actorUserId, order.pickerUserId);
                if (!canOperate) {
                    throw CustomError.forbidden('No tienes responsabilidad asignada en este picking');
                }
            }
        }

        const session = await prisma.pickingSession.upsert({
            where: { orderId: order.id },
            create: {
                orderId: order.id,
                status: 'IN_PROGRESS',
                assignedUserId: pickingResponsibilityFlowEnabled
                    ? this.resolvePreferredResponsibleUserId(order.pickerUserId, actorUserId)
                    : assignedUserId,
            },
            update: {
                status: 'IN_PROGRESS',
                assignedUserId: pickingResponsibilityFlowEnabled
                    ? this.resolvePreferredResponsibleUserId(order.pickerUserId, actorUserId)
                    : assignedUserId,
            },
        });
        const defaultContributionUserId = this.resolvePreferredResponsibleUserId(
            order.pickerUserId,
            session.assignedUserId,
            actorUserId,
            assignedUserId,
        );
        const requestedByVariant = new Map<number, number>();
        const pickedByVariant = new Map<number, number>();
        for (const item of order.items || []) {
            const variantId = Number(item?.variantId || 0);
            if (!Number.isInteger(variantId) || variantId < 1) {
                continue;
            }

            const requestedQuantity = Math.max(0, Number(item?.quantity || 0));
            const pickedQuantity = Math.max(0, Number(item?.picked || 0));

            requestedByVariant.set(variantId, Number(requestedByVariant.get(variantId) || 0) + requestedQuantity);
            pickedByVariant.set(variantId, Number(pickedByVariant.get(variantId) || 0) + pickedQuantity);
        }

        for (const [variantId, requestedQuantity] of requestedByVariant.entries()) {
            const existingPickingItem = await prisma.pickingItem.findFirst({
                where: {
                    sessionId: session.id,
                    variantId,
                },
            });

            if (existingPickingItem) {
                const refreshedPickingItem = await prisma.pickingItem.update({
                    where: { id: existingPickingItem.id },
                    data: { quantity: requestedQuantity },
                });

                if (
                    pickingResponsibilityFlowEnabled
                    && Number(defaultContributionUserId || 0) > 0
                    && Number(refreshedPickingItem.pickedQuantity || 0) > 0
                ) {
                    const totalContributionRows = await prisma.$queryRaw(
                        Prisma.sql`
                            SELECT COALESCE(SUM("quantity"), 0) AS "quantity"
                            FROM "PickingItemContribution"
                            WHERE "orderId" = ${order.id}
                              AND "pickingItemId" = ${refreshedPickingItem.id}
                        `,
                    ) as Array<{ quantity: number }>;
                    const totalContributed = Math.max(0, Number(totalContributionRows?.[0]?.quantity || 0));
                    if (totalContributed <= 0) {
                        await this.updatePickingItemUserContribution(
                            order.id,
                            refreshedPickingItem.id,
                            Number(defaultContributionUserId),
                            Number(refreshedPickingItem.pickedQuantity || 0),
                        );
                    }
                }
                continue;
            }

            const createdPickingItem = await prisma.pickingItem.create({
                data: {
                    sessionId: session.id,
                    variantId,
                    quantity: requestedQuantity,
                    pickedQuantity: Math.min(
                        requestedQuantity,
                        Math.max(0, Number(pickedByVariant.get(variantId) || 0)),
                    ),
                },
            });

            if (
                pickingResponsibilityFlowEnabled
                && Number(defaultContributionUserId || 0) > 0
                && Number(createdPickingItem.pickedQuantity || 0) > 0
            ) {
                await this.updatePickingItemUserContribution(
                    order.id,
                    createdPickingItem.id,
                    Number(defaultContributionUserId),
                    Number(createdPickingItem.pickedQuantity || 0),
                );
            }
        }

        const refreshedOrder = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });

        if (refreshedOrder) {
            const detailMap = await this.syncPickingOrderItemDetailsForOrder(
                refreshedOrder,
                prisma,
                { forcePickedFromOrderItems: true },
            );
            const detailRows = Array.from(detailMap.values());
            const uniquePickingItemIds = Array.from(
                new Set(
                    detailRows
                        .map((row) => Number(row?.pickingItemId || 0))
                        .filter((pickingItemId) => Number.isInteger(pickingItemId) && pickingItemId > 0),
                ),
            );

            for (const pickingItemId of uniquePickingItemIds) {
                await this.recalculatePickingItemPickedQuantityFromDetails(orderId, Number(pickingItemId), prisma);
            }

            await this.syncOrderItemsFromPickingOrderItemDetailMap(refreshedOrder, detailMap, prisma);
        }

        await prisma.order.update({
            where: { id: orderId },
            data: {
                status: OrderStatusEnum.PREPARING,
                pickerUserId: pickingResponsibilityFlowEnabled
                    ? this.resolvePreferredResponsibleUserId(order.pickerUserId, actorUserId)
                    : assignedUserId,
            },
        });

        return this.getOrderPicking(orderId);
    }

    async updatePickingOrderItem(orderId: number, orderItemId: number, pickedQuantity: number, responsibleUserId?: number) {
        if (!Number.isInteger(orderId) || orderId < 1) {
            throw CustomError.badRequest('El ID de la orden es invalido');
        }
        if (!Number.isInteger(orderItemId) || orderItemId < 1) {
            throw CustomError.badRequest('El ID del item de orden es invalido');
        }
        if (!Number.isFinite(pickedQuantity) || pickedQuantity < 0) {
            throw CustomError.badRequest('La cantidad separada debe ser mayor o igual a 0');
        }
        if (!Number.isInteger(pickedQuantity)) {
            throw CustomError.badRequest('La cantidad separada debe ser un numero entero');
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: this.orderDetailInclude,
        });
        if (!order) {
            throw CustomError.notFound(`El pedido con ID ${orderId} no existe`);
        }

        if (!order.pickingSession) {
            throw CustomError.badRequest('La orden no tiene una sesion de picking iniciada');
        }
        const pickingSessionId = Number(order.pickingSession.id);
        const currentSessionAssignedUserId = order.pickingSession.assignedUserId ?? null;

        const validStatuses = [
            OrderStatusEnum.CONFIRMED,
            OrderStatusEnum.PREPARING,
            OrderStatusEnum.WAITING_TRANSFER,
            OrderStatusEnum.READY,
        ];
        if (!validStatuses.includes(order.status as OrderStatusEnum)) {
            throw CustomError.badRequest('La orden no permite actualizar picking en su estado actual');
        }

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        const actorUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);

        if (pickingResponsibilityFlowEnabled) {
            if (!actorUserId) {
                throw CustomError.unauthorized('No se pudo identificar al usuario que actualiza picking');
            }

            const canOperate = await this.canUserOperatePicking(
                order.id,
                actorUserId,
                order.pickerUserId ?? order.pickingSession.assignedUserId ?? null,
            );
            if (!canOperate) {
                throw CustomError.forbidden('No tienes responsabilidad asignada para actualizar este picking');
            }
        }

        const targetOrderItem = (order.items || []).find((item: any) => Number(item?.id || 0) === orderItemId);
        if (!targetOrderItem) {
            throw CustomError.badRequest('El item de orden no pertenece a la orden indicada');
        }

        const detailMap = await this.syncPickingOrderItemDetailsForOrder(order, prisma);
        const targetDetail = detailMap.get(orderItemId);
        if (!targetDetail) {
            throw CustomError.badRequest('No se pudo resolver el detalle de picking para el item');
        }

        const rowLimit = this.getOrderItemMaxPickableQuantity(order, targetOrderItem);
        const currentRowPickedQuantity = Math.max(0, Number(targetDetail.pickedQuantity || 0));
        const isReducingOverflow = currentRowPickedQuantity > rowLimit && pickedQuantity < currentRowPickedQuantity;
        if (pickedQuantity > rowLimit && !isReducingOverflow) {
            throw CustomError.badRequest(`La cantidad separada no puede superar ${rowLimit}`);
        }

        const normalizedPickedQuantity = Math.max(0, Math.min(rowLimit, pickedQuantity));
        const rowDelta = normalizedPickedQuantity - currentRowPickedQuantity;
        if (rowDelta === 0) {
            return this.getOrderPicking(orderId);
        }

        const pickingItemId = Number(targetDetail?.pickingItemId || 0);
        const currentGroupPickedQuantity = pickingItemId > 0
            ? Array.from(detailMap.values())
                .filter((detailRow) => Number(detailRow?.pickingItemId || 0) === pickingItemId)
                .reduce((sum, detailRow) => sum + Math.max(0, Number(detailRow?.pickedQuantity || 0)), 0)
            : currentRowPickedQuantity;

        if (pickingResponsibilityFlowEnabled && rowDelta < 0 && pickingItemId > 0) {
            const reductionQuantity = Math.abs(rowDelta);
            let ownContribution = await this.getPickingItemUserContribution(orderId, pickingItemId, Number(actorUserId || 0));

            if (ownContribution < reductionQuantity && actorUserId) {
                const totalContributionRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT COALESCE(SUM("quantity"), 0) AS "quantity"
                        FROM "PickingItemContribution"
                        WHERE "orderId" = ${order.id}
                          AND "pickingItemId" = ${pickingItemId}
                    `,
                ) as Array<{ quantity: number }>;
                const totalContribution = Math.max(0, Number(totalContributionRows?.[0]?.quantity || 0));

                // Compatibilidad: registros legacy sin trazabilidad previa.
                if (totalContribution <= 0 && currentGroupPickedQuantity > 0) {
                    ownContribution = await this.updatePickingItemUserContribution(
                        order.id,
                        pickingItemId,
                        Number(actorUserId),
                        currentGroupPickedQuantity,
                    );
                }
            }

            if (ownContribution < reductionQuantity) {
                throw CustomError.forbidden(
                    'Solo puedes restar unidades separadas por ti. Usa "Solicitar accion" para retirar unidades separadas por otro responsable',
                );
            }
        }

        const nextPickerUserId = pickingResponsibilityFlowEnabled
            ? this.resolvePreferredResponsibleUserId(order.pickerUserId, currentSessionAssignedUserId, actorUserId)
            : this.resolvePreferredResponsibleUserId(
                order.pickerUserId,
                currentSessionAssignedUserId,
                responsibleUserId,
            );

        await prisma.$transaction(async (tx) => {
            await tx.$executeRaw(
                Prisma.sql`
                    INSERT INTO "PickingOrderItemDetail" (
                        "orderId",
                        "orderItemId",
                        "pickingItemId",
                        "variantId",
                        "pickedQuantity"
                    )
                    VALUES (
                        ${orderId},
                        ${orderItemId},
                        ${pickingItemId > 0 ? pickingItemId : null},
                        ${Number(targetOrderItem?.variantId || 0)},
                        ${normalizedPickedQuantity}
                    )
                    ON CONFLICT ("orderItemId")
                    DO UPDATE SET
                        "orderId" = EXCLUDED."orderId",
                        "pickingItemId" = EXCLUDED."pickingItemId",
                        "variantId" = EXCLUDED."variantId",
                        "pickedQuantity" = EXCLUDED."pickedQuantity",
                        "updatedAt" = CURRENT_TIMESTAMP
                `,
            );

            const refreshedDetailRows = await this.listPickingOrderItemDetailRows(orderId, tx);
            const refreshedDetailMap = this.buildPickingOrderItemDetailMap(refreshedDetailRows);
            await this.syncOrderItemsFromPickingOrderItemDetailMap(order, refreshedDetailMap, tx);

            if (pickingItemId > 0) {
                const nextGroupPickedQuantity = await this.recalculatePickingItemPickedQuantityFromDetails(
                    orderId,
                    pickingItemId,
                    tx,
                );
                const groupDelta = nextGroupPickedQuantity - currentGroupPickedQuantity;
                if (pickingResponsibilityFlowEnabled && actorUserId && groupDelta !== 0) {
                    await this.updatePickingItemUserContribution(
                        order.id,
                        pickingItemId,
                        Number(actorUserId),
                        groupDelta,
                        tx,
                    );
                }
            }

            if (nextPickerUserId !== currentSessionAssignedUserId) {
                await tx.pickingSession.update({
                    where: { id: pickingSessionId },
                    data: { assignedUserId: nextPickerUserId },
                });
            }

            if (nextPickerUserId !== (order.pickerUserId ?? null)) {
                await tx.order.update({
                    where: { id: order.id },
                    data: { pickerUserId: nextPickerUserId },
                });
            }
        });

        await this.syncPickingAndOrderStatus(order.id);
        return this.getOrderPicking(order.id);
    }

    async updatePickingItem(pickingItemId: number, pickedQuantity: number, responsibleUserId?: number) {
        if (!Number.isInteger(pickingItemId) || pickingItemId < 1) {
            throw CustomError.badRequest('El ID del item de picking es invalido');
        }

        if (!Number.isFinite(pickedQuantity) || pickedQuantity < 0) {
            throw CustomError.badRequest('La cantidad separada debe ser mayor o igual a 0');
        }
        if (!Number.isInteger(pickedQuantity)) {
            throw CustomError.badRequest('La cantidad separada debe ser un numero entero');
        }

        const pickingItem = await prisma.pickingItem.findUnique({
            where: { id: pickingItemId },
            include: {
                session: {
                    include: {
                        order: {
                            include: {
                                items: true,
                                reservations: true,
                            },
                        },
                    },
                },
            },
        });

        if (!pickingItem || !pickingItem.session?.order) {
            throw CustomError.notFound(`No se encontro el item de picking ${pickingItemId}`);
        }

        const order = pickingItem.session.order;
        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        const actorUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);
        const validStatuses = [
            OrderStatusEnum.CONFIRMED,
            OrderStatusEnum.PREPARING,
            OrderStatusEnum.WAITING_TRANSFER,
            OrderStatusEnum.READY,
        ];
        if (!validStatuses.includes(order.status as OrderStatusEnum)) {
            throw CustomError.badRequest('La orden no permite actualizar picking en su estado actual');
        }

        if (pickingResponsibilityFlowEnabled) {
            if (!actorUserId) {
                throw CustomError.unauthorized('No se pudo identificar al usuario que actualiza picking');
            }

            const canOperate = await this.canUserOperatePicking(
                order.id,
                actorUserId,
                order.pickerUserId ?? pickingItem.session.assignedUserId ?? null,
            );
            if (!canOperate) {
                throw CustomError.forbidden('No tienes responsabilidad asignada para actualizar este picking');
            }
        }

        const orderItemsForVariant = this.getOrderItemsForVariant(order, Number(pickingItem.variantId));
        if (orderItemsForVariant.length === 0) {
            throw CustomError.badRequest('La variante del item de picking no pertenece a la orden');
        }
        const totalRequestedForVariant = this.getRequestedQuantityForVariant(order, Number(pickingItem.variantId));

        const maxAllowed = this.resolveMaxPickableQuantity(order, pickingItem.variantId, totalRequestedForVariant);
        const currentPickedQuantity = Number(pickingItem.pickedQuantity || 0);
        const isReducingOverflow = currentPickedQuantity > maxAllowed && pickedQuantity < currentPickedQuantity;
        const quantityDelta = pickedQuantity - currentPickedQuantity;

        if (pickedQuantity > maxAllowed && !isReducingOverflow) {
            throw CustomError.badRequest(`La cantidad separada no puede superar ${maxAllowed}`);
        }

        if (pickingResponsibilityFlowEnabled && quantityDelta < 0) {
            const reductionQuantity = Math.abs(quantityDelta);
            let ownContribution = await this.getPickingItemUserContribution(order.id, pickingItemId, Number(actorUserId || 0));

            if (ownContribution < reductionQuantity && actorUserId) {
                const totalContributionRows = await prisma.$queryRaw(
                    Prisma.sql`
                        SELECT COALESCE(SUM("quantity"), 0) AS "quantity"
                        FROM "PickingItemContribution"
                        WHERE "orderId" = ${order.id}
                          AND "pickingItemId" = ${pickingItemId}
                    `,
                ) as Array<{ quantity: number }>;
                const totalContribution = Math.max(0, Number(totalContributionRows?.[0]?.quantity || 0));

                // Compatibilidad: si este item viene de datos antiguos sin trazabilidad, tomamos el estado actual
                // como contribucion del actor para no bloquear la operacion.
                if (totalContribution <= 0 && currentPickedQuantity > 0) {
                    ownContribution = await this.updatePickingItemUserContribution(
                        order.id,
                        pickingItemId,
                        Number(actorUserId),
                        currentPickedQuantity,
                    );
                }
            }

            if (ownContribution < reductionQuantity) {
                throw CustomError.forbidden(
                    'Solo puedes restar unidades separadas por ti. Usa "Solicitar accion" para retirar unidades separadas por otro responsable',
                );
            }
        }

        await prisma.$transaction(async (tx) => {
            await tx.pickingItem.update({
                where: { id: pickingItemId },
                data: { pickedQuantity },
            });

            const pickedAllocations = this.allocateQuantityAcrossOrderItems(orderItemsForVariant, pickedQuantity);
            for (const orderItem of orderItemsForVariant) {
                const nextPickedQuantityForItem = Math.max(
                    0,
                    Number(pickedAllocations.get(Number(orderItem.id || 0)) || 0),
                );
                const requestedQuantityForItem = Math.max(0, Number(orderItem.quantity || 0));

                await tx.orderItem.update({
                    where: { id: orderItem.id },
                    data: {
                        picked: nextPickedQuantityForItem,
                        status: this.mapOrderItemStatusFromPicked(nextPickedQuantityForItem, requestedQuantityForItem),
                    },
                });

                await tx.$executeRaw(
                    Prisma.sql`
                        INSERT INTO "PickingOrderItemDetail" (
                            "orderId",
                            "orderItemId",
                            "pickingItemId",
                            "variantId",
                            "pickedQuantity"
                        )
                        VALUES (
                            ${order.id},
                            ${Number(orderItem.id)},
                            ${pickingItemId},
                            ${Number(orderItem.variantId || pickingItem.variantId || 0)},
                            ${nextPickedQuantityForItem}
                        )
                        ON CONFLICT ("orderItemId")
                        DO UPDATE SET
                            "orderId" = EXCLUDED."orderId",
                            "pickingItemId" = EXCLUDED."pickingItemId",
                            "variantId" = EXCLUDED."variantId",
                            "pickedQuantity" = EXCLUDED."pickedQuantity",
                            "updatedAt" = CURRENT_TIMESTAMP
                    `,
                );
            }

            await this.recalculatePickingItemPickedQuantityFromDetails(order.id, pickingItemId, tx);

            if (pickingResponsibilityFlowEnabled && actorUserId && quantityDelta !== 0) {
                await this.updatePickingItemUserContribution(
                    order.id,
                    pickingItemId,
                    Number(actorUserId),
                    quantityDelta,
                    tx,
                );
            }
        });

        const nextPickerUserId = pickingResponsibilityFlowEnabled
            ? this.resolvePreferredResponsibleUserId(order.pickerUserId, pickingItem.session.assignedUserId, actorUserId)
            : this.resolvePreferredResponsibleUserId(
                order.pickerUserId,
                pickingItem.session.assignedUserId,
                responsibleUserId,
            );

        const currentSessionAssignedUserId = pickingItem.session.assignedUserId ?? null;
        const currentOrderPickerUserId = order.pickerUserId ?? null;

        if (nextPickerUserId !== currentSessionAssignedUserId) {
            await prisma.pickingSession.update({
                where: { id: pickingItem.sessionId },
                data: { assignedUserId: nextPickerUserId },
            });
        }

        if (nextPickerUserId !== currentOrderPickerUserId) {
            await prisma.order.update({
                where: { id: order.id },
                data: { pickerUserId: nextPickerUserId },
            });
        }

        await this.syncPickingAndOrderStatus(order.id);
        return this.getOrderPicking(order.id);
    }

    async completeOrderPicking(orderId: number, responsibleUserId?: number) {
        const picking = await this.getOrderPicking(orderId);
        if (!picking.pickingSession) {
            throw CustomError.badRequest('La orden no tiene una sesion de picking iniciada');
        }

        const hasPendingItems = picking.items.some((item: any) => item.status !== 'COMPLETED');
        if (hasPendingItems) {
            throw CustomError.badRequest('No se puede finalizar: existen items pendientes o parciales');
        }

        const currentOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: { pickerUserId: true },
        });

        const pickingResponsibilityFlowEnabled = await this.isPickingResponsibilityFlowEnabled();
        const actorUserId = this.resolvePreferredResponsibleUserId(responsibleUserId);
        if (pickingResponsibilityFlowEnabled) {
            if (!actorUserId) {
                throw CustomError.unauthorized('No se pudo identificar al usuario que finaliza picking');
            }

            const canOperate = await this.canUserOperatePicking(
                orderId,
                actorUserId,
                currentOrder?.pickerUserId ?? picking.pickingSession.assignedUser?.id ?? null,
            );
            if (!canOperate) {
                throw CustomError.forbidden('No tienes responsabilidad asignada para finalizar este picking');
            }
        }

        const assignedUserId = this.resolvePreferredResponsibleUserId(
            picking.pickingSession.assignedUser?.id,
            currentOrder?.pickerUserId,
            pickingResponsibilityFlowEnabled ? actorUserId : responsibleUserId,
        );

        await prisma.pickingSession.update({
            where: { id: picking.pickingSession.id },
            data: {
                status: 'COMPLETED',
                assignedUserId,
            },
        });

        await prisma.order.update({
            where: { id: orderId },
            data: {
                status: OrderStatusEnum.READY,
                pickerUserId: assignedUserId,
            },
        });

        return this.getOrderById(orderId);
    }

    async updateOrderPicking(orderId: number, dto: UpdateOrderPickingDto, responsibleUserId?: number) {
        await this.startOrderPicking(orderId, responsibleUserId);
        const currentPicking = await this.getOrderPicking(orderId);
        const pickingItemsByVariant = new Map<number, any>(
            (currentPicking.items || [])
                .filter((item: any) => Number(item.pickingItemId || 0) > 0)
                .map((item: any) => [Number(item.variantId), item]),
        );

        for (const item of dto.items) {
            const targetItem = pickingItemsByVariant.get(Number(item.variantId));
            if (!targetItem || !targetItem.pickingItemId) {
                throw CustomError.badRequest(`No existe item de picking para la variante ${item.variantId}`);
            }

            await this.updatePickingItem(
                Number(targetItem.pickingItemId),
                Number(item.pickedQuantity || 0),
                responsibleUserId,
            );
        }

        return this.getOrderById(orderId);
    }

    /**
     * Reservar stock remoto
     */
    async reserveRemoteStock(orderId: number, sourceStoreId: number, variantId: number, quantity: number) {
        const order = await this.getOrderById(orderId);

        // Validar inventario remoto
        const remoteInventory = await prisma.inventory.findUnique({
            where: {
                storeId_variantId: {
                    storeId: sourceStoreId,
                    variantId,
                },
            },
        });

        if (!remoteInventory) {
            throw CustomError.badRequest('El inventario remoto no existe');
        }

        const availableStock = remoteInventory.stock - remoteInventory.reservedStock;
        if (availableStock < quantity) {
            throw CustomError.badRequest(`Stock remoto insuficiente. Disponible: ${availableStock}`);
        }

        // Actualizar fulfillmentStoreId
        await prisma.order.update({
            where: { id: orderId },
            data: { fulfillmentStoreId: sourceStoreId },
        });

        // Reservar stock en tienda remota
        await prisma.inventory.update({
            where: { id: remoteInventory.id },
            data: { reservedStock: { increment: quantity } },
        });

        // Crear reserva
        await prisma.reservation.create({
            data: {
                quantity,
                status: 'ACTIVE',
                inventoryId: remoteInventory.id,
                variantId,
                orderId,
            },
        });

        return { success: true, message: 'Stock remoto reservado exitosamente' };
    }
}
