import { Request, Response } from 'express';
import { CustomError } from '../../domain/errors/custom.error';
import { PaymentMethodService } from '../services/payment-method.service';
import { ListPaymentMethodDto } from '../../domain/dtos/list-payment-method.dto';
import { CreatePaymentMethodDto } from '../../domain/dtos/create-payment-method.dto';
import { UpdatePaymentMethodDto } from '../../domain/dtos/update-payment-method.dto';

export class PaymentMethodController {
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
    ) {}

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.error(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    list = async (req: Request, res: Response) => {
        const [error, dto] = ListPaymentMethodDto.create(req.query as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const result = await this.paymentMethodService.list(dto!);
            return res.status(200).json(result);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    listActive = async (_req: Request, res: Response) => {
        try {
            const result = await this.paymentMethodService.listActive();
            return res.status(200).json({ data: result });
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    create = async (req: Request, res: Response) => {
        const [error, dto] = CreatePaymentMethodDto.create(req.body as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const created = await this.paymentMethodService.create(dto!);
            return res.status(201).json(created);
        } catch (err) {
            return this.handleError(err, res);
        }
    };

    update = async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        const [error, dto] = UpdatePaymentMethodDto.create({
            id,
            ...(req.body as object),
        } as { [key: string]: unknown });
        if (error) {
            return res.status(400).json({ message: error });
        }

        try {
            const updated = await this.paymentMethodService.update(dto!);
            return res.status(200).json(updated);
        } catch (err) {
            return this.handleError(err, res);
        }
    };
}
