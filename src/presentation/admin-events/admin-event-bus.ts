import { Prisma } from "@prisma/client";
import { Response } from "express";
import { platformPrisma } from "../../data/platform-prisma";
import { TenantDataContext } from "../../modules/tenant/tenant-data-context";
import { AdminEventEnvelope, AdminEventTransport } from "./admin-event-transport";

export type AdminEventType =
    | "ORDER_CREATED" | "ORDER_UPDATED" | "ORDER_STATUS_UPDATED"
    | "ORDER_RESPONSIBLE_ASSIGNED" | "ORDER_RETURN_UPDATED"
    | "ORDER_PICKING_UPDATED" | "INVENTORY_UPDATED"
    | "TRANSFER_CREATED" | "TRANSFER_UPDATED";

export interface AdminEventPayload {
    type: AdminEventType;
    entity: "ORDER" | "INVENTORY" | "TRANSFER";
    entityId?: number | null;
    entityCode?: string | null;
    status?: string | null;
    actorUserId?: number | null;
    targetUserId?: number | null;
    timestamp?: string;
    sequence?: number | string;
}

interface AdminEventClient {
    tenantId: string;
    response: Response;
    heartbeat: NodeJS.Timeout;
}

export class AdminEventBus {
    private static clients = new Map<number, AdminEventClient>();
    private static nextClientId = 1;
    private static localSequences = new Map<string, number>();
    private static retryTimer: NodeJS.Timeout | null = null;

    static async initialize(): Promise<void> {
        await AdminEventTransport.initialize((event) => this.deliver(event));
        await this.processPending();
        this.retryTimer = setInterval(() => void this.processPending(), 5_000);
        this.retryTimer.unref?.();
    }

    static async subscribe(response: Response, tenantId: string, userId?: number | null, lastEventId?: string | null) {
        const clientId = this.nextClientId++;
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache, no-transform");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");
        response.flushHeaders?.();
        response.write(`event: connected\ndata: ${JSON.stringify({ clientId, userId: userId ?? null, timestamp: new Date().toISOString() })}\n\n`);

        const heartbeat = setInterval(() => {
            if (response.writableEnded) return this.remove(clientId);
            response.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
        }, 25_000);
        this.clients.set(clientId, { tenantId, response, heartbeat });
        response.on("close", () => this.remove(clientId));

        if (/^\d+$/.test(String(lastEventId || ""))) {
            const rows = await platformPrisma.adminEventOutbox.findMany({
                where: { tenantId, status: "PUBLISHED", sequence: { gt: BigInt(String(lastEventId)) } },
                orderBy: { sequence: "asc" },
                take: 500,
            });
            for (const row of rows) this.write(response, {
                id: row.id,
                tenantId: row.tenantId,
                sequence: row.sequence.toString(),
                payload: row.payload as Record<string, unknown>,
            });
        }
    }

    static async publish(payload: AdminEventPayload): Promise<void> {
        const tenantId = TenantDataContext.currentTenantId();
        const tx = TenantDataContext.currentTransactionClient();
        if (!tenantId) return;
        const normalized = { ...payload, timestamp: payload.timestamp || new Date().toISOString() };
        if (!tx) {
            const sequence = (this.localSequences.get(tenantId) ?? 0) + 1;
            this.localSequences.set(tenantId, sequence);
            this.deliver({ id: `local-${sequence}`, tenantId, sequence: String(sequence), payload: normalized });
            return;
        }
        const row = await tx.adminEventOutbox.create({
            data: { tenantId, eventType: payload.type, payload: normalized as Prisma.InputJsonObject },
            select: { id: true },
        });
        TenantDataContext.afterCommit(() => this.dispatch(row.id));
    }

    static async processPending(limit = 100): Promise<void> {
        const stale = new Date(Date.now() - 60_000);
        const rows = await platformPrisma.adminEventOutbox.findMany({
            where: { OR: [
                { status: "PENDING", availableAt: { lte: new Date() } },
                { status: "PROCESSING", updatedAt: { lt: stale } },
            ] },
            select: { id: true },
            orderBy: { createdAt: "asc" },
            take: limit,
        }).catch(() => []);
        await Promise.all(rows.map((row) => this.dispatch(row.id)));
    }

    private static async dispatch(id: string): Promise<void> {
        const stale = new Date(Date.now() - 60_000);
        const claimed = await platformPrisma.adminEventOutbox.updateMany({
            where: { id, OR: [
                { status: "PENDING", availableAt: { lte: new Date() } },
                { status: "PROCESSING", updatedAt: { lt: stale } },
            ] },
            data: { status: "PROCESSING", attempts: { increment: 1 } },
        });
        if (claimed.count !== 1) return;
        const row = await platformPrisma.adminEventOutbox.findUniqueOrThrow({ where: { id } });
        const event: AdminEventEnvelope = { id: row.id, tenantId: row.tenantId, sequence: row.sequence.toString(), payload: row.payload as Record<string, unknown> };
        try {
            const distributed = await AdminEventTransport.publish(event);
            if (!distributed) this.deliver(event);
            await platformPrisma.adminEventOutbox.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
        } catch (error) {
            const delay = Math.min(60_000, 1_000 * 2 ** Math.min(row.attempts, 6));
            await platformPrisma.adminEventOutbox.update({ where: { id }, data: { status: "PENDING", availableAt: new Date(Date.now() + delay) } }).catch(() => undefined);
            console.error("[admin-event-outbox]", error instanceof Error ? error.message : error);
        }
    }

    private static deliver(event: AdminEventEnvelope): void {
        for (const [clientId, client] of this.clients) {
            if (client.tenantId !== event.tenantId) continue;
            if (client.response.writableEnded) { this.remove(clientId); continue; }
            try { this.write(client.response, event); }
            catch { this.remove(clientId); }
        }
    }

    private static write(response: Response, event: AdminEventEnvelope): void {
        response.write(`id: ${event.sequence}\n`);
        response.write("event: admin-update\n");
        response.write(`data: ${JSON.stringify({ ...event.payload, sequence: event.sequence })}\n\n`);
    }

    private static remove(clientId: number): void {
        const client = this.clients.get(clientId);
        if (client) clearInterval(client.heartbeat);
        this.clients.delete(clientId);
    }
}
