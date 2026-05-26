import { AppRouter } from "./presentation/routes";
import { Server } from "./presentation/server";
import { envs } from "./config/envs";
import { runStartupBootstraps } from "./bootstrap/startup";

void bootstrap();

async function bootstrap() {
    console.log("Starting backend-refactorizado...");
    await runStartupBootstraps(envs.DATABASE_URL);

    const server = new Server({
        port: envs.PORT,
        routes: AppRouter.router
    });
    await server.start();
}
