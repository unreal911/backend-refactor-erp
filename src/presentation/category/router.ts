import { Router } from "express";
import { CategoryService } from "../services/category.service";
import { CategoryController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class categoryRoute {
    static get router(): Router {
        const router = Router()
        const categoryServiceInstance = new CategoryService()
        const controller = new CategoryController(categoryServiceInstance)
        router.post('/', AuthMiddleware.requirePermission('categories.manage'), controller.createCategory)
        router.get('/', AuthMiddleware.requirePermission(['products.view', 'categories.manage']), controller.listCategory)
        router.get('/search', AuthMiddleware.requirePermission(['products.view', 'categories.manage']), controller.findcategoriesbyname)
        router.put('/:id', AuthMiddleware.requirePermission('categories.manage'), controller.updateCategory)
        return router;
    }

}
