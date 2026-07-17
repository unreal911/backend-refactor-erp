import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests de CONCURRENCIA REAL contra Postgres (no mocks). Prueban end-to-end que
// las casuisticas de cruce quedan cerradas a nivel de fila:
//   1) doble entrega concurrente NO decrementa stock dos veces (C1).
//   2) dos reservas concurrentes sobre el mismo stock NO sobre-reservan (C2/C3).
//
// Se auto-omiten si no hay BD alcanzable (p.ej. CI sin Postgres). Siembran un
// grafo aislado (producto/variante/inventario propios) y lo limpian al final,
// asi no tocan datos reales del dev.
//
// NOTA: importan el prisma REAL (este archivo NO hace vi.mock).

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';
import { isReturnResponsibilityManagementEnabled } from '../src/presentation/services/order-responsibility.queries';
import { InventoryService } from '../src/presentation/services/inventory.service';
import { ensureInventoryIntegritySchema } from '../src/data/inventory-integrity-bootstrap';

let dbReady = false;
const uniq = Date.now();
let seq = 0;

// Lookups compartidos (se reutilizan si ya existen en la BD sembrada).
let storeId = 0;
let categoryId = 0;
let colorId = 0;
let sizeId = 0;
let userId = 0; // responsable/cancelador (updateOrderStatus exige uno para cancelar).

// IDs creados por los tests, para limpieza en afterAll.
const createdOrderIds: number[] = [];
const createdInventoryIds: number[] = [];
const createdVariantIds: number[] = [];
const createdProductIds: number[] = [];
const createdPickingSessionIds: number[] = [];
const createdRoleIds: number[] = [];
const createdUserIds: number[] = [];

async function firstOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const found = await find();
  return found ?? create();
}

async function seedScenario(opts: { stock: number; reserved: number }) {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({
    data: { name: `IT Prod ${tag}`, categoryId },
  });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `IT-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  const inventory = await prisma.inventory.create({
    data: { storeId, variantId: variant.id, stock: opts.stock, reservedStock: opts.reserved },
  });
  createdInventoryIds.push(inventory.id);
  return { product, variant, inventory };
}

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  // Aplica los CHECK de integridad (idempotente): la red de seguridad tambien
  // deberia impedir el oversell a nivel BD.
  await ensureInventoryIntegritySchema();

  const store = await firstOrCreate(
    () => prisma.store.findFirst(),
    () => prisma.store.create({ data: { name: `IT Store ${uniq}`, code: `ITST-${uniq}` } }),
  );
  storeId = store.id;
  const category = await firstOrCreate(
    () => prisma.category.findFirst(),
    () => prisma.category.create({ data: { name: `IT Cat ${uniq}` } }),
  );
  categoryId = category.id;
  const color = await firstOrCreate(
    () => prisma.color.findFirst(),
    () => prisma.color.create({ data: { name: `IT Color ${uniq}` } }),
  );
  colorId = color.id;
  const size = await firstOrCreate(
    () => prisma.size.findFirst(),
    () => prisma.size.create({ data: { name: `IT Size ${uniq}` } }),
  );
  sizeId = size.id;

  // Usuario responsable: cancelar exige un cancelledById valido (FK a User).
  // Reutiliza uno existente (dev suele tener admin) o crea rol+user aislados.
  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const existingRole = await prisma.role.findFirst();
    const role = existingRole ?? await prisma.role.create({ data: { name: `IT Role ${uniq}` } });
    if (!existingRole) createdRoleIds.push(role.id);
    const user = await prisma.user.create({
      data: {
        firstName: 'IT',
        lastName: 'Responsable',
        email: `it-user-${uniq}@test.local`,
        password: 'x',
        roleId: role.id,
      },
    });
    createdUserIds.push(user.id);
    userId = user.id;
  }
});

// Siembra un pedido pickeable con sesion de picking IN_PROGRESS y una linea ya
// separada (picked = quantity, reserved = quantity) + reserva ACTIVE. Base para
// los tests de carrera G1/G2/G3.
async function seedPickingOrder(opts: { stock: number; quantity: number; picked: number }) {
  const { variant, inventory } = await seedScenario({ stock: opts.stock, reserved: opts.quantity });
  const order = await prisma.order.create({
    data: {
      code: `IT-PICK-${uniq}-${seq}`,
      status: 'CONFIRMED',
      sourceStoreId: storeId,
      fulfillmentStoreId: storeId,
      sellerUserId: userId,
      pickerUserId: userId, // responsable principal (el flujo de picking puede estar activo).
      items: {
        create: [
          {
            variantId: variant.id,
            quantity: opts.quantity,
            reserved: opts.quantity,
            picked: opts.picked,
            unitPrice: 10,
            subtotal: opts.quantity * 10,
            status: opts.picked >= opts.quantity ? 'PICKED' : 'PENDING',
          },
        ],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  await prisma.reservation.create({
    data: {
      quantity: opts.quantity,
      status: 'ACTIVE',
      inventoryId: inventory.id,
      variantId: variant.id,
      orderId: order.id,
      orderItemId: order.items[0].id,
    },
  });
  const session = await prisma.pickingSession.create({
    data: {
      orderId: order.id,
      status: 'IN_PROGRESS',
      assignedUserId: userId,
      items: { create: [{ variantId: variant.id, quantity: opts.quantity, pickedQuantity: opts.picked }] },
    },
  });
  createdPickingSessionIds.push(session.id);
  return { variant, inventory, order };
}

afterAll(async () => {
  if (dbReady) {
    // Orden FK-safe: detalle picking (tabla raw) -> items/sesiones picking ->
    // movimientos -> reservas -> ordenes (cascade items) -> inventario ->
    // variantes -> productos -> usuario/rol creados por estos tests.
    try { if (createdOrderIds.length) await prisma.orderReturn.deleteMany({ where: { orderId: { in: createdOrderIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.$executeRawUnsafe(`DELETE FROM "PickingOrderItemDetail" WHERE "orderId" = ANY($1::int[])`, createdOrderIds); } catch { /* noop */ }
    try { if (createdPickingSessionIds.length) await prisma.pickingItem.deleteMany({ where: { sessionId: { in: createdPickingSessionIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } }); } catch { /* noop */ }
    try { if (createdInventoryIds.length) await prisma.inventoryMovement.deleteMany({ where: { inventoryId: { in: createdInventoryIds } } }); } catch { /* noop */ }
    try { if (createdInventoryIds.length) await prisma.reservation.deleteMany({ where: { inventoryId: { in: createdInventoryIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }); } catch { /* noop */ }
    try { if (createdInventoryIds.length) await prisma.inventory.deleteMany({ where: { id: { in: createdInventoryIds } } }); } catch { /* noop */ }
    try { if (createdVariantIds.length) await prisma.productVariant.deleteMany({ where: { id: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdProductIds.length) await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }); } catch { /* noop */ }
    try { if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); } catch { /* noop */ }
    try { if (createdRoleIds.length) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } }); } catch { /* noop */ }
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe('Concurrencia real contra Postgres', () => {
  it('C2/C3: dos reservas concurrentes sobre el mismo stock NO sobre-reservan', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Stock 6, sin reservar. Dos lineas del pedido piden 4 cada una (demanda 8).
    const { variant, inventory } = await seedScenario({ stock: 6, reserved: 0 });
    const order = await prisma.order.create({
      data: {
        code: `IT-ORD-${uniq}-${seq}`,
        status: 'CONFIRMED',
        sourceStoreId: storeId,
        items: {
          create: [
            { variantId: variant.id, quantity: 4, unitPrice: 10, subtotal: 40 },
            { variantId: variant.id, quantity: 4, unitPrice: 10, subtotal: 40 },
          ],
        },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    createdOrderIds.push(order.id);
    const [itemA, itemB] = order.items;

    const svc = new OrderService();
    // allowPartial=true: cada una reserva lo que pueda. La suma NO puede pasar de 6.
    const results = await Promise.allSettled([
      svc.reserveRemoteStock(order.id, storeId, variant.id, 4, null, itemA.id, true),
      svc.reserveRemoteStock(order.id, storeId, variant.id, 4, null, itemB.id, true),
    ]);

    const reservedTotal = results.reduce((sum, r) => (
      r.status === 'fulfilled' ? sum + Number((r.value as any).reservedQuantity || 0) : sum
    ), 0);

    // Invariante duro: jamas se reserva mas que el stock.
    expect(reservedTotal).toBeLessThanOrEqual(6);
    // Demanda 8 > stock 6 => se consume todo lo disponible: exactamente 6.
    expect(reservedTotal).toBe(6);

    const freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.reservedStock).toBe(6);
    expect(freshInv!.reservedStock).toBeLessThanOrEqual(freshInv!.stock);

    // Ledger consistente: reservedStock == suma de reservas ACTIVE (sin descuadre).
    const activeAgg = await prisma.reservation.aggregate({
      where: { inventoryId: inventory.id, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    expect(Number(activeAgg._sum.quantity || 0)).toBe(6);

    // La auditoria no debe reportar este inventario como inconsistente.
    const audit = await new InventoryService().auditReservedStock();
    expect(audit.items.some((i) => i.inventoryId === inventory.id)).toBe(false);
  }, 30_000);

  it('C1: doble entrega concurrente NO decrementa stock dos veces', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido READY con reserva ACTIVE de 5 sobre un inventario stock=5, reservado=5.
    const { variant, inventory } = await seedScenario({ stock: 5, reserved: 5 });
    const order = await prisma.order.create({
      data: {
        code: `IT-ORD-${uniq}-${seq}`,
        status: 'READY',
        sourceStoreId: storeId,
        fulfillmentStoreId: storeId,
        items: {
          create: [
            { variantId: variant.id, quantity: 5, reserved: 5, picked: 5, unitPrice: 10, subtotal: 50, status: 'PICKED' },
          ],
        },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);
    await prisma.reservation.create({
      data: {
        quantity: 5,
        status: 'ACTIVE',
        inventoryId: inventory.id,
        variantId: variant.id,
        orderId: order.id,
        orderItemId: order.items[0].id,
      },
    });

    const svc = new OrderService();
    // Dos "Entregar" simultaneos. Solo uno debe consumir el stock.
    const results = await Promise.allSettled([
      svc.updateOrderStatus(order.id, { status: 'DELIVERED' } as any),
      svc.updateOrderStatus(order.id, { status: 'DELIVERED' } as any),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedResults = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toBe(1);
    expect(rejectedResults).toHaveLength(1);
    // El rechazo debe venir de la guarda in-tx (FOR UPDATE + revalidacion), no de
    // otra causa: prueba que es el fix C1 el que evita la doble entrega.
    expect(String(rejectedResults[0].reason?.message || '')).toMatch(/cambio de estado/i);

    const freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    // Decremento UNA sola vez: 5 -> 0 (no -5). Invariante: nunca negativo.
    expect(freshInv?.stock).toBe(0);
    expect(freshInv?.reservedStock).toBe(0);
    expect(freshInv!.stock).toBeGreaterThanOrEqual(0);

    const reservation = await prisma.reservation.findFirst({ where: { orderId: order.id } });
    expect(reservation?.status).toBe('COMPLETED');

    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(freshOrder?.status).toBe('DELIVERED');
  }, 30_000);

  it('G1: completar picking vs cancelar concurrentes NO resucita el pedido a READY', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido CONFIRMED con su linea ya separada y sesion de picking lista para
    // finalizar. Sin el lock+guard, completeOrderPicking podia sobrescribir con
    // READY un pedido que la cancelacion concurrente ya movio.
    const { order } = await seedPickingOrder({ stock: 5, quantity: 5, picked: 5 });

    const svc = new OrderService();
    const results = await Promise.allSettled([
      svc.completeOrderPicking(order.id, userId),
      svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId),
    ]);

    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    // Invariante G1: cancelar siempre commitea (CANCELLED o RETURN_PENDING por
    // haber unidades separadas); el pedido JAMAS queda READY (resucitado).
    expect(freshOrder?.status).not.toBe('READY');
    expect(['CANCELLED', 'RETURN_PENDING']).toContain(freshOrder?.status);

    // Si completeOrderPicking gano el lock primero (pedido -> READY), la
    // cancelacion posterior lo llevo a RETURN_PENDING; si perdio, debio abortar
    // con el mensaje del guard. Nunca ambos "exitosos" dejando READY.
    const completeResult = results[0];
    if (completeResult.status === 'rejected') {
      expect(String(completeResult.reason?.message || '')).toMatch(/cambio de estado/i);
    }
  }, 30_000);

  it('G2: cancelar con picking concurrente NO pierde el rastro de devolucion', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido CONFIRMED con reserva pero SIN separar aun (picked=0). Se lanza
    // pickAll (separa) a la vez que la cancelacion. G2 recomputa `picked` bajo
    // lock: si se alcanzo a separar mercaderia, debe ir a RETURN_PENDING; nunca
    // CANCELLED con unidades fisicamente separadas.
    const { order } = await seedPickingOrder({ stock: 5, quantity: 5, picked: 0 });

    const svc = new OrderService();
    await Promise.allSettled([
      svc.pickAllAvailableForOrder(order.id, userId),
      svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId),
    ]);

    const freshOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    const pickedUnits = (freshOrder?.items || []).reduce((sum, it) => sum + Number(it.picked || 0), 0);

    // Invariante G2: si quedaron unidades separadas, el estado refleja la
    // devolucion pendiente. Nunca CANCELLED con picked>0 (rastro perdido).
    if (pickedUnits > 0) {
      expect(freshOrder?.status).toBe('RETURN_PENDING');
    } else {
      expect(['CANCELLED', 'RETURN_PENDING']).toContain(freshOrder?.status);
    }
    expect(freshOrder?.status).not.toBe('READY');
  }, 30_000);

  it('G5: entregar con una linea sin reservar por completo se bloquea (no sobreventa)', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Inventario stock=5. Linea pide 5 pero solo 3 reservadas (p.ej. item
    // agregado sin reservar). Entregar decrementaria solo 3 y las 2 sin cubrir
    // saldrian fisicas sin descontar stock -> sobreventa. G5 debe bloquear.
    const { variant, inventory } = await seedScenario({ stock: 5, reserved: 3 });
    const order = await prisma.order.create({
      data: {
        code: `IT-G5-${uniq}-${seq}`,
        status: 'READY',
        sourceStoreId: storeId,
        fulfillmentStoreId: storeId,
        sellerUserId: userId,
        items: {
          create: [
            { variantId: variant.id, quantity: 5, reserved: 3, picked: 3, unitPrice: 10, subtotal: 50, status: 'PARTIAL' },
          ],
        },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);
    await prisma.reservation.create({
      data: {
        quantity: 3,
        status: 'ACTIVE',
        inventoryId: inventory.id,
        variantId: variant.id,
        orderId: order.id,
        orderItemId: order.items[0].id,
      },
    });

    const svc = new OrderService();
    await expect(
      svc.updateOrderStatus(order.id, { status: 'DELIVERED' } as any, userId),
    ).rejects.toThrow(/sin reservar/i);

    // Nada se movio: stock intacto y pedido sigue READY (no entregado).
    const freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.stock).toBe(5);
    const freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(freshOrder?.status).toBe('READY');
  }, 30_000);

  it('G4: devolucion post-entrega parcial repone stock y respeta el limite entregado', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido DELIVERED con linea de 5 unidades. El inventario ya refleja la
    // salida (stock=5, era 10). Se devuelve parcialmente y se verifica restock
    // + acumulado, guard de sobre-devolucion y cierre (returnedAt) al completar.
    const { variant, inventory } = await seedScenario({ stock: 5, reserved: 0 });
    const order = await prisma.order.create({
      data: {
        code: `IT-RET-${uniq}-${seq}`,
        status: 'DELIVERED',
        sourceStoreId: storeId,
        fulfillmentStoreId: storeId,
        sellerUserId: userId,
        items: {
          create: [
            { variantId: variant.id, quantity: 5, reserved: 5, picked: 5, unitPrice: 10, subtotal: 50, status: 'PICKED' },
          ],
        },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);
    const lineId = order.items[0].id;

    const svc = new OrderService();

    // Devuelve 2 de 5.
    await svc.registerOrderReturn(order.id, { reason: 'defecto', items: [{ orderItemId: lineId, quantity: 2 }] }, userId);
    let freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.stock).toBe(7); // 5 + 2 repuestas
    let freshLine = await prisma.orderItem.findUnique({ where: { id: lineId } });
    expect(freshLine?.returnedQuantity).toBe(2);
    let freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(freshOrder?.returnedAt).toBeNull(); // aun no completa

    // Intentar devolver 4 mas (solo quedan 3) -> rechazado, sin efectos.
    await expect(
      svc.registerOrderReturn(order.id, { reason: 'defecto', items: [{ orderItemId: lineId, quantity: 4 }] }, userId),
    ).rejects.toThrow(/solo quedan 3/i);
    freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.stock).toBe(7); // sin cambios por el rechazo

    // Devuelve las 3 restantes -> completa: stock original y returnedAt seteado.
    await svc.registerOrderReturn(order.id, { reason: 'defecto', items: [{ orderItemId: lineId, quantity: 3 }] }, userId);
    freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.stock).toBe(10);
    freshLine = await prisma.orderItem.findUnique({ where: { id: lineId } });
    expect(freshLine?.returnedQuantity).toBe(5);
    freshOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(freshOrder?.returnedAt).not.toBeNull();

    // Se registraron 2 devoluciones para el pedido, cada una con el responsable
    // (quien la registro) trazado.
    const returns = await prisma.orderReturn.findMany({ where: { orderId: order.id } });
    expect(returns.length).toBe(2);
    expect(returns.every((r) => r.responsibleUserId === userId)).toBe(true);
  }, 30_000);

  it('G4: no se puede devolver un pedido que no fue entregado', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido CONFIRMED (no entregado) -> devolver debe rechazarse.
    const { order } = await seedPickingOrder({ stock: 5, quantity: 5, picked: 0 });
    const svc = new OrderService();
    await expect(
      svc.registerOrderReturn(order.id, { reason: 'x', items: [{ orderItemId: order.items[0].id, quantity: 1 }] }, userId),
    ).rejects.toThrow(/entregado/i);
  }, 30_000);

  it('G3: no se puede separar mercaderia de un pedido ya cancelado', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Pedido con sesion de picking; se cancela primero (secuencial) y luego se
    // intenta separar: el guard de estado (pre-check y assertPickableUnderLock)
    // debe rechazarlo. Asi no se marca `picked` sobre un pedido terminado.
    const { order } = await seedPickingOrder({ stock: 5, quantity: 5, picked: 0 });

    const svc = new OrderService();
    await svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId);

    await expect(svc.pickAllAvailableForOrder(order.id, userId)).rejects.toThrow(/no permite|cambio de estado/i);

    const freshOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    const pickedUnits = (freshOrder?.items || []).reduce((sum, it) => sum + Number(it.picked || 0), 0);
    expect(pickedUnits).toBe(0);
    expect(['CANCELLED', 'RETURN_PENDING']).toContain(freshOrder?.status);
  }, 30_000);

  it('Responsabilidad devolucion: cancelar con separado asigna responsable y solo el/ella cierra', async (ctx) => {
    if (!dbReady) return ctx.skip();

    // Requiere el flujo de responsabilidad de devolucion activo (default true).
    // Si estuviera desactivado, no hay responsable que trazar -> se omite.
    const flowEnabled = await isReturnResponsibilityManagementEnabled();
    if (!flowEnabled) return ctx.skip();

    // Pedido CONFIRMED con mercaderia YA separada (picked=quantity). Al cancelar,
    // como hay unidades separadas, va a RETURN_PENDING y (con el flujo activo) se
    // asigna al cancelador como responsable de la devolucion, ACCEPTED.
    const { inventory, order } = await seedPickingOrder({ stock: 5, quantity: 5, picked: 5 });
    const svc = new OrderService();

    await svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId);

    let fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('RETURN_PENDING');
    expect(fresh?.returnResponsibleUserId).toBe(userId); // responsable trazado
    expect(fresh?.returnResponsibilityStatus).toBe('ACCEPTED');
    expect(fresh?.returnRequestedAt).not.toBeNull();
    expect(fresh?.returnedAt).toBeNull(); // aun no cerrada

    // Cerrar la devolucion con OTRO usuario (id inexistente basta: el guard lanza
    // antes de escribir) -> forbidden. El estado no cambia.
    await expect(
      svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId + 100000),
    ).rejects.toThrow(/responsable/i);
    fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('RETURN_PENDING');

    // Cerrar con el responsable correcto -> CANCELLED, libera reservas y marca returnedAt.
    await svc.updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId);
    fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('CANCELLED');
    expect(fresh?.returnedAt).not.toBeNull();

    const freshInv = await prisma.inventory.findUnique({ where: { id: inventory.id } });
    expect(freshInv?.reservedStock).toBe(0); // reserva liberada al cerrar
  }, 30_000);
});
