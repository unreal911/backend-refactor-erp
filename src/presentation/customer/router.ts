import { Router } from 'express';
import { AuthMiddleware } from '../auth/middleware';
import { CustomerController } from './controller';

export class customerRoute {
    static get router(): Router {
        const router = Router();
        const controller = new CustomerController();
        router.get('/', AuthMiddleware.requirePermission('customers.view'), controller.list);
        router.post('/', AuthMiddleware.requirePermission('customers.manage'), controller.create);
        router.put('/:id', AuthMiddleware.requirePermission('customers.manage'), controller.update);
        router.patch('/:id', AuthMiddleware.requirePermission('customers.manage'), controller.update);
        return router;
    }
}
