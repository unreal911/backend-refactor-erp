import { Router } from 'express';
import { ProductService } from '../services/product.service';
import { OrderService } from '../services/order.service';
import { PublicController } from './controller';
import { MarketplaceAuthService } from '../services/marketplace-auth.service';
import { MarketplaceAuthMiddleware } from './marketplace-auth.middleware';
import { SystemConfigService } from '../services/system-config.service';
import { authRateLimiter, publicReadRateLimiter, publicWriteRateLimiter } from '../middlewares/rate-limit';

export class publicRoute {
    static get router(): Router {
        const router = Router();
        const productService = new ProductService();
        const orderService = new OrderService();
        const marketplaceAuthService = new MarketplaceAuthService();
        const systemConfigService = new SystemConfigService();
        const controller = new PublicController(productService, orderService, marketplaceAuthService, systemConfigService);

        router.post('/auth/register', authRateLimiter, controller.registerMarketplaceCustomer);
        router.post('/auth/login', authRateLimiter, controller.loginMarketplaceCustomer);
        router.get('/auth/me', MarketplaceAuthMiddleware.validateJWT, controller.meMarketplaceCustomer);
        router.patch('/auth/profile', MarketplaceAuthMiddleware.validateJWT, controller.updateMarketplaceCustomerProfile);

        router.get('/products', controller.listProducts);
        router.get('/products/:id', controller.getProductById);
        router.get('/stores', controller.listStores);
        router.get('/checkout-payment-methods', controller.listMarketplaceCheckoutPaymentMethods);
        router.get('/branding', controller.getMarketplaceBranding);

        router.post('/orders', publicWriteRateLimiter, controller.createMarketplaceOrder);
        // Consultas de pedidos por codigo/telefono: rate-limit para frenar
        // enumeracion/scraping de PII (mitigacion de la fuga tipo IDOR).
        router.get('/orders/my', publicReadRateLimiter, controller.listMarketplaceOrders);
        router.get('/orders/my-auth', MarketplaceAuthMiddleware.validateJWT, controller.listMarketplaceOrdersByAuth);
        router.get('/orders/track', publicReadRateLimiter, controller.trackMarketplaceOrder);
        router.get('/orders/:code', publicReadRateLimiter, controller.getMarketplaceOrderByCode);

        return router;
    }
}
