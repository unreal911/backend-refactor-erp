import { Request, Response } from 'express';
import { ListCustomerDto, SaveCustomerDto } from '../../domain/dtos/customer.dto';
import { CustomError } from '../../domain/errors/custom.error';
import { CustomerService } from '../services/customer.service';

export class CustomerController {
    constructor(private readonly service = new CustomerService()) {}

    private error(caught: unknown, res: Response) {
        if (caught instanceof CustomError) return res.status(caught.statusCode).json({ message: caught.message });
        console.error(caught);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    list = async (req: Request, res: Response) => {
        const [error, dto] = ListCustomerDto.create(req.query as Record<string, unknown>);
        if (error) return res.status(400).json({ message: error });
        try { return res.status(200).json(await this.service.list(dto!)); }
        catch (caught) { return this.error(caught, res); }
    };

    create = async (req: Request, res: Response) => {
        const [error, dto] = SaveCustomerDto.create(req.body as Record<string, unknown>);
        if (error) return res.status(400).json({ message: error });
        try { return res.status(201).json(await this.service.create(dto!)); }
        catch (caught) { return this.error(caught, res); }
    };

    update = async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Id de cliente invalido' });
        const [error, dto] = SaveCustomerDto.create(req.body as Record<string, unknown>);
        if (error) return res.status(400).json({ message: error });
        try { return res.status(200).json(await this.service.update(id, dto!)); }
        catch (caught) { return this.error(caught, res); }
    };
}
