import express, { Router } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import { AuditLogMiddleware } from './audit-log/middleware';
import { AuditLogService } from './services/audit-log.service';
import { envs } from '../config/envs';

interface Options {
    port: number;
    routes: Router;
    public_path?: string;
}

type CreateAppOptions = Omit<Options, 'port'>;

export function createExpressApp(options: CreateAppOptions) {
    const { routes, public_path = 'public' } = options;
    const app = express();
    const requestBodyLimit = '100mb';

    // Detras de proxy (Netlify): confiar en X-Forwarded-* para IP correcta
    // (necesario para rate-limit por IP).
    app.set('trust proxy', 1);

    app.use((req, _res, next) => {
        const netlifyFunctionPrefix = '/.netlify/functions/api';
        if (req.url.startsWith(netlifyFunctionPrefix)) {
            req.url = req.url.slice(netlifyFunctionPrefix.length) || '/';
        }
        next();
    });

    // Cabeceras de seguridad. CSP desactivada para no romper la SPA servida.
    app.use(helmet({ contentSecurityPolicy: false }));

    // CORS: si CORS_ORIGINS esta definido, restringe a esa allowlist; si esta
    // vacio, permite todos los origenes (comportamiento previo, no rompe deploy).
    const corsAllowlist = envs.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
    app.use(cors({
        exposedHeaders: ['x-access-token'],
        origin: corsAllowlist.length === 0
            ? true
            : (origin, callback) => {
                // Permite requests sin Origin (server-to-server, curl, health checks).
                if (!origin || corsAllowlist.includes(origin)) {
                    return callback(null, true);
                }
                return callback(new Error('Origen no permitido por CORS'));
            },
    }));
    app.use(express.json({ limit: requestBodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
    app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err?.type === 'entity.too.large' || err?.status === 413) {
            return res.status(413).json({
                message: `El contenido enviado supera el limite permitido de ${requestBodyLimit}. Reduce el peso de las imagenes o sube menos archivos por vez.`,
            });
        }

        return next(err);
    });
    app.use(AuditLogMiddleware.capture(new AuditLogService()));

    const publicDir = path.isAbsolute(public_path)
        ? public_path
        : path.join(__dirname, '..', public_path);

    app.use(express.static(publicDir));
    app.get('/api/health', (_req, res) => {
        res.status(200).json({ status: 'ok' });
    });

    app.use(routes);

    app.get(/(.*)/, (_req, res) => {
        const indexPath = path.join(publicDir, 'index.html');
        res.sendFile(indexPath);
    });

    return app;
}

export class Server {

    public readonly app: express.Express;
    private serverListener: any;
    private readonly port: number;

    constructor(options: Options) {
        const { port, ...appOptions } = options;
        this.port = port;
        this.app = createExpressApp(appOptions);
    }
    async start() {
        this.serverListener = this.app.listen(this.port, '0.0.0.0', () => console.log(`Example app listening on port ${this.port}!`));
    }
    public close() {
        this.serverListener.close();
    }

}
