import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Tests LIVE-DB (Postgres real, sin mocks) de INTEGRIDAD DE INVENTARIO.
// Cubren la matriz de casuisticas que rodean stock/movimientos y garantizan que
// el sistema NO genera deuda de stock ni sobreventa:
//   - InventoryService.createMovement: los 7 tipos + guards (disponible vs stock,
//     no-negativo, no-sobre-liberar) + fila de auditoria (previous/new correctos).
//   - Transferencias entre tiendas: salida descuenta disponible, entrada repone,
//     conservacion del total (out == in), doble-recepcion e insuficiencia rechazadas.
//   - createReservation atomica (+ movimiento RESERVED) y guard de sobre-reserva.
//   - reconcileReservedStock (drift -> suma de ACTIVE) y auditReservedStock
//     (detecta descuadre de ledger).
//   - Red de seguridad a nivel BD: los CHECK impiden stock<0 y reservedStock>stock.
//
// Se auto-omiten si no hay BD. Siembran un grafo aislado y limpian al final.

import { InventoryMovementType } from '@prisma/client';
import { prisma } from '../src/data/prisma';
import { InventoryService } from '../src/presentation/services/inventory.service';
import { CreateInventoryMovementDto } from '../src/domain/dtos/create-inventory-movement.dto';
import { CreateStockTransferDto } from '../src/domain/dtos/create-stock-transfer.dto';
import { CreateReservationDto } from '../src/domain/dtos/create-reservation.dto';
import { ensureInventoryIntegritySchema } from '../src/data/inventory-integrity-bootstrap';

let dbReady = false;
const uniq = Date.now();
let seq = 0;

let storeAId = 0; // origen
let storeBId = 0; // destino (transferencias)
let categoryId = 0;
let colorId = 0;
let sizeId = 0;
let userId = 0;

const createdVariantIds: number[] = [];
const createdProductIds: number[] = [];
const createdTransferIds: number[] = [];
const createdStoreIds: number[] = [];
const createdRoleIds: number[] = [];
const createdUserIds: number[] = [];

async function firstOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  const found = await find();
  return found ?? create();
}

// Crea producto+variante nuevos y opcionalmente inventario en storeA.
async function seedVariant(): Promise<number> {
  seq += 1;
  const tag = `${uniq}-${seq}`;
  const product = await prisma.product.create({ data: { name: `INV Prod ${tag}`, categoryId } });
  createdProductIds.push(product.id);
  const variant = await prisma.productVariant.create({
    data: { sku: `INV-SKU-${tag}`, price: 10, productId: product.id, colorId, sizeId },
  });
  createdVariantIds.push(variant.id);
  return variant.id;
}

async function seedInventory(storeId: number, variantId: number, stock: number, reserved = 0) {
  return prisma.inventory.create({ data: { storeId, variantId, stock, reservedStock: reserved } });
}

const svc = () => new InventoryService();
const move = (storeId: number, variantId: number, type: InventoryMovementType, quantity: number) => {
  const [err, dto] = CreateInventoryMovementDto.create({ storeId, variantId, type, quantity });
  if (err || !dto) throw new Error(`DTO invalido: ${err}`);
  return svc().createMovement(dto, userId);
};

beforeAll(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }

  await ensureInventoryIntegritySchema();

  // Dos tiendas dedicadas (transferencias necesitan origen != destino).
  const storeA = await prisma.store.create({ data: { name: `INV Store A ${uniq}`, code: `INVA-${uniq}` } });
  const storeB = await prisma.store.create({ data: { name: `INV Store B ${uniq}`, code: `INVB-${uniq}` } });
  createdStoreIds.push(storeA.id, storeB.id);
  storeAId = storeA.id;
  storeBId = storeB.id;

  const category = await firstOrCreate(
    () => prisma.category.findFirst(),
    () => prisma.category.create({ data: { name: `INV Cat ${uniq}` } }),
  );
  categoryId = category.id;
  const color = await firstOrCreate(
    () => prisma.color.findFirst(),
    () => prisma.color.create({ data: { name: `INV Color ${uniq}` } }),
  );
  colorId = color.id;
  const size = await firstOrCreate(
    () => prisma.size.findFirst(),
    () => prisma.size.create({ data: { name: `INV Size ${uniq}` } }),
  );
  sizeId = size.id;

  const existingUser = await prisma.user.findFirst();
  if (existingUser) {
    userId = existingUser.id;
  } else {
    const existingRole = await prisma.role.findFirst();
    const role = existingRole ?? await prisma.role.create({ data: { name: `INV Role ${uniq}` } });
    if (!existingRole) createdRoleIds.push(role.id);
    const user = await prisma.user.create({
      data: { firstName: 'INV', lastName: 'User', email: `inv-user-${uniq}@test.local`, password: 'x', roleId: role.id },
    });
    createdUserIds.push(user.id);
    userId = user.id;
  }
});

afterAll(async () => {
  if (dbReady) {
    // FK-safe: movimientos -> reservas -> transfer items/transfers -> inventarios ->
    // variantes -> productos -> tiendas/usuario/rol propios.
    try { await prisma.inventoryMovement.deleteMany({ where: { inventory: { variantId: { in: createdVariantIds } } } }); } catch { /* noop */ }
    try { await prisma.reservation.deleteMany({ where: { variantId: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdTransferIds.length) await prisma.stockTransferItem.deleteMany({ where: { transferId: { in: createdTransferIds } } }); } catch { /* noop */ }
    try { if (createdTransferIds.length) await prisma.stockTransfer.deleteMany({ where: { id: { in: createdTransferIds } } }); } catch { /* noop */ }
    try { await prisma.inventory.deleteMany({ where: { variantId: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdVariantIds.length) await prisma.productVariant.deleteMany({ where: { id: { in: createdVariantIds } } }); } catch { /* noop */ }
    try { if (createdProductIds.length) await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }); } catch { /* noop */ }
    try { if (createdStoreIds.length) await prisma.store.deleteMany({ where: { id: { in: createdStoreIds } } }); } catch { /* noop */ }
    try { if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }); } catch { /* noop */ }
    try { if (createdRoleIds.length) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } }); } catch { /* noop */ }
  }
  await prisma.$disconnect().catch(() => undefined);
});

describe('InventoryService.createMovement — matriz de tipos y guards', () => {
  it('IN incrementa stock y registra el movimiento con previous/new correctos', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 10);

    const { inventory, movement } = await move(storeAId, variantId, InventoryMovementType.IN, 5);

    expect(inventory.stock).toBe(15);
    expect(inventory.reservedStock).toBe(0);
    expect(inventory.availableStock).toBe(15);
    expect(movement.type).toBe('IN');
    expect(movement.quantity).toBe(5);
    expect(movement.previousStock).toBe(10);
    expect(movement.newStock).toBe(15);
  }, 30_000);

  it('IN crea el inventario si no existia', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant(); // sin inventario previo

    const { inventory } = await move(storeAId, variantId, InventoryMovementType.IN, 7);
    expect(inventory.stock).toBe(7);
  }, 30_000);

  it('OUT descuenta stock; DISPONIBLE (stock - reservado) es la cota, no el stock', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 5, 3); // disponible = 2

    // Pedir 3 (>disponible 2) se rechaza aunque stock fisico sea 5.
    await expect(move(storeAId, variantId, InventoryMovementType.OUT, 3)).rejects.toThrow(/insuficiente/i);
    let inv = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    expect(inv?.stock).toBe(5); // sin cambios tras el rechazo

    // Pedir 2 (==disponible) pasa.
    const { inventory } = await move(storeAId, variantId, InventoryMovementType.OUT, 2);
    expect(inventory.stock).toBe(3);
    expect(inventory.reservedStock).toBe(3);
    expect(inventory.availableStock).toBe(0);
  }, 30_000);

  it('ADJUSTMENT suma o resta; no puede dejar stock negativo', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 4);

    // Ajuste negativo valido: 4 - 3 = 1.
    const dec = CreateInventoryMovementDto.create({ storeId: storeAId, variantId, type: InventoryMovementType.ADJUSTMENT, quantity: -3 });
    const { inventory } = await svc().createMovement(dec[1]!, userId);
    expect(inventory.stock).toBe(1);

    // Ajuste negativo que dejaria negativo: rechazado.
    const bad = CreateInventoryMovementDto.create({ storeId: storeAId, variantId, type: InventoryMovementType.ADJUSTMENT, quantity: -5 });
    await expect(svc().createMovement(bad[1]!, userId)).rejects.toThrow(/negativo/i);
    const inv = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    expect(inv?.stock).toBe(1);
  }, 30_000);

  it('RESERVED incrementa reservado hasta el disponible; UNRESERVED lo libera sin pasarse', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 6);

    // Reservar mas del disponible se rechaza.
    await expect(move(storeAId, variantId, InventoryMovementType.RESERVED, 7)).rejects.toThrow(/disponible/i);

    const r = await move(storeAId, variantId, InventoryMovementType.RESERVED, 4);
    expect(r.inventory.reservedStock).toBe(4);
    expect(r.inventory.availableStock).toBe(2);

    // Liberar mas de lo reservado se rechaza.
    await expect(move(storeAId, variantId, InventoryMovementType.UNRESERVED, 5)).rejects.toThrow(/reservado/i);

    const u = await move(storeAId, variantId, InventoryMovementType.UNRESERVED, 4);
    expect(u.inventory.reservedStock).toBe(0);
    expect(u.inventory.availableStock).toBe(6);
  }, 30_000);
});

describe('Transferencias entre tiendas — sin deuda de stock', () => {
  it('salida descuenta el disponible del origen y emite TRANSFER_OUT (estado PENDING)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 10, 2); // disponible = 8

    const [, dto] = CreateStockTransferDto.create({
      fromStoreId: storeAId, toStoreId: storeBId, items: [{ variantId, quantity: 6 }],
    });
    const transfer = await svc().createStockTransfer(dto!, userId);
    createdTransferIds.push(transfer!.id);
    expect(transfer!.status).toBe('PENDING');

    const src = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    expect(src?.stock).toBe(4); // 10 - 6
    expect(src?.reservedStock).toBe(2); // reservado intacto

    const movements = await prisma.inventoryMovement.findMany({ where: { transferId: transfer!.id, type: 'TRANSFER_OUT' } });
    expect(movements.length).toBe(1);
    expect(movements[0].quantity).toBe(6);
    expect(movements[0].previousStock).toBe(10);
    expect(movements[0].newStock).toBe(4);
  }, 30_000);

  it('rechaza transferir mas que el disponible del origen (reservado cuenta) sin efectos', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 5, 4); // disponible = 1

    const [, dto] = CreateStockTransferDto.create({
      fromStoreId: storeAId, toStoreId: storeBId, items: [{ variantId, quantity: 2 }],
    });
    await expect(svc().createStockTransfer(dto!, userId)).rejects.toThrow(/insuficiente/i);

    const src = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    expect(src?.stock).toBe(5); // rollback total: nada se movio
  }, 30_000);

  it('recepcion repone en destino y el total sale igual (conservacion, no genera deuda)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    await seedInventory(storeAId, variantId, 10);
    const totalAntes = 10; // solo existe en A

    const [, dto] = CreateStockTransferDto.create({
      fromStoreId: storeAId, toStoreId: storeBId, items: [{ variantId, quantity: 6 }],
    });
    const transfer = await svc().createStockTransfer(dto!, userId);
    createdTransferIds.push(transfer!.id);

    const received = await svc().receiveStockTransfer(transfer!.id, userId);
    expect(received.transfer!.status).toBe('RECEIVED');

    const src = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeAId, variantId } } });
    const dst = await prisma.inventory.findUnique({ where: { storeId_variantId: { storeId: storeBId, variantId } } });
    expect(src?.stock).toBe(4);
    expect(dst?.stock).toBe(6); // inventario destino creado por la recepcion
    // Invariante: el total de unidades se conserva end-to-end.
    expect(Number(src?.stock) + Number(dst?.stock)).toBe(totalAntes);

    const inMov = await prisma.inventoryMovement.findMany({ where: { transferId: transfer!.id, type: 'TRANSFER_IN' } });
    expect(inMov.length).toBe(1);
    expect(inMov[0].newStock).toBe(6);

    // Doble recepcion rechazada.
    await expect(svc().receiveStockTransfer(transfer!.id, userId)).rejects.toThrow(/ya fue recibida/i);
  }, 30_000);
});

describe('Reservas de inventario (InventoryService.createReservation)', () => {
  it('reserva atomica: sube reservado, crea movimiento RESERVED y cuadra el ledger', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 8);

    const [, dto] = CreateReservationDto.create({ inventoryId: inv.id, quantity: 3 });
    const { reservation, inventory } = await svc().createReservation(dto!, userId);

    expect(reservation.status).toBe('ACTIVE');
    expect(inventory.reservedStock).toBe(3);
    expect(inventory.availableStock).toBe(5);

    const mov = await prisma.inventoryMovement.findMany({ where: { reservationId: reservation.id } });
    expect(mov.some((m) => m.type === 'RESERVED' && m.quantity === 3)).toBe(true);

    // Ledger consistente: reservedStock == suma ACTIVE.
    const agg = await prisma.reservation.aggregate({ where: { inventoryId: inv.id, status: 'ACTIVE' }, _sum: { quantity: true } });
    expect(Number(agg._sum.quantity || 0)).toBe(3);
  }, 30_000);

  it('rechaza reservar mas que el disponible (sin sobre-reserva)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 4, 2); // disponible = 2

    const [, dto] = CreateReservationDto.create({ inventoryId: inv.id, quantity: 3 });
    await expect(svc().createReservation(dto!, userId)).rejects.toThrow(/disponible/i);

    const fresh = await prisma.inventory.findUnique({ where: { id: inv.id } });
    expect(fresh?.reservedStock).toBe(2); // sin cambios
  }, 30_000);

  it('dos reservas concurrentes sobre el mismo inventario NO sobre-reservan', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 5); // disponible = 5, demanda 4+4

    const [, a] = CreateReservationDto.create({ inventoryId: inv.id, quantity: 4 });
    const [, b] = CreateReservationDto.create({ inventoryId: inv.id, quantity: 4 });
    const results = await Promise.allSettled([
      svc().createReservation(a!, userId),
      svc().createReservation(b!, userId),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1); // solo una cabe (4), la otra falla por disponible
    const fresh = await prisma.inventory.findUnique({ where: { id: inv.id } });
    expect(fresh!.reservedStock).toBeLessThanOrEqual(fresh!.stock);
    expect(fresh?.reservedStock).toBe(4);

    const audit = await svc().auditReservedStock();
    expect(audit.items.some((i) => i.inventoryId === inv.id)).toBe(false);
  }, 30_000);
});

describe('Reconciliacion y auditoria de reservados', () => {
  it('reconcile ajusta reservedStock al total de reservas ACTIVE y registra el movimiento', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 10, 0);
    // Reserva real de 3, pero reservedStock quedo en 0 (drift simulado).
    await prisma.reservation.create({ data: { quantity: 3, status: 'ACTIVE', inventoryId: inv.id, variantId, } });

    const before = await svc().auditReservedStock();
    expect(before.items.some((i) => i.inventoryId === inv.id && i.problems.includes('DESCUADRE_LEDGER'))).toBe(true);

    const res = await svc().reconcileReservedStock([inv.id], userId);
    expect(res.adjustedCount).toBe(1);
    const fresh = await prisma.inventory.findUnique({ where: { id: inv.id } });
    expect(fresh?.reservedStock).toBe(3);

    // Tras reconciliar, la auditoria ya no reporta este inventario.
    const after = await svc().auditReservedStock();
    expect(after.items.some((i) => i.inventoryId === inv.id)).toBe(false);
  }, 30_000);
});

describe('Red de seguridad a nivel BD (CHECK constraints)', () => {
  it('la BD rechaza dejar stock negativo', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 2);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Inventory" SET "stock" = -1 WHERE "id" = ${inv.id}`),
    ).rejects.toThrow();
  }, 30_000);

  it('la BD rechaza reservedStock mayor que stock (sobre-reserva)', async (ctx) => {
    if (!dbReady) return ctx.skip();
    const variantId = await seedVariant();
    const inv = await seedInventory(storeAId, variantId, 3);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "Inventory" SET "reservedStock" = 4 WHERE "id" = ${inv.id}`),
    ).rejects.toThrow();
  }, 30_000);
});
