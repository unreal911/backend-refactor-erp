import { Request, Response } from "express";
import { AuthRequest } from "../auth/middleware";
import { InventoryService } from "../../modules/inventory/services/inventory.service";
import { CustomError } from "../../domain/errors/custom.error";
import { CreateInventoryMovementDto } from "../../domain/dtos/create-inventory-movement.dto";
import { CreateStockTransferDto } from "../../domain/dtos/create-stock-transfer.dto";
import { CreateReservationDto } from "../../domain/dtos/create-reservation.dto";
import { UserActivityProduct, UserActivityService } from "../services/user-activity.service";

export class InventoryController {
    constructor(
        private readonly inventoryService: InventoryService,
        private readonly userActivityService: UserActivityService = new UserActivityService(),
    ) { }

    private mapProductFromVariant(variant: any, quantity?: number): UserActivityProduct | null {
        const variantId = Number(variant?.id || variant?.variantId || 0);
        if (!Number.isInteger(variantId) || variantId < 1) {
            return null;
        }

        return {
            variantId,
            sku: variant?.sku ? String(variant.sku) : null,
            productName: variant?.product?.name ? String(variant.product.name) : null,
            color: variant?.color?.name ? String(variant.color.name) : null,
            size: variant?.size?.name ? String(variant.size.name) : null,
            quantity: Number.isFinite(Number(quantity)) ? Number(quantity) : null,
        };
    }

    private registerUserActivity(
        req: AuthRequest,
        payload: {
            module: string;
            actionType: string;
            actionLabel: string;
            entityType: string;
            entityId?: number | null;
            entityCode?: string | null;
            description?: string | null;
            products?: UserActivityProduct[];
            context?: Record<string, unknown>;
        },
    ) {
        void this.userActivityService.register({
            userId: req.user?.id ?? null,
            userEmail: req.user?.email ?? null,
            userRole: req.user?.role ?? null,
            module: payload.module,
            actionType: payload.actionType,
            actionLabel: payload.actionLabel,
            entityType: payload.entityType,
            entityId: payload.entityId ?? null,
            entityCode: payload.entityCode ?? null,
            description: payload.description ?? null,
            products: Array.isArray(payload.products) ? payload.products.filter(Boolean) : [],
            context: payload.context ?? {},
        });
    }

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }

        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    listInventories = async (req: Request, res: Response) => {
        const { skip, take, storeId, variantId, search, includeZero } = req.query;

        try {
            const options: any = {};
            if (skip !== undefined) options.skip = Number(skip);
            if (take !== undefined) options.take = Number(take);
            if (storeId !== undefined) options.storeId = Number(storeId);
            if (variantId !== undefined) options.variantId = Number(variantId);
            if (typeof search === 'string') options.search = search;
            if (includeZero !== undefined) options.includeZero = includeZero === 'true';

            const inventories = await this.inventoryService.listInventories(options);

            return res.status(200).json(inventories);
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    listMovements = async (req: Request, res: Response) => {
        const { inventoryId, transferId, reservationId } = req.query;

        try {
            const filter: any = {};
            if (inventoryId !== undefined) filter.inventoryId = Number(inventoryId);
            if (transferId !== undefined) filter.transferId = Number(transferId);
            if (reservationId !== undefined) filter.reservationId = Number(reservationId);

            const movements = await this.inventoryService.listMovements(filter);

            return res.status(200).json(movements);
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    listTransfers = async (req: Request, res: Response) => {
        try {
            const transfers = await this.inventoryService.listTransfers();
            return res.status(200).json(transfers);
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    listReservations = async (req: Request, res: Response) => {
        const { inventoryId, storeId, variantId, orderId, status } = req.query;

        try {
            const filter: any = {};
            if (inventoryId !== undefined) filter.inventoryId = Number(inventoryId);
            if (storeId !== undefined) filter.storeId = Number(storeId);
            if (variantId !== undefined) filter.variantId = Number(variantId);
            if (orderId !== undefined) filter.orderId = Number(orderId);
            if (typeof status === 'string') {
                filter.status = status.split(',').map((item) => item.trim()).filter(Boolean);
            }

            const reservations = await this.inventoryService.listReservations(filter);
            return res.status(200).json(reservations);
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    createMovement = async (req: AuthRequest, res: Response) => {
        const [error, dto] = CreateInventoryMovementDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (!dto) {
            return res.status(400).json({ message: 'Datos de movimiento inválidos' });
        }

        try {
            const result = await this.inventoryService.createMovement(dto, req.user?.id);

            this.registerUserActivity(req, {
                module: 'INVENTORY',
                actionType: 'INVENTORY_MOVEMENT_CREATED',
                actionLabel: 'Movimiento de inventario registrado',
                entityType: 'INVENTORY_MOVEMENT',
                entityId: Number(result?.movement?.id || 0) || null,
                description: `${dto.type} de ${dto.quantity} und. en tienda ${dto.storeId}`,
                products: [{
                    variantId: Number(dto.variantId),
                    quantity: Number(dto.quantity),
                }],
                context: {
                    movementType: dto.type,
                    storeId: Number(dto.storeId),
                    inventoryId: Number(result?.movement?.inventoryId || 0) || null,
                    note: dto.note ?? null,
                },
            });

            return res.status(201).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    }

    createStockTransfer = async (req: AuthRequest, res: Response) => {
        const [error, dto] = CreateStockTransferDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (!dto) {
            return res.status(400).json({ message: 'Datos de transferencia inválidos' });
        }

        try {
            const transfer = await this.inventoryService.createStockTransfer(dto, req.user?.id);

            const transferProducts = Array.isArray(transfer?.items)
                ? transfer.items
                    .map((item: any) => this.mapProductFromVariant(item?.variant, Number(item?.quantity || 0)))
                    .filter((item): item is UserActivityProduct => Boolean(item))
                : [];

            this.registerUserActivity(req, {
                module: 'TRANSFERS',
                actionType: 'TRANSFER_CREATED',
                actionLabel: 'Transferencia de stock creada',
                entityType: 'TRANSFER',
                entityId: Number(transfer?.id || 0) || null,
                entityCode: transfer?.code ? String(transfer.code) : null,
                description: `Transferencia ${transfer?.code || ''} creada de tienda ${dto.fromStoreId} a ${dto.toStoreId}`.trim(),
                products: transferProducts,
                context: {
                    fromStoreId: Number(dto.fromStoreId),
                    toStoreId: Number(dto.toStoreId),
                    itemsCount: Array.isArray(dto.items) ? dto.items.length : 0,
                    note: dto.note ?? null,
                },
            });

            return res.status(201).json(transfer);
        } catch (err) {
            return this.handleError(err, res);
        }
    }

    receiveStockTransfer = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ message: 'El ID de la transferencia debe ser un número válido' });
        }

        try {
            const result = await this.inventoryService.receiveStockTransfer(Number(id), req.user?.id);

            const transfer = result?.transfer;
            const transferProducts = Array.isArray(transfer?.items)
                ? transfer.items
                    .map((item: any) => this.mapProductFromVariant(item?.variant, Number(item?.quantity || 0)))
                    .filter((item): item is UserActivityProduct => Boolean(item))
                : [];

            this.registerUserActivity(req, {
                module: 'TRANSFERS',
                actionType: 'TRANSFER_RECEIVED',
                actionLabel: 'Transferencia recibida',
                entityType: 'TRANSFER',
                entityId: Number(transfer?.id || id) || null,
                entityCode: transfer?.code ? String(transfer.code) : null,
                description: `Transferencia ${transfer?.code || id} recibida`,
                products: transferProducts,
                context: {
                    transferId: Number(id),
                    inventoriesUpdated: Array.isArray(result?.inventories) ? result.inventories.length : 0,
                    toStoreId: Number(transfer?.toStoreId || 0) || null,
                },
            });

            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    }

    createReservation = async (req: AuthRequest, res: Response) => {
        const [error, dto] = CreateReservationDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (!dto) {
            return res.status(400).json({ message: 'Datos de reserva inválidos' });
        }

        try {
            const result = await this.inventoryService.createReservation(dto, req.user?.id);

            this.registerUserActivity(req, {
                module: 'INVENTORY',
                actionType: 'RESERVATION_CREATED',
                actionLabel: 'Reserva de stock creada',
                entityType: 'RESERVATION',
                entityId: Number(result?.reservation?.id || 0) || null,
                description: `Reserva de ${dto.quantity} und. en inventario ${dto.inventoryId}`,
                products: [{
                    variantId: Number(result?.reservation?.variantId || 0),
                    quantity: Number(dto.quantity),
                }],
                context: {
                    inventoryId: Number(dto.inventoryId),
                    orderId: dto.orderId ?? null,
                },
            });

            return res.status(201).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    }

    reconcileReservedStock = async (req: AuthRequest, res: Response) => {
        try {
            const rawInventoryIds = Array.isArray(req.body?.inventoryIds) ? req.body.inventoryIds : [];
            const inventoryIds = rawInventoryIds
                .map((value: unknown) => Number(value))
                .filter((value: number) => Number.isInteger(value) && value > 0);

            const result = await this.inventoryService.reconcileReservedStock(inventoryIds, req.user?.id);

            this.registerUserActivity(req, {
                module: 'INVENTORY',
                actionType: 'RESERVED_STOCK_RECONCILED',
                actionLabel: 'Reconciliacion de stock reservado',
                entityType: 'INVENTORY_RECONCILE',
                description: `Reconciliacion ejecutada sobre ${result.processedInventoryCount} inventarios`,
                context: {
                    adjustedCount: result.adjustedCount,
                    unchangedCount: result.unchangedCount,
                    requestedInventoryCount: result.requestedInventoryCount ?? null,
                    processedInventoryCount: result.processedInventoryCount,
                },
            });

            return res.status(200).json(result);
        } catch (error) {
            return this.handleError(error, res);
        }
    }
}
