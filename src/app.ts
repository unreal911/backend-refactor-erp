import "./instrumentation/sentry-api";
import { AppRouter } from "./presentation/routes";
import { Server } from "./presentation/server";
import { envs } from "./config/envs";
import { runStartupBootstraps } from "./bootstrap/startup";
import { AdminEventBus } from "./presentation/admin-events/admin-event-bus";
import { captureOperationalException, flushSentry } from "./presentation/observability/sentry";
import { operationalLog } from "./presentation/observability/operational-logger";

void bootstrap().catch(async (caught) => {
    operationalLog("error", "api.bootstrap_failed", {
        error: caught instanceof Error ? caught.message : String(caught),
    });
    captureOperationalException(caught, { operation: "api.bootstrap", level: "fatal" });
    await flushSentry();
    process.exitCode = 1;
});

async function bootstrap() {
    console.log("Starting backend-refactorizado...");
    await runStartupBootstraps(envs.DATABASE_URL);
    await AdminEventBus.initialize();

    const server = new Server({
        port: envs.PORT,
        routes: AppRouter.router
    });
    await server.start();
}
