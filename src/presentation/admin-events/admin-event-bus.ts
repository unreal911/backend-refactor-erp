import { Response } from 'express';

export type AdminEventType =
    | 'ORDER_CREATED'
    | 'ORDER_UPDATED'
    | 'ORDER_STATUS_UPDATED'
    | 'ORDER_RESPONSIBLE_ASSIGNED'
    | 'ORDER_RETURN_UPDATED'
    | 'ORDER_PICKING_UPDATED'
    | 'INVENTORY_UPDATED';

export interface AdminEventPayload {
    type: AdminEventType;
    entity: 'ORDER' | 'INVENTORY';
    entityId?: number | null;
    entityCode?: string | null;
    status?: string | null;
    actorUserId?: number | null;
    targetUserId?: number | null;
    timestamp?: string;
}

interface AdminEventClient {
    id: number;
    userId: number | null;
    response: Response;
    heartbeat: NodeJS.Timeout;
}

export class AdminEventBus {
    private static clients = new Map<number, AdminEventClient>();
    private static nextClientId = 1;

    static subscribe(response: Response, userId?: number | null) {
        const clientId = this.nextClientId++;
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache, no-transform');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        response.flushHeaders?.();

        const write = (event: string, data: unknown) => {
            response.write(`event: ${event}\n`);
            response.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        write('connected', {
            clientId,
            timestamp: new Date().toISOString(),
        });

        const heartbeat = setInterval(() => {
            if (response.writableEnded) {
                clearInterval(heartbeat);
                this.clients.delete(clientId);
                return;
            }
            write('heartbeat', { timestamp: new Date().toISOString() });
        }, 25_000);

        this.clients.set(clientId, {
            id: clientId,
            userId: Number.isInteger(Number(userId)) ? Number(userId) : null,
            response,
            heartbeat,
        });

        response.on('close', () => {
            clearInterval(heartbeat);
            this.clients.delete(clientId);
        });
    }

    static publish(payload: AdminEventPayload) {
        const event = {
            ...payload,
            timestamp: payload.timestamp || new Date().toISOString(),
        };

        for (const [clientId, client] of this.clients) {
            if (client.response.writableEnded) {
                clearInterval(client.heartbeat);
                this.clients.delete(clientId);
                continue;
            }

            try {
                client.response.write('event: admin-update\n');
                client.response.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
                clearInterval(client.heartbeat);
                this.clients.delete(clientId);
            }
        }
    }
}
