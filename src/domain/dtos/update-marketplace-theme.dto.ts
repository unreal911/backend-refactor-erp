export const MARKETPLACE_THEME_PRESETS = [
    'catalogo_moderno',
    'moda_editorial',
    'catalogo_compacto',
    'boutique',
] as const;

export const MARKETPLACE_THEME_FONTS = [
    'Inter',
    'Montserrat',
    'Poppins',
    'Lora',
    'Playfair Display',
    'Roboto',
] as const;

export interface MarketplaceThemeConfig {
    preset: typeof MARKETPLACE_THEME_PRESETS[number];
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
    headingFont: typeof MARKETPLACE_THEME_FONTS[number];
    bodyFont: typeof MARKETPLACE_THEME_FONTS[number];
    heroTitle: string;
    heroSubtitle: string;
    heroCtaLabel: string;
    bannerUrl: string;
    announcementText: string;
    productImageRatio: '1:1' | '4:5' | '3:4';
    cardStyle: 'flat' | 'soft' | 'bordered';
    buttonStyle: 'square' | 'rounded' | 'pill';
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function text(value: unknown, maxLength: number): string {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isSafeUrl(value: string): boolean {
    if (!value) return true;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

export class UpdateMarketplaceThemeDto {
    private constructor(
        public readonly config: MarketplaceThemeConfig,
        public readonly bannerFile?: { filename: string; data: string },
    ) {}

    static create(object: { [key: string]: unknown }): [string | undefined, UpdateMarketplaceThemeDto | undefined] {
        const raw = object?.config && typeof object.config === 'object'
            ? object.config as Record<string, unknown>
            : object;

        const preset = text(raw.preset, 40) as MarketplaceThemeConfig['preset'];
        if (!MARKETPLACE_THEME_PRESETS.includes(preset)) {
            return ['Selecciona una plantilla valida', undefined];
        }

        const colors = ['primaryColor', 'secondaryColor', 'backgroundColor', 'textColor'] as const;
        for (const field of colors) {
            if (!HEX_COLOR.test(text(raw[field], 7))) {
                return [`${field} debe ser un color hexadecimal de 6 digitos`, undefined];
            }
        }

        const headingFont = text(raw.headingFont, 40) as MarketplaceThemeConfig['headingFont'];
        const bodyFont = text(raw.bodyFont, 40) as MarketplaceThemeConfig['bodyFont'];
        if (!MARKETPLACE_THEME_FONTS.includes(headingFont) || !MARKETPLACE_THEME_FONTS.includes(bodyFont)) {
            return ['Selecciona tipografias de la lista permitida', undefined];
        }

        const heroTitle = text(raw.heroTitle, 80);
        const heroSubtitle = text(raw.heroSubtitle, 180);
        const heroCtaLabel = text(raw.heroCtaLabel, 40);
        const bannerUrl = text(raw.bannerUrl, 1000);
        const announcementText = text(raw.announcementText, 100);
        if (!isSafeUrl(bannerUrl)) {
            return ['La imagen principal debe usar una URL http o https valida', undefined];
        }
        let bannerFile: { filename: string; data: string } | undefined;
        if (object?.bannerFile !== undefined) {
            const file = object.bannerFile;
            if (!file || typeof file !== 'object' || Array.isArray(file)) {
                return ['La imagen de fondo debe incluir filename y data en base64', undefined];
            }
            const candidate = file as Record<string, unknown>;
            if (typeof candidate.filename !== 'string' || !candidate.filename.trim()
                || typeof candidate.data !== 'string' || !candidate.data.trim()) {
                return ['La imagen de fondo debe incluir filename y data en base64', undefined];
            }
            if (candidate.data.length > Math.ceil(5 * 1024 * 1024 * 4 / 3) + 100) {
                return ['La imagen de fondo no debe superar 5 MB', undefined];
            }
            bannerFile = { filename: candidate.filename.slice(0, 255), data: candidate.data };
        }

        const productImageRatio = text(raw.productImageRatio, 4) as MarketplaceThemeConfig['productImageRatio'];
        const cardStyle = text(raw.cardStyle, 16) as MarketplaceThemeConfig['cardStyle'];
        const buttonStyle = text(raw.buttonStyle, 16) as MarketplaceThemeConfig['buttonStyle'];
        if (!['1:1', '4:5', '3:4'].includes(productImageRatio)) {
            return ['Selecciona una proporcion de imagen valida', undefined];
        }
        if (!['flat', 'soft', 'bordered'].includes(cardStyle)) {
            return ['Selecciona un estilo de tarjeta valido', undefined];
        }
        if (!['square', 'rounded', 'pill'].includes(buttonStyle)) {
            return ['Selecciona un estilo de boton valido', undefined];
        }

        return [undefined, new UpdateMarketplaceThemeDto({
            preset,
            primaryColor: text(raw.primaryColor, 7).toUpperCase(),
            secondaryColor: text(raw.secondaryColor, 7).toUpperCase(),
            backgroundColor: text(raw.backgroundColor, 7).toUpperCase(),
            textColor: text(raw.textColor, 7).toUpperCase(),
            headingFont,
            bodyFont,
            heroTitle,
            heroSubtitle,
            heroCtaLabel,
            bannerUrl,
            announcementText,
            productImageRatio,
            cardStyle,
            buttonStyle,
        }, bannerFile)];
    }
}
