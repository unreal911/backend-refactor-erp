import serverless from 'serverless-http';
import { runStartupBootstraps } from '../../bootstrap/startup';
import { envs } from '../../config/envs';
import { AppRouter } from '../../presentation/routes';
import { createExpressApp } from '../../presentation/server';

const app = createExpressApp({
    routes: AppRouter.router,
    public_path: envs.PUBLIC_PATH,
});

const expressHandler = serverless(app);
let startupPromise: Promise<void> | undefined;

function ensureStartup() {
    startupPromise ??= runStartupBootstraps(envs.DATABASE_URL);
    return startupPromise;
}

export const handler: typeof expressHandler = async (event, context) => {
    await ensureStartup();
    return expressHandler(event, context);
};
