import { CategoryDto } from "../../domain/dtos/create-category.dto";
import { UpdateCategoryDto } from "../../domain/dtos/update-category.dto";
import { prisma } from "../../data/prisma";
import { CustomError } from '../../domain/errors/custom.error';
import { CategoryEntity } from "../../domain/entities/category.entity";
import { ListCategoryDto } from '../../domain/dtos/list-category.dto';
export class CategoryService {

    constructor() { }
    async createCategory(createCategoryDto: CategoryDto): Promise<CategoryEntity> {
        const category = await prisma.category.findFirst({
            where: {
                name: createCategoryDto.name,
            },
        });
        if (category) {
            throw CustomError.badRequest('Ya existe una categoría con ese nombre');
        }
        try {
            const newCategory = await prisma.category.create({
                data: {
                    name: createCategoryDto.name,
                    isActive: createCategoryDto.isActive,
                },
            });
            return CategoryEntity.fromObject(newCategory);
        } catch (error) {
            throw CustomError.internal('Error al crear la categoría');
        }
    }
    async listCategory(listCategoryDto: ListCategoryDto) {
        const { skip: skip = 1, take: take = 10, isActive } = listCategoryDto;
        try {
            const where = {
                ...(isActive !== undefined && { isActive }),
            };
            const categories = await prisma.category.findMany({
                where,
                skip: (skip - 1) * take,
                take: take,
            });
            const total = await prisma.category.count({ where });

            return {
                data: categories.map(category => CategoryEntity.fromObject(category)),
                total,
                page: skip,
                limit: take,
            }
        } catch (error) {
            throw CustomError.internal('Error al listar las categorías');
        }
    }
    findcategoriesbyname(name: string, isActive?: boolean): Promise<CategoryEntity[] | null> {
        return prisma.category.findMany({
            where: {
                name: {
                    contains: name,
                    mode: 'insensitive',
                },
                ...(isActive !== undefined && { isActive }),
            },
        }).then(categories => categories.length > 0 ? categories.map(CategoryEntity.fromObject) : null);
    }
    async updateCategory(updateCategoryDto: UpdateCategoryDto): Promise<CategoryEntity> {
        const { id, name, isActive } = updateCategoryDto;

        const category = await prisma.category.findUnique({
            where: { id },
        });

        if (!category) {
            throw CustomError.notFound('La categoría no existe');
        }

        if (name) {
            const existingCategory = await prisma.category.findFirst({
                where: {
                    name: name,
                    id: { not: id },
                },
            });

            if (existingCategory) {
                throw CustomError.badRequest('Ya existe una categoría con ese nombre');
            }
        }

        try {
            const updatedCategory = await prisma.category.update({
                where: { id },
                data: {
                    ...(name && { name }),
                    ...(isActive !== undefined && { isActive }),
                },
            });

            return CategoryEntity.fromObject(updatedCategory);
        } catch (error) {
            throw CustomError.internal('Error al actualizar la categoría');
        }
    }
}
