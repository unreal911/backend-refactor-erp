import { Router } from 'express';
import { ProductService } from '../services/product.service';
import { OrderService } from '../services/order.service';
import { PublicController } from './controller';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceAuthMiddleware } from './marketplace-auth.middleware';

export class publicRoute {
    static get router(): Router {
        const router = Router();
        const productService = new ProductService();
        const orderService = new OrderService();
        const marketplaceAuthService = new MarketplaceAuthService();
        const controller = new PublicController(productService, orderService, marketplaceAuthService);

        router.post('/auth/register', controller.registerMarketplaceCustomer);
        router.post('/auth/login', controller.loginMarketplaceCustomer);
        router.get('/auth/me', MarketplaceAuthMiddleware.validateJWT, controller.meMarketplaceCustomer);
        router.patch('/auth/profile', MarketplaceAuthMiddleware.validateJWT, controller.updateMarketplaceCustomerProfile);

        router.get('/products', controller.listProducts);
        router.get('/products/:id', controller.getProductById);
        router.get('/stores', controller.listStores);
        router.get('/checkout-payment-methods', controller.listMarketplaceCheckoutPaymentMethods);

        router.post('/orders', controller.createMarketplaceOrder);
        router.get('/orders/my', controller.listMarketplaceOrders);
        router.get('/orders/my-auth', MarketplaceAuthMiddleware.validateJWT, controller.listMarketplaceOrdersByAuth);
        router.get('/orders/track', controller.trackMarketplaceOrder);
        router.get('/orders/:code', controller.getMarketplaceOrderByCode);

        return router;
    }
}
