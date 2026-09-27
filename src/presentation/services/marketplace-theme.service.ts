import { CommercialAssetPurpose, type Prisma } from '@prisma/client';
import { tenantPrisma as prisma } from '../../data/tenant-prisma';
import { CommercialAssetService } from '../../modules/commercial-assets/commercial-asset.service';
import { inspectImage } from '../../modules/commercial-assets/image-inspection';
import { TenantDataContext } from '../../modules/tenant/tenant-data-context';
import type { MarketplaceThemeConfig } from '../../domain/dtos/update-marketplace-theme.dto';

export const DEFAULT_MARKETPLACE_THEME: MarketplaceThemeConfig = {
    preset: 'catalogo_moderno',
    primaryColor: '#0B63CE',
    secondaryColor: '#E8F1FF',
    backgroundColor: '#FFFFFF',
    textColor: '#10243F',
    headingFont: 'Montserrat',
    bodyFont: 'Inter',
    heroTitle: 'Descubre nuestro catalogo',
    heroSubtitle: 'Elige productos, revisa variantes y arma tu pedido en pocos pasos.',
    heroCtaLabel: 'Ver catalogo',
    bannerUrl: '',
    announcementText: '',
    productImageRatio: '1:1',
    cardStyle: 'soft',
    buttonStyle: 'rounded',
};

type CachedTheme = { expiresAt: number; config: MarketplaceThemeConfig | null };

function asThemeConfig(value: unknown): MarketplaceThemeConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ...DEFAULT_MARKETPLACE_THEME };
    }
    return { ...DEFAULT_MARKETPLACE_THEME, ...(value as Partial<MarketplaceThemeConfig>) };
}

export class MarketplaceThemeService {
    private static readonly publishedCache = new Map<string, CachedTheme>();
    private static readonly cacheTtlMs = 60_000;

    async getEditorTheme() {
        const tenantId = TenantDataContext.requireTenantId();
        const row = await prisma.marketplaceTheme.findUnique({ where: { tenantId } });
        return {
            status: row?.status === 'PUBLISHED' ? 'PUBLISHED' as const : 'DRAFT' as const,
            draftConfig: asThemeConfig(row?.draftConfig),
            publishedConfig: row?.publishedConfig ? asThemeConfig(row.publishedConfig) : null,
            publishedAt: row?.publishedAt?.toISOString() ?? null,
            updatedAt: row?.updatedAt?.toISOString() ?? null,
        };
    }

    async saveDraft(config: MarketplaceThemeConfig, bannerFile?: { filename: string; data: string }) {
        const tenantId = TenantDataContext.requireTenantId();
        if (bannerFile) {
            inspectImage(bannerFile.data, 5 * 1024 * 1024);
            const asset = await CommercialAssetService.upload({
                data: bannerFile.data,
                key: `marketplace/${tenantId}/hero`,
                purpose: CommercialAssetPurpose.OTHER,
                ownerType: 'MarketplaceTheme',
                ownerId: tenantId,
            });
            config = { ...config, bannerUrl: asset.url };
        }
        await prisma.marketplaceTheme.upsert({
            where: { tenantId },
            create: {
                tenantId,
                preset: config.preset,
                status: 'DRAFT',
                draftConfig: config as unknown as Prisma.InputJsonValue,
            },
            update: {
                preset: config.preset,
                status: 'DRAFT',
                draftConfig: config as unknown as Prisma.InputJsonValue,
            },
        });
        return this.getEditorTheme();
    }

    async publish() {
        const tenantId = TenantDataContext.requireTenantId();
        const current = await prisma.marketplaceTheme.findUnique({ where: { tenantId } });
        const config = asThemeConfig(current?.draftConfig);
        await prisma.marketplaceTheme.upsert({
            where: { tenantId },
            create: {
                tenantId,
                preset: config.preset,
                status: 'PUBLISHED',
                draftConfig: config as unknown as Prisma.InputJsonValue,
                publishedConfig: config as unknown as Prisma.InputJsonValue,
                publishedAt: new Date(),
            },
            update: {
                preset: config.preset,
                status: 'PUBLISHED',
                publishedConfig: config as unknown as Prisma.InputJsonValue,
                publishedAt: new Date(),
            },
        });
        MarketplaceThemeService.publishedCache.delete(tenantId);
        return this.getEditorTheme();
    }

    async getPublishedTheme(): Promise<MarketplaceThemeConfig | null> {
        const tenantId = TenantDataContext.requireTenantId();
        const cached = MarketplaceThemeService.publishedCache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) return cached.config;

        const row = await prisma.marketplaceTheme.findUnique({
            where: { tenantId },
            select: { publishedConfig: true },
        });
        const config = row?.publishedConfig ? asThemeConfig(row.publishedConfig) : null;
        MarketplaceThemeService.publishedCache.set(tenantId, {
            config,
            expiresAt: Date.now() + MarketplaceThemeService.cacheTtlMs,
        });
        return config;
    }
}
