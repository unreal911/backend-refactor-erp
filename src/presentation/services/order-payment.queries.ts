import { prisma } from "../../data/prisma";
import { Prisma } from "@prisma/client";
import { CustomError } from "../../domain/errors/custom.error";
import {
    MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
    MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
    MARKETPLACE_INCLUDE_IGV_KEY,
    MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
} from "../../data/system-config-keys";
import { MarketplacePaymentMethod, MarketplacePaymentSettings } from "./order.types";
import { parseBooleanSetting, parseNumberArraySetting } from "./order.helpers";
import { getSystemSettingValue } from "./order.queries";

// Métodos de pago del marketplace: settings (SystemSetting) + catálogo activo
// (PaymentMethod) + filtrado por lista permitida. Funciones puras de repositorio:
// reciben `dbClient` y no dependen de estado de OrderService.

export async function getMarketplacePaymentSettings(dbClient: any = prisma): Promise<MarketplacePaymentSettings> {
    const [enabledRaw, allowedIdsRaw, includeIgvRaw, autoReserveStockRaw] = await Promise.all([
        getSystemSettingValue(MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY, dbClient),
        getSystemSettingValue(MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY, dbClient),
        getSystemSettingValue(MARKETPLACE_INCLUDE_IGV_KEY, dbClient),
        getSystemSettingValue(MARKETPLACE_AUTO_RESERVE_STOCK_KEY, dbClient),
    ]);

    return {
        enabled: parseBooleanSetting(enabledRaw, false),
        allowedPaymentMethodIds: parseNumberArraySetting(allowedIdsRaw),
        includeIgv: parseBooleanSetting(includeIgvRaw, true),
        autoReserveStock: parseBooleanSetting(autoReserveStockRaw, false),
    };
}

export async function listActivePaymentMethods(dbClient: any = prisma): Promise<MarketplacePaymentMethod[]> {
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

export function filterAllowedPaymentMethods(methods: MarketplacePaymentMethod[], settings: MarketplacePaymentSettings): MarketplacePaymentMethod[] {
    if (settings.allowedPaymentMethodIds.length === 0) {
        return methods;
    }

    const allowedSet = new Set(settings.allowedPaymentMethodIds);
    const filtered = methods.filter((method) => allowedSet.has(Number(method.id)));

    return filtered.length > 0 ? filtered : methods;
}

export async function resolveMarketplacePaymentMethod(
    paymentMethodId: number | undefined,
    dbClient: any = prisma,
): Promise<MarketplacePaymentMethod | null> {
    const settings = await getMarketplacePaymentSettings(dbClient);
    if (!settings.enabled) {
        return null;
    }

    const activeMethods = await listActivePaymentMethods(dbClient);
    const availableMethods = filterAllowedPaymentMethods(activeMethods, settings);

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
