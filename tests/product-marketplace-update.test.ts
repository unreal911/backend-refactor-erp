import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../src/data/prisma', () => ({
  prisma: {
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../src/data/prisma';
import { ProductService } from '../src/presentation/services/product.service';

describe('ProductService.updateProduct marketplace color images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('persiste colorImages cuando se actualiza un producto SIMPLE con imageFile marketplace', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
      id: 99,
      name: 'Polo Caballero',
      description: null,
      categoryId: 3,
      isActive: true,
      variants: [
        {
          id: 100,
          price: 18,
          color: { id: 10, name: '__SIN_COLOR__' },
          size: { id: 20, name: '__SIN_TALLA__' },
        },
      ],
    } as never);
    vi.mocked(prisma.product.update).mockResolvedValueOnce({
      id: 99,
      name: 'Polo Caballero',
      description: null,
      categoryId: 3,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const service = new ProductService() as any;
    service.validateColors = vi.fn().mockResolvedValue(undefined);
    service.validateSizes = vi.fn().mockResolvedValue(undefined);
    service.getMarketplaceSimpleVariantConfig = vi.fn().mockResolvedValue({
      colorIds: [1, 2],
      sizeIds: [4],
      colorImages: [],
    });
    service.uploadBase64Image = vi.fn().mockResolvedValue(
      'https://res.cloudinary.com/demo/image/upload/product_99_marketplace_color_1_negro.jpg',
    );
    service.replaceSimpleVariant = vi.fn().mockResolvedValue(undefined);
    service.upsertMarketplaceSimpleVariantConfig = vi.fn().mockResolvedValue(undefined);

    await service.updateProduct(99, {
      variantMode: 'SIMPLE',
      colorIds: [1, 2],
      sizeIds: [4],
      variants: [
        {
          price: 18,
          isActive: true,
        },
      ],
      marketplaceColorImages: [
        {
          colorId: 1,
          imageFile: {
            filename: 'negro.png',
            data: 'base64-negro',
          },
        },
      ],
    } as never);

    expect(service.upsertMarketplaceSimpleVariantConfig).toHaveBeenCalledWith(99, {
      colorIds: [1, 2],
      sizeIds: [4],
      colorImages: [
        {
          colorId: 1,
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/product_99_marketplace_color_1_negro.jpg',
        },
      ],
    });
  });
});
