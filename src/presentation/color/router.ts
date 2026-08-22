import { Router } from "express";
import { ColorService } from "../services/color.service";
import { ColorController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class colorRoute {
    static get router(): Router {
        const router = Router()
        const colorServiceInstance = new ColorService()
        const controller = new ColorController(colorServiceInstance)
        router.post('/', AuthMiddleware.requirePermission('colors.manage'), controller.createColor)
        router.get('/', AuthMiddleware.requirePermission(['products.view', 'colors.manage']), controller.listColor)
        router.get('/search', AuthMiddleware.requirePermission(['products.view', 'colors.manage']), controller.findcolorsbyname)
        router.put('/:id', AuthMiddleware.requirePermission('colors.manage'), controller.updateColor)
        return router;
    }

}
