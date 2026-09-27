import { describe, expect, it } from 'vitest';
import { UpdateMarketplaceThemeDto } from '../src/domain/dtos/update-marketplace-theme.dto';

const validTheme = {
    preset: 'catalogo_moderno',
    primaryColor: '#7C3AED',
    secondaryColor: '#F4F0FF',
    backgroundColor: '#FFFFFF',
    textColor: '#18181B',
    headingFont: 'Montserrat',
    bodyFont: 'Inter',
    heroTitle: 'Nueva coleccion disponible',
    heroSubtitle: 'Compra por mayor directamente desde nuestro catalogo',
    heroCtaLabel: 'Ver catalogo',
    bannerUrl: 'https://cdn.example.com/banner.jpg',
    announcementText: 'Envios a todo el Peru',
    productImageRatio: '4:5',
    cardStyle: 'soft',
    buttonStyle: 'rounded',
};

describe('UpdateMarketplaceThemeDto', () => {
    it('normaliza una configuracion valida', () => {
        const [error, dto] = UpdateMarketplaceThemeDto.create({ config: validTheme });
        expect(error).toBeUndefined();
        expect(dto?.config.primaryColor).toBe('#7C3AED');
        expect(dto?.config.heroTitle).toBe(validTheme.heroTitle);
    });

    it.each([
        [{ ...validTheme, primaryColor: 'red' }, /hexadecimal/i],
        [{ ...validTheme, headingFont: 'Comic Sans MS' }, /tipografias/i],
        [{ ...validTheme, bannerUrl: 'javascript:alert(1)' }, /URL/i],
        [{ ...validTheme, preset: 'css_libre' }, /plantilla/i],
    ])('rechaza valores fuera del contrato seguro', (config, expected) => {
        const [error] = UpdateMarketplaceThemeDto.create({ config });
        expect(error).toMatch(expected);
    });

    it('acepta una imagen de fondo para subir con el borrador', () => {
        const bannerFile = { filename: 'portada.webp', data: 'base64-de-prueba' };
        const [error, dto] = UpdateMarketplaceThemeDto.create({ config: validTheme, bannerFile });
        expect(error).toBeUndefined();
        expect(dto?.bannerFile).toEqual(bannerFile);
    });

    it('rechaza una imagen de fondo sin datos', () => {
        const [error] = UpdateMarketplaceThemeDto.create({ config: validTheme, bannerFile: { filename: 'portada.png' } });
        expect(error).toMatch(/imagen de fondo/i);
    });
});
