import { Request, Response } from "express";
import { ProductService } from "../services/product.service";
import { CustomError } from "../../domain/errors/custom.error";
import { CreateProductDto } from "../../domain/dtos/create-product.dto";
import { UpdateProductDto } from "../../domain/dtos/update-product.dto";
import { ListProductDto } from "../../domain/dtos/list-product.dto";
import { GenerateVariantsDto } from "../../domain/dtos/generate-variants.dto";

export class ProductController {
    constructor(
        private readonly productService: ProductService,
    ) { }

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.log(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    /**
     * Crear un nuevo producto con variantes
     * POST /products
     */
    createProduct = async (req: Request, res: Response) => {
        const [error, createProductDto] = CreateProductDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (createProductDto) {
            try {
                const result = await this.productService.createProduct(createProductDto);
                return res.status(201).json(result);
            } catch (error) {
                return this.handleError(error, res);
            }
        }
    }

    /**
     * Generar variantes automáticamente
     * POST /products/generate-variants
     */
    generateVariants = async (req: Request, res: Response) => {
        const [error, generateVariantsDto] = GenerateVariantsDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (generateVariantsDto) {
            try {
                const variants = await this.productService.generateVariants(generateVariantsDto);
                return res.status(200).json({
                    variants,
                    count: variants.length,
                    message: `Se generaron ${variants.length} combinaciones de variantes`,
                });
            } catch (error) {
                return this.handleError(error, res);
            }
        }
    }

    /**
     * Eliminar imagen de Cloudinary
     * DELETE /products/image/:publicId
     */
    deleteImage = async (req: Request, res: Response) => {
        const { publicId } = req.params as { publicId: string };

        if (!publicId) {
            return res.status(400).json({ message: 'El publicId de la imagen es requerido' });
        }

        try {
            await this.productService.deleteImageFromCloudinary(publicId);
            return res.status(200).json({ message: 'Imagen eliminada exitosamente' });
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    /**
     * Listar productos con búsqueda
     * GET /products
     */
    listProducts = async (req: Request, res: Response) => {
        const { skip, take, search, isActive } = req.query;

        const isActiveBool = isActive !== undefined ? (isActive === 'true') : true;
        const [error, listProductDto] = ListProductDto.create(
            Number(skip) || 1,
            Number(take) || 10,
            search as string,
            isActiveBool,
        );

        if (error) {
            return res.status(400).json({ message: error });
        }

        if (listProductDto) {
            try {
                const result = await this.productService.listProducts(listProductDto);
                return res.status(200).json(result);
            } catch (error) {
                return this.handleError(error, res);
            }
        }
    }

    /**
     * Obtener detalles de un producto
     * GET /products/:id
     */
    getProductById = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ message: 'El ID del producto debe ser un número válido' });
        }

        try {
            const product = await this.productService.getProductById(Number(id));
            return res.status(200).json(product);
        } catch (error) {
            return this.handleError(error, res);
        }
    }

    /**
     * Actualizar un producto
     * PATCH /products/:id
     */
    updateProduct = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ message: 'El ID del producto debe ser un número válido' });
        }

        const [error, updateProductDto] = UpdateProductDto.create(req.body);
        if (error) {
            return res.status(400).json({ message: error });
        }

        if (updateProductDto) {
            try {
                await this.productService.updateProduct(Number(id), updateProductDto);
                const product = await this.productService.getProductById(Number(id));
                return res.status(200).json({
                    message: 'Producto actualizado exitosamente',
                    product,
                });
            } catch (error) {
                return this.handleError(error, res);
            }
        }
    }

    /**
     * Eliminar un producto
     * DELETE /products/:id
     */
    deleteProduct = async (req: Request, res: Response) => {
        const { id } = req.params;

        if (!id || isNaN(Number(id))) {
            return res.status(400).json({ message: 'El ID del producto debe ser un número válido' });
        }

        try {
            await this.productService.deleteProduct(Number(id));
            return res.status(200).json({ message: 'Producto eliminado exitosamente' });
        } catch (error) {
            return this.handleError(error, res);
        }
    }
}
