import { Router } from 'express';
import { AuthMiddleware } from '../auth/middleware';
import { SystemConfigController } from './controller';
import { SystemConfigService } from '../services/system-config.service';

export class systemConfigRoute {
    static get router(): Router {
        const router = Router();
        const service = new SystemConfigService();
        const controller = new SystemConfigController(service);

        router.get('/order-workflow', controller.getOrderWorkflowSettings);
        router.patch('/order-workflow', AuthMiddleware.requirePermission('settings.manage'), controller.updateOrderWorkflowSettings);

        return router;
    }
}
