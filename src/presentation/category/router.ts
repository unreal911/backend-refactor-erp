import { Router } from "express";
import { CategoryService } from "../services/category.service";
import { CategoryController } from "./controller";

export class categoryRoute {
    static get router(): Router {
        const router = Router()
        const categoryServiceInstance = new CategoryService()
        const controller = new CategoryController(categoryServiceInstance)
        router.post('/', controller.createCategory)
        router.get('/', controller.listCategory)
        router.get('/search', controller.findcategoriesbyname)
        router.put('/:id', controller.updateCategory)
        return router;
    }

}