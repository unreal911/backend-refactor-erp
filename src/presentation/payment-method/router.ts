import { Router } from 'express';
import { PaymentMethodController } from './controller';
import { PaymentMethodService } from '../services/payment-method.service';
import { AuthMiddleware } from '../auth/middleware';

export class paymentMethodRoute {
    static get router(): Router {
        const router = Router();
        const paymentMethodService = new PaymentMethodService();
        const controller = new PaymentMethodController(paymentMethodService);

        router.get('/active', controller.listActive);

        router.get('/', AuthMiddleware.requirePermission('payment_methods.manage'), controller.list);
        router.post('/', AuthMiddleware.requirePermission('payment_methods.manage'), controller.create);
        router.put('/:id', AuthMiddleware.requirePermission('payment_methods.manage'), controller.update);
        router.patch('/:id', AuthMiddleware.requirePermission('payment_methods.manage'), controller.update);

        return router;
    }
}
