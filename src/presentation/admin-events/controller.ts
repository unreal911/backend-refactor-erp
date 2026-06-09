import { Response } from 'express';
import { AuthRequest } from '../auth/middleware';
import { AdminEventBus } from './admin-event-bus';

export class AdminEventsController {
    stream = (req: AuthRequest, res: Response) => {
        AdminEventBus.subscribe(res, req.user?.id ?? null);
    };
}
