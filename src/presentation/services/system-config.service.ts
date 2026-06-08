import { Prisma } from '@prisma/client';
import { cloudinary } from '../../config/cloudinary';
import { prisma } from '../../data/prisma';
import { UpdateOrderWorkflowSettingsDto } from '../../domain/dtos/update-order-workflow-settings.dto';
import {
    COMPANY_ADDRESS_KEY,
    COMPANY_EMAIL_KEY,
    COMPANY_LEGAL_NAME_KEY,
    COMPANY_LOGO_URL_KEY,
    COMPANY_NAME_KEY,
    COMPANY_PHONE_KEY,
    COMPANY_RUC_KEY,
    MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
    MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
    MARKETPLACE_INCLUDE_IGV_KEY,
    MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
    PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
} from '../../data/system-config-keys';
import { CustomError } from '../../domain/errors/custom.error';

type SystemSettingRow = {
    value: string;
};

type PaymentMethodIdRow = {
    id: number;
};

export class SystemConfigService {
    constructor() {}

    private parseBoolean(rawValue: string | null | undefined, fallback: boolean): boolean {
        const normalized = String(rawValue || '').trim().toLowerCase();
        if (!normalized) return fallback;
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
        return fallback;
    }

    private parseNumberArray(rawValue: string | null | undefined): number[] {
        if (!rawValue) return [];

        const fromJson = this.safeParseJsonArray(rawValue);
        if (fromJson) {
            return this.normalizeIds(fromJson);
        }

        return this.normalizeIds(String(rawValue).split(','));
    }

    private parseText(rawValue: string | null | undefined): string {
        return String(rawValue || '').trim();
    }

    private safeParseJsonArray(rawValue: string): unknown[] | null {
        try {
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }

    private normalizeIds(values: unknown[]): number[] {
        const unique = new Set<number>();
        for (const value of values) {
            const id = Number(value);
            if (Number.isInteger(id) && id > 0) {
                unique.add(id);
            }
        }
        return Array.from(unique.values());
    }

    private async getSettingValue(key: string): Promise<string | null> {
        const rows = await prisma.$queryRaw<SystemSettingRow[]>(
            Prisma.sql`SELECT "value" FROM "SystemSetting" WHERE "key" = ${key} LIMIT 1`,
        );
        return rows[0]?.value ?? null;
    }

    private async upsertSettingValue(key: string, value: string): Promise<void> {
        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO "SystemSetting" ("key", "value")
                VALUES (${key}, ${value})
                ON CONFLICT ("key") DO UPDATE
                SET "value" = EXCLUDED."value",
                    "updatedAt" = CURRENT_TIMESTAMP
            `,
        );
    }

    private async uploadCompanyLogo(file: { filename: string; data: string }): Promise<string> {
        const filenameBase = file.filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const payload = file.data.startsWith('data:') ? file.data : `data:image/jpeg;base64,${file.data}`;

        try {
            const uploadResult = await cloudinary.uploader.upload(payload, {
                folder: 'company_assets',
                public_id: `company_logo_${filenameBase || 'logo'}`,
                overwrite: true,
                resource_type: 'image',
            });

            return uploadResult.secure_url;
        } catch (error) {
            console.error('Error subiendo logo de empresa a Cloudinary:', error);
            throw CustomError.internal('Error al subir el logo de la empresa');
        }
    }

    private async getActivePaymentMethodIds(): Promise<number[]> {
        const rows = await prisma.$queryRaw<PaymentMethodIdRow[]>(
            Prisma.sql`
                SELECT "id"
                FROM "PaymentMethod"
                WHERE "isActive" = true
                ORDER BY "displayOrder" ASC, "name" ASC
            `,
        );

        return rows
            .map((row) => Number(row.id))
            .filter((id) => Number.isInteger(id) && id > 0);
    }

    async getOrderWorkflowSettings() {
        const [
            returnResponsibilityRaw,
            pickingResponsibilityFlowRaw,
            marketplacePaymentsRaw,
            marketplacePaymentIdsRaw,
            marketplaceIncludeIgvRaw,
            marketplaceAutoReserveStockRaw,
            companyNameRaw,
            companyLegalNameRaw,
            companyRucRaw,
            companyAddressRaw,
            companyPhoneRaw,
            companyEmailRaw,
            companyLogoUrlRaw,
            activeMethodIds,
        ] = await Promise.all([
            this.getSettingValue(RETURN_RESPONSIBILITY_MANAGEMENT_KEY),
            this.getSettingValue(PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY),
            this.getSettingValue(MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY),
            this.getSettingValue(MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY),
            this.getSettingValue(MARKETPLACE_INCLUDE_IGV_KEY),
            this.getSettingValue(MARKETPLACE_AUTO_RESERVE_STOCK_KEY),
            this.getSettingValue(COMPANY_NAME_KEY),
            this.getSettingValue(COMPANY_LEGAL_NAME_KEY),
            this.getSettingValue(COMPANY_RUC_KEY),
            this.getSettingValue(COMPANY_ADDRESS_KEY),
            this.getSettingValue(COMPANY_PHONE_KEY),
            this.getSettingValue(COMPANY_EMAIL_KEY),
            this.getSettingValue(COMPANY_LOGO_URL_KEY),
            this.getActivePaymentMethodIds(),
        ]);

        const activeIdSet = new Set(activeMethodIds);
        const configuredIds = this.parseNumberArray(marketplacePaymentIdsRaw)
            .filter((id) => activeIdSet.has(id));
        const fallbackIds = configuredIds.length > 0 ? configuredIds : [...activeMethodIds];

        return {
            returnResponsibilityManagementEnabled: this.parseBoolean(returnResponsibilityRaw, true),
            pickingResponsibilityFlowEnabled: this.parseBoolean(pickingResponsibilityFlowRaw, false),
            marketplacePaymentMethodsEnabled: this.parseBoolean(marketplacePaymentsRaw, false),
            marketplacePaymentMethodIds: fallbackIds,
            marketplaceIncludeIgv: this.parseBoolean(marketplaceIncludeIgvRaw, true),
            marketplaceAutoReserveStock: this.parseBoolean(marketplaceAutoReserveStockRaw, false),
            companyName: this.parseText(companyNameRaw) || 'B2B Marketplace',
            companyLegalName: this.parseText(companyLegalNameRaw),
            companyRuc: this.parseText(companyRucRaw),
            companyAddress: this.parseText(companyAddressRaw),
            companyPhone: this.parseText(companyPhoneRaw),
            companyEmail: this.parseText(companyEmailRaw),
            companyLogoUrl: this.parseText(companyLogoUrlRaw),
        };
    }

    async updateOrderWorkflowSettings(dto: UpdateOrderWorkflowSettingsDto) {
        const currentSettings = await this.getOrderWorkflowSettings();
        const activeMethodIds = await this.getActivePaymentMethodIds();
        const activeIdSet = new Set(activeMethodIds);

        const returnResponsibilityManagementEnabled = dto.returnResponsibilityManagementEnabled
            ?? currentSettings.returnResponsibilityManagementEnabled;
        const pickingResponsibilityFlowEnabled = dto.pickingResponsibilityFlowEnabled
            ?? currentSettings.pickingResponsibilityFlowEnabled;
        const marketplacePaymentMethodsEnabled = dto.marketplacePaymentMethodsEnabled
            ?? currentSettings.marketplacePaymentMethodsEnabled;
        const marketplaceIncludeIgv = dto.marketplaceIncludeIgv
            ?? currentSettings.marketplaceIncludeIgv;
        const marketplaceAutoReserveStock = dto.marketplaceAutoReserveStock
            ?? currentSettings.marketplaceAutoReserveStock;
        const companyName = dto.companyName ?? currentSettings.companyName;
        const companyLegalName = dto.companyLegalName ?? currentSettings.companyLegalName;
        const companyRuc = dto.companyRuc ?? currentSettings.companyRuc;
        const companyAddress = dto.companyAddress ?? currentSettings.companyAddress;
        const companyPhone = dto.companyPhone ?? currentSettings.companyPhone;
        const companyEmail = dto.companyEmail ?? currentSettings.companyEmail;
        const companyLogoUrl = dto.companyLogoFile
            ? await this.uploadCompanyLogo(dto.companyLogoFile)
            : (dto.companyLogoUrl ?? currentSettings.companyLogoUrl);

        const incomingIds = dto.marketplacePaymentMethodIds ?? currentSettings.marketplacePaymentMethodIds;
        const sanitizedIds = this.normalizeIds(incomingIds).filter((id) => activeIdSet.has(id));
        const marketplacePaymentMethodIds = sanitizedIds.length > 0 ? sanitizedIds : [...activeMethodIds];

        if (marketplacePaymentMethodsEnabled && marketplacePaymentMethodIds.length === 0) {
            throw CustomError.badRequest('Debes activar al menos un metodo de pago para el marketplace');
        }

        await this.upsertSettingValue(
            RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
            returnResponsibilityManagementEnabled ? 'true' : 'false',
        );
        await this.upsertSettingValue(
            PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
            pickingResponsibilityFlowEnabled ? 'true' : 'false',
        );
        await this.upsertSettingValue(
            MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
            marketplacePaymentMethodsEnabled ? 'true' : 'false',
        );
        await this.upsertSettingValue(
            MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
            JSON.stringify(marketplacePaymentMethodIds),
        );
        await this.upsertSettingValue(
            MARKETPLACE_INCLUDE_IGV_KEY,
            marketplaceIncludeIgv ? 'true' : 'false',
        );
        await this.upsertSettingValue(
            MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
            marketplaceAutoReserveStock ? 'true' : 'false',
        );
        await this.upsertSettingValue(COMPANY_NAME_KEY, companyName);
        await this.upsertSettingValue(COMPANY_LEGAL_NAME_KEY, companyLegalName);
        await this.upsertSettingValue(COMPANY_RUC_KEY, companyRuc);
        await this.upsertSettingValue(COMPANY_ADDRESS_KEY, companyAddress);
        await this.upsertSettingValue(COMPANY_PHONE_KEY, companyPhone);
        await this.upsertSettingValue(COMPANY_EMAIL_KEY, companyEmail);
        await this.upsertSettingValue(COMPANY_LOGO_URL_KEY, companyLogoUrl);

        return this.getOrderWorkflowSettings();
    }
}
