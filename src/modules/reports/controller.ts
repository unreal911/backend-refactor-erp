import { Response } from 'express';
import { CustomError } from '../../domain/errors/custom.error';
import { AuthRequest } from '../../presentation/auth/middleware';
import { canUseReportSource, parseReportRequest, publicReportSources, reportSource } from './report.registry';
import { ReportService } from './report.service';
import { buildReportXlsx } from './report.xlsx';

export class ReportController {
    constructor(private readonly service = new ReportService()) {}

    private error(caught: unknown, res: Response) {
        if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
        console.error(caught);
        return res.status(500).json({ message: 'No se pudo generar el reporte' });
    }

    sources = (req: AuthRequest, res: Response) => {
        return res.status(200).json({ data: publicReportSources(req.user?.permissions || []) });
    };

    preview = async (req: AuthRequest, res: Response) => {
        try {
            const request = parseReportRequest(req.body || {}, 250);
            if (!canUseReportSource(reportSource(request.source), req.user?.permissions || [])) {
                return res.status(403).json({ message: 'No tienes permiso para consultar esta fuente' });
            }
            return res.status(200).json(await this.service.execute(request));
        } catch (caught) { return this.error(caught, res); }
    };

    export = async (req: AuthRequest, res: Response) => {
        try {
            const request = parseReportRequest(req.body || {}, 10_000);
            if (!canUseReportSource(reportSource(request.source), req.user?.permissions || [])) {
                return res.status(403).json({ message: 'No tienes permiso para exportar esta fuente' });
            }
            const report = await this.service.execute(request);
            const file = await buildReportXlsx(report);
            const stamp = new Date().toISOString().slice(0, 10);
            res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('content-disposition', `attachment; filename="reporte-${request.source}-${stamp}.xlsx"`);
            res.setHeader('x-export-rows', String(report.rows.length));
            return res.status(200).send(file);
        } catch (caught) { return this.error(caught, res); }
    };
}
