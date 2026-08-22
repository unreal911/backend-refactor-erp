import { Router } from 'express';
import { AdminEventsController } from './controller';
import { AuthMiddleware } from '../auth/middleware';

export class AdminEventsRoute {
    static get router(): Router {
        const router = Router();
        const controller = new AdminEventsController();

        router.get('/stream', AuthMiddleware.requirePermission('settings.manage'), controller.stream);

        return router;
    }
}
