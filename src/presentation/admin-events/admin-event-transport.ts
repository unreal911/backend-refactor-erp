import { createClient, RedisClientType } from "redis";
import { envs } from "../../config/envs";

export type AdminEventEnvelope = {
    id: string;
    tenantId: string;
    sequence: string;
    payload: Record<string, unknown>;
};

const CHANNEL = "tienda:admin-events:v1";

export class AdminEventTransport {
    private static publisher: RedisClientType | null = null;
    private static subscriber: RedisClientType | null = null;

    static async initialize(onMessage: (event: AdminEventEnvelope) => void): Promise<void> {
        const url = envs.REALTIME_REDIS_URL.trim();
        if (!url) {
            if (envs.API_INSTANCE_COUNT > 1) {
                throw new Error("API_INSTANCE_COUNT > 1 requiere REALTIME_REDIS_URL");
            }
            console.info("[realtime] modo de una instancia; Redis no es obligatorio");
            return;
        }
        const publisher = createClient({ url });
        const subscriber = publisher.duplicate();
        publisher.on("error", (error: Error) => console.error("[realtime-redis:publisher]", error.message));
        subscriber.on("error", (error: Error) => console.error("[realtime-redis:subscriber]", error.message));
        await Promise.all([publisher.connect(), subscriber.connect()]);
        await subscriber.subscribe(CHANNEL, (message: string) => {
            try { onMessage(JSON.parse(message) as AdminEventEnvelope); }
            catch { console.error("[realtime-redis] evento inválido descartado"); }
        });
        this.publisher = publisher as RedisClientType;
        this.subscriber = subscriber as RedisClientType;
        console.info("[realtime] Redis pub/sub conectado");
    }

    static async publish(event: AdminEventEnvelope): Promise<boolean> {
        if (!this.publisher?.isReady) return false;
        await this.publisher.publish(CHANNEL, JSON.stringify(event));
        return true;
    }

    static async close(): Promise<void> {
        await Promise.all([
            this.publisher?.quit().catch(() => undefined),
            this.subscriber?.quit().catch(() => undefined),
        ]);
        this.publisher = null;
        this.subscriber = null;
    }
}
