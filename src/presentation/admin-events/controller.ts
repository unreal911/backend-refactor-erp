import { Response } from 'express';
import { AuthRequest } from '../auth/middleware';
import { AdminEventBus } from './admin-event-bus';

export class AdminEventsController {
    stream = (req: AuthRequest, res: Response) => {
        if (!req.tenant) {
            return res.status(403).json({ message: 'Contexto de empresa requerido' });
        }
        AdminEventBus.subscribe(res, req.tenant.tenant.id, req.user?.id ?? null);
    };
}
