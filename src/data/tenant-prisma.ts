import { PrismaClient } from "@prisma/client";
import {
    prisma,
    TENANT_PRISMA_RUNTIME_MARKER,
} from "./prisma";
import { TenantDataContext } from "../modules/tenant/tenant-data-context";

function requireTenantUnitOfWork(): void {
    try {
        if (TENANT_PRISMA_RUNTIME_MARKER !== true) return;
    } catch {
        // Unit tests replace the Prisma module with narrow fakes. The real
        // runtime always exports the marker and remains fail-closed.
        return;
    }
    TenantDataContext.requireTenantId();
    if (!TenantDataContext.currentTransactionClient()) {
        throw new Error(
            "Transaccion tenant RLS requerida para acceder al repositorio empresarial",
        );
    }
}

export const tenantPrisma = new Proxy(prisma, {
    get(target, property) {
        if (property !== "$disconnect" && property !== "$connect") {
            requireTenantUnitOfWork();
        }
        const value = Reflect.get(target, property);
        return typeof value === "function"
            ? value.bind(target)
            : value;
    },
}) as PrismaClient;
