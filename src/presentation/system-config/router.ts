import { Router } from 'express';
import { AuthMiddleware } from '../auth/middleware';
import { SystemConfigController } from './controller';
import { SystemConfigService } from '../services/system-config.service';

export class systemConfigRoute {
    static get router(): Router {
        const router = Router();
        const service = new SystemConfigService();
        const controller = new SystemConfigController(service);

        router.get('/order-workflow', AuthMiddleware.requirePermission(['orders.view', 'picking.view', 'settings.manage']), controller.getOrderWorkflowSettings);
        router.patch('/order-workflow', AuthMiddleware.requirePermission('settings.manage'), controller.updateOrderWorkflowSettings);
        router.get('/marketplace-theme', AuthMiddleware.requirePermission('settings.manage'), controller.getMarketplaceTheme);
        router.put('/marketplace-theme/draft', AuthMiddleware.requirePermission('settings.manage'), controller.saveMarketplaceThemeDraft);
        router.post('/marketplace-theme/publish', AuthMiddleware.requirePermission('settings.manage'), controller.publishMarketplaceTheme);

        return router;
    }
}
