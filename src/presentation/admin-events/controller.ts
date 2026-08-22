import { Response } from 'express';
import { AuthRequest } from '../auth/middleware';
import { AdminEventBus } from './admin-event-bus';

export class AdminEventsController {
    stream = async (req: AuthRequest, res: Response) => {
        if (!req.tenant) {
            return res.status(403).json({ message: 'Contexto de empresa requerido' });
        }
        await AdminEventBus.subscribe(res, req.tenant.tenant.id, req.user?.id ?? null, req.header("last-event-id"));
    };
}
