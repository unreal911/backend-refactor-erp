import { runTenantDatabaseTransaction } from "../../src/data/prisma";
import { LEGACY_TENANT_ID } from "../../src/modules/tenant/tenant-data-context";

/**
 * Los tests heredados invocan servicios sin pasar por middleware HTTP.
 * Este proxy conserva ese estilo y abre una unidad RLS independiente por
 * llamada, incluso en escenarios concurrentes.
 */
export function tenantService<T extends object>(
    service: T,
    tenantId = LEGACY_TENANT_ID,
): T {
    return new Proxy(service, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => runTenantDatabaseTransaction(
                tenantId,
                () => value.apply(target, args),
            );
        },
    });
}
