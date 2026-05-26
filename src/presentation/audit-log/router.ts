import { Router } from 'express';
import { AuthMiddleware } from '../auth/middleware';
import { AuditLogController } from './controller';
import { AuditLogService } from '../services/audit-log.service';

export class auditLogRoute {
    static get router(): Router {
        const router = Router();
        const service = new AuditLogService();
        const controller = new AuditLogController(service);

        router.get('/', AuthMiddleware.requirePermission('settings.manage'), controller.listLogs);

        return router;
    }
}
