import { Response } from 'express';
import { TenantDataContext } from '../../modules/tenant/tenant-data-context';

export type AdminEventType =
    | 'ORDER_CREATED'
    | 'ORDER_UPDATED'
    | 'ORDER_STATUS_UPDATED'
    | 'ORDER_RESPONSIBLE_ASSIGNED'
    | 'ORDER_RETURN_UPDATED'
    | 'ORDER_PICKING_UPDATED'
    | 'INVENTORY_UPDATED'
    | 'TRANSFER_CREATED'
    | 'TRANSFER_UPDATED';

export interface AdminEventPayload {
    type: AdminEventType;
    entity: 'ORDER' | 'INVENTORY' | 'TRANSFER';
    entityId?: number | null;
    entityCode?: string | null;
    status?: string | null;
    actorUserId?: number | null;
    targetUserId?: number | null;
    timestamp?: string;
    sequence?: number;
}

interface AdminEventClient {
    id: number;
    userId: number | null;
    tenantId: string;
    response: Response;
    heartbeat: NodeJS.Timeout;
}

export class AdminEventBus {
    private static clients = new Map<number, AdminEventClient>();
    private static nextClientId = 1;
    private static sequences = new Map<string, number>();

    static subscribe(response: Response, tenantId: string, userId?: number | null) {
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
            tenantId,
            response,
            heartbeat,
        });

        response.on('close', () => {
            clearInterval(heartbeat);
            this.clients.delete(clientId);
        });
    }

    static publish(payload: AdminEventPayload) {
        const tenantId = TenantDataContext.currentTenantId();
        if (!tenantId) return;
        TenantDataContext.afterCommit(() => this.deliver(tenantId, payload));
    }

    private static deliver(tenantId: string, payload: AdminEventPayload) {
        const sequence = (this.sequences.get(tenantId) ?? 0) + 1;
        this.sequences.set(tenantId, sequence);
        const event = {
            ...payload,
            sequence,
            timestamp: payload.timestamp || new Date().toISOString(),
        };

        for (const [clientId, client] of this.clients) {
            if (client.tenantId !== tenantId) continue;
            if (client.response.writableEnded) {
                clearInterval(client.heartbeat);
                this.clients.delete(clientId);
                continue;
            }

            try {
                client.response.write(`id: ${sequence}\n`);
                client.response.write('event: admin-update\n');
                client.response.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
                clearInterval(client.heartbeat);
                this.clients.delete(clientId);
            }
        }
    }
}
