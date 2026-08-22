import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";

type TenantDataStore = {
    tenantId: string;
    transactionClient?: Prisma.TransactionClient;
    afterCommitTasks?: Array<() => void | Promise<void>>;
};

export const LEGACY_TENANT_ID = "00000000-0000-4000-8000-000000000001";

const tenantStorage = new AsyncLocalStorage<TenantDataStore>();

export class TenantDataContext {
    static run<T>(
        tenantId: string,
        callback: () => T | Promise<T>,
    ): Promise<T> {
        const normalizedTenantId = String(tenantId || "").trim();
        if (!normalizedTenantId) {
            throw new Error("tenantId requerido para el contexto de datos");
        }
        return tenantStorage.run(
            { tenantId: normalizedTenantId },
            async () => await callback(),
        );
    }

    static currentTenantId(): string | null {
        return tenantStorage.getStore()?.tenantId ?? null;
    }

    static runWithTransaction<T>(
        tenantId: string,
        transactionClient: Prisma.TransactionClient,
        callback: () => T | Promise<T>,
        afterCommitTasks: Array<() => void | Promise<void>> = [],
    ): Promise<T> {
        const normalizedTenantId = String(tenantId || "").trim();
        if (!normalizedTenantId) {
            throw new Error("tenantId requerido para el contexto de datos");
        }
        return tenantStorage.run(
            {
                tenantId: normalizedTenantId,
                transactionClient,
                afterCommitTasks,
            },
            async () => await callback(),
        );
    }

    static currentTransactionClient(): Prisma.TransactionClient | null {
        return tenantStorage.getStore()?.transactionClient ?? null;
    }

    static afterCommit(task: () => void | Promise<void>): void {
        const store = tenantStorage.getStore();
        if (store?.transactionClient && store.afterCommitTasks) {
            store.afterCommitTasks.push(task);
            return;
        }
        queueMicrotask(() => { void Promise.resolve(task()).catch(() => undefined); });
    }

    static requireTenantId(): string {
        const tenantId = TenantDataContext.currentTenantId();
        if (!tenantId) {
            throw new Error("Contexto tenant requerido para acceder a datos empresariales");
        }
        return tenantId;
    }
}
