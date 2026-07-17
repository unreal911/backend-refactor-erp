import { beforeEach, describe, expect, it, vi } from 'vitest';

// Idempotencia de createMarketplaceOrder (C4): un reintento/doble-submit con la
// misma idempotencyKey debe hacer REPLAY del pedido existente y cortocircuitar
// ANTES de abrir la transaccion (no crea pedido nuevo ni consume stock).
// Test con prisma mockeado: aisla la guarda de replay sin depender de la BD.

vi.mock('../src/data/prisma', () => {
  const client: any = {
    order: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';

// Pedido existente minimo (mapOrderWithPresentationData es null-safe con items:[]).
function existingOrder() {
  return {
    id: 77,
    code: 'MK-REPLAY',
    status: 'CONFIRMED',
    note: 'MKT venta mayorista',
    subtotal: 100,
    tax: 18,
    total: 118,
    items: [],
  };
}

describe('createMarketplaceOrder — idempotencia (replay)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con idempotencyKey ya existente devuelve el pedido sin abrir transaccion', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(existingOrder() as never);

    const result: any = await new OrderService().createMarketplaceOrder({ idempotencyKey: 'MK-REPLAY' } as any);

    // Replay: consulto por la clave y devolvi el pedido mapeado.
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'MK-REPLAY' } }),
    );
    expect(result.code).toBe('MK-REPLAY');
    expect(result.stockSummary).toBeDefined();
    // Clave: NO se abrio transaccion (no se creo pedido ni se consumio stock).
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('con idempotencyKey sin coincidencia NO cortocircuita (sigue el flujo normal)', async () => {
    // No hay pedido con esa clave -> el replay no aplica; el metodo avanza y
    // (con prisma mockeado incompleto) falla mas adelante, pero NUNCA devuelve
    // por replay. Basta verificar que consulto la clave y siguio de largo.
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(null as never);

    await expect(
      new OrderService().createMarketplaceOrder({ idempotencyKey: 'MK-NUEVO' } as any),
    ).rejects.toBeTruthy();

    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'MK-NUEVO' } }),
    );
  });
});
