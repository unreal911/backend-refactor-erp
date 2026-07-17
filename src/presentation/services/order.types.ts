import { PickingResponsibilityMode } from "../../domain/dtos/delegate-picking-responsibility.dto";

export type MarketplacePaymentMethod = {
    id: number;
    name: string;
    code: string;
    displayOrder: number;
    isActive: boolean;
};

export type MarketplacePaymentSettings = {
    enabled: boolean;
    allowedPaymentMethodIds: number[];
    includeIgv: boolean;
    autoReserveStock: boolean;
};

export type MarketplaceGuideItem = {
    colorName?: string;
    sizeName?: string;
    displayVariantId?: number;
};

export type OrderItemReservationSuggestion = {
    inventoryId: number;
    storeId: number;
    storeName: string;
    storeCode?: string | null;
    storeType?: string | null;
    stock: number;
    reservedStock: number;
    availableStock: number;
    recommendedQuantity: number;
    isCurrentFulfillmentStore: boolean;
    isSourceStore: boolean;
};

export type PickingSharedResponsibilityRow = {
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

export type PickingResponsibilityRequestRow = {
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

export type PickingResponsibilityContext = {
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

export type PickingItemContributionRow = {
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

export type PickingUnpickRequestRow = {
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

export type PickingOrderItemDetailRow = {
    id: number;
    orderId: number;
    orderItemId: number;
    pickingItemId: number | null;
    variantId: number;
    pickedQuantity: number;
    createdAt: Date;
    updatedAt: Date;
};
