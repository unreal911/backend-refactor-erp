import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests LIVE-DB de reserveAllRecommendedForOrder: reserva masiva por tienda
// recomendada (mayor disponibilidad primero). Verifica que:
//   - reserva completo lo pendiente cuando hay stock (y fija fulfillment).
//   - con stock insuficiente reserva solo lo disponible (sin sobre-reserva).
//   - divide una linea entre varias tiendas (split) priorizando disponibilidad.
//   - rechaza pedidos cerrados/en devolucion.
//   - deja el ledger consistente (auditoria limpia) y es idempotente al re-correr.

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';
import { InventoryService } from '../src/presentation/services/inventory.service';

let dbReady = false;
const uniq = Date.now();
let seq = 0;

let storeAId = 0;
let storeBId = 0;
let categoryId = 0;
let colorId = 0;
let sizeId = 0;
let userId = 0;

const createdOrderIds: number[] = [];
const createdVariantIds: number[] = [];
const createdProductIds: number[] = [];
const createdStoreIds: number[] = [];
const createdUserIds: number[] = [];
const createdRoleIds: number[] = [];

async function firstOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const found = await find();
  return found ?? create();
}

async function seedVariant(): Promise<number> {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({ data: { name: `RA Prod ${tag}`, categoryId } });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `RA-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  return variant.id;
}

const seedInv = (storeId: number, variantId: number, stock: number, reserved = 0) =>
  prisma.inventory.create({ data: { storeId, variantId, stock, reservedStock: reserved } });

async function seedOrder(status: string, items: Array<{ variantId: number; quantity: number }>) {
  seq += 1;
  const order = await prisma.order.create({
    data: {
      code: `RA-ORD-${uniq}-${seq}`,
      status: status as any,
      sourceStoreId: storeAId,
      sellerUserId: userId,
      items: {
        create: items.map((it) => ({
          variantId: it.variantId, quantity: it.quantity, reserved: 0, picked: 0,
          unitPrice: 10, subtotal: it.quantity * 10, status: 'PENDING',
        })),
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  return order;
}

const itemReserved = async (itemId: number) =>
  Number((await prisma.orderItem.findUnique({ where: { id: itemId } }))?.reserved || 0);
const invReserved = async (storeId: number, variantId: number) =>
  Number((await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId, variantId } } }))?.reservedStock || 0);

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  const storeA = await prisma.store.create({ data: { name: `RA Store A ${uniq}`, code: `RAA-${uniq}`, isActive: true } });
  const storeB = await prisma.store.create({ data: { name: `RA Store B ${uniq}`, code: `RAB-${uniq}`, isActive: true } });
  createdStoreIds.push(storeA.id, storeB.id);
  storeAId = storeA.id;
  storeBId = storeB.id;

  const category = await firstOrCreate(() => prisma.category.findFirst(), () => prisma.category.create({ data: { name: `RA Cat ${uniq}` } }));
  categoryId = category.id;
  const color = await firstOrCreate(() => prisma.color.findFirst(), () => prisma.color.create({ data: { name: `RA Color ${uniq}` } }));
  colorId = color.id;
  const size = await firstOrCreate(() => prisma.size.findFirst(), () => prisma.size.create({ data: { name: `RA Size ${uniq}` } }));
  sizeId = size.id;

  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const existingRole = await prisma.role.findFirst();
    const role = existingRole ?? await prisma.role.create({ data: { name: `RA Role ${uniq}` } });
    if (!existingRole) createdRoleIds.push(role.id);
    const user = await prisma.user.create({ data: { firstName: 'RA', lastName: 'User', email: `ra-user-${uniq}@test.local`, password: 'x', roleId: role.id } });
    createdUserIds.push(user.id);
    userId = user.id;
  }
});

afterAll(async () => {
  if (dbReady) {
    try { await prisma.inventoryMovement.deleteMany({ where: { inventory: { variantId: { in: createdVariantIds } } } }); } catch { /* noop */ }
    try { await prisma.reservation.deleteMany({ where: { variantId: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } }); } catch { /* noop */ }
    try { await prisma.inventory.deleteMany({ where: { variantId: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdVariantIds.length) await prisma.productVariant.deleteMany({ where: { id: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdProductIds.length) await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }); } catch { /* noop */ }
    try { if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); } catch { /* noop */ }
    try { if (createdRoleIds.length) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } }); } catch { /* noop */ }
    try { if (createdStoreIds.length) await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } }); } catch { /* noop */ }
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe('reserveAllRecommendedForOrder', () => {
  it('reserva todo lo pendiente cuando hay stock y fija el fulfillment', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInv(storeAId, variantId, 10);
    const order = await seedOrder('CONFIRMED', [{ variantId, quantity: 5 }]);

    const res = await new OrderService().reserveAllRecommendedForOrder(order.id, userId);
    expect(res.reservedUnits).toBe(5);
    expect(res.reservedLines).toBe(1);
    expect(await itemReserved(order.items[0].id)).toBe(5);
    expect(await invReserved(storeAId, variantId)).toBe(5);

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.fulfillmentStoreId).toBe(storeAId);

    // Re-correr no vuelve a reservar (idempotente: ya no hay pendiente).
    const again = await new OrderService().reserveAllRecommendedForOrder(order.id, userId);
    expect(again.reservedUnits).toBe(0);
    expect(await invReserved(storeAId, variantId)).toBe(5);
  }, 30_000);

  it('con stock insuficiente reserva solo lo disponible (sin sobre-reserva)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInv(storeAId, variantId, 3);
    const order = await seedOrder('CONFIRMED', [{ variantId, quantity: 5 }]);

    const res = await new OrderService().reserveAllRecommendedForOrder(order.id, userId);
    expect(res.reservedUnits).toBe(3);
    expect(await itemReserved(order.items[0].id)).toBe(3);
    const inv = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    expect(inv!.reservedStock).toBe(3);
    expect(inv!.reservedStock).toBeLessThanOrEqual(inv!.stock);
  }, 30_000);

  it('divide una linea entre tiendas priorizando la de mayor disponibilidad', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInv(storeAId, variantId, 2);
    await seedInv(storeBId, variantId, 4); // mayor disponibilidad -> primero
    const order = await seedOrder('CONFIRMED', [{ variantId, quantity: 5 }]);

    const res = await new OrderService().reserveAllRecommendedForOrder(order.id, userId);
    expect(res.reservedUnits).toBe(5);
    expect(await itemReserved(order.items[0].id)).toBe(5);
    // B (4 disponibles) se consume entero, A cubre la restante (1).
    expect(await invReserved(storeBId, variantId)).toBe(4);
    expect(await invReserved(storeAId, variantId)).toBe(1);
  }, 30_000);

  it('rechaza reservar para un pedido cerrado', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInv(storeAId, variantId, 10);
    const order = await seedOrder('CANCELLED', [{ variantId, quantity: 5 }]);

    await expect(
      new OrderService().reserveAllRecommendedForOrder(order.id, userId),
    ).rejects.toThrow(/cerrado o en devolucion/i);
    expect(await invReserved(storeAId, variantId)).toBe(0);
  }, 30_000);

  it('deja el ledger consistente (auditoria limpia)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInv(storeAId, variantId, 8);
    const order = await seedOrder('CONFIRMED', [{ variantId, quantity: 6 }]);

    await new OrderService().reserveAllRecommendedForOrder(order.id, userId);

    const agg = await prisma.reservation.aggregate({ where: { inventoryId: inv.id, status: 'ACTIVE' }, _sum: { quantity: true } });
    expect(Number(agg._sum.quantity || 0)).toBe(6);
    const audit = await new InventoryService().auditReservedStock();
    expect(audit.items.some((i) => i.inventoryId === inv.id)).toBe(false);
  }, 30_000);
});
