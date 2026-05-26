import { prisma } from "../../data/prisma";
import { CustomError } from "../../domain/errors/custom.error";
import { CreateInventoryMovementDto } from "../../domain/dtos/create-inventory-movement.dto";
import { CreateStockTransferDto } from "../../domain/dtos/create-stock-transfer.dto";
import { CreateReservationDto } from "../../domain/dtos/create-reservation.dto";
import { InventoryMovementType, TransferStatus } from "@prisma/client";

interface InventoryListOptions {
    skip?: number;
    take?: number;
    storeId?: number;
    variantId?: number;
    search?: string;
    includeZero?: boolean;
}

interface MovementFilter {
    inventoryId?: number;
    transferId?: number;
    reservationId?: number;
}

interface ReservationFilter {
    inventoryId?: number;
    storeId?: number;
    variantId?: number;
    orderId?: number;
    status?: string[];
}

interface ReconcileReservedStockResultItem {
    inventoryId: number;
    storeId: number;
    storeName: string;
    variantId: number;
    sku: string;
    previousReservedStock: number;
    targetReservedStock: number;
    difference: number;
    reconciled: boolean;
}

export class InventoryService {
    constructor() { }

    async listInventories(options: InventoryListOptions) {
        const where: any = {};

        if (options.storeId) {
            where.storeId = options.storeId;
        }
        if (options.variantId) {
            where.variantId = options.variantId;
        }
        if (options.search) {
            where.AND = [
                {
                    OR: [
                        { variant: { sku: { contains: options.search, mode: 'insensitive' } } },
                        { variant: { barcode: { contains: options.search, mode: 'insensitive' } } },
                        { variant: { product: { name: { contains: options.search, mode: 'insensitive' } } } },
                        { store: { name: { contains: options.search, mode: 'insensitive' } } },
                    ],
                },
            ];
        }
        if (options.includeZero === false) {
            where.stock = { gt: 0 };
        }

        const findManyArgs: any = {
            where,
            include: {
                store: true,
                variant: {
                    include: {
                        product: true,
                        color: true,
                        size: true,
                    },
                },
            },
            orderBy: { id: 'asc' },
        };

        const page = typeof options.skip === 'number' && Number.isFinite(options.skip) && options.skip > 0
            ? Math.floor(options.skip)
            : undefined;
        const take = typeof options.take === 'number' && Number.isFinite(options.take) && options.take > 0
            ? Math.floor(options.take)
            : undefined;

        if (typeof take === 'number') {
            findManyArgs.take = take;
            findManyArgs.skip = typeof page === 'number' ? (page - 1) * take : 0;
        } else if (typeof page === 'number') {
            findManyArgs.skip = Math.max(0, page - 1);
        }

        const inventories = await prisma.inventory.findMany(findManyArgs);

        return inventories.map((inventory) => ({
            ...inventory,
            availableStock: inventory.stock - inventory.reservedStock,
        }));
    }

    async listMovements(filter: MovementFilter) {
        const where: any = {};
        if (typeof filter.inventoryId === 'number') {
            where.inventoryId = filter.inventoryId;
        }
        if (typeof filter.transferId === 'number') {
            where.transferId = filter.transferId;
        }
        if (typeof filter.reservationId === 'number') {
            where.reservationId = filter.reservationId;
        }

        const movements = await prisma.inventoryMovement.findMany({
            where,
            include: {
                inventory: {
                    include: {
                        store: true,
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
                responsibleUser: true,
                transfer: true,
                reservation: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return movements;
    }

    async listTransfers() {
        return prisma.stockTransfer.findMany({
            include: {
                fromStore: true,
                toStore: true,
                createdBy: true,
                receivedBy: true,
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    async listReservations(filter: ReservationFilter = {}) {
        const where: any = {};

        if (typeof filter.inventoryId === 'number') {
            where.inventoryId = filter.inventoryId;
        }
        if (typeof filter.variantId === 'number') {
            where.variantId = filter.variantId;
        }
        if (typeof filter.orderId === 'number') {
            where.orderId = filter.orderId;
        }
        if (Array.isArray(filter.status) && filter.status.length > 0) {
            where.status = { in: filter.status };
        }
        if (typeof filter.storeId === 'number') {
            where.inventory = { storeId: filter.storeId };
        }

        return prisma.reservation.findMany({
            where,
            include: {
                inventory: {
                    include: {
                        store: true,
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
                reservedBy: true,
                order: {
                    select: {
                        id: true,
                        code: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        sourceStoreId: true,
                        fulfillmentStoreId: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    private async validateStore(storeId: number) {
        const store = await prisma.store.findUnique({ where: { id: storeId } });
        if (!store) {
            throw CustomError.badRequest(`La tienda con ID ${storeId} no existe`);
        }
    }

    private async validateVariant(variantId: number) {
        const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
        if (!variant) {
            throw CustomError.badRequest(`La variante con ID ${variantId} no existe`);
        }
    }

    private async findInventory(storeId: number, variantId: number) {
        return prisma.inventory.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    }

    private async createInventory(storeId: number, variantId: number) {
        return prisma.inventory.create({
            data: {
                storeId,
                variantId,
                stock: 0,
                reservedStock: 0,
            },
        });
    }

    async createMovement(dto: CreateInventoryMovementDto, userId?: number | undefined) {
        await this.validateStore(dto.storeId);
        await this.validateVariant(dto.variantId);

        let inventory = await this.findInventory(dto.storeId, dto.variantId);

        if (!inventory && dto.type === InventoryMovementType.IN || !inventory && dto.type === InventoryMovementType.TRANSFER_IN) {
            inventory = await this.createInventory(dto.storeId, dto.variantId);
        }

        if (!inventory) {
            throw CustomError.badRequest('Inventario no encontrado para la operación solicitada');
        }

        const stockBefore = inventory.stock;
        const reservedBefore = inventory.reservedStock;
        let stockAfter = stockBefore;
        let reservedAfter = reservedBefore;

        switch (dto.type) {
            case InventoryMovementType.IN:
                stockAfter += dto.quantity;
                break;
            case InventoryMovementType.OUT:
                if (stockBefore - reservedBefore < dto.quantity) {
                    throw CustomError.badRequest('Stock insuficiente para la salida');
                }
                stockAfter -= dto.quantity;
                break;
            case InventoryMovementType.ADJUSTMENT:
                stockAfter += dto.quantity;
                if (stockAfter < 0) {
                    throw CustomError.badRequest('El ajuste no puede dejar stock negativo');
                }
                break;
            case InventoryMovementType.TRANSFER_OUT:
                if (stockBefore - reservedBefore < dto.quantity) {
                    throw CustomError.badRequest('Stock insuficiente para la transferencia de salida');
                }
                stockAfter -= dto.quantity;
                break;
            case InventoryMovementType.TRANSFER_IN:
                stockAfter += dto.quantity;
                break;
            case InventoryMovementType.RESERVED:
                if (stockBefore - reservedBefore < dto.quantity) {
                    throw CustomError.badRequest('No hay suficiente stock disponible para reservar');
                }
                reservedAfter += dto.quantity;
                break;
            case InventoryMovementType.UNRESERVED:
                if (reservedBefore < dto.quantity) {
                    throw CustomError.badRequest('No hay suficiente stock reservado para liberar');
                }
                reservedAfter -= dto.quantity;
                break;
            default:
                throw CustomError.badRequest('Tipo de movimiento no válido');
        }

        const [updatedInventory, movement] = await prisma.$transaction([
            prisma.inventory.update({
                where: { id: inventory.id },
                data: {
                    stock: stockAfter,
                    reservedStock: reservedAfter,
                },
            }),
            prisma.inventoryMovement.create({
                data: {
                    type: dto.type,
                    quantity: dto.quantity,
                    previousStock: stockBefore,
                    newStock: stockAfter,
                    note: dto.note ?? null,
                    responsibleUserId: userId ?? null,
                    inventoryId: inventory.id,
                    transferId: dto.transferId ?? null,
                    reservationId: dto.reservationId ?? null,
                },
            }),
        ]);

        return {
            inventory: { ...updatedInventory, availableStock: updatedInventory.stock - updatedInventory.reservedStock },
            movement,
        };
    }

    async createStockTransfer(dto: CreateStockTransferDto, userId?: number | undefined) {
        if (dto.fromStoreId === dto.toStoreId) {
            throw CustomError.badRequest('La tienda de origen y destino no pueden ser la misma');
        }

        await this.validateStore(dto.fromStoreId);
        await this.validateStore(dto.toStoreId);

        for (const item of dto.items) {
            await this.validateVariant(item.variantId);
        }

        const transferCode = `TR-${Date.now()}`;

        const transfer = await prisma.$transaction(async (tx) => {
            const createdTransfer = await tx.stockTransfer.create({
                data: {
                    code: transferCode,
                    status: TransferStatus.PENDING,
                    note: dto.note ?? null,
                    createdById: userId ?? null,
                    fromStoreId: dto.fromStoreId,
                    toStoreId: dto.toStoreId,
                    items: {
                        create: dto.items.map((item) => ({
                            variantId: item.variantId,
                            quantity: item.quantity,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });

            for (const item of dto.items) {
                const inventory = await tx.inventory.findUnique({
                    where: { storeId_variantId: { storeId: dto.fromStoreId, variantId: item.variantId } },
                });

                if (!inventory) {
                    throw CustomError.badRequest(`No existe inventario para la variante ${item.variantId} en la tienda de origen`);
                }

                const availableStock = inventory.stock - inventory.reservedStock;
                if (availableStock < item.quantity) {
                    throw CustomError.badRequest(`Stock insuficiente para la variante ${item.variantId} en la tienda de origen`);
                }

                const updatedInventory = await tx.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        stock: { decrement: item.quantity },
                    },
                });

                await tx.inventoryMovement.create({
                    data: {
                        type: InventoryMovementType.TRANSFER_OUT,
                        quantity: item.quantity,
                        previousStock: inventory.stock,
                        newStock: updatedInventory.stock,
                        note: dto.note ?? null,
                        responsibleUserId: userId ?? null,
                        inventoryId: inventory.id,
                        transferId: createdTransfer.id,
                    },
                });
            }

            return createdTransfer;
        });

        return prisma.stockTransfer.findUnique({
            where: { id: transfer.id },
            include: {
                fromStore: true,
                toStore: true,
                createdBy: true,
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
        });
    }

    async receiveStockTransfer(transferId: number, userId?: number | undefined) {
        const transfer = await prisma.stockTransfer.findUnique({
            where: { id: transferId },
            include: { items: true },
        });

        if (!transfer) {
            throw CustomError.notFound('La transferencia no existe');
        }
        if (transfer.status === TransferStatus.RECEIVED) {
            throw CustomError.badRequest('La transferencia ya fue recibida');
        }

        const receivedTransfer = await prisma.$transaction(async (tx) => {
            const updatedTransfer = await tx.stockTransfer.update({
                where: { id: transferId },
                data: {
                    status: TransferStatus.RECEIVED,
                    receivedById: userId ?? null,
                },
            });

            const inventories = [] as Array<any>;
            for (const item of transfer.items) {
                const existingInventory = await tx.inventory.findUnique({
                    where: { storeId_variantId: { storeId: transfer.toStoreId, variantId: item.variantId } },
                });

                const previousStock = existingInventory ? existingInventory.stock : 0;
                const inventory = existingInventory
                    ? await tx.inventory.update({
                        where: { id: existingInventory.id },
                        data: { stock: { increment: item.quantity } },
                    })
                    : await tx.inventory.create({
                        data: {
                            storeId: transfer.toStoreId,
                            variantId: item.variantId,
                            stock: item.quantity,
                            reservedStock: 0,
                        },
                    });

                inventories.push(inventory);

                await tx.inventoryMovement.create({
                    data: {
                        type: InventoryMovementType.TRANSFER_IN,
                        quantity: item.quantity,
                        previousStock,
                        newStock: inventory.stock,
                        note: transfer.note ?? null,
                        responsibleUserId: userId ?? null,
                        inventoryId: inventory.id,
                        transferId: updatedTransfer.id,
                    },
                });
            }

            return {
                transfer: updatedTransfer,
                inventories,
            };
        });

        const transferWithDetails = await prisma.stockTransfer.findUnique({
            where: { id: transferId },
            include: {
                fromStore: true,
                toStore: true,
                createdBy: true,
                receivedBy: true,
                items: {
                    include: {
                        variant: {
                            include: {
                                product: true,
                                color: true,
                                size: true,
                            },
                        },
                    },
                },
            },
        });

        return {
            transfer: transferWithDetails,
            inventories: receivedTransfer.inventories,
        };
    }

    async createReservation(dto: CreateReservationDto, userId?: number | undefined) {
        const inventory = await prisma.inventory.findUnique({ where: { id: dto.inventoryId } });

        if (!inventory) {
            throw CustomError.badRequest('El inventario especificado no existe');
        }

        const availableStock = inventory.stock - inventory.reservedStock;
        if (availableStock < dto.quantity) {
            throw CustomError.badRequest('No hay suficiente stock disponible para reservar');
        }

        const result = await prisma.$transaction(async (tx) => {
            const updatedInventory = await tx.inventory.update({
                where: { id: inventory.id },
                data: { reservedStock: { increment: dto.quantity } },
            });

            const reservation = await tx.reservation.create({
                data: {
                    quantity: dto.quantity,
                    status: dto.orderId ? 'ACTIVE' : 'ACTIVE',
                    inventoryId: inventory.id,
                    variantId: inventory.variantId,
                    orderId: dto.orderId ?? null,
                    reservedById: userId ?? null,
                },
            });

            await tx.inventoryMovement.create({
                data: {
                    type: InventoryMovementType.RESERVED,
                    quantity: dto.quantity,
                    previousStock: inventory.stock,
                    newStock: updatedInventory.stock,
                    note: dto.orderId ? `Reserva para orden ${dto.orderId}` : null,
                    responsibleUserId: userId ?? null,
                    inventoryId: inventory.id,
                    reservationId: reservation.id,
                },
            });

            return {
                reservation,
                inventory: { ...updatedInventory, availableStock: updatedInventory.stock - updatedInventory.reservedStock },
            };
        });

        return result;
    }

    async reconcileReservedStock(inventoryIds: number[] = [], userId?: number | undefined) {
        const normalizedIds = Array.from(
            new Set(
                (Array.isArray(inventoryIds) ? inventoryIds : [])
                    .map((value) => Number(value))
                    .filter((value) => Number.isInteger(value) && value > 0)
            ).values()
        );

        const where: any = normalizedIds.length > 0
            ? { id: { in: normalizedIds } }
            : {};

        const result = await prisma.$transaction(async (tx) => {
            const inventories = await tx.inventory.findMany({
                where,
                include: {
                    store: true,
                    variant: true,
                },
                orderBy: { id: 'asc' },
            });

            if (inventories.length === 0) {
                return {
                    adjustedCount: 0,
                    unchangedCount: 0,
                    items: [] as ReconcileReservedStockResultItem[],
                };
            }

            const groupedReservations = await tx.reservation.groupBy({
                by: ['inventoryId'],
                where: {
                    status: 'ACTIVE',
                    inventoryId: {
                        in: inventories.map((inventory) => inventory.id),
                    },
                },
                _sum: {
                    quantity: true,
                },
            });

            const activeReservedByInventory = new Map<number, number>();
            groupedReservations.forEach((group) => {
                activeReservedByInventory.set(
                    Number(group.inventoryId),
                    Number(group._sum.quantity ?? 0),
                );
            });

            const items: ReconcileReservedStockResultItem[] = [];
            let adjustedCount = 0;
            let unchangedCount = 0;

            for (const inventory of inventories) {
                const previousReservedStock = Number(inventory.reservedStock || 0);
                const targetReservedStock = Number(activeReservedByInventory.get(inventory.id) ?? 0);
                const difference = targetReservedStock - previousReservedStock;
                const reconciled = difference !== 0;

                if (reconciled) {
                    adjustedCount += 1;
                    await tx.inventory.update({
                        where: { id: inventory.id },
                        data: { reservedStock: targetReservedStock },
                    });

                    await tx.inventoryMovement.create({
                        data: {
                            type: difference > 0 ? InventoryMovementType.RESERVED : InventoryMovementType.UNRESERVED,
                            quantity: Math.abs(difference),
                            previousStock: inventory.stock,
                            newStock: inventory.stock,
                            note: `Reconciliacion automatica de reservados (${previousReservedStock} -> ${targetReservedStock})`,
                            responsibleUserId: userId ?? null,
                            inventoryId: inventory.id,
                        },
                    });
                } else {
                    unchangedCount += 1;
                }

                items.push({
                    inventoryId: inventory.id,
                    storeId: inventory.storeId,
                    storeName: inventory.store.name,
                    variantId: inventory.variantId,
                    sku: inventory.variant.sku,
                    previousReservedStock,
                    targetReservedStock,
                    difference,
                    reconciled,
                });
            }

            return {
                adjustedCount,
                unchangedCount,
                items,
            };
        });

        return {
            ...result,
            requestedInventoryCount: normalizedIds.length > 0 ? normalizedIds.length : undefined,
            processedInventoryCount: result.items.length,
        };
    }
}
