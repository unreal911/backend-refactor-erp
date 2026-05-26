import { Request, Response } from "express";
import { ColorService } from "../services/color.service";
import { CustomError } from "../../domain/errors/custom.error";
import { ColorDto } from "../../domain/dtos/create-color.dto";
import { ListColorDto } from "../../domain/dtos/list-color.dto";
import { UpdateColorDto } from "../../domain/dtos/update-color.dto";

export class ColorController {
    constructor(
        private readonly colorService: ColorService,
    ) { }

    private handleError(error: unknown, res: Response) {
        if (error instanceof CustomError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        console.log(error);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }

    createColor = async (req: Request, res: Response) => {
        const [error, createColorDto] = ColorDto.create(req.body);

        if (error) {
            return res.status(400).json({ message: error });
        }
        if (createColorDto) {
            this.colorService.createColor(createColorDto).then(color => {
                return res.status(201).json(color);
            }).catch(error => this.handleError(error, res));
        }
    }

    listColor = async (req: Request, res: Response) => {
        const { skip, take, isActive } = req.query;
        const skipNum = skip ? Number(skip) : undefined;
        const takeNum = take ? Number(take) : undefined;
        const isActiveBool = isActive !== undefined ? isActive === 'true' : undefined;
        const [error, listColorDto] = ListColorDto.create(skipNum, takeNum, isActiveBool);
        if (error) {
            return res.status(400).json({ message: error });
        }
        if (listColorDto) {
            this.colorService.listColor(listColorDto).then(colors => {
                return res.status(200).json(colors);
            }).catch(error => this.handleError(error, res));
        }
    }

    updateColor = async (req: Request, res: Response) => {
        const { id } = req.params;
        const [error, updateColorDto] = UpdateColorDto.create({ id: Number(id), ...req.body });

        if (error) {
            return res.status(400).json({ message: error });
        }
        if (updateColorDto) {
            this.colorService.updateColor(updateColorDto).then(color => {
                return res.status(200).json(color);
            }).catch(error => this.handleError(error, res));
        }
    }

    findcolorsbyname = async (req: Request, res: Response) => {
        const { name, isActive } = req.query;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ message: 'El nombre es obligatorio y debe ser una cadena' });
        }
        const isActiveBool = isActive !== undefined ? (isActive === 'true') : undefined;
        this.colorService.findcolorsbyname(name, isActiveBool).then(colors => {
            if (colors) {
                return res.status(200).json(colors);
            } else {
                return res.status(404).json({ message: 'No se encontraron colores con ese nombre' });
            }
        }).catch(error => this.handleError(error, res));
    }
}