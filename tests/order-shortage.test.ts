import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests LIVE-DB de markOrderItemShortage (marcar/limpiar faltante en proforma
// ecommerce): faltante capado al pendiente (quantity - reserved), transicion del
// pedido a WAITING_STOCK y de vuelta a PENDING al limpiar, y guards (solo
// ecommerce, no con picking iniciado).

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';

let dbReady = false;
const uniq = Date.now();
let seq = 0;

let storeId = 0;
let categoryId = 0;
let colorId = 0;
let sizeId = 0;
let userId = 0;

const createdOrderIds: number[] = [];
const createdVariantIds: number[] = [];
const createdProductIds: number[] = [];
const createdPickingSessionIds: number[] = [];
const createdStoreIds: number[] = [];
const createdUserIds: number[] = [];
const createdRoleIds: number[] = [];

async function firstOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const found = await find();
  return found ?? create();
}

// Pedido ECOMMERCE (code MK-) con una linea quantity/reserved dados.
async function seedEcommerceOrder(opts: { status?: string; quantity: number; reserved: number; withPicking?: boolean }) {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({ data: { name: `SH Prod ${tag}`, categoryId } });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `SH-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  const order = await prisma.order.create({
    data: {
      code: `MK-${tag}`, // MK- => ECOMMERCE
      status: (opts.status ?? 'CONFIRMED') as any,
      sourceStoreId: storeId,
      sellerUserId: userId,
      items: {
        create: [{
          variantId: variant.id, quantity: opts.quantity, reserved: opts.reserved, picked: 0,
          unitPrice: 10, subtotal: opts.quantity * 10, status: 'PENDING',
        }],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  if (opts.withPicking) {
    const session = await prisma.pickingSession.create({
      data: { orderId: order.id, status: 'IN_PROGRESS', assignedUserId: userId },
    });
    createdPickingSessionIds.push(session.id);
  }
  return { order, itemId: order.items[0].id };
}

const readItem = async (itemId: number) => prisma.orderItem.findUnique({ where: { id: itemId } });
const readOrder = async (orderId: number) => prisma.order.findUnique({ where: { id: orderId } });

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  const store = await firstOrCreate(() => prisma.store.findFirst(), () => prisma.store.create({ data: { name: `SH Store ${uniq}`, code: `SHST-${uniq}` } }));
  storeId = store.id;
  const category = await firstOrCreate(() => prisma.category.findFirst(), () => prisma.category.create({ data: { name: `SH Cat ${uniq}` } }));
  categoryId = category.id;
  const color = await firstOrCreate(() => prisma.color.findFirst(), () => prisma.color.create({ data: { name: `SH Color ${uniq}` } }));
  colorId = color.id;
  const size = await firstOrCreate(() => prisma.size.findFirst(), () => prisma.size.create({ data: { name: `SH Size ${uniq}` } }));
  sizeId = size.id;

  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const existingRole = await prisma.role.findFirst();
    const role = existingRole ?? await prisma.role.create({ data: { name: `SH Role ${uniq}` } });
    if (!existingRole) createdRoleIds.push(role.id);
    const user = await prisma.user.create({ data: { firstName: 'SH', lastName: 'User', email: `sh-user-${uniq}@test.local`, password: 'x', roleId: role.id } });
    createdUserIds.push(user.id);
    userId = user.id;
  }
});

afterAll(async () => {
  if (dbReady) {
    try { if (createdPickingSessionIds.length) await prisma.pickingSession.deleteMany({ where: { id: { in: createdPickingSessionIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }); } catch { /* noop */ }
    try { if (createdVariantIds.length) await prisma.productVariant.deleteMany({ where: { id: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdProductIds.length) await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }); } catch { /* noop */ }
    try { if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); } catch { /* noop */ }
    try { if (createdRoleIds.length) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } }); } catch { /* noop */ }
    try { if (createdStoreIds.length) await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } }); } catch { /* noop */ }
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe('markOrderItemShortage', () => {
  it('marca faltante del pendiente y pasa el pedido a WAITING_STOCK', async (ctx) => {
    if (!dbReady) return ctx.skip();
    // quantity 5, reserved 2 -> pendiente 3.
    const { order, itemId } = await seedEcommerceOrder({ quantity: 5, reserved: 2 });

    const res = await new OrderService().markOrderItemShortage(order.id, itemId, 3, userId);
    expect(res.shortageQuantity).toBe(3);

    const item = await readItem(itemId);
    expect(item?.shortageQuantity).toBe(3);
    expect(item?.status).toBe('MISSING');
    expect((await readOrder(order.id))?.status).toBe('WAITING_STOCK');
  }, 30_000);

  it('capa el faltante al pendiente (no puede exceder quantity - reserved)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const { order, itemId } = await seedEcommerceOrder({ quantity: 5, reserved: 2 });

    // Pide 10 pero solo 3 estan pendientes.
    const res = await new OrderService().markOrderItemShortage(order.id, itemId, 10, userId);
    expect(res.shortageQuantity).toBe(3);
    expect((await readItem(itemId))?.shortageQuantity).toBe(3);
  }, 30_000);

  it('limpiar el faltante (0) devuelve el pedido a PENDING', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const { order, itemId } = await seedEcommerceOrder({ quantity: 5, reserved: 2 });
    const svc = new OrderService();

    await svc.markOrderItemShortage(order.id, itemId, 3, userId); // -> WAITING_STOCK
    expect((await readOrder(order.id))?.status).toBe('WAITING_STOCK');

    await svc.markOrderItemShortage(order.id, itemId, 0, userId); // limpia
    const item = await readItem(itemId);
    expect(item?.shortageQuantity).toBe(0);
    expect((await readOrder(order.id))?.status).toBe('PENDING');
  }, 30_000);

  it('rechaza marcar faltante en un pedido que no es ecommerce', async (ctx) => {
    if (!dbReady) return ctx.skip();
    // code sin MK- ni note ecommerce -> INTERNAL.
    seq += 1;
    const product = await prisma.product.create({ data: { name: `SH Prod int ${uniq}-${seq}`, categoryId } });
    createdProductIds.push(product.id);
    const variant = await prisma.productVariant.create({ data: { sku: `SH-INT-${uniq}-${seq}`, price: 10, productId: product.id, colorId, sizeId } });
    createdVariantIds.push(variant.id);
    const order = await prisma.order.create({
      data: {
        code: `INT-${uniq}-${seq}`, status: 'CONFIRMED', sourceStoreId: storeId, sellerUserId: userId,
        items: { create: [{ variantId: variant.id, quantity: 5, reserved: 0, picked: 0, unitPrice: 10, subtotal: 50, status: 'PENDING' }] },
      },
      include: { items: true },
    });
    createdOrderIds.push(order.id);

    await expect(
      new OrderService().markOrderItemShortage(order.id, order.items[0].id, 2, userId),
    ).rejects.toThrow(/ecommerce/i);
  }, 30_000);

  it('rechaza marcar faltante con el picking ya iniciado', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const { order, itemId } = await seedEcommerceOrder({ quantity: 5, reserved: 2, withPicking: true });

    await expect(
      new OrderService().markOrderItemShortage(order.id, itemId, 2, userId),
    ).rejects.toThrow(/picking ya iniciado/i);
  }, 30_000);
});
