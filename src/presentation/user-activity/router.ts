import { Router } from 'express';
import { AuthMiddleware } from '../auth/middleware';
import { UserActivityController } from './controller';
import { UserActivityService } from '../services/user-activity.service';

export class userActivityRoute {
    static get router(): Router {
        const router = Router();
        const service = new UserActivityService();
        const controller = new UserActivityController(service);

        router.get('/', AuthMiddleware.requirePermission('settings.manage'), controller.list);

        return router;
    }
}
