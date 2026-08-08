import { Router } from 'express';
import { AuthMiddleware } from '../../presentation/auth/middleware';
import { ReportController } from './controller';

export function registerReportModuleRoutes(router: Router): void {
    const reportRouter = Router();
    const controller = new ReportController();
    reportRouter.get('/sources', AuthMiddleware.requirePermission('reports.view'), controller.sources);
    reportRouter.post('/preview', AuthMiddleware.requirePermission('reports.view'), controller.preview);
    reportRouter.post('/export', AuthMiddleware.requirePermission('reports.export'), controller.export);
    router.use('/api/reports', AuthMiddleware.validateJWT, reportRouter);
}
