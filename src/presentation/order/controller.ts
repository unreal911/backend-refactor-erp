import { Request, Response } from 'express';
import { OrderService } from '../../modules/orders/services/order.service';
import { CreateOrderDto } from '../../domain/dtos/create-order.dto';
import { UpdateOrderStatusDto } from '../../domain/dtos/update-order-status.dto';
import { ListOrderDto } from '../../domain/dtos/list-order.dto';
import { AssignOrderResponsibleDto } from '../../domain/dtos/assign-order-responsible.dto';
import { UpdateOrderPickingDto } from '../../domain/dtos/update-order-picking.dto';
import { DelegateOrderReturnDto } from '../../domain/dtos/delegate-order-return.dto';
import { DelegatePickingResponsibilityDto } from '../../domain/dtos/delegate-picking-responsibility.dto';
import { RequestPickingResponsibilityDto } from '../../domain/dtos/request-picking-responsibility.dto';
import { ResolvePickingResponsibilityRequestDto } from '../../domain/dtos/resolve-picking-responsibility-request.dto';
import { RequestPickingUnpickActionDto } from '../../domain/dtos/request-picking-unpick-action.dto';
import { ResolvePickingUnpickActionDto } from '../../domain/dtos/resolve-picking-unpick-action.dto';
import { CustomError } from '../../domain/errors/custom.error';
import { AuthRequest } from '../auth/middleware';
import { AdminEventBus, AdminEventType } from '../admin-events/admin-event-bus';
import { UserActivityProduct, UserActivityService } from '../services/user-activity.service';

export class OrderController {
    constructor(
        private readonly orderService: OrderService,
        private readonly userActivityService: UserActivityService = new UserActivityService(),
    ) {}

    private detectSalesChannel(note: unknown): 'POS' | 'ECOMMERCE' | 'INTERNAL' {
        const text = String(note || '').toUpperCase();
        if (text.includes('POS-') || text.includes('METODO DE PAGO')) {
            return 'POS';
        }
        if (text.includes('ECOMMERCE')) {
            return 'ECOMMERCE';
        }
        return 'INTERNAL';
    }

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

    private mapProductsFromOrderItems(items: any[]): UserActivityProduct[] {
        if (!Array.isArray(items)) {
            return [];
        }

        return items
            .map((item: any) => this.mapProductFromVariant(
                item?.variant || { id: item?.variantId },
                Number(item?.quantity ?? item?.pickedQuantity ?? item?.picked ?? 0),
            ))
            .filter((item): item is UserActivityProduct => Boolean(item));
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

    private publishOrderEvent(
        type: AdminEventType,
        orderLike: any,
        actorUserId?: number | null,
        targetUserId?: number | null,
    ) {
        AdminEventBus.publish({
            type,
            entity: 'ORDER',
            entityId: Number(orderLike?.id || orderLike?.orderId || 0) || null,
            entityCode: orderLike?.code
                ? String(orderLike.code)
                : orderLike?.orderCode
                    ? String(orderLike.orderCode)
                    : null,
            status: orderLike?.status
                ? String(orderLike.status)
                : orderLike?.orderStatus
                    ? String(orderLike.orderStatus)
                    : null,
            actorUserId: Number(actorUserId || 0) || null,
            targetUserId: Number(targetUserId || 0) || null,
        });
    }

    /**
     * Crear pedido
     * POST /api/orders
     */
    createOrder = async (req: AuthRequest, res: Response) => {
        const [error, dto] = CreateOrderDto.create(req.body);

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const order = await this.orderService.createOrder(dto!);
            const salesChannel = this.detectSalesChannel(order?.note ?? dto?.note ?? null);

            this.registerUserActivity(req, {
                module: salesChannel === 'POS' ? 'POS' : 'ORDERS',
                actionType: salesChannel === 'POS' ? 'POS_ORDER_CREATED' : 'ORDER_CREATED',
                actionLabel: salesChannel === 'POS' ? 'Venta POS registrada' : 'Orden creada',
                entityType: 'ORDER',
                entityId: Number(order?.id || 0) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: salesChannel === 'POS'
                    ? `Venta POS ${order?.code || ''} registrada`
                    : `Orden ${order?.code || ''} creada`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    salesChannel,
                    status: order?.status || null,
                    sourceStoreId: Number(order?.sourceStoreId || dto?.sourceStoreId || 0) || null,
                    fulfillmentStoreId: Number(order?.fulfillmentStoreId || dto?.fulfillmentStoreId || 0) || null,
                    total: Number(order?.total || 0),
                },
            });
            this.publishOrderEvent('ORDER_CREATED', order, req.user?.id);

            res.status(201).json({
                success: true,
                data: order,
                message: 'Pedido creado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Listar pedidos
     * GET /api/orders
     */
    listOrders = async (req: Request, res: Response) => {
        const [error, dto] = ListOrderDto.create(req.query);

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const result = await this.orderService.listOrders(dto!);
            res.status(200).json({
                success: true,
                data: result.data,
                pagination: result.pagination,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Obtener pedido por ID
     * GET /api/orders/:id
     */
    getOrderById = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        try {
            const order = await this.orderService.getOrderById(Number(id));
            res.status(200).json({
                success: true,
                data: order,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Actualizar estado del pedido
     * PATCH /api/orders/:id/status
     */
    updateOrderStatus = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const [error, dto] = UpdateOrderStatusDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const order = await this.orderService.updateOrderStatus(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'ORDERS',
                actionType: 'ORDER_STATUS_UPDATED',
                actionLabel: 'Estado de orden actualizado',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Orden ${order?.code || id} actualizada a estado ${dto?.status}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    targetStatus: dto?.status,
                    resultingStatus: order?.status || null,
                    note: dto?.note ?? null,
                },
            });
            this.publishOrderEvent('ORDER_STATUS_UPDATED', order, req.user?.id);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Estado del pedido actualizado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Asignar responsable a pedido
     * PATCH /api/orders/:id/assign
     */
    assignResponsible = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const [error, dto] = AssignOrderResponsibleDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const order = await this.orderService.assignResponsible(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'ORDERS',
                actionType: 'ORDER_RESPONSIBLE_ASSIGNED',
                actionLabel: 'Responsable asignado en orden',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Responsable ${dto?.roleType} asignado a orden ${order?.code || id}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    roleType: dto?.roleType,
                    assignedUserId: Number(dto?.userId || 0) || null,
                },
            });
            this.publishOrderEvent('ORDER_RESPONSIBLE_ASSIGNED', order, req.user?.id, dto?.userId);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Responsable asignado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Solicitar responsabilidad en picking
     * POST /api/orders/:id/picking/responsibility/request
     */
    requestPickingResponsibility = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const [error, dto] = RequestPickingResponsibilityDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const picking = await this.orderService.requestPickingResponsibility(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_RESPONSIBILITY_REQUESTED',
                actionLabel: 'Solicitud de responsabilidad en picking',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Solicitud de responsabilidad ${dto?.mode} enviada en orden ${picking?.orderCode || id}`,
                context: {
                    mode: dto?.mode || null,
                    note: dto?.note || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: 'Solicitud enviada',
            });
        } catch (serviceError) {
            if (serviceError instanceof CustomError) {
                return res.status(serviceError.statusCode).json({ error: serviceError.message });
            }
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Delegar responsabilidad en picking
     * PATCH /api/orders/:id/picking/responsibility/delegate
     */
    delegatePickingResponsibility = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const [error, dto] = DelegatePickingResponsibilityDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const picking = await this.orderService.delegatePickingResponsibility(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: dto?.mode === 'SHARED' ? 'PICKING_RESPONSIBILITY_SHARED' : 'PICKING_RESPONSIBILITY_TRANSFERRED',
                actionLabel: dto?.mode === 'SHARED' ? 'Responsabilidad de picking compartida' : 'Responsabilidad de picking transferida',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Responsabilidad ${dto?.mode} delegada en orden ${picking?.orderCode || id}`,
                context: {
                    delegatedToUserId: Number(dto?.userId || 0) || null,
                    mode: dto?.mode || null,
                    note: dto?.note || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id, dto?.userId);

            res.status(200).json({
                success: true,
                data: picking,
                message: dto?.mode === 'SHARED'
                    ? 'Responsabilidad compartida asignada'
                    : 'Responsabilidad principal transferida',
            });
        } catch (serviceError) {
            if (serviceError instanceof CustomError) {
                return res.status(serviceError.statusCode).json({ error: serviceError.message });
            }
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Resolver solicitud de responsabilidad en picking
     * PATCH /api/orders/:id/picking/responsibility/requests/:requestId
     */
    resolvePickingResponsibilityRequest = async (req: AuthRequest, res: Response) => {
        const { id, requestId } = req.params;
        const [error, dto] = ResolvePickingResponsibilityRequestDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (!requestId || isNaN(Number(requestId))) {
            return res.status(400).json({ error: 'requestId invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const picking = await this.orderService.resolvePickingResponsibilityRequest(
                Number(id),
                Number(requestId),
                dto!,
                req.user?.id,
            );

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: dto?.action === 'APPROVE'
                    ? 'PICKING_RESPONSIBILITY_REQUEST_APPROVED'
                    : 'PICKING_RESPONSIBILITY_REQUEST_REJECTED',
                actionLabel: dto?.action === 'APPROVE'
                    ? 'Solicitud de responsabilidad aprobada'
                    : 'Solicitud de responsabilidad rechazada',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Solicitud ${requestId} ${dto?.action === 'APPROVE' ? 'aprobada' : 'rechazada'} en orden ${picking?.orderCode || id}`,
                context: {
                    requestId: Number(requestId),
                    action: dto?.action || null,
                    note: dto?.note || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: dto?.action === 'APPROVE'
                    ? 'Solicitud aprobada'
                    : 'Solicitud rechazada',
            });
        } catch (serviceError) {
            if (serviceError instanceof CustomError) {
                return res.status(serviceError.statusCode).json({ error: serviceError.message });
            }
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Obtener stock remoto
     * GET /api/orders/remote-stock/:variantId
     */
    getVariantStock = async (req: Request, res: Response) => {
        const { storeId, variantIds } = req.query;

        if (!storeId || isNaN(Number(storeId)) || !variantIds || typeof variantIds !== 'string') {
            return res.status(400).json({ error: 'Parámetros inválidos' });
        }

        const variantIdsArray = variantIds
            .split(',')
            .map((id) => Number(id.trim()))
            .filter((id) => !isNaN(id) && id > 0);

        if (variantIdsArray.length === 0) {
            return res.status(400).json({ error: 'Debe proporcionar al menos un variantId válido' });
        }

        try {
            const stocks = await this.orderService.getVariantStock(
                Number(storeId),
                variantIdsArray
            );
            res.status(200).json({
                success: true,
                data: stocks,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Obtener stock remoto
     * GET /api/orders/remote-stock/:variantId
     */
    getRemoteStock = async (req: Request, res: Response) => {
        const { variantId } = req.params;
        const { excludeStoreId } = req.query;

        if (!variantId || isNaN(Number(variantId)) || !excludeStoreId || isNaN(Number(excludeStoreId))) {
            return res.status(400).json({ error: 'Parámetros inválidos' });
        }

        try {
            const remoteStock = await this.orderService.getRemoteStock(
                Number(variantId),
                Number(excludeStoreId)
            );
            res.status(200).json({
                success: true,
                data: remoteStock,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Obtener reservas de una orden
     * GET /api/orders/:id/reservations
     */
    getOrderReservations = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        try {
            const reservations = await this.orderService.getOrderReservations(Number(id));
            res.status(200).json({
                success: true,
                data: reservations,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Delegar responsabilidad de devolucion
     * PATCH /api/orders/:id/return-responsibility/delegate
     */
    delegateReturnResponsibility = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const [error, dto] = DelegateOrderReturnDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const order = await this.orderService.delegateReturnResponsibility(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'ORDERS',
                actionType: 'ORDER_RETURN_DELEGATED',
                actionLabel: 'Responsabilidad de devolucion delegada',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Devolucion de orden ${order?.code || id} delegada a usuario ${dto?.userId}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    delegatedToUserId: Number(dto?.userId || 0) || null,
                    note: dto?.note ?? null,
                },
            });
            this.publishOrderEvent('ORDER_RETURN_UPDATED', order, req.user?.id, dto?.userId);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Responsabilidad de devolucion delegada exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Aceptar responsabilidad de devolucion
     * PATCH /api/orders/:id/return-responsibility/accept
     */
    acceptReturnResponsibility = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        try {
            const order = await this.orderService.acceptReturnResponsibility(Number(id), req.user?.id);

            this.registerUserActivity(req, {
                module: 'ORDERS',
                actionType: 'ORDER_RETURN_ACCEPTED',
                actionLabel: 'Responsabilidad de devolucion aceptada',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Responsabilidad de devolucion aceptada en orden ${order?.code || id}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
            });
            this.publishOrderEvent('ORDER_RETURN_UPDATED', order, req.user?.id);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Responsabilidad de devolucion aceptada',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Obtener estado de picking por orden
     * GET /api/orders/:id/picking
     */
    getOrderPicking = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        try {
            const picking = await this.orderService.getOrderPicking(Number(id));
            res.status(200).json({
                success: true,
                data: picking,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Iniciar picking
     * POST /api/orders/:id/picking/start
     */
    startOrderPicking = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        try {
            const picking = await this.orderService.startOrderPicking(Number(id), req.user?.id);

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_STARTED',
                actionLabel: 'Picking iniciado',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Picking iniciado para orden ${picking?.orderCode || id}`,
                products: this.mapProductsFromOrderItems(picking?.items || []),
                context: {
                    orderStatus: picking?.orderStatus || null,
                    pickingSessionId: Number(picking?.pickingSession?.id || 0) || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: 'Picking iniciado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Actualizar picking del pedido
     * PATCH /api/orders/:id/picking
     */
    updateOrderPicking = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const body = { ...req.body, orderId: Number(id) };
        const [error, dto] = UpdateOrderPickingDto.create(body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const order = await this.orderService.updateOrderPicking(Number(id), dto!, req.user?.id);

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_UPDATED',
                actionLabel: 'Picking actualizado',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Picking actualizado en orden ${order?.code || id}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    updatedItems: Array.isArray(dto?.items) ? dto.items.length : 0,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', order, req.user?.id);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Picking del pedido actualizado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Actualizar un item de picking
     * PATCH /api/orders/picking/items/:itemId
     */
    updatePickingItem = async (req: AuthRequest, res: Response) => {
        const { itemId } = req.params;
        const pickedQuantity = Number(req.body?.pickedQuantity);

        if (!itemId || isNaN(Number(itemId))) {
            return res.status(400).json({ error: 'ID de item invalido' });
        }

        if (!Number.isFinite(pickedQuantity) || pickedQuantity < 0) {
            return res.status(400).json({ error: 'pickedQuantity debe ser >= 0' });
        }
        if (!Number.isInteger(pickedQuantity)) {
            return res.status(400).json({ error: 'pickedQuantity debe ser entero' });
        }

        try {
            const picking = await this.orderService.updatePickingItem(Number(itemId), pickedQuantity, req.user?.id);

            const pickedItem = Array.isArray(picking?.items)
                ? picking.items.find((item: any) => Number(item?.pickingItemId || 0) === Number(itemId))
                : null;

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_ITEM_UPDATED',
                actionLabel: 'Item de picking actualizado',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || 0) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Item de picking ${itemId} actualizado a ${pickedQuantity} und.`,
                products: pickedItem
                    ? this.mapProductsFromOrderItems([{
                        variantId: pickedItem.variantId,
                        quantity: pickedItem.pickedQuantity,
                        variant: pickedItem.variant,
                    }])
                    : [],
                context: {
                    pickingItemId: Number(itemId),
                    pickedQuantity: Number(pickedQuantity),
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: 'Item de picking actualizado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Actualizar picking de una fila especifica de la orden
     * PATCH /api/orders/:id/picking/order-items/:orderItemId
     */
    updatePickingOrderItem = async (req: AuthRequest, res: Response) => {
        const { id, orderItemId } = req.params;
        const pickedQuantity = Number(req.body?.pickedQuantity);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (!orderItemId || isNaN(Number(orderItemId))) {
            return res.status(400).json({ error: 'orderItemId invalido' });
        }

        if (!Number.isFinite(pickedQuantity) || pickedQuantity < 0) {
            return res.status(400).json({ error: 'pickedQuantity debe ser >= 0' });
        }
        if (!Number.isInteger(pickedQuantity)) {
            return res.status(400).json({ error: 'pickedQuantity debe ser entero' });
        }

        try {
            const picking = await this.orderService.updatePickingOrderItem(
                Number(id),
                Number(orderItemId),
                pickedQuantity,
                req.user?.id,
            );

            const pickedItem = Array.isArray(picking?.items)
                ? picking.items.find((item: any) => Number(item?.orderItemId || 0) === Number(orderItemId))
                : null;

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_ORDER_ITEM_UPDATED',
                actionLabel: 'Fila de picking actualizada',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Fila ${orderItemId} actualizada a ${pickedQuantity} und.`,
                products: pickedItem
                    ? this.mapProductsFromOrderItems([{
                        variantId: pickedItem.variantId,
                        quantity: pickedItem.pickedQuantity,
                        variant: pickedItem.variant,
                    }])
                    : [],
                context: {
                    orderItemId: Number(orderItemId),
                    pickedQuantity: Number(pickedQuantity),
                    pickingItemId: Number(pickedItem?.pickingItemId || 0) || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: 'Fila de picking actualizada exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Solicitar accion de unpick sobre unidades separadas por otro colaborador
     * POST /api/orders/:id/picking/items/:itemId/unpick-request
     */
    requestPickingUnpickAction = async (req: AuthRequest, res: Response) => {
        const { id, itemId } = req.params;
        const [error, dto] = RequestPickingUnpickActionDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (!itemId || isNaN(Number(itemId))) {
            return res.status(400).json({ error: 'itemId invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const picking = await this.orderService.requestPickingUnpickAction(
                Number(id),
                Number(itemId),
                dto!,
                req.user?.id,
            );

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_UNPICK_ACTION_REQUESTED',
                actionLabel: 'Solicitud de accion de unpick',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Solicitud de unpick enviada para item ${itemId} en orden ${picking?.orderCode || id}`,
                context: {
                    pickingItemId: Number(itemId),
                    quantity: Number(dto?.quantity || 0),
                    note: dto?.note ?? null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: 'Solicitud de accion enviada',
            });
        } catch (serviceError) {
            if (serviceError instanceof CustomError) {
                return res.status(serviceError.statusCode).json({ error: serviceError.message });
            }
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Resolver solicitud de accion de unpick
     * PATCH /api/orders/:id/picking/unpick-requests/:requestId
     */
    resolvePickingUnpickAction = async (req: AuthRequest, res: Response) => {
        const { id, requestId } = req.params;
        const [error, dto] = ResolvePickingUnpickActionDto.create(req.body);

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        if (!requestId || isNaN(Number(requestId))) {
            return res.status(400).json({ error: 'requestId invalido' });
        }

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const picking = await this.orderService.resolvePickingUnpickAction(
                Number(id),
                Number(requestId),
                dto!,
                req.user?.id,
            );

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: dto?.action === 'APPROVE'
                    ? 'PICKING_UNPICK_ACTION_APPROVED'
                    : 'PICKING_UNPICK_ACTION_REJECTED',
                actionLabel: dto?.action === 'APPROVE'
                    ? 'Solicitud de unpick aprobada'
                    : 'Solicitud de unpick rechazada',
                entityType: 'ORDER',
                entityId: Number(picking?.orderId || id) || null,
                entityCode: picking?.orderCode ? String(picking.orderCode) : null,
                description: `Solicitud de unpick ${requestId} ${dto?.action === 'APPROVE' ? 'aprobada' : 'rechazada'} en orden ${picking?.orderCode || id}`,
                context: {
                    requestId: Number(requestId),
                    action: dto?.action || null,
                    note: dto?.note ?? null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', picking, req.user?.id);

            res.status(200).json({
                success: true,
                data: picking,
                message: dto?.action === 'APPROVE' ? 'Solicitud aprobada' : 'Solicitud rechazada',
            });
        } catch (serviceError) {
            if (serviceError instanceof CustomError) {
                return res.status(serviceError.statusCode).json({ error: serviceError.message });
            }
            return res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Finalizar picking de una orden
     * PATCH /api/orders/:id/picking/complete
     */
    completeOrderPicking = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID invalido' });
        }

        try {
            const order = await this.orderService.completeOrderPicking(Number(id), req.user?.id);

            this.registerUserActivity(req, {
                module: 'PICKING',
                actionType: 'PICKING_COMPLETED',
                actionLabel: 'Picking completado',
                entityType: 'ORDER',
                entityId: Number(order?.id || id) || null,
                entityCode: order?.code ? String(order.code) : null,
                description: `Picking completado en orden ${order?.code || id}`,
                products: this.mapProductsFromOrderItems(order?.items || []),
                context: {
                    resultingStatus: order?.status || null,
                },
            });
            this.publishOrderEvent('ORDER_PICKING_UPDATED', order, req.user?.id);

            res.status(200).json({
                success: true,
                data: order,
                message: 'Picking finalizado exitosamente',
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };

    /**
     * Reservar stock remoto
     * POST /api/orders/:id/reserve-remote
     */
    reserveRemoteStock = async (req: AuthRequest, res: Response) => {
        const { id } = req.params;
        const { sourceStoreId, variantId, quantity } = req.body;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ error: 'ID de pedido inválido' });
        }

        if (!sourceStoreId || !variantId || !quantity) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos' });
        }

        try {
            const result = await this.orderService.reserveRemoteStock(
                Number(id),
                Number(sourceStoreId),
                Number(variantId),
                Number(quantity)
            );

            this.registerUserActivity(req, {
                module: 'ORDERS',
                actionType: 'REMOTE_STOCK_RESERVED',
                actionLabel: 'Stock remoto reservado',
                entityType: 'ORDER',
                entityId: Number(id),
                description: `Stock remoto reservado para orden ${id}`,
                products: [{
                    variantId: Number(variantId),
                    quantity: Number(quantity),
                }],
                context: {
                    sourceStoreId: Number(sourceStoreId),
                    variantId: Number(variantId),
                    quantity: Number(quantity),
                },
            });
            this.publishOrderEvent('ORDER_UPDATED', { id: Number(id) }, req.user?.id);

            res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ error: error.message });
            }
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    };
}
