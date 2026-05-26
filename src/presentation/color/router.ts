import { Router } from "express";
import { ColorService } from "../services/color.service";
import { ColorController } from "./controller";

export class colorRoute {
    static get router(): Router {
        const router = Router()
        const colorServiceInstance = new ColorService()
        const controller = new ColorController(colorServiceInstance)
        router.post('/', controller.createColor)
        router.get('/', controller.listColor)
        router.get('/search', controller.findcolorsbyname)
        router.put('/:id', controller.updateColor)
        return router;
    }

}