import { Request, Response } from "express";
import { SizeService } from "../services/size.service";
import { CustomError } from "../../domain/errors/custom.error";
import { SizeDto } from "../../domain/dtos/create-size.dto";
import { ListSizeDto } from "../../domain/dtos/list-size.dto";
import { UpdateSizeDto } from "../../domain/dtos/update-size.dto";

export class SizeController {
    constructor(
        private readonly sizeService: SizeService,
    ) { }

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.log(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    createSize = async (req: Request, res: Response) => {
        const [error, createSizeDto] = SizeDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }
        if (createSizeDto) {
            this.sizeService.createSize(createSizeDto).then(size => {
                return res.status(201).json(size);
            }).catch(error => this.handleError(error, res));
        }
    }

    listSize = async (req: Request, res: Response) => {
        const { skip, take, isActive } = req.query;
        const skipNum = skip ? Number(skip) : undefined;
        const takeNum = take ? Number(take) : undefined;
        const isActiveBool = isActive !== undefined ? isActive === 'true' : undefined;
        const [error, listSizeDto] = ListSizeDto.create(skipNum, takeNum, isActiveBool);
        if (error) {
            return res.status(400).json({ message: error });
        }
        if (listSizeDto) {
            this.sizeService.listSize(listSizeDto).then(sizes => {
                return res.status(200).json(sizes);
            }).catch(error => this.handleError(error, res));
        }
    }

    updateSize = async (req: Request, res: Response) => {
        const { id } = req.params;
        const [error, updateSizeDto] = UpdateSizeDto.create({ id: Number(id), ...req.body });

        if (error) {
            return res.status(400).json({ message: error });
        }
        if (updateSizeDto) {
            this.sizeService.updateSize(updateSizeDto).then(size => {
                return res.status(200).json(size);
            }).catch(error => this.handleError(error, res));
        }
    }

    findsizesbyname = async (req: Request, res: Response) => {
        const { name, isActive } = req.query;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ message: 'El nombre es obligatorio y debe ser una cadena' });
        }
        const isActiveBool = isActive !== undefined ? (isActive === 'true') : undefined;
        this.sizeService.findsizesbyname(name, isActiveBool).then(sizes => {
            if (sizes) {
                return res.status(200).json(sizes);
            } else {
                return res.status(404).json({ message: 'No se encontraron tallas con ese nombre' });
            }
        }).catch(error => this.handleError(error, res));
    }
}
