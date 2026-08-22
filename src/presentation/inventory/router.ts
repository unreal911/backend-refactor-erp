import { Router } from "express";
import { InventoryService } from "../../modules/inventory/services/inventory.service";
import { InventoryController } from "./controller";
import { AuthMiddleware, AuthRequest } from "../auth/middleware";
import { NextFunction, Response } from "express";

function requireMovementPermission(req: AuthRequest, res: Response, next: NextFunction) {
    const movementType = String(req.body?.type || '').trim().toUpperCase();
    const permission = movementType === 'ADJUSTMENT'
        ? 'inventory.adjustment.create'
        : 'inventory.movement.create';
    return AuthMiddleware.requirePermission(permission)(req, res, next);
}

export class inventoryRoute {
    static get router(): Router {
        const router = Router();
        const inventoryService = new InventoryService();
        const controller = new InventoryController(inventoryService);

        router.get('/', AuthMiddleware.requirePermission('inventory.view'), controller.listInventories);
        router.get('/movements', AuthMiddleware.requirePermission('inventory.history.view'), controller.listMovements);
        // Listar y cerrar transferencias existentes sigue permitido al vencer una
        // promoción o bajar de plan. Solo crear una nueva requiere el beneficio.
        router.get('/transfers', AuthMiddleware.requirePermission('transfers.view'), controller.listTransfers);
        router.get('/reservations', AuthMiddleware.requirePermission('inventory.view'), controller.listReservations);
        router.get('/reserved-audit', AuthMiddleware.requirePermission('inventory.reconcile'), controller.auditReservedStock);

        router.post('/movements', requireMovementPermission, controller.createMovement);
        router.post('/transfers', AuthMiddleware.requirePlanFeature('transfers'), AuthMiddleware.requirePermission('transfers.create'), controller.createStockTransfer);
        router.post('/reservations', AuthMiddleware.requirePermission('inventory.reservation.manage'), controller.createReservation);
        router.post('/reconcile-reserved', AuthMiddleware.requirePermission('inventory.reconcile'), controller.reconcileReservedStock);
        router.patch('/transfers/:id/dispatch', AuthMiddleware.requirePermission('transfers.dispatch'), controller.dispatchStockTransfer);
        router.patch('/transfers/:id/receive', AuthMiddleware.requirePermission('transfers.receive'), controller.receiveStockTransfer);
        router.patch('/transfers/:id/cancel', AuthMiddleware.requirePermission('transfers.cancel'), controller.cancelStockTransfer);

        return router;
    }
}
