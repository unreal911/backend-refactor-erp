import { Router } from "express";
import { ProductService } from "../services/product.service";
import { ProductController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class productRoute {
    static get router(): Router {
        const router = Router();
        const productServiceInstance = new ProductService();
        const controller = new ProductController(productServiceInstance);

        // Crear producto
        router.post('/', AuthMiddleware.requirePermission('products.create'), controller.createProduct);

        // Generar variantes automáticamente
        router.post('/generate-variants', AuthMiddleware.requirePermission('products.create'), controller.generateVariants);

        // Eliminar imagen de Cloudinary
        router.delete('/image/:publicId', AuthMiddleware.requirePermission('products.update'), controller.deleteImage);

        // Listar productos
        router.get('/', AuthMiddleware.requirePermission('products.view'), controller.listProducts);

        // Obtener producto por ID
        router.get('/:id', AuthMiddleware.requirePermission('products.view'), controller.getProductById);

        // Actualizar producto
        router.patch('/:id', AuthMiddleware.requirePermission('products.update'), controller.updateProduct);

        // Eliminar producto
        router.delete('/:id', AuthMiddleware.requirePermission('products.disable'), controller.deleteProduct);

        return router;
    }
}
