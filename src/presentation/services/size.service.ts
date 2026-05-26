import { SizeDto } from "../../domain/dtos/create-size.dto";
import { UpdateSizeDto } from "../../domain/dtos/update-size.dto";
import { prisma } from "../../data/prisma";
import { CustomError } from '../../domain/errors/custom.error';
import { SizeEntity } from "../../domain/entities/size.entity";
import { ListSizeDto } from '../../domain/dtos/list-size.dto';

export class SizeService {

    constructor() { }

    async createSize(createSizeDto: SizeDto): Promise<SizeEntity> {
        const size = await prisma.size.findFirst({
            where: {
                name: createSizeDto.name,
            },
        });
        if (size) {
            throw CustomError.badRequest('Ya existe una talla con ese nombre');
        }
        try {
            const newSize = await prisma.size.create({
                data: {
                    name: createSizeDto.name,
                    isActive: createSizeDto.isActive,
                },
            });
            return SizeEntity.fromObject(newSize);
        } catch (error) {
            throw CustomError.internal('Error al crear la talla');
        }
    }

    async listSize(listSizeDto: ListSizeDto) {
        const { skip, take, isActive } = listSizeDto;
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
            const sizes = await prisma.size.findMany(options);
            const total = await prisma.size.count({ where });

            return {
                data: sizes.map(size => SizeEntity.fromObject(size)),
                total,
                page: skip || 1,
                limit: take || total,
            }
        } catch (error) {
            throw CustomError.internal('Error al listar las tallas');
        }
    }

    findsizesbyname(name: string, isActive?: boolean): Promise<SizeEntity[] | null> {
        return prisma.size.findMany({
            where: {
                name: {
                    contains: name,
                    mode: 'insensitive',
                },
                ...(isActive !== undefined && { isActive }),
            },
        }).then(sizes => sizes.length > 0 ? sizes.map(SizeEntity.fromObject) : null);
    }

    async updateSize(updateSizeDto: UpdateSizeDto): Promise<SizeEntity> {
        const { id, name, isActive } = updateSizeDto;

        const size = await prisma.size.findUnique({
            where: { id },
        });

        if (!size) {
            throw CustomError.notFound('La talla no existe');
        }

        if (name) {
            const existingSize = await prisma.size.findFirst({
                where: {
                    name: name,
                    id: { not: id },
                },
            });

            if (existingSize) {
                throw CustomError.badRequest('Ya existe una talla con ese nombre');
            }
        }

        try {
            const updatedSize = await prisma.size.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(isActive !== undefined && { isActive }),
                },
            });

            return SizeEntity.fromObject(updatedSize);
        } catch (error) {
            throw CustomError.internal('Error al actualizar la talla');
        }
    }
}
