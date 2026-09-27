import { describe, expect, it } from 'vitest';
import { CreateProductDto } from '../src/domain/dtos/create-product.dto';
import { UpdateProductDto } from '../src/domain/dtos/update-product.dto';

describe('identificadores comerciales del producto', () => {
    it('acepta SKU, codigo de barras y producto inactivo al crear', () => {
        const [error, dto] = CreateProductDto.create({
            name: 'Polo basico',
            categoryId: 1,
            isActive: false,
            variantMode: 'SIMPLE',
            variants: [{
                sku: 'POL-001',
                barcode: '7751234567890',
                price: 49.9,
            }],
        });

        expect(error).toBeUndefined();
        expect(dto?.isActive).toBe(false);
        expect(dto?.variants[0]).toMatchObject({
            sku: 'POL-001',
            barcode: '7751234567890',
        });
    });

    it('permite vaciar el codigo de barras al editar', () => {
        const [error, dto] = UpdateProductDto.create({
            variantMode: 'SIMPLE',
            variants: [{ price: 20, barcode: '' }],
        });

        expect(error).toBeUndefined();
        expect(dto?.variants?.[0]?.barcode).toBe('');
    });

    it('rechaza identificadores excesivamente largos', () => {
        const [error] = CreateProductDto.create({
            name: 'Polo basico',
            categoryId: 1,
            variantMode: 'SIMPLE',
            variants: [{ sku: 'X'.repeat(65), price: 49.9 }],
        });

        expect(error).toContain('hasta 64 caracteres');
    });

    it('rechaza codigos de barras repetidos entre variantes', () => {
        const [error] = CreateProductDto.create({
            name: 'Polo colores',
            categoryId: 1,
            variantMode: 'MATRIX',
            colorIds: [1],
            sizeIds: [1, 2],
            variants: [
                { colorId: 1, sizeId: 1, barcode: '775000000001', price: 40 },
                { colorId: 1, sizeId: 2, barcode: '775000000001', price: 42 },
            ],
        });

        expect(error).toContain('mismo codigo de barras');
    });

    it('acepta una secuencia mixta de fotos para conservar portada y orden', () => {
        const [error, dto] = UpdateProductDto.create({
            orderedImages: [
                { imageFile: { filename: 'portada.jpg', data: 'Zm90bw==' } },
                { url: 'https://cdn.example.com/lateral.jpg' },
            ],
        });

        expect(error).toBeUndefined();
        expect(dto?.orderedImages?.[0]?.imageFile?.filename).toBe('portada.jpg');
        expect(dto?.orderedImages?.[1]?.url).toContain('lateral.jpg');
    });
});
