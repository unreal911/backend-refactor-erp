import { CommercialAssetPurpose, Prisma } from '@prisma/client';
import { CommercialAssetService } from '../../modules/commercial-assets/commercial-asset.service';
import { tenantPrisma as prisma } from '../../data/tenant-prisma';
import { UpdateOrderWorkflowSettingsDto } from '../../domain/dtos/update-order-workflow-settings.dto';
import {
    BRAND_DISPLAY_MODE_KEY,
    COMPANY_ADDRESS_KEY,
    COMPANY_EMAIL_KEY,
    COMPANY_LEGAL_NAME_KEY,
    COMPANY_LOGO_URL_KEY,
    COMPANY_NAME_KEY,
    COMPANY_PHONE_KEY,
    COMPANY_RUC_KEY,
    DEFAULT_MARKETPLACE_HERO_HEADING,
    MARKETPLACE_AUTO_RESERVE_STOCK_KEY,
    MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY,
    MARKETPLACE_HERO_HEADING_KEY,
    MARKETPLACE_INCLUDE_IGV_KEY,
    MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY,
    PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY,
    POS_BOLETA_ENABLED_KEY,
    POS_FACTURA_ENABLED_KEY,
    RETURN_RESPONSIBILITY_MANAGEMENT_KEY,
} from '../../data/system-config-keys';
import { CustomError } from '../../domain/errors/custom.error';
import { TenantDataContext } from '../../modules/tenant/tenant-data-context';

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

    private parseBrandDisplay(rawValue: string | null | undefined): 'logo' | 'logo_text' {
        return String(rawValue || '').trim().toLowerCase() === 'logo' ? 'logo' : 'logo_text';
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
        const tenantId = TenantDataContext.requireTenantId();
        const rows = await prisma.$queryRaw<SystemSettingRow[]>(
            Prisma.sql`
                SELECT "value"
                FROM "SystemSetting"
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "key" = ${key}
                LIMIT 1
            `,
        );
        return rows[0]?.value ?? null;
    }

    private async upsertSettingValue(key: string, value: string): Promise<void> {
        const tenantId = TenantDataContext.requireTenantId();
        await prisma.$executeRaw(
            Prisma.sql`
                INSERT INTO "SystemSetting" ("tenantId", "key", "value")
                VALUES (${tenantId}::uuid, ${key}, ${value})
                ON CONFLICT ("tenantId", "key") DO UPDATE
                SET "value" = EXCLUDED."value",
                    "updatedAt" = CURRENT_TIMESTAMP
            `,
        );
    }

    private async uploadCompanyLogo(file: { filename: string; data: string }): Promise<string> {
        const tenantId = TenantDataContext.requireTenantId();
        const filenameBase = file.filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        try {
            const asset = await CommercialAssetService.upload({
                data: file.data,
                key: `company_assets/${tenantId}/company_logo_${filenameBase || 'logo'}`,
                purpose: CommercialAssetPurpose.COMPANY_LOGO,
                ownerType: 'Tenant',
                ownerId: tenantId,
            });
            return asset.url;
        } catch (error) {
            if (error instanceof CustomError) throw error;
            console.error('Error subiendo logo de empresa:', error);
            throw CustomError.internal('Error al subir el logo de la empresa');
        }
    }

    private async getActivePaymentMethodIds(): Promise<number[]> {
        const tenantId = TenantDataContext.requireTenantId();
        const rows = await prisma.$queryRaw<PaymentMethodIdRow[]>(
            Prisma.sql`
                SELECT "id"
                FROM "PaymentMethod"
                WHERE "tenantId" = ${tenantId}::uuid
                  AND "isActive" = true
                ORDER BY "displayOrder" ASC, "name" ASC
            `,
        );

        return rows
            .map((row) => Number(row.id))
            .filter((id) => Number.isInteger(id) && id > 0);
    }

    async getOrderWorkflowSettings() {
        const tenantId = TenantDataContext.requireTenantId();
        const [
            returnResponsibilityRaw,
            pickingResponsibilityFlowRaw,
            marketplacePaymentsRaw,
            marketplacePaymentIdsRaw,
            marketplaceIncludeIgvRaw,
            companyNameRaw,
            companyLegalNameRaw,
            companyRucRaw,
            companyAddressRaw,
            companyPhoneRaw,
            companyEmailRaw,
            companyLogoUrlRaw,
            marketplaceHeroHeadingRaw,
            posBoletaEnabledRaw,
            posFacturaEnabledRaw,
            brandDisplayModeRaw,
            activeMethodIds,
            tenantProfile,
        ] = await Promise.all([
            this.getSettingValue(RETURN_RESPONSIBILITY_MANAGEMENT_KEY),
            this.getSettingValue(PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY),
            this.getSettingValue(MARKETPLACE_PAYMENT_METHODS_ENABLED_KEY),
            this.getSettingValue(MARKETPLACE_ALLOWED_PAYMENT_METHOD_IDS_KEY),
            this.getSettingValue(MARKETPLACE_INCLUDE_IGV_KEY),
            this.getSettingValue(COMPANY_NAME_KEY),
            this.getSettingValue(COMPANY_LEGAL_NAME_KEY),
            this.getSettingValue(COMPANY_RUC_KEY),
            this.getSettingValue(COMPANY_ADDRESS_KEY),
            this.getSettingValue(COMPANY_PHONE_KEY),
            this.getSettingValue(COMPANY_EMAIL_KEY),
            this.getSettingValue(COMPANY_LOGO_URL_KEY),
            this.getSettingValue(MARKETPLACE_HERO_HEADING_KEY),
            this.getSettingValue(POS_BOLETA_ENABLED_KEY),
            this.getSettingValue(POS_FACTURA_ENABLED_KEY),
            this.getSettingValue(BRAND_DISPLAY_MODE_KEY),
            this.getActivePaymentMethodIds(),
            prisma.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    name: true,
                    slug: true,
                    marketplaceSlug: true,
                    legalName: true,
                    ruc: true,
                    address: true,
                    contactPhone: true,
                    contactEmail: true,
                    logoUrl: true,
                },
            }),
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
            marketplaceAutoReserveStock: false,
            marketplaceSlug: tenantProfile?.marketplaceSlug || tenantProfile?.slug || '',
            companyName: tenantProfile?.name || this.parseText(companyNameRaw) || 'B2B Marketplace',
            companyLegalName: tenantProfile?.legalName || this.parseText(companyLegalNameRaw),
            companyRuc: tenantProfile?.ruc || this.parseText(companyRucRaw),
            companyAddress: tenantProfile?.address || this.parseText(companyAddressRaw),
            companyPhone: tenantProfile?.contactPhone || this.parseText(companyPhoneRaw),
            companyEmail: tenantProfile?.contactEmail || this.parseText(companyEmailRaw),
            companyLogoUrl: tenantProfile?.logoUrl || this.parseText(companyLogoUrlRaw),
            marketplaceHeroHeading: this.parseText(marketplaceHeroHeadingRaw) || DEFAULT_MARKETPLACE_HERO_HEADING,
            posBoletaEnabled: this.parseBoolean(posBoletaEnabledRaw, false),
            posFacturaEnabled: this.parseBoolean(posFacturaEnabledRaw, false),
            brandDisplay: this.parseBrandDisplay(brandDisplayModeRaw),
        };
    }

    async getPublicBranding() {
        const settings = await this.getOrderWorkflowSettings();
        return {
            brandName: settings.companyName,
            logoUrl: settings.companyLogoUrl,
            heroHeading: settings.marketplaceHeroHeading,
            brandDisplay: settings.brandDisplay,
            marketplaceSlug: settings.marketplaceSlug,
        };
    }

    async updateOrderWorkflowSettings(dto: UpdateOrderWorkflowSettingsDto) {
        const tenantId = TenantDataContext.requireTenantId();
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
        const marketplaceAutoReserveStock = false;
        const marketplaceSlug = dto.marketplaceSlug ?? currentSettings.marketplaceSlug;
        const companyName = dto.companyName ?? currentSettings.companyName;
        const companyLegalName = dto.companyLegalName ?? currentSettings.companyLegalName;
        const companyRuc = dto.companyRuc ?? currentSettings.companyRuc;
        const companyAddress = dto.companyAddress ?? currentSettings.companyAddress;
        const companyPhone = dto.companyPhone ?? currentSettings.companyPhone;
        const companyEmail = dto.companyEmail ?? currentSettings.companyEmail;
        const companyLogoUrl = dto.companyLogoFile
            ? await this.uploadCompanyLogo(dto.companyLogoFile)
            : (dto.companyLogoUrl ?? currentSettings.companyLogoUrl);
        const marketplaceHeroHeading = dto.marketplaceHeroHeading ?? currentSettings.marketplaceHeroHeading;
        const posBoletaEnabled = dto.posBoletaEnabled ?? currentSettings.posBoletaEnabled;
        const posFacturaEnabled = dto.posFacturaEnabled ?? currentSettings.posFacturaEnabled;
        const brandDisplay = dto.brandDisplay ?? currentSettings.brandDisplay;

        const incomingIds = dto.marketplacePaymentMethodIds ?? currentSettings.marketplacePaymentMethodIds;
        const sanitizedIds = this.normalizeIds(incomingIds).filter((id) => activeIdSet.has(id));
        const marketplacePaymentMethodIds = sanitizedIds.length > 0 ? sanitizedIds : [...activeMethodIds];

        if (marketplacePaymentMethodsEnabled && marketplacePaymentMethodIds.length === 0) {
            throw CustomError.badRequest('Debes activar al menos un metodo de pago para el marketplace');
        }

        try {
            await prisma.tenant.update({
                where: { id: tenantId },
                data: {
                    name: companyName,
                    marketplaceSlug,
                legalName: companyLegalName || null,
                ruc: companyRuc || null,
                address: companyAddress || null,
                contactPhone: companyPhone || null,
                contactEmail: companyEmail || null,
                logoUrl: companyLogoUrl || null,
                ...(companyRuc !== currentSettings.companyRuc
                    ? { rucConfirmedAt: null }
                    : {}),
                },
            });
        } catch (error) {
            if ((error as { code?: string })?.code === 'P2002') {
                throw CustomError.badRequest('La direccion publica ya esta siendo usada por otra tienda');
            }
            throw error;
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
        await this.upsertSettingValue(MARKETPLACE_HERO_HEADING_KEY, marketplaceHeroHeading);
        await this.upsertSettingValue(POS_BOLETA_ENABLED_KEY, posBoletaEnabled ? 'true' : 'false');
        await this.upsertSettingValue(POS_FACTURA_ENABLED_KEY, posFacturaEnabled ? 'true' : 'false');
        await this.upsertSettingValue(BRAND_DISPLAY_MODE_KEY, brandDisplay === 'logo' ? 'logo' : 'logo_text');

        return this.getOrderWorkflowSettings();
    }
}
