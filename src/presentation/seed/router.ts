import { Router } from 'express';
import { SeedController } from './controller';
import { AuthMiddleware } from '../auth/middleware';

export class SeedRoute {
    static get router(): Router {
        const router = Router();
        router.post('/', AuthMiddleware.validateJWT, AuthMiddleware.requireAdmin, SeedController.run);
        return router;
    }
}
