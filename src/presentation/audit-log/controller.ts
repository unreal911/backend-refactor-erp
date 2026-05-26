import { Request, Response } from 'express';
import { ListAuditLogDto } from '../../domain/dtos/list-audit-log.dto';
import { AuditLogService } from '../services/audit-log.service';

export class AuditLogController {
    constructor(private readonly auditLogService: AuditLogService) {}

    listLogs = async (req: Request, res: Response) => {
        const [error, dto] = ListAuditLogDto.create(req.query as { [key: string]: any });

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const result = await this.auditLogService.list(dto!);
            return res.status(200).json({
                success: true,
                data: result.data,
                pagination: {
                    page: result.page,
                    limit: result.limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / result.limit),
                },
            });
        } catch (serviceError) {
            console.error(serviceError);
            return res.status(500).json({ error: 'No se pudo cargar la trazabilidad global' });
        }
    };
}
