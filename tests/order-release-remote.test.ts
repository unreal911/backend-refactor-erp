import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => {
  const client: any = {
    order: { findUnique: vi.fn() },
    reservation: { update: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';

// La reserva vive en una sola fila Reservation de cantidad 5, en la tienda 2.
function mockOrder() {
  return {
    id: 1,
    code: 'MK-1',
    status: 'CONFIRMED',
    sourceStoreId: 1,
    fulfillmentStoreId: 2,
    items: [
      { id: 900, variantId: 10, reserved: 5, quantity: 6 },
    ],
    reservations: [
      {
        id: 5001,
        status: 'ACTIVE',
        variantId: 10,
        quantity: 5,
        inventoryId: 22,
        inventory: { id: 22, storeId: 2, stock: 16 },
      },
    ],
  };
}

describe('OrderService.releaseRemoteStock (liberacion parcial)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // El $transaction ejecuta el callback con el mismo cliente mock como `tx`.
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
  });

  it('libera solo la cantidad pedida y NO toda la linea (bug del -)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);

    // reserved = 5, se pide liberar 1 de la tienda 2.
    const result = await new OrderService().releaseRemoteStock(1, 900, undefined, 1, 2);

    expect(result.releasedQuantity).toBe(1);
    // La reserva de 5 se reduce a 4 (parcial), no se marca RELEASED.
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5001 },
      data: { quantity: 4 },
    });
    expect(prisma.reservation.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'RELEASED' } }),
    );
    // Movimiento de inventario por la unidad liberada.
    expect(prisma.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'UNRESERVED', quantity: 1, inventoryId: 22 }),
    });
  });

  it('sin quantity libera toda la reserva (comportamiento por defecto)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);

    const result = await new OrderService().releaseRemoteStock(1, 900);

    expect(result.releasedQuantity).toBe(5);
    // Al liberar todo, la reserva se marca RELEASED.
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5001 },
      data: { status: 'RELEASED' },
    });
  });

  it('quantity mayor al reservado se acota al total de la linea', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);

    const result = await new OrderService().releaseRemoteStock(1, 900, undefined, 100, 2);

    expect(result.releasedQuantity).toBe(5);
  });

  it('con sourceStoreId sin reservas en esa tienda no libera nada (lanza error)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);

    // La reserva esta en la tienda 2; pedimos liberar de la tienda 99.
    await expect(
      new OrderService().releaseRemoteStock(1, 900, undefined, 1, 99),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('divide la liberacion entre varias reservas (LIFO) sin pasarse', async () => {
    const order = mockOrder();
    // Dos reservas en la misma tienda: 3 (id 5002, mas nueva) y 2 (id 5001).
    order.items[0].reserved = 5;
    order.reservations = [
      { id: 5001, status: 'ACTIVE', variantId: 10, quantity: 2, inventoryId: 22, inventory: { id: 22, storeId: 2, stock: 16 } },
      { id: 5002, status: 'ACTIVE', variantId: 10, quantity: 3, inventoryId: 22, inventory: { id: 22, storeId: 2, stock: 16 } },
    ];
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(order as never);

    // Liberar 4: toma 3 de la mas nueva (RELEASED) + 1 de la otra (queda en 1).
    const result = await new OrderService().releaseRemoteStock(1, 900, undefined, 4, 2);

    expect(result.releasedQuantity).toBe(4);
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5002 },
      data: { status: 'RELEASED' },
    });
    expect(prisma.reservation.update).toHaveBeenCalledWith({
      where: { id: 5001 },
      data: { quantity: 1 },
    });
  });
});
