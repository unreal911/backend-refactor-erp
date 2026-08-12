import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { AdminEventBus } from "../src/presentation/admin-events/admin-event-bus";
import { TenantDataContext } from "../src/modules/tenant/tenant-data-context";

class FakeResponse extends EventEmitter {
    writableEnded = false;
    writes: string[] = [];
    headers = new Map<string, string>();

    setHeader(name: string, value: string) {
        this.headers.set(name, value);
        return this;
    }

    flushHeaders() {}

    write(value: string) {
        this.writes.push(String(value));
        return true;
    }

    close() {
        this.writableEnded = true;
        this.emit("close");
    }
}

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("AdminEventBus multiempresa", () => {
    it("entrega eventos únicamente a clientes del tenant emisor", async () => {
        const tenantA = "00000000-0000-4000-8000-0000000000a1";
        const tenantB = "00000000-0000-4000-8000-0000000000b2";
        const responseA = new FakeResponse();
        const responseB = new FakeResponse();
        AdminEventBus.subscribe(responseA as never, tenantA, 1);
        AdminEventBus.subscribe(responseB as never, tenantB, 2);
        const baselineA = responseA.writes.length;
        const baselineB = responseB.writes.length;

        await TenantDataContext.run(tenantA, () => {
            AdminEventBus.publish({
                type: "INVENTORY_UPDATED",
                entity: "INVENTORY",
                entityId: 10,
            });
        });
        await flushMicrotasks();

        expect(responseA.writes.slice(baselineA).join("")).toContain("INVENTORY_UPDATED");
        expect(responseA.writes.slice(baselineA).join("")).toContain("id: 1");
        expect(responseB.writes.slice(baselineB).join("")).toBe("");

        responseA.close();
        responseB.close();
    });
});
