export class UpdateOrderWorkflowSettingsDto {
    private constructor(
        public readonly returnResponsibilityManagementEnabled?: boolean,
        public readonly pickingResponsibilityFlowEnabled?: boolean,
        public readonly marketplacePaymentMethodsEnabled?: boolean,
        public readonly marketplacePaymentMethodIds?: number[],
        public readonly marketplaceIncludeIgv?: boolean,
        public readonly marketplaceAutoReserveStock?: boolean,
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, UpdateOrderWorkflowSettingsDto | undefined] {
        const rawReturnFlag = object?.returnResponsibilityManagementEnabled;
        const rawPickingResponsibilityFlowFlag = object?.pickingResponsibilityFlowEnabled;
        const rawMarketplaceFlag = object?.marketplacePaymentMethodsEnabled;
        const rawMarketplaceMethodIds = object?.marketplacePaymentMethodIds;
        const rawMarketplaceIncludeIgv = object?.marketplaceIncludeIgv;
        const rawMarketplaceAutoReserveStock = object?.marketplaceAutoReserveStock;

        let returnResponsibilityManagementEnabled: boolean | undefined;
        if (rawReturnFlag !== undefined) {
            if (typeof rawReturnFlag !== 'boolean') {
                return ['returnResponsibilityManagementEnabled debe ser booleano', undefined];
            }
            returnResponsibilityManagementEnabled = rawReturnFlag;
        }

        let pickingResponsibilityFlowEnabled: boolean | undefined;
        if (rawPickingResponsibilityFlowFlag !== undefined) {
            if (typeof rawPickingResponsibilityFlowFlag !== 'boolean') {
                return ['pickingResponsibilityFlowEnabled debe ser booleano', undefined];
            }
            pickingResponsibilityFlowEnabled = rawPickingResponsibilityFlowFlag;
        }

        let marketplacePaymentMethodsEnabled: boolean | undefined;
        if (rawMarketplaceFlag !== undefined) {
            if (typeof rawMarketplaceFlag !== 'boolean') {
                return ['marketplacePaymentMethodsEnabled debe ser booleano', undefined];
            }
            marketplacePaymentMethodsEnabled = rawMarketplaceFlag;
        }

        let marketplacePaymentMethodIds: number[] | undefined;
        if (rawMarketplaceMethodIds !== undefined) {
            if (!Array.isArray(rawMarketplaceMethodIds)) {
                return ['marketplacePaymentMethodIds debe ser un arreglo de ids', undefined];
            }

            const parsedIds = rawMarketplaceMethodIds.map((value: unknown) => Number(value));
            const invalidId = parsedIds.find((id) => !Number.isInteger(id) || id < 1);
            if (invalidId !== undefined) {
                return ['marketplacePaymentMethodIds contiene ids invalidos', undefined];
            }
            marketplacePaymentMethodIds = Array.from(new Set(parsedIds));
        }

        let marketplaceIncludeIgv: boolean | undefined;
        if (rawMarketplaceIncludeIgv !== undefined) {
            if (typeof rawMarketplaceIncludeIgv !== 'boolean') {
                return ['marketplaceIncludeIgv debe ser booleano', undefined];
            }
            marketplaceIncludeIgv = rawMarketplaceIncludeIgv;
        }

        let marketplaceAutoReserveStock: boolean | undefined;
        if (rawMarketplaceAutoReserveStock !== undefined) {
            if (typeof rawMarketplaceAutoReserveStock !== 'boolean') {
                return ['marketplaceAutoReserveStock debe ser booleano', undefined];
            }
            marketplaceAutoReserveStock = rawMarketplaceAutoReserveStock;
        }

        if (
            returnResponsibilityManagementEnabled === undefined
            && pickingResponsibilityFlowEnabled === undefined
            && marketplacePaymentMethodsEnabled === undefined
            && marketplacePaymentMethodIds === undefined
            && marketplaceIncludeIgv === undefined
            && marketplaceAutoReserveStock === undefined
        ) {
            return ['Debes enviar al menos una configuracion para actualizar', undefined];
        }

        return [
            undefined,
            new UpdateOrderWorkflowSettingsDto(
                returnResponsibilityManagementEnabled,
                pickingResponsibilityFlowEnabled,
                marketplacePaymentMethodsEnabled,
                marketplacePaymentMethodIds,
                marketplaceIncludeIgv,
                marketplaceAutoReserveStock,
            ),
        ];
    }
}
