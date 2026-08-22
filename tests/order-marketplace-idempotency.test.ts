import { beforeEach, describe, expect, it, vi } from 'vitest';

// Idempotencia de createMarketplaceOrder (C4): un reintento/doble-submit con la
// misma idempotencyKey debe hacer REPLAY del pedido existente y cortocircuitar
// ANTES de abrir la transaccion (no crea pedido nuevo ni consume stock).
// Test con prisma mockeado: aisla la guarda de replay sin depender de la BD.

vi.mock('../src/data/prisma', () => {
  const client: any = {
    order: { findUnique: vi.fn(), findMany: vi.fn() },
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
    marketplaceCustomerId: null,
    items: [],
  };
}

describe('createMarketplaceOrder — idempotencia (replay)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no permite reutilizar una clave idempotente de otro cliente autenticado', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      ...existingOrder(),
      marketplaceCustomerId: 41,
    } as never);

    await expect(
      new OrderService().createMarketplaceOrder({ idempotencyKey: 'MK-REPLAY' } as any, 99),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite el replay solamente al mismo propietario autenticado', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({
      ...existingOrder(),
      marketplaceCustomerId: 41,
    } as never);

    const result: any = await new OrderService().createMarketplaceOrder(
      { idempotencyKey: 'MK-REPLAY' } as any,
      41,
    );

    expect(result.code).toBe('MK-REPLAY');
  });

  it('con idempotencyKey ya existente devuelve el pedido sin abrir transaccion', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(existingOrder() as never);

    const result: any = await new OrderService().createMarketplaceOrder({ idempotencyKey: 'MK-REPLAY' } as any);

    // Replay: consulto por la clave y devolvi el pedido mapeado.
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_idempotencyKey: {
            tenantId: '00000000-0000-4000-8000-000000000001',
            idempotencyKey: 'MK-REPLAY',
          },
        },
      }),
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
      expect.objectContaining({
        where: {
          tenantId_idempotencyKey: {
            tenantId: '00000000-0000-4000-8000-000000000001',
            idempotencyKey: 'MK-NUEVO',
          },
        },
      }),
    );
  });
});

describe('propiedad de pedidos marketplace autenticados', () => {
  it('lista por marketplaceCustomerId y no por telefono o correo mutable', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValueOnce([] as never);

    await new OrderService().listMarketplaceOrdersByCustomerId(41);

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ marketplaceCustomerId: 41 }),
    }));
    const call = vi.mocked(prisma.order.findMany).mock.calls[0]?.[0] as any;
    expect(JSON.stringify(call.where)).not.toMatch(/clientPhone|clientEmail/);
  });
});
