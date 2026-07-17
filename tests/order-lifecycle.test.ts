import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests LIVE-DB del CICLO DE VIDA del pedido:
//   - Matriz de transiciones de estado: las validas avanzan; las invalidas
//     (saltos, retrocesos, estados finales) se rechazan sin efectos.
//   - Idempotencia de createOrder: reintentar con la misma idempotencyKey
//     devuelve el mismo pedido y NO vuelve a consumir stock (sin deuda).
//
// Se auto-omite si no hay BD. Siembra un grafo aislado y limpia al final.

import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';
import { CreateOrderDto } from '../src/domain/dtos/create-order.dto';

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
const createdStoreIds: number[] = [];
const createdUserIds: number[] = [];
const createdRoleIds: number[] = [];

async function firstOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const found = await find();
  return found ?? create();
}

// Pedido minimo en el estado indicado (sin items: basta para validar transiciones,
// que se chequean antes de la transaccion).
async function seedOrder(status: string) {
  seq += 1;
  const order = await prisma.order.create({
    data: { code: `LC-${uniq}-${seq}`, status: status as any, sourceStoreId: storeId, sellerUserId: userId },
  });
  createdOrderIds.push(order.id);
  return order;
}

async function seedVariantWithStock(stock: number) {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({ data: { name: `LC Prod ${tag}`, categoryId } });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `LC-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  await prisma.inventory.create({ data: { storeId, variantId: variant.id, stock, reservedStock: 0 } });
  return variant.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  const store = await firstOrCreate(() => prisma.store.findFirst(), () => prisma.store.create({ data: { name: `LC Store ${uniq}`, code: `LCST-${uniq}` } }));
  storeId = store.id;
  const category = await firstOrCreate(() => prisma.category.findFirst(), () => prisma.category.create({ data: { name: `LC Cat ${uniq}` } }));
  categoryId = category.id;
  const color = await firstOrCreate(() => prisma.color.findFirst(), () => prisma.color.create({ data: { name: `LC Color ${uniq}` } }));
  colorId = color.id;
  const size = await firstOrCreate(() => prisma.size.findFirst(), () => prisma.size.create({ data: { name: `LC Size ${uniq}` } }));
  sizeId = size.id;

  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const existingRole = await prisma.role.findFirst();
    const role = existingRole ?? await prisma.role.create({ data: { name: `LC Role ${uniq}` } });
    if (!existingRole) createdRoleIds.push(role.id);
    const user = await prisma.user.create({ data: { firstName: 'LC', lastName: 'User', email: `lc-user-${uniq}@test.local`, password: 'x', roleId: role.id } });
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

describe('Ciclo de vida: transiciones invalidas rechazadas sin efectos', () => {
  const svc = () => new OrderService();
  // [estadoActual, objetivoIlegal]
  const illegal: Array<[string, string]> = [
    ['PENDING', 'READY'],        // salto
    ['PENDING', 'DELIVERED'],    // salto
    ['CONFIRMED', 'DELIVERED'],  // salto (falta PREPARING/READY)
    ['READY', 'PENDING'],        // retroceso
    ['DELIVERED', 'CANCELLED'],  // estado final
    ['DELIVERED', 'RETURN_PENDING'], // estado final
    ['CANCELLED', 'CONFIRMED'],  // estado final
  ];

  for (const [from, to] of illegal) {
    it(`${from} -> ${to} se rechaza`, async (ctx) => {
      if (!dbReady) return ctx.skip();
      const order = await seedOrder(from);
      await expect(
        svc().updateOrderStatus(order.id, { status: to } as any, userId),
      ).rejects.toThrow(/no se puede cambiar/i);
      const fresh = await prisma.order.findUnique({ where: { id: order.id } });
      expect(fresh?.status).toBe(from); // no cambio
    }, 30_000);
  }
});

describe('Ciclo de vida: transiciones validas avanzan', () => {
  it('PENDING -> WAITING_STOCK', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const order = await seedOrder('PENDING');
    await new OrderService().updateOrderStatus(order.id, { status: 'WAITING_STOCK' } as any, userId);
    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('WAITING_STOCK');
  }, 30_000);

  it('PENDING -> CANCELLED (sin unidades separadas cierra directo)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const order = await seedOrder('PENDING');
    await new OrderService().updateOrderStatus(order.id, { status: 'CANCELLED' } as any, userId);
    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('CANCELLED');
  }, 30_000);
});

describe('Idempotencia de createOrder', () => {
  it('reintentar con la misma idempotencyKey devuelve el mismo pedido sin consumir stock 2 veces', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariantWithStock(10);
    const [err, dto] = CreateOrderDto.create({
      sourceStoreId: storeId,
      sellerUserId: userId,
      note: 'Metodo de pago: Efectivo | Ref: LC-IDEMPO',
      idempotencyKey: `LC-IDEMPO-${uniq}`,
      items: [{ variantId, quantity: 3, unitPrice: 10 }],
    });
    expect(err).toBeUndefined();

    const svc = new OrderService();
    const first: any = await svc.createOrder(dto!);
    createdOrderIds.push(first.id);
    const invAfterFirst = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    expect(invAfterFirst?.stock).toBe(7); // 10 - 3 (venta local se atiende directo)

    // Replay: mismo DTO/clave -> devuelve el MISMO pedido, sin volver a descontar.
    const second: any = await svc.createOrder(dto!);
    expect(second.id).toBe(first.id);
    const invAfterSecond = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    expect(invAfterSecond?.stock).toBe(7); // sin doble consumo
  }, 30_000);
});
