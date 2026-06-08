import { describe, expect, test } from 'vitest';
import { ProductService } from '../src/presentation/services/product.service';

describe('ProductService marketplace color images', () => {
  test('sube imageFile y devuelve una relacion colorId -> imageUrl', async () => {
    const service = new ProductService() as any;
    service.uploadBase64Image = async (_data: string, publicId: string) =>
      `https://res.cloudinary.com/demo/image/upload/${publicId}.jpg`;

    const result = await service.resolveMarketplaceColorImages(99, [1, 2], [
      {
        colorId: 1,
        imageFile: {
          filename: 'negro.png',
          data: 'base64-negro',
        },
      },
      {
        colorId: 999,
        imageFile: {
          filename: 'ignorado.png',
          data: 'base64-ignorado',
        },
      },
    ]);

    expect(result).toEqual([
      {
        colorId: 1,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/product_99_marketplace_color_1_negro.jpg',
      },
    ]);
  });

  test('conserva imageUrl existente para colores permitidos', async () => {
    const service = new ProductService() as any;

    const result = await service.resolveMarketplaceColorImages(99, [1, 2], [
      {
        colorId: 2,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/blanco.jpg',
      },
    ]);

    expect(result).toEqual([
      {
        colorId: 2,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/blanco.jpg',
      },
    ]);
  });
});
