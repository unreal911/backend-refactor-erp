import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => ({
  prisma: {
    store: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    productVariant: {
      findMany: vi.fn(),
    },
    inventory: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    },
    order: {
      create: vi.fn(),
    },
    reservation: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../src/data/prisma';
import { CreateOrderDto } from '../src/domain/dtos/create-order.dto';
import { OrderService } from '../src/presentation/services/order.service';

describe('OrderService POS stock fulfillment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserva fulfillmentStoreId por item en el DTO', () => {
    const [error, dto] = CreateOrderDto.create({
      sourceStoreId: 1,
      note: 'Metodo de pago: Efectivo | Ref: POS-123',
      items: [
        {
          variantId: 10,
          quantity: 3,
          unitPrice: 18,
          fulfillmentStoreId: 2,
        },
      ],
    });

    expect(error).toBeUndefined();
    expect(dto?.items[0].fulfillmentStoreId).toBe(2);
  });

  it('reserva stock remoto del fulfillmentStoreId del item POS sin descontar stock fisico', async () => {
    const remoteInventory = {
      id: 22,
      storeId: 2,
      variantId: 10,
      stock: 16,
      reservedStock: 0,
    };

    vi.mocked(prisma.store.findUnique).mockResolvedValueOnce({ id: 1, name: 'Feria mañana' } as never);
    vi.mocked(prisma.store.findMany).mockResolvedValueOnce([{ id: 2 }] as never);
    vi.mocked(prisma.productVariant.findMany).mockResolvedValueOnce([
      {
        id: 10,
        product: { name: 'Polo para Caballero - Algodon Licrado 30/1 v2' },
      },
    ] as never);
    vi.mocked(prisma.inventory.findUnique)
      .mockResolvedValueOnce(remoteInventory as never)
      .mockResolvedValueOnce(remoteInventory as never)
      .mockResolvedValueOnce(remoteInventory as never);
    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: 500,
      code: 'ORD-POS-500',
      status: 'WAITING_TRANSFER',
      sourceStoreId: 1,
      fulfillmentStoreId: 2,
      items: [
        {
          id: 900,
          variantId: 10,
          quantity: 3,
          unitPrice: 18,
          subtotal: 54,
          fulfillmentStoreId: 2,
        },
      ],
    } as never);

    const [, dto] = CreateOrderDto.create({
      sourceStoreId: 1,
      note: 'Metodo de pago: Efectivo | Ref: POS-123',
      items: [
        {
          variantId: 10,
          quantity: 3,
          unitPrice: 18,
          fulfillmentStoreId: 2,
        },
      ],
    });

    const order = await new OrderService().createOrder(dto!);

    expect(order.status).toBe('WAITING_TRANSFER');
    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'WAITING_TRANSFER',
        fulfillmentStoreId: 2,
        items: {
          create: [
            expect.objectContaining({
              variantId: 10,
              quantity: 3,
              picked: 0,
              status: 'PENDING',
              fulfillmentStoreId: 2,
            }),
          ],
        },
      }),
    }));
    expect(prisma.inventory.findUnique).toHaveBeenCalledWith({
      where: { storeId_variantId: { storeId: 2, variantId: 10 } },
    });
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 22 },
      data: { reservedStock: { increment: 3 } },
    });
    expect(prisma.reservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quantity: 3,
        status: 'ACTIVE',
        inventoryId: 22,
        variantId: 10,
        orderId: 500,
      }),
    });
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    expect(prisma.inventory.update).not.toHaveBeenCalledWith({
      where: { id: 22 },
      data: { stock: { decrement: 3 } },
    });
  });

  it('consume stock directo cuando la venta POS se atiende en la tienda local', async () => {
    const localInventory = {
      id: 11,
      storeId: 1,
      variantId: 10,
      stock: 8,
      reservedStock: 1,
    };

    vi.mocked(prisma.store.findUnique).mockResolvedValueOnce({ id: 1, name: 'Feria mañana' } as never);
    vi.mocked(prisma.productVariant.findMany).mockResolvedValueOnce([
      {
        id: 10,
        product: { name: 'Polo para Caballero - Algodon Licrado 30/1' },
      },
    ] as never);
    vi.mocked(prisma.inventory.findUnique)
      .mockResolvedValueOnce(localInventory as never)
      .mockResolvedValueOnce(localInventory as never);
    vi.mocked(prisma.order.create).mockResolvedValueOnce({
      id: 501,
      code: 'ORD-POS-501',
      status: 'DELIVERED',
      sourceStoreId: 1,
      fulfillmentStoreId: 1,
      items: [
        {
          id: 901,
          variantId: 10,
          quantity: 2,
          unitPrice: 18,
          subtotal: 36,
          fulfillmentStoreId: 1,
        },
      ],
    } as never);

    const [, dto] = CreateOrderDto.create({
      sourceStoreId: 1,
      note: 'Metodo de pago: Efectivo | Ref: POS-124',
      items: [
        {
          variantId: 10,
          quantity: 2,
          unitPrice: 18,
        },
      ],
    });

    await new OrderService().createOrder(dto!);

    expect(prisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DELIVERED',
        items: {
          create: [
            expect.objectContaining({
              picked: 2,
              status: 'PICKED',
              fulfillmentStoreId: 1,
            }),
          ],
        },
      }),
    }));
    expect(prisma.inventory.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { stock: { decrement: 2 } },
    });
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'OUT',
        quantity: 2,
        previousStock: 8,
        newStock: 6,
        inventoryId: 11,
      }),
    });
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });
});
