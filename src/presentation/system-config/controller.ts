import { Request, Response } from 'express';
import { CustomError } from '../../domain/errors/custom.error';
import { SystemConfigService } from '../services/system-config.service';
import { UpdateOrderWorkflowSettingsDto } from '../../domain/dtos/update-order-workflow-settings.dto';

export class SystemConfigController {
    constructor(
        private readonly systemConfigService: SystemConfigService,
    ) {}

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    getOrderWorkflowSettings = async (_req: Request, res: Response) => {
        try {
            const result = await this.systemConfigService.getOrderWorkflowSettings();
            return res.status(200).json({ data: result });
        } catch (error) {
            return this.handleError(error, res);
        }
    };

    updateOrderWorkflowSettings = async (req: Request, res: Response) => {
        const [error, dto] = UpdateOrderWorkflowSettingsDto.create(req.body as { [key: string]: any });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.systemConfigService.updateOrderWorkflowSettings(dto!);
            return res.status(200).json({ data: result });
        } catch (err) {
            return this.handleError(err, res);
        }
    };
}
