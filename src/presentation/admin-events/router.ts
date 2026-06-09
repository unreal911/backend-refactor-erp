import { Router } from 'express';
import { AdminEventsController } from './controller';

export class AdminEventsRoute {
    static get router(): Router {
        const router = Router();
        const controller = new AdminEventsController();

        router.get('/stream', controller.stream);

        return router;
    }
}
