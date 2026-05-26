import { Router } from "express";
import { InventoryService } from "../../modules/inventory/services/inventory.service";
import { InventoryController } from "./controller";

export class inventoryRoute {
    static get router(): Router {
        const router = Router();
        const inventoryService = new InventoryService();
        const controller = new InventoryController(inventoryService);

        router.get('/', controller.listInventories);
        router.get('/movements', controller.listMovements);
        router.get('/transfers', controller.listTransfers);
        router.get('/reservations', controller.listReservations);

        router.post('/movements', controller.createMovement);
        router.post('/transfers', controller.createStockTransfer);
        router.post('/reservations', controller.createReservation);
        router.post('/reconcile-reserved', controller.reconcileReservedStock);
        router.patch('/transfers/:id/receive', controller.receiveStockTransfer);

        return router;
    }
}
