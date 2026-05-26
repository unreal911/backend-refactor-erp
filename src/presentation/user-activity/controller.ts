import { Request, Response } from 'express';
import { ListUserActivityDto } from '../../domain/dtos/list-user-activity.dto';
import { UserActivityService } from '../services/user-activity.service';

export class UserActivityController {
    constructor(private readonly userActivityService: UserActivityService) {}

    list = async (req: Request, res: Response) => {
        const [error, dto] = ListUserActivityDto.create(req.query as { [key: string]: any });

        if (error) {
            return res.status(400).json({ error });
        }

        try {
            const result = await this.userActivityService.list(dto!);

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
            return res.status(500).json({ error: 'No se pudo cargar la auditoria de movimientos de usuarios' });
        }
    };
}
