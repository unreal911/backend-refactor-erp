import { Router } from "express";
import { SizeService } from "../services/size.service";
import { SizeController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class sizeRoute {
    static get router(): Router {
        const router = Router();
        const sizeServiceInstance = new SizeService();
        const controller = new SizeController(sizeServiceInstance);

        router.post('/', AuthMiddleware.requirePermission('sizes.manage'), controller.createSize);
        router.get('/', AuthMiddleware.requirePermission(['products.view', 'sizes.manage']), controller.listSize);
        router.get('/search', AuthMiddleware.requirePermission(['products.view', 'sizes.manage']), controller.findsizesbyname);
        router.put('/:id', AuthMiddleware.requirePermission('sizes.manage'), controller.updateSize);

        return router;
    }
}
