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

        this.app.use(express.json({ limit: '15mb' }));
        this.app.use(cors({
            exposedHeaders: ['x-access-token'],
        }));
        this.app.use(express.urlencoded({ extended: true, limit: '15mb' }));
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
