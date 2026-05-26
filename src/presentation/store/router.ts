import { Router } from "express";
import { StoreService } from "../services/store.service";
import { StoreController } from "./controller";

export class storeRoute {
    static get router(): Router {
        const router = Router();
        const storeService = new StoreService();
        const controller = new StoreController(storeService);

        router.post('/', controller.createStore);
        router.get('/', controller.listStores);
        router.put('/:id', controller.updateStore);
        router.patch('/:id/deactivate', controller.deactivateStore);

        return router;
    }
}
