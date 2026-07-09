import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => {
  const client: any = {
    order: { findUnique: vi.fn(), update: vi.fn() },
    productVariant: { findFirst: vi.fn() },
    orderItem: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';

// Proforma marketplace abierta (CONFIRMED, sin picking).
function mockOrder(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    code: 'MK-1',
    status: 'CONFIRMED',
    note: 'CHANNEL: ECOMMERCE',
    sourceStoreId: 1,
    pickingSession: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
  // getMarketplacePaymentSettings: sin filas => includeIgv default true.
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
  vi.mocked(prisma.order.update).mockResolvedValue({} as never);
  vi.mocked(prisma.orderItem.update).mockResolvedValue({} as never);
});

describe('OrderService.addOrderItem', () => {
  it('crea la linea con precio de la variante y recalcula subtotal/IGV/total', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValueOnce({ id: 10, price: 50 } as never);
    vi.mocked(prisma.orderItem.create).mockResolvedValueOnce({ id: 999 } as never);
    // recompute: items NO eliminados = existente (100) + nuevo (100).
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([
      { subtotal: 100 },
      { subtotal: 100 },
    ] as never);

    const result = await new OrderService().addOrderItem(1, 10, 2, 7);

    expect(prisma.orderItem.create).toHaveBeenCalledWith({
      data: { orderId: 1, variantId: 10, quantity: 2, unitPrice: 50, subtotal: 100 },
      select: { id: true },
    });
    // recompute suma solo removedAt=null.
    expect(prisma.orderItem.findMany).toHaveBeenCalledWith({
      where: { orderId: 1, removedAt: null },
      select: { subtotal: true },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { subtotal: 200, tax: 36, total: 236 },
    });
    expect(result.orderItemId).toBe(999);
    expect(result.total).toBe(236);
  });

  it('sin IGV en la configuracion, el total no suma impuesto', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValueOnce({ id: 10, price: 50 } as never);
    vi.mocked(prisma.orderItem.create).mockResolvedValueOnce({ id: 999 } as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([{ subtotal: 100 }] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ value: 'false' }] as never);

    const result = await new OrderService().addOrderItem(1, 10, 2);

    expect(result.tax).toBe(0);
    expect(result.total).toBe(100);
  });

  it('rechaza pedidos que no son ecommerce', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ code: 'ORD-1', note: null }) as never,
    );
    await expect(new OrderService().addOrderItem(1, 10, 1)).rejects.toThrow(/ecommerce/i);
    expect(prisma.orderItem.create).not.toHaveBeenCalled();
  });

  it('permite agregar durante el picking en curso (cliente cambia en caliente)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ status: 'PREPARING', pickingSession: { id: 55 } }) as never,
    );
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValueOnce({ id: 10, price: 50 } as never);
    vi.mocked(prisma.orderItem.create).mockResolvedValueOnce({ id: 999 } as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([{ subtotal: 100 }] as never);

    const result = await new OrderService().addOrderItem(1, 10, 2);

    expect(prisma.orderItem.create).toHaveBeenCalled();
    expect(result.orderItemId).toBe(999);
  });

  it('rechaza si el pedido ya esta finalizado (READY)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ status: 'READY', pickingSession: { id: 55 } }) as never,
    );
    await expect(new OrderService().addOrderItem(1, 10, 1)).rejects.toThrow(/finalizado|cerrado/i);
    expect(prisma.orderItem.create).not.toHaveBeenCalled();
  });

  it('rechaza cantidad invalida', async () => {
    await expect(new OrderService().addOrderItem(1, 10, 0)).rejects.toThrow(/cantidad/i);
  });

  it('rechaza variante sin precio valido', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(mockOrder() as never);
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValueOnce({ id: 10, price: 0 } as never);
    await expect(new OrderService().addOrderItem(1, 10, 1)).rejects.toThrow(/precio/i);
  });

  it('persiste el guide marketplace (color/talla) del item nuevo en el note', async () => {
    // Pedido con 1 item previo => el nuevo queda en el indice 1.
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ note: 'CHANNEL: ECOMMERCE', items: [{ id: 900 }] }) as never,
    );
    vi.mocked(prisma.productVariant.findFirst).mockResolvedValueOnce({ id: 10, price: 50 } as never);
    vi.mocked(prisma.orderItem.create).mockResolvedValueOnce({ id: 999 } as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([{ subtotal: 100 }] as never);

    await new OrderService().addOrderItem(1, 10, 2, 7, { colorName: 'Negro', sizeName: 'L', displayVariantId: 123 });

    // Debe haber una order.update que escriba el note con el token del guide.
    const noteUpdate = vi.mocked(prisma.order.update).mock.calls
      .map((call) => call[0] as any)
      .find((arg) => typeof arg?.data?.note === 'string' && arg.data.note.includes('MKT_GUIDE_ITEMS:'));
    expect(noteUpdate).toBeTruthy();

    // El token decodifica a un arreglo alineado: [vacio, {Negro/L}].
    const token = String(noteUpdate.data.note).split('|').map((p: string) => p.trim())
      .find((p: string) => p.startsWith('MKT_GUIDE_ITEMS:'))!;
    const decoded = JSON.parse(Buffer.from(token.replace('MKT_GUIDE_ITEMS:', ''), 'base64').toString('utf8'));
    expect(decoded).toHaveLength(2);
    expect(decoded[1]).toMatchObject({ colorName: 'Negro', sizeName: 'L', displayVariantId: 123 });
  });
});

describe('OrderService.removeOrderItem', () => {
  it('marca eliminado, guarda motivo/usuario y recalcula excluyendolo', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ items: [{ id: 900, reserved: 0, removedAt: null }] }) as never,
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ firstName: 'Ada', lastName: 'Lopez' } as never);
    // recompute tras eliminar: solo queda 1 item (50).
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([{ subtotal: 50 }] as never);

    const result = await new OrderService().removeOrderItem(1, 900, 'Sin stock', ' n/a', 7);

    const updateArg = vi.mocked(prisma.orderItem.update).mock.calls[0][0] as any;
    expect(updateArg.where).toEqual({ id: 900 });
    expect(updateArg.data.removedAt).toBeInstanceOf(Date);
    expect(updateArg.data.removedReason).toBe('Sin stock');
    expect(updateArg.data.removedById).toBe(7);
    expect(updateArg.data.removedByName).toBe('Ada Lopez');
    // 50 + IGV 18% (9) = 59.
    expect(result.total).toBe(59);
  });

  it('rechaza si el producto ya estaba eliminado', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ items: [{ id: 900, reserved: 0, removedAt: new Date() }] }) as never,
    );
    await expect(new OrderService().removeOrderItem(1, 900)).rejects.toThrow(/ya esta eliminado/i);
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });

  it('rechaza pedidos que no son ecommerce', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ code: 'ORD-1', note: null, items: [{ id: 900, reserved: 0, removedAt: null }] }) as never,
    );
    await expect(new OrderService().removeOrderItem(1, 900)).rejects.toThrow(/ecommerce/i);
  });

  it('si el item ya fue pickeado durante el picking, lo des-pickea antes de liberar', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({
        status: 'PREPARING',
        pickingSession: { id: 55 },
        items: [{ id: 900, reserved: 2, picked: 2, removedAt: null }],
      }) as never,
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ firstName: 'Ada', lastName: 'Lopez' } as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([{ subtotal: 50 }] as never);

    const unpickSpy = vi.spyOn(OrderService.prototype as any, 'updatePickingOrderItem').mockResolvedValue({} as never);
    const releaseSpy = vi.spyOn(OrderService.prototype as any, 'releaseRemoteStock').mockResolvedValue({} as never);

    await new OrderService().removeOrderItem(1, 900, 'Cliente cambio', null, 7);

    // Des-pickear (picked -> 0) ANTES de liberar la reserva.
    expect(unpickSpy).toHaveBeenCalledWith(1, 900, 0, 7);
    expect(releaseSpy).toHaveBeenCalledWith(1, 900, 7);
    const unpickOrder = unpickSpy.mock.invocationCallOrder[0];
    const releaseOrder = releaseSpy.mock.invocationCallOrder[0];
    expect(unpickOrder).toBeLessThan(releaseOrder);
    // Y marca eliminado.
    const updateArg = vi.mocked(prisma.orderItem.update).mock.calls[0][0] as any;
    expect(updateArg.data.removedAt).toBeInstanceOf(Date);

    unpickSpy.mockRestore();
    releaseSpy.mockRestore();
  });
});

describe('OrderService.restoreOrderItem', () => {
  it('limpia las marcas y recalcula volviendo a contar el item', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ items: [{ id: 900, removedAt: new Date() }] }) as never,
    );
    vi.mocked(prisma.orderItem.findMany).mockResolvedValueOnce([
      { subtotal: 100 },
      { subtotal: 50 },
    ] as never);

    const result = await new OrderService().restoreOrderItem(1, 900);

    const updateArg = vi.mocked(prisma.orderItem.update).mock.calls[0][0] as any;
    expect(updateArg.data.removedAt).toBeNull();
    expect(updateArg.data.removedReason).toBeNull();
    // 150 + IGV (27) = 177.
    expect(result.total).toBe(177);
  });

  it('rechaza si el producto no estaba eliminado', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(
      mockOrder({ items: [{ id: 900, removedAt: null }] }) as never,
    );
    await expect(new OrderService().restoreOrderItem(1, 900)).rejects.toThrow(/no esta eliminado/i);
    expect(prisma.orderItem.update).not.toHaveBeenCalled();
  });
});
