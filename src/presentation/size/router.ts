import { Router } from "express";
import { SizeService } from "../services/size.service";
import { SizeController } from "./controller";

export class sizeRoute {
    static get router(): Router {
        const router = Router();
        const sizeServiceInstance = new SizeService();
        const controller = new SizeController(sizeServiceInstance);

        router.post('/', controller.createSize);
        router.get('/', controller.listSize);
        router.get('/search', controller.findsizesbyname);
        router.put('/:id', controller.updateSize);

        return router;
    }
}
