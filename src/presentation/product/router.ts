import express, { NextFunction, Request, Response, Router } from "express";
import { ProductService } from "../services/product.service";
import { ProductController } from "./controller";
import { AuthMiddleware } from "../auth/middleware";

export class productRoute {
    static get router(): Router {
        const router = Router();
        const productServiceInstance = new ProductService();
        const controller = new ProductController(productServiceInstance);
        const productPayloadParser = express.json({ limit: '30mb' });
        const regularPayloadParser = express.json({ limit: '2mb' });
        const parse = (parser: ReturnType<typeof express.json>, limit: string) => (
            req: Request,
            res: Response,
            next: NextFunction,
        ) => parser(req, res, (error?: unknown) => {
            const bodyError = error as { type?: string; status?: number } | undefined;
            if (bodyError?.type === 'entity.too.large' || bodyError?.status === 413) {
                return res.status(413).json({
                    message: `El contenido enviado supera el límite permitido de ${limit}.`,
                });
            }
            return error ? next(error) : next();
        });

        // Crear producto
        router.post('/', parse(productPayloadParser, '30mb'), AuthMiddleware.requirePermission('products.create'), controller.createProduct);

        // Generar variantes automáticamente
        router.post('/generate-variants', parse(regularPayloadParser, '2mb'), AuthMiddleware.requirePermission('products.create'), controller.generateVariants);

        // Eliminar imagen de Cloudinary
        router.delete('/image/:publicId', AuthMiddleware.requirePermission('products.update'), controller.deleteImage);

        // Listar productos
        router.get('/', AuthMiddleware.requirePermission('products.view'), controller.listProducts);

        // Obtener producto por ID
        router.get('/:id', AuthMiddleware.requirePermission('products.view'), controller.getProductById);

        // Actualizar producto
        router.patch('/:id', parse(productPayloadParser, '30mb'), AuthMiddleware.requirePermission('products.update'), controller.updateProduct);

        // Eliminar producto
        router.delete('/:id', AuthMiddleware.requirePermission('products.disable'), controller.deleteProduct);

        return router;
    }
}
