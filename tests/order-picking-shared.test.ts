import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests LIVE-DB del FLUJO DE RESPONSABILIDAD DE PICKING COMPARTIDO (2 usuarios).
// Activa el flag `picking_responsibility_flow_enabled` y prueba la matriz de
// autorizacion cuando dos usuarios operan el mismo pedido:
//   - solo el responsable principal puede separar; un tercero es rechazado.
//   - delegar SHARED habilita a un segundo responsable; TRANSFER mueve el principal.
//   - solicitar + APROBAR concede responsabilidad; RECHAZAR no.
//   - un responsable solo puede RESTAR unidades separadas por el (trazabilidad).
//   - dos separaciones concurrentes de la misma linea NO exceden lo pedido
//     (sin deuda de stock / sobre-separacion).
//
// Se auto-omite si no hay BD. Restaura el valor original del flag al terminar.

import { Prisma } from '@prisma/client';
import { prisma } from '../src/data/prisma';
import { OrderService } from '../src/presentation/services/order.service';
import { DelegatePickingResponsibilityDto } from '../src/domain/dtos/delegate-picking-responsibility.dto';
import { RequestPickingResponsibilityDto } from '../src/domain/dtos/request-picking-responsibility.dto';
import { ResolvePickingResponsibilityRequestDto } from '../src/domain/dtos/resolve-picking-responsibility-request.dto';
import { RequestPickingUnpickActionDto } from '../src/domain/dtos/request-picking-unpick-action.dto';
import { ResolvePickingUnpickActionDto } from '../src/domain/dtos/resolve-picking-unpick-action.dto';
import { PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY } from '../src/data/system-config-keys';
import { ensurePickingResponsibilitySchema } from '../src/data/picking-responsibility-bootstrap';

let dbReady = false;
const uniq = Date.now();
let seq = 0;

let storeId = 0;
let categoryId = 0;
let colorId = 0;
let sizeId = 0;
let userAId = 0; // responsable principal
let userBId = 0; // segundo usuario
let previousFlag: string | null = null;

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

async function setFlag(value: string) {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "SystemSetting" ("key", "value")
      VALUES (${PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY}, ${value})
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
    `,
  );
}

// Pedido CONFIRMED con reserva ACTIVE, sesion de picking IN_PROGRESS y pickerUserId
// = principal. Sin separar aun (picked=0). Base para los tests de responsabilidad.
async function seedPickingOrder(primaryUserId: number, quantity: number) {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({ data: { name: `PS Prod ${tag}`, categoryId } });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `PS-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  const inventory = await prisma.inventory.create({
    data: { storeId, variantId: variant.id, stock: quantity, reservedStock: quantity },
  });
  const order = await prisma.order.create({
    data: {
      code: `PS-ORD-${tag}`,
      status: 'CONFIRMED',
      sourceStoreId: storeId,
      fulfillmentStoreId: storeId,
      sellerUserId: primaryUserId,
      pickerUserId: primaryUserId,
      items: {
        create: [{
          variantId: variant.id,
          quantity,
          reserved: quantity,
          picked: 0,
          unitPrice: 10,
          subtotal: quantity * 10,
          status: 'PENDING',
        }],
      },
    },
    include: { items: true },
  });
  createdOrderIds.push(order.id);
  await prisma.reservation.create({
    data: {
      quantity, status: 'ACTIVE', inventoryId: inventory.id,
      variantId: variant.id, orderId: order.id, orderItemId: order.items[0].id,
    },
  });
  const session = await prisma.pickingSession.create({
    data: {
      orderId: order.id, status: 'IN_PROGRESS', assignedUserId: primaryUserId,
      items: { create: [{ variantId: variant.id, quantity, pickedQuantity: 0 }] },
    },
  });
  createdPickingSessionIds.push(session.id);
  return { order, itemId: order.items[0].id };
}

const pickedOf = async (itemId: number) =>
  Number((await prisma.orderItem.findUnique({ where: { id: itemId } }))?.picked || 0);

const pendingRequestId = async (orderId: number): Promise<number> => {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT "id" FROM "PickingResponsibilityRequest" WHERE "orderId" = ${orderId} AND "status" = 'PENDING' ORDER BY "id" DESC LIMIT 1`,
  );
  return Number(rows?.[0]?.id || 0);
};

const pickingItemIdOf = async (orderId: number): Promise<number> =>
  Number((await prisma.pickingItem.findFirst({ where: { session: { orderId } } }))?.id || 0);

const pendingUnpickId = async (orderId: number): Promise<number> => {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT "id" FROM "PickingUnpickRequest" WHERE "orderId" = ${orderId} AND "status" = 'PENDING' ORDER BY "id" DESC LIMIT 1`,
  );
  return Number(rows?.[0]?.id || 0);
};

// Via CORRECTA para volver a B responsable COMPARTIDO (sin mover el principal):
// B solicita SHARED y A la aprueba. (delegatePickingResponsibility con mode SHARED
// no sirve: hoy transfiere el principal — ver test de caracterizacion.)
async function grantSharedToB(svc: OrderService, orderId: number) {
  const [, reqDto] = RequestPickingResponsibilityDto.create({ mode: 'SHARED' });
  await svc.requestPickingResponsibility(orderId, reqDto!, userBId);
  const [, apprDto] = ResolvePickingResponsibilityRequestDto.create({ action: 'APPROVE' });
  await svc.resolvePickingResponsibilityRequest(orderId, await pendingRequestId(orderId), apprDto!, userAId);
}

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  await ensurePickingResponsibilitySchema();

  // Guarda el valor actual del flag y lo activa para estos tests.
  const rows = await prisma.$queryRaw<Array<{ value: string }>>(
    Prisma.sql`SELECT "value" FROM "SystemSetting" WHERE "key" = ${PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY} LIMIT 1`,
  );
  previousFlag = rows?.[0]?.value ?? null;
  await setFlag('true');

  const store = await firstOrCreate(
    () => prisma.store.findFirst(),
    () => prisma.store.create({ data: { name: `PS Store ${uniq}`, code: `PSST-${uniq}` } }),
  );
  storeId = store.id;
  const category = await firstOrCreate(() => prisma.category.findFirst(), () => prisma.category.create({ data: { name: `PS Cat ${uniq}` } }));
  categoryId = category.id;
  const color = await firstOrCreate(() => prisma.color.findFirst(), () => prisma.color.create({ data: { name: `PS Color ${uniq}` } }));
  colorId = color.id;
  const size = await firstOrCreate(() => prisma.size.findFirst(), () => prisma.size.create({ data: { name: `PS Size ${uniq}` } }));
  sizeId = size.id;

  // Dos usuarios dedicados y distintos (principal vs segundo).
  const existingRole = await prisma.role.findFirst();
  const role = existingRole ?? await prisma.role.create({ data: { name: `PS Role ${uniq}` } });
  if (!existingRole) createdRoleIds.push(role.id);
  const userA = await prisma.user.create({ data: { firstName: 'PS', lastName: 'Primary', email: `ps-a-${uniq}@test.local`, password: 'x', roleId: role.id } });
  const userB = await prisma.user.create({ data: { firstName: 'PS', lastName: 'Second', email: `ps-b-${uniq}@test.local`, password: 'x', roleId: role.id } });
  createdUserIds.push(userA.id, userB.id);
  userAId = userA.id;
  userBId = userB.id;
});

afterAll(async () => {
  if (dbReady) {
    // Restaura el flag original (o lo borra si no existia).
    try {
      if (previousFlag === null) {
        await prisma.$executeRaw(Prisma.sql`DELETE FROM "SystemSetting" WHERE "key" = ${PICKING_RESPONSIBILITY_FLOW_ENABLED_KEY}`);
      } else {
        await setFlag(previousFlag);
      }
    } catch { /* noop */ }

    // FK-safe. Las tablas raw de responsabilidad son ON DELETE CASCADE a Order,
    // pero se limpian explicitamente por si acaso.
    try { if (createdOrderIds.length) await prisma.$executeRawUnsafe(`DELETE FROM "PickingItemContribution" WHERE "orderId" = ANY($1::int[])`, createdOrderIds); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.$executeRawUnsafe(`DELETE FROM "PickingResponsibilityRequest" WHERE "orderId" = ANY($1::int[])`, createdOrderIds); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.$executeRawUnsafe(`DELETE FROM "PickingSharedResponsibility" WHERE "orderId" = ANY($1::int[])`, createdOrderIds); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.$executeRawUnsafe(`DELETE FROM "PickingOrderItemDetail" WHERE "orderId" = ANY($1::int[])`, createdOrderIds); } catch { /* noop */ }
    try { if (createdPickingSessionIds.length) await prisma.pickingItem.deleteMany({ where: { sessionId: { in: createdPickingSessionIds } } }); } catch { /* noop */ }
    try { if (createdOrderIds.length) await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } }); } catch { /* noop */ }
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

describe('Picking compartido: autorizacion basica', () => {
  it('el responsable principal puede separar', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await new OrderService().updatePickingOrderItem(order.id, itemId, 3, userAId);
    expect(await pickedOf(itemId)).toBe(3);
  }, 30_000);

  it('un usuario SIN responsabilidad es rechazado (no separa nada)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await expect(
      new OrderService().updatePickingOrderItem(order.id, itemId, 1, userBId),
    ).rejects.toThrow(/responsabilidad/i);
    expect(await pickedOf(itemId)).toBe(0);
  }, 30_000);
});

describe('Picking compartido: delegacion', () => {
  // Regresion: delegar con mode:'SHARED' COMPARTE (agrega a B como responsable)
  // sin mover el principal. Antes fallaba: normalizePickingResponsibilityMode con
  // fallback 'TRANSFER' devolvia TRANSFER para 'SHARED'; ahora reconoce el literal.
  it('delegar con mode SHARED comparte: B habilitado y A sigue principal', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);

    const [, dto] = DelegatePickingResponsibilityDto.create({ userId: userBId, mode: 'SHARED' });
    await svc.delegatePickingResponsibility(order.id, dto!, userAId);

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.pickerUserId).toBe(userAId); // A sigue siendo el principal

    // B (compartido por delegacion) puede separar.
    await svc.updatePickingOrderItem(order.id, itemId, 2, userBId);
    expect(await pickedOf(itemId)).toBe(2);
  }, 30_000);

  it('TRANSFER mueve el responsable principal; el anterior pierde el acceso', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);

    const [, dto] = DelegatePickingResponsibilityDto.create({ userId: userBId, mode: 'TRANSFER' });
    await svc.delegatePickingResponsibility(order.id, dto!, userAId);

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.pickerUserId).toBe(userBId);

    // El nuevo principal (B) separa.
    await svc.updatePickingOrderItem(order.id, itemId, 1, userBId);
    expect(await pickedOf(itemId)).toBe(1);

    // A ya no es principal ni compartido -> rechazado.
    await expect(svc.updatePickingOrderItem(order.id, itemId, 2, userAId)).rejects.toThrow(/responsabilidad/i);
  }, 30_000);
});

describe('Picking compartido: solicitud y resolucion', () => {
  it('aprobar la solicitud agrega a B como compartido y mantiene a A como principal', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);

    await grantSharedToB(svc, order.id);

    const fresh = await prisma.order.findUnique({ where: { id: order.id } });
    expect(fresh?.pickerUserId).toBe(userAId); // A sigue siendo el principal

    // Ambos responsables pueden separar la misma linea.
    await svc.updatePickingOrderItem(order.id, itemId, 2, userBId); // B (compartido)
    await svc.updatePickingOrderItem(order.id, itemId, 3, userAId); // A (principal)
    expect(await pickedOf(itemId)).toBe(3);
  }, 30_000);

  it('RECHAZAR la solicitud deja al usuario sin acceso; APROBAR se lo concede', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);

    // B solicita responsabilidad compartida; A la RECHAZA.
    const [, reqDto] = RequestPickingResponsibilityDto.create({ mode: 'SHARED' });
    await svc.requestPickingResponsibility(order.id, reqDto!, userBId);
    const [, rejDto] = ResolvePickingResponsibilityRequestDto.create({ action: 'REJECT' });
    await svc.resolvePickingResponsibilityRequest(order.id, await pendingRequestId(order.id), rejDto!, userAId);
    await expect(svc.updatePickingOrderItem(order.id, itemId, 1, userBId)).rejects.toThrow(/responsabilidad/i);

    // B vuelve a solicitar; A la APRUEBA -> ahora B puede separar.
    await svc.requestPickingResponsibility(order.id, reqDto!, userBId);
    const [, apprDto] = ResolvePickingResponsibilityRequestDto.create({ action: 'APPROVE' });
    await svc.resolvePickingResponsibilityRequest(order.id, await pendingRequestId(order.id), apprDto!, userAId);
    await svc.updatePickingOrderItem(order.id, itemId, 2, userBId);
    expect(await pickedOf(itemId)).toBe(2);
  }, 30_000);
});

describe('Picking compartido: trazabilidad al restar y concurrencia', () => {
  it('un responsable solo puede restar las unidades que separo el mismo', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await grantSharedToB(svc, order.id);

    await svc.updatePickingOrderItem(order.id, itemId, 3, userAId); // A separa 3
    await svc.updatePickingOrderItem(order.id, itemId, 5, userBId); // B separa +2 (total 5)
    expect(await pickedOf(itemId)).toBe(5);

    // B intenta bajar a 2 (quitar 3, pero solo separo 2) -> rechazado.
    await expect(svc.updatePickingOrderItem(order.id, itemId, 2, userBId)).rejects.toThrow(/restar unidades separadas por ti/i);
    expect(await pickedOf(itemId)).toBe(5);

    // B baja a 3 (quita sus propias 2) -> permitido.
    await svc.updatePickingOrderItem(order.id, itemId, 3, userBId);
    expect(await pickedOf(itemId)).toBe(3);
  }, 30_000);

  it('dos separaciones concurrentes de la misma linea NO exceden lo pedido', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await grantSharedToB(svc, order.id);

    // Ambos intentan separar el total (5) a la vez. El cap [0, rowLimit] impide
    // que se acumule 10: el pedido nunca queda con mas separado que su cantidad.
    await Promise.allSettled([
      svc.updatePickingOrderItem(order.id, itemId, 5, userAId),
      svc.updatePickingOrderItem(order.id, itemId, 5, userBId),
    ]);

    const picked = await pickedOf(itemId);
    expect(picked).toBe(5);
    expect(picked).toBeLessThanOrEqual(5);
  }, 30_000);
});

describe('Picking compartido: solicitud de unpick (retirar unidades de otro)', () => {
  // Escenario base: A separa 3, B (compartido) separa +2 (total 5). B quiere
  // retirar unidades separadas por A -> debe SOLICITARLO (no puede restarlas solo).
  async function seedMixedPicking(svc: OrderService) {
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await grantSharedToB(svc, order.id);
    await svc.updatePickingOrderItem(order.id, itemId, 3, userAId); // A contribuye 3
    await svc.updatePickingOrderItem(order.id, itemId, 5, userBId); // B contribuye 2
    return { order, itemId, pickingItemId: await pickingItemIdOf(order.id) };
  }

  it('solicitar + APROBAR retira las unidades de otro y baja el separado', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId, pickingItemId } = await seedMixedPicking(svc);

    // B solicita retirar 3 (las de A). maxRequestable = 5 - contribucionB(2) = 3.
    const [, reqDto] = RequestPickingUnpickActionDto.create({ quantity: 3 });
    await svc.requestPickingUnpickAction(order.id, pickingItemId, reqDto!, userBId);

    // A (principal) aprueba -> retira 3 -> separado baja a 2.
    const [, apprDto] = ResolvePickingUnpickActionDto.create({ action: 'APPROVE' });
    await svc.resolvePickingUnpickAction(order.id, await pendingUnpickId(order.id), apprDto!, userAId);
    expect(await pickedOf(itemId)).toBe(2);
  }, 30_000);

  it('RECHAZAR la solicitud deja el separado intacto', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId, pickingItemId } = await seedMixedPicking(svc);

    const [, reqDto] = RequestPickingUnpickActionDto.create({ quantity: 3 });
    await svc.requestPickingUnpickAction(order.id, pickingItemId, reqDto!, userBId);

    const [, rejDto] = ResolvePickingUnpickActionDto.create({ action: 'REJECT' });
    await svc.resolvePickingUnpickAction(order.id, await pendingUnpickId(order.id), rejDto!, userAId);
    expect(await pickedOf(itemId)).toBe(5); // sin cambios
  }, 30_000);

  it('no se puede resolver la propia solicitud', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, pickingItemId } = await seedMixedPicking(svc);

    const [, reqDto] = RequestPickingUnpickActionDto.create({ quantity: 3 });
    await svc.requestPickingUnpickAction(order.id, pickingItemId, reqDto!, userBId);

    const [, apprDto] = ResolvePickingUnpickActionDto.create({ action: 'APPROVE' });
    await expect(
      svc.resolvePickingUnpickAction(order.id, await pendingUnpickId(order.id), apprDto!, userBId),
    ).rejects.toThrow(/tu propia solicitud/i);
  }, 30_000);

  it('no hay solicitud si el item solo tiene unidades propias', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const svc = new OrderService();
    const { order, itemId } = await seedPickingOrder(userAId, 5);
    await svc.updatePickingOrderItem(order.id, itemId, 3, userAId); // solo A separo
    const pickingItemId = await pickingItemIdOf(order.id);

    const [, reqDto] = RequestPickingUnpickActionDto.create({ quantity: 1 });
    await expect(
      svc.requestPickingUnpickAction(order.id, pickingItemId, reqDto!, userAId),
    ).rejects.toThrow(/solo hay unidades separadas por ti/i);
  }, 30_000);
});
