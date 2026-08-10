import { describe, expect, it } from 'vitest';
import { CreateProductDto } from '../src/domain/dtos/create-product.dto';
import { UpdateProductDto } from '../src/domain/dtos/update-product.dto';
import { sanitizeProductDescriptionHtml } from '../src/domain/sanitization/product-description';

describe('sanitizacion de descripcion de producto', () => {
    it('elimina etiquetas ejecutables, eventos y URLs javascript', () => {
        const dirty = '<p onclick="alert(1)">Seguro<script>alert(2)</script>'
            + '<img src=x onerror=alert(3)><a href="javascript:alert(4)">enlace</a></p>';
        const clean = sanitizeProductDescriptionHtml(dirty);

        expect(clean).toBe('<p>Seguro<a>enlace</a></p>');
        expect(clean).not.toMatch(/script|onclick|onerror|javascript:/i);
    });

    it('conserva el formato del editor y descarta CSS peligroso', () => {
        const dirty = '<h2 style="text-align:center;position:fixed;color:#123456">Titulo</h2>'
            + '<table><tbody><tr><td colspan="2">Dato</td></tr></tbody></table>';
        const clean = sanitizeProductDescriptionHtml(dirty);

        expect(clean).toContain('text-align:center');
        expect(clean).toContain('color:#123456');
        expect(clean).not.toContain('position');
        expect(clean).toContain('<td colspan="2">Dato</td>');
    });

    it('sanitiza creacion y actualizacion antes del servicio', () => {
        const [, createDto] = CreateProductDto.create({
            name: 'Polo', categoryId: 1, description: '<p onmouseover="x">Texto</p>',
            variantMode: 'SIMPLE', variants: [{ price: 10 }],
        });
        const [, updateDto] = UpdateProductDto.create({
            description: '<iframe src="https://evil.test"></iframe><p>Nuevo</p>',
        });

        expect(createDto?.description).toBe('<p>Texto</p>');
        expect(updateDto?.description).toBe('<p>Nuevo</p>');
    });
});
