import { Router } from 'express';
import { OrderService } from '../../modules/orders/services/order.service';
import { OrderController } from './controller';
import { AuthMiddleware } from '../auth/middleware';

export class orderRoute {
    static get router(): Router {
        const router = Router();
        const orderServiceInstance = new OrderService();
        const controller = new OrderController(orderServiceInstance);

        // Crear pedido
        router.post('/', AuthMiddleware.requirePermission(['orders.create', 'pos.sell']), controller.createOrder);

        // Listar pedidos
        router.get('/', AuthMiddleware.requirePermission('orders.view'), controller.listOrders);

        // Obtener stock de variantes para tienda
        router.get('/variant-stock', AuthMiddleware.requirePermission(['pos.view', 'inventory.view']), controller.getVariantStock);

        // Obtener stock remoto para una variante
        router.get('/remote-stock/:variantId', AuthMiddleware.requirePermission(['orders.fulfillment.manage', 'inventory.view']), controller.getRemoteStock);

        // Reservas de una orden
        router.get('/:id/reservations', AuthMiddleware.requirePermission(['orders.detail.view', 'inventory.view']), controller.getOrderReservations);

        // Obtener picking de una orden
        router.get('/:id/picking', AuthMiddleware.requirePermission('picking.view'), controller.getOrderPicking);

        // Iniciar picking
        router.post('/:id/picking/start', AuthMiddleware.requirePermission('picking.start'), controller.startOrderPicking);

        // Finalizar picking
        router.patch('/:id/picking/complete', AuthMiddleware.requirePermission('picking.complete'), controller.completeOrderPicking);

        // Separar de una vez todo lo disponible del pedido (1 transaccion)
        router.patch('/:id/picking/pick-all', AuthMiddleware.requirePermission('picking.update'), controller.pickAllOrderPicking);

        // Actualizar picking del pedido
        router.patch('/:id/picking', AuthMiddleware.requirePermission('picking.update'), controller.updateOrderPicking);

        // Actualizar item de picking
        router.patch('/picking/items/:itemId', AuthMiddleware.requirePermission('picking.update'), controller.updatePickingItem);

        // Actualizar picking por fila de orden (orderItem)
        router.patch('/:id/picking/order-items/:orderItemId', AuthMiddleware.requirePermission('picking.update'), controller.updatePickingOrderItem);

        // Solicitar accion para unpick en item de picking
        router.post('/:id/picking/items/:itemId/unpick-request', AuthMiddleware.requirePlanFeature('picking.collaborative'), AuthMiddleware.requirePermission('picking.update'), controller.requestPickingUnpickAction);

        // Resolver solicitud de accion de unpick
        router.patch('/:id/picking/unpick-requests/:requestId', AuthMiddleware.requirePlanFeature('picking.collaborative'), AuthMiddleware.requirePermission('picking.complete'), controller.resolvePickingUnpickAction);

        // Solicitar responsabilidad en picking
        router.post('/:id/picking/responsibility/request', AuthMiddleware.requirePlanFeature('picking.collaborative'), AuthMiddleware.requirePermission('picking.update'), controller.requestPickingResponsibility);

        // Delegar responsabilidad en picking
        router.patch('/:id/picking/responsibility/delegate', AuthMiddleware.requirePlanFeature('picking.collaborative'), AuthMiddleware.requirePermission('orders.assign'), controller.delegatePickingResponsibility);

        // Resolver solicitud de responsabilidad en picking
        router.patch('/:id/picking/responsibility/requests/:requestId', AuthMiddleware.requirePlanFeature('picking.collaborative'), AuthMiddleware.requirePermission('orders.assign'), controller.resolvePickingResponsibilityRequest);

        // Obtener pedido por ID
        router.get('/:id', AuthMiddleware.requirePermission('orders.detail.view'), controller.getOrderById);

        // Actualizar estado del pedido
        router.patch('/:id/status', AuthMiddleware.requirePermission('orders.status.update'), controller.updateOrderStatus);

        // Asignar responsable
        router.patch('/:id/assign', AuthMiddleware.requirePermission('orders.assign'), controller.assignResponsible);

        // Delegar responsabilidad de devolucion
        router.patch('/:id/return-responsibility/delegate', AuthMiddleware.requirePermission('orders.return.manage'), controller.delegateReturnResponsibility);

        // Aceptar responsabilidad de devolucion
        router.patch('/:id/return-responsibility/accept', AuthMiddleware.requirePermission('orders.return.manage'), controller.acceptReturnResponsibility);

        // Reservar stock remoto
        router.post('/:id/reserve-remote', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.reserveRemoteStock);

        // Reservar de una vez todo lo pendiente con la tienda recomendada
        router.post('/:id/reserve-all-recommended', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.reserveAllRecommended);

        // Liberar la reserva de un item (inverso de reserve-remote)
        router.post('/:id/items/:itemId/release-remote', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.releaseRemoteStock);

        // Agregar un producto (nueva linea) a una proforma ecommerce
        router.post('/:id/items', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.addOrderItem);

        // Eliminar (soft-delete) / restaurar un producto de la proforma ecommerce
        router.post('/:id/items/:itemId/remove', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.removeOrderItem);
        router.post('/:id/items/:itemId/restore', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.restoreOrderItem);

        // Marcar/limpiar faltante de un item (proforma ecommerce)
        router.post('/:id/items/:itemId/shortage', AuthMiddleware.requirePermission('orders.fulfillment.manage'), controller.markOrderItemShortage);

        // Devoluciones post-entrega (G4)
        router.get('/:id/returns', AuthMiddleware.requirePermission('orders.detail.view'), controller.getOrderReturns);
        router.post('/:id/returns', AuthMiddleware.requirePermission('orders.return.manage'), controller.registerOrderReturn);

        return router;
    }
}
