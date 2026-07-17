import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mapa de bugs de la "Preparacion del pedido ecommerce" con VARIANTE COMPARTIDA
// ("producto unico": varias filas Color/Talla del pedido = mismo variantId y el
// mismo stock). El sintoma reportado: en /admin/orders/:id la ultima fila se ve
// como "Pendiente 0 / 5" y al pulsar + salta el error
//   "El item ya tiene toda su cantidad reservada".
//
// Estos tests documentan por que pasa y donde estan los defectos.

vi.mock('../src/data/prisma', () => {
  const client: any = {
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderItem: { findMany: vi.fn() },
    inventory: { findUnique: vi.fn() },
    reservation: { create: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';
import { resolveReservedByOrderItem } from '../src/presentation/services/order-presentation';

const VARIANT = 10;
const STORE = 2;

// Estado REAL en BD del pedido de la captura. Las 4 lineas comparten variantId 10.
// La reserva total de la variante = 12 unidades, pero repartida "hacia atras":
// Blanco M(901)=0, Blanco L(902)=5, Negro M(903)=2, Negro L(904)=5.
function sharedVariantOrder() {
  return {
    id: 1,
    code: 'MK-1',
    status: 'CONFIRMED',
    sourceStoreId: 1,
    fulfillmentStoreId: STORE,
    items: [
      { id: 901, variantId: VARIANT, reserved: 0, quantity: 5, fulfillmentStoreId: STORE }, // Blanco M
      { id: 902, variantId: VARIANT, reserved: 5, quantity: 5, fulfillmentStoreId: STORE }, // Blanco L
      { id: 903, variantId: VARIANT, reserved: 2, quantity: 4, fulfillmentStoreId: STORE }, // Negro M
      { id: 904, variantId: VARIANT, reserved: 5, quantity: 5, fulfillmentStoreId: STORE }, // Negro L
    ],
    reservations: [
      { id: 5001, status: 'ACTIVE', variantId: VARIANT, quantity: 12, inventoryId: 22, inventory: { id: 22, storeId: STORE, stock: 72, reservedStock: 12 } },
    ],
  };
}

describe('OrderService.reserveRemoteStock — variante compartida (producto unico)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(prisma));
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);
    vi.mocked(prisma.inventory.findUnique).mockResolvedValue({ id: 22, store: { name: 'Feria Mananera Paramonga' }, stock: 72, reservedStock: 12 } as never);
    vi.mocked(prisma.reservation.create).mockResolvedValue({ id: 7000 } as never);
    vi.mocked(prisma.inventoryMovement.create).mockResolvedValue({} as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.order.update).mockResolvedValue({} as never);
  });

  // GUARD (backend truth): `reserveRemoteStock` valida el OrderItem.reserved REAL.
  // Reservar una linea ya llena debe rechazarse. Tras el fix, la UI ya NO pinta esa
  // linea como pendiente (ver "reserved real por linea"), asi que el usuario no llega
  // a este error; pero la validacion sigue siendo correcta como red de seguridad.
  it('rechaza reservar una linea que en BD ya esta llena (variante compartida)', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(sharedVariantOrder() as never);

    await expect(
      new OrderService().reserveRemoteStock(1, STORE, VARIANT, 1, undefined, 904),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'El item ya tiene toda su cantidad reservada',
    });

    // No se creo ninguna reserva: el rechazo es antes de tocar inventario.
    expect(prisma.reservation.create).not.toHaveBeenCalled();
  });

  // Comportamiento: si NO se envia orderItemId, reserveRemoteStock elige la PRIMERA
  // linea pendiente por id (matchingItems[0]). El panel SIEMPRE envia orderItemId, asi
  // que esto es solo el fallback documentado (riesgo latente si algun caller lo omite).
  it('sin orderItemId reserva en la primera linea pendiente por id', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(sharedVariantOrder() as never);

    // El usuario "queria" Negro M (903), pero al no mandar orderItemId el backend
    // toma la 1ra linea con reserved<quantity → Blanco M (901).
    const result = await new OrderService().reserveRemoteStock(1, STORE, VARIANT, 1, undefined);

    expect(result.orderItemId).toBe(901);
  });

  // Sanity: con la linea correcta y pendiente si reserva.
  it('reserva bien cuando la linea objetivo si tiene pendiente', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(sharedVariantOrder() as never);

    const result = await new OrderService().reserveRemoteStock(1, STORE, VARIANT, 1, undefined, 903);

    expect(result.orderItemId).toBe(903);
    expect(result.quantity).toBe(1);
  });

  // C2 — reserva parcial (allowPartial): el caso "otro usuario ya separo, solo
  // queda lo que hay". Se pide mas de lo disponible y se reserva lo posible,
  // devolviendo partial=true + cuanto quedo por reservar (sin lanzar error).
  it('con allowPartial reserva solo lo disponible y marca partial', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(sharedVariantOrder() as never);
    // Solo 1 disponible (stock 13 - reservado 12). La linea 903 tiene pendiente 2.
    vi.mocked(prisma.inventory.findUnique).mockResolvedValue({ id: 22, store: { name: 'Tienda X' }, stock: 13, reservedStock: 12 } as never);

    const result = await new OrderService().reserveRemoteStock(1, STORE, VARIANT, 4, undefined, 903, true);

    expect(result.reservedQuantity).toBe(1);
    expect(result.requestedQuantity).toBe(4);
    expect(result.partial).toBe(true);
    // Se creo la reserva por la unidad efectivamente tomada.
    expect(prisma.reservation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 1, orderItemId: 903 }) }),
    );
  });

  // Sin allowPartial se mantiene el contrato estricto: pedir mas del pendiente falla.
  it('sin allowPartial rechaza si se pide mas del pendiente de la linea', async () => {
    vi.mocked(prisma.order.findUnique).mockResolvedValueOnce(sharedVariantOrder() as never);

    await expect(
      new OrderService().reserveRemoteStock(1, STORE, VARIANT, 4, undefined, 903),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// FIX de la raiz del sintoma: la respuesta de picking ahora usa el reserved REAL por
// linea (resolveReservedByOrderItem) en vez del reparto voraz. Asi la vista coincide
// con lo que valida reserveRemoteStock y las lineas llenas no se ven como pendientes.
describe('OrderService.resolveReservedByOrderItem — reserved real por linea (fix)', () => {
  const svc = () => new OrderService() as any;

  it('caso normal: respeta el OrderItem.reserved de cada linea (NO reparte voraz)', () => {
    const items = [
      { id: 901, quantity: 5, reserved: 0 }, // Blanco M
      { id: 902, quantity: 5, reserved: 5 }, // Blanco L
      { id: 903, quantity: 4, reserved: 2 }, // Negro M
      { id: 904, quantity: 5, reserved: 5 }, // Negro L (lleno)
    ];
    const map: Map<number, number> = resolveReservedByOrderItem(items, 12);

    // Cada linea muestra su reserved real: Negro L = 5 (lleno), no 0.
    expect(map.get(901)).toBe(0);
    expect(map.get(902)).toBe(5);
    expect(map.get(903)).toBe(2);
    expect(map.get(904)).toBe(5); // ← antes se veia 0 (pendiente); ahora 5 (lleno)
  });

  it('legacy: si no hay tracking por linea (todo 0) reparte el total como respaldo', () => {
    const items = [
      { id: 901, quantity: 5, reserved: 0 },
      { id: 902, quantity: 5, reserved: 0 },
      { id: 903, quantity: 4, reserved: 0 },
      { id: 904, quantity: 5, reserved: 0 },
    ];
    const map: Map<number, number> = resolveReservedByOrderItem(items, 12);

    expect(map.get(901)).toBe(5);
    expect(map.get(902)).toBe(5);
    expect(map.get(903)).toBe(2);
    expect(map.get(904)).toBe(0);
  });
});
