import { Prisma } from "@prisma/client";
import { platformPrisma } from "../../data/platform-prisma";

function jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value, (_key, item) => (
        typeof item === "bigint" ? item.toString() : item
    ))) as Prisma.InputJsonValue;
}

export type PlatformAuditInput = {
    actorPlatformAdminId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    reason?: string | null;
    correlationId?: string | null;
    before?: unknown;
    after?: unknown;
};

export class PlatformAuditService {
    static async record(input: PlatformAuditInput, tx: Prisma.TransactionClient = platformPrisma) {
        return tx.platformAuditEvent.create({
            data: {
                actorPlatformAdminId: input.actorPlatformAdminId ?? null,
                action: input.action,
                entityType: input.entityType,
                entityId: input.entityId ?? null,
                reason: input.reason ?? null,
                correlationId: input.correlationId ?? null,
                ...(input.before !== undefined ? { before: jsonValue(input.before) } : {}),
                ...(input.after !== undefined ? { after: jsonValue(input.after) } : {}),
            },
        });
    }
}
