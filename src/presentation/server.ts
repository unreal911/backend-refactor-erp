import express, { Router } from 'express';
import path from 'path';
import cors from 'cors';
import { AuditLogMiddleware } from './audit-log/middleware';
import { AuditLogService } from './services/audit-log.service';

interface Options {
    port: number;
    routes: Router;
    public_path?: string;
}

export class Server {

    public readonly app = express();
    private serverListener: any;
    private readonly port: number;
    private readonly publicPath: string;
    private readonly routes: Router;

    constructor(options: Options) {
        const { port, routes, public_path = 'public' } = options;
        this.port = port;
        this.routes = routes;
        this.publicPath = public_path;
    }
    async start() {

        const requestBodyLimit = '100mb';

        this.app.use(cors({
            exposedHeaders: ['x-access-token'],
        }));
        this.app.use(express.json({ limit: requestBodyLimit }));
        this.app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
        this.app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
            if (err?.type === 'entity.too.large' || err?.status === 413) {
                return res.status(413).json({
                    message: `El contenido enviado supera el limite permitido de ${requestBodyLimit}. Reduce el peso de las imagenes o sube menos archivos por vez.`,
                });
            }

            return next(err);
        });
        this.app.use(AuditLogMiddleware.capture(new AuditLogService()));

        const publicDir = path.isAbsolute(this.publicPath)
            ? this.publicPath
            : path.join(__dirname, '..', this.publicPath);

        this.app.use(express.static(publicDir));
        this.app.get('/ ', (_req, res) => {
            res.status(200).json({ status: 'ok' });
        });
        
        this.app.use(this.routes);

        this.app.get(/(.*)/, (req, res) => {
            const indexPath = path.join(publicDir, 'index.html');
            res.sendFile(indexPath);
        });
        this.serverListener = this.app.listen(this.port, '0.0.0.0', () => console.log(`Example app listening on port ${this.port}!`));
    }
    public close() {
        this.serverListener.close();
    }

}
