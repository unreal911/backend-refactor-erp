import { Router } from "express";
import { StoreService } from "../services/store.service";
import { StoreController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class storeRoute {
    static get router(): Router {
        const router = Router();
        const storeService = new StoreService();
        const controller = new StoreController(storeService);

        router.post('/', AuthMiddleware.requirePermission('stores.create'), controller.createStore);
        router.get('/', AuthMiddleware.requirePermission('stores.view'), controller.listStores);
        router.put('/:id', AuthMiddleware.requirePermission('stores.update'), controller.updateStore);
        router.patch('/:id/deactivate', AuthMiddleware.requirePermission('stores.disable'), controller.deactivateStore);

        return router;
    }
}
