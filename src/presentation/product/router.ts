import { Router } from "express";
import { ProductService } from "../services/product.service";
import { ProductController } from "./controller";

export class productRoute {
    static get router(): Router {
        const router = Router();
        const productServiceInstance = new ProductService();
        const controller = new ProductController(productServiceInstance);

        // Crear producto
        router.post('/', controller.createProduct);

        // Generar variantes automáticamente
        router.post('/generate-variants', controller.generateVariants);

        // Eliminar imagen de Cloudinary
        router.delete('/image/:publicId', controller.deleteImage);

        // Listar productos
        router.get('/', controller.listProducts);

        // Obtener producto por ID
        router.get('/:id', controller.getProductById);

        // Actualizar producto
        router.patch('/:id', controller.updateProduct);

        // Eliminar producto
        router.delete('/:id', controller.deleteProduct);

        return router;
    }
}
