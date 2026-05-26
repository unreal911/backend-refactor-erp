import { ColorDto } from "../../domain/dtos/create-color.dto";
import { UpdateColorDto } from "../../domain/dtos/update-color.dto";
import { prisma } from "../../data/prisma";
import { CustomError } from '../../domain/errors/custom.error';
import { ColorEntity } from "../../domain/entities/color.entity";
import { ListColorDto } from '../../domain/dtos/list-color.dto';

export class ColorService {

    constructor() { }

    async createColor(createColorDto: ColorDto): Promise<ColorEntity> {
        const color = await prisma.color.findFirst({
            where: {
                name: createColorDto.name,
            },
        });
        if (color) {
            throw CustomError.badRequest('Ya existe un color con ese nombre');
        }
        try {
            const newColor = await prisma.color.create({
                data: {
                    name: createColorDto.name,
                    hex: createColorDto.hex || null,
                    isActive: createColorDto.isActive,
                },
            });
            return ColorEntity.fromObject(newColor);
        } catch (error) {
            throw CustomError.internal('Error al crear el color');
        }
    }

    async listColor(listColorDto: ListColorDto) {
        const { skip, take, isActive } = listColorDto;
        try {
            const where = {
                ...(isActive !== undefined && { isActive }),
            };
            const options: any = {
                where,
            };
            if (take !== undefined) {
                options.skip = skip ? (skip - 1) * take : 0;
                options.take = take;
            }
            const colors = await prisma.color.findMany(options);
            const total = await prisma.color.count({ where });

            return {
                data: colors.map(color => ColorEntity.fromObject(color)),
                total,
                page: skip || 1,
                limit: take || total,
            }
        } catch (error) {
            throw CustomError.internal('Error al listar los colores');
        }
    }

    findcolorsbyname(name: string, isActive?: boolean): Promise<ColorEntity[] | null> {
        return prisma.color.findMany({
            where: {
                name: {
                    contains: name,
                    mode: 'insensitive',
                },
                ...(isActive !== undefined && { isActive }),
            },
        }).then(colors => colors.length > 0 ? colors.map(ColorEntity.fromObject) : null);
    }

    async updateColor(updateColorDto: UpdateColorDto): Promise<ColorEntity> {
        const { id, name, hex, isActive } = updateColorDto;

        const color = await prisma.color.findUnique({
            where: { id },
        });

        if (!color) {
            throw CustomError.notFound('El color no existe');
        }

        if (name) {
            const existingColor = await prisma.color.findFirst({
                where: {
                    name: name,
                    id: { not: id },
                },
            });

            if (existingColor) {
                throw CustomError.badRequest('Ya existe un color con ese nombre');
            }
        }

        try {
            const updatedColor = await prisma.color.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(hex !== undefined && { hex: hex || null }),
                    ...(isActive !== undefined && { isActive }),
                },
            });

            return ColorEntity.fromObject(updatedColor);
        } catch (error) {
            throw CustomError.internal('Error al actualizar el color');
        }
    }
}