import { Request, Response } from 'express';
import { ProductService } from '../services/product.service';
import { OrderService } from '../services/order.service';
import { CustomError } from '../../domain/errors/custom.error';
import { PublicListProductDto } from '../../domain/dtos/public-list-product.dto';
import { CreateMarketplaceOrderDto } from '../../domain/dtos/create-marketplace-order.dto';
import { TrackMarketplaceOrderDto } from '../../domain/dtos/track-marketplace-order.dto';
import { ListMarketplaceOrdersDto } from '../../domain/dtos/list-marketplace-orders.dto';
import { RegisterMarketplaceCustomerDto } from '../../domain/dtos/register-marketplace-customer.dto';
import { LoginMarketplaceCustomerDto } from '../../domain/dtos/login-marketplace-customer.dto';
import { UpdateMarketplaceCustomerProfileDto } from '../../domain/dtos/update-marketplace-customer-profile.dto';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceAuthRequest } from './marketplace-auth.middleware';

export class PublicController {
    constructor(
        private readonly productService: ProductService,
        private readonly orderService: OrderService,
        private readonly marketplaceAuthService: MarketplaceAuthService,
    ) {}

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    listProducts = async (req: Request, res: Response) => {
        const [error, dto] = PublicListProductDto.create(req.query as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.productService.listPublicProducts(dto!);
            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    listStores = async (_req: Request, res: Response) => {
        try {
            const stores = await this.orderService.listMarketplaceStores();
            return res.status(200).json({ data: stores });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    registerMarketplaceCustomer = async (req: Request, res: Response) => {
        const [error, dto] = RegisterMarketplaceCustomerDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.marketplaceAuthService.register(dto!);
            return res.status(201).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    loginMarketplaceCustomer = async (req: Request, res: Response) => {
        const [error, dto] = LoginMarketplaceCustomerDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.marketplaceAuthService.login(dto!);
            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    meMarketplaceCustomer = async (req: MarketplaceAuthRequest, res: Response) => {
        const customerId = Number(req.marketplaceCustomer?.id || 0);
        if (!Number.isInteger(customerId) || customerId < 1) {
            return res.status(401).json({ message: 'Cliente no autenticado' });
        }

        try {
            const result = await this.marketplaceAuthService.me(customerId);
            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    updateMarketplaceCustomerProfile = async (req: MarketplaceAuthRequest, res: Response) => {
        const customerId = Number(req.marketplaceCustomer?.id || 0);
        if (!Number.isInteger(customerId) || customerId < 1) {
            return res.status(401).json({ message: 'Cliente no autenticado' });
        }

        const [error, dto] = UpdateMarketplaceCustomerProfileDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.marketplaceAuthService.updateProfile(customerId, dto!);
            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    listMarketplaceCheckoutPaymentMethods = async (_req: Request, res: Response) => {
        try {
            const result = await this.orderService.getMarketplaceCheckoutPaymentMethods();
            return res.status(200).json({ data: result });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    getProductById = async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) {
            return res.status(400).json({ message: 'ID de producto invalido' });
        }

        try {
            const product = await this.productService.getPublicProductById(id);
            return res.status(200).json(product);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    createMarketplaceOrder = async (req: Request, res: Response) => {
        const [error, dto] = CreateMarketplaceOrderDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const order = await this.orderService.createMarketplaceOrder(dto!);
            return res.status(201).json({
                success: true,
                data: order,
                message: 'Pedido registrado. Nuestro equipo confirmara disponibilidad.',
            });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    getMarketplaceOrderByCode = async (req: Request, res: Response) => {
        const rawCode = req.params.code;
        const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;
        const normalizedCode = (code || '').trim().toUpperCase();
        if (!normalizedCode) {
            return res.status(400).json({ message: 'Codigo de pedido invalido' });
        }

        try {
            const order = await this.orderService.getMarketplaceOrderByCode(normalizedCode);
            return res.status(200).json({
                success: true,
                data: order,
            });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    listMarketplaceOrders = async (req: Request, res: Response) => {
        const [error, dto] = ListMarketplaceOrdersDto.create(req.query as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const orders = await this.orderService.listMarketplaceOrders(dto!);
            return res.status(200).json({
                success: true,
                data: orders,
            });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    listMarketplaceOrdersByAuth = async (req: MarketplaceAuthRequest, res: Response) => {
        const customerId = Number(req.marketplaceCustomer?.id || 0);
        if (!Number.isInteger(customerId) || customerId < 1) {
            return res.status(401).json({ message: 'Cliente no autenticado' });
        }

        try {
            const me = await this.marketplaceAuthService.me(customerId);
            const user = me?.user;
            const orders = await this.orderService.listMarketplaceOrdersByCustomerProfile({
                phone: String(user?.phone || ''),
                email: String(user?.email || ''),
            });

            return res.status(200).json({
                success: true,
                data: orders,
            });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    trackMarketplaceOrder = async (req: Request, res: Response) => {
        const [error, dto] = TrackMarketplaceOrderDto.create(req.query as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const order = await this.orderService.trackMarketplaceOrder(dto!);
            return res.status(200).json({
                success: true,
                data: order,
            });
        } catch (err) {
            return this.handleError(err, res);
        }
    };
}
