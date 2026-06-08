export class UpdateOrderWorkflowSettingsDto {
    private constructor(
        public readonly returnResponsibilityManagementEnabled?: boolean,
        public readonly pickingResponsibilityFlowEnabled?: boolean,
        public readonly marketplacePaymentMethodsEnabled?: boolean,
        public readonly marketplacePaymentMethodIds?: number[],
        public readonly marketplaceIncludeIgv?: boolean,
        public readonly marketplaceAutoReserveStock?: boolean,
        public readonly companyName?: string,
        public readonly companyLegalName?: string,
        public readonly companyRuc?: string,
        public readonly companyAddress?: string,
        public readonly companyPhone?: string,
        public readonly companyEmail?: string,
        public readonly companyLogoUrl?: string,
        public readonly companyLogoFile?: { filename: string; data: string },
    ) {}

    static create(object: { [key: string]: any }): [string | undefined, UpdateOrderWorkflowSettingsDto | undefined] {
        const rawReturnFlag = object?.returnResponsibilityManagementEnabled;
        const rawPickingResponsibilityFlowFlag = object?.pickingResponsibilityFlowEnabled;
        const rawMarketplaceFlag = object?.marketplacePaymentMethodsEnabled;
        const rawMarketplaceMethodIds = object?.marketplacePaymentMethodIds;
        const rawMarketplaceIncludeIgv = object?.marketplaceIncludeIgv;
        const rawMarketplaceAutoReserveStock = object?.marketplaceAutoReserveStock;
        const rawCompanyName = object?.companyName;
        const rawCompanyLegalName = object?.companyLegalName;
        const rawCompanyRuc = object?.companyRuc;
        const rawCompanyAddress = object?.companyAddress;
        const rawCompanyPhone = object?.companyPhone;
        const rawCompanyEmail = object?.companyEmail;
        const rawCompanyLogoUrl = object?.companyLogoUrl;
        const rawCompanyLogoFile = object?.companyLogoFile;

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

        const normalizeOptionalText = (value: unknown, fieldName: string, maxLength: number): [string | undefined, string | undefined] => {
            if (value === undefined) {
                return [undefined, undefined];
            }
            if (typeof value !== 'string') {
                return [`${fieldName} debe ser texto`, undefined];
            }
            const normalized = value.trim();
            if (normalized.length > maxLength) {
                return [`${fieldName} no debe superar ${maxLength} caracteres`, undefined];
            }
            return [undefined, normalized];
        };

        let companyName: string | undefined;
        let companyLegalName: string | undefined;
        let companyRuc: string | undefined;
        let companyAddress: string | undefined;
        let companyPhone: string | undefined;
        let companyEmail: string | undefined;
        let companyLogoUrl: string | undefined;
        let companyLogoFile: { filename: string; data: string } | undefined;

        {
            const [error, value] = normalizeOptionalText(rawCompanyName, 'companyName', 120);
            if (error) return [error, undefined];
            companyName = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyLegalName, 'companyLegalName', 160);
            if (error) return [error, undefined];
            companyLegalName = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyRuc, 'companyRuc', 20);
            if (error) return [error, undefined];
            if (value && !/^[0-9]{8,11}$/.test(value)) {
                return ['companyRuc debe contener entre 8 y 11 digitos', undefined];
            }
            companyRuc = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyAddress, 'companyAddress', 240);
            if (error) return [error, undefined];
            companyAddress = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyPhone, 'companyPhone', 40);
            if (error) return [error, undefined];
            companyPhone = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyEmail, 'companyEmail', 120);
            if (error) return [error, undefined];
            if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return ['companyEmail debe ser un correo valido', undefined];
            }
            companyEmail = value;
        }
        {
            const [error, value] = normalizeOptionalText(rawCompanyLogoUrl, 'companyLogoUrl', 500);
            if (error) return [error, undefined];
            companyLogoUrl = value;
        }

        if (rawCompanyLogoFile !== undefined) {
            if (
                !rawCompanyLogoFile
                || typeof rawCompanyLogoFile !== 'object'
                || typeof rawCompanyLogoFile.filename !== 'string'
                || typeof rawCompanyLogoFile.data !== 'string'
                || !rawCompanyLogoFile.filename.trim()
                || !rawCompanyLogoFile.data.trim()
            ) {
                return ['companyLogoFile debe incluir filename y data en base64', undefined];
            }

            companyLogoFile = {
                filename: rawCompanyLogoFile.filename.trim(),
                data: rawCompanyLogoFile.data.trim(),
            };
        }

        if (
            returnResponsibilityManagementEnabled === undefined
            && pickingResponsibilityFlowEnabled === undefined
            && marketplacePaymentMethodsEnabled === undefined
            && marketplacePaymentMethodIds === undefined
            && marketplaceIncludeIgv === undefined
            && marketplaceAutoReserveStock === undefined
            && companyName === undefined
            && companyLegalName === undefined
            && companyRuc === undefined
            && companyAddress === undefined
            && companyPhone === undefined
            && companyEmail === undefined
            && companyLogoUrl === undefined
            && companyLogoFile === undefined
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
                companyName,
                companyLegalName,
                companyRuc,
                companyAddress,
                companyPhone,
                companyEmail,
                companyLogoUrl,
                companyLogoFile,
            ),
        ];
    }
}
