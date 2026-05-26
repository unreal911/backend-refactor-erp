import { prisma } from "../../data/prisma";
import { CreateStoreDto } from "../../domain/dtos/create-store.dto";
import { UpdateStoreDto } from "../../domain/dtos/update-store.dto";
import { ListStoreDto } from "../../domain/dtos/list-store.dto";
import { CustomError } from "../../domain/errors/custom.error";

export class StoreService {
    constructor() { }

    async createStore(createStoreDto: CreateStoreDto) {
        const existing = await prisma.store.findUnique({
            where: { code: createStoreDto.code }
        });

        if (existing) {
            throw CustomError.badRequest(`El código ${createStoreDto.code} ya está en uso`);
        }

        return prisma.store.create({
            data: {
                name: createStoreDto.name,
                code: createStoreDto.code,
                type: createStoreDto.type,
                address: createStoreDto.address ?? null,
                isActive: createStoreDto.isActive,
            },
        });
    }

    async listStores(listStoreDto: ListStoreDto) {
        const where: any = {};

        if (listStoreDto.search) {
            where.OR = [
                { name: { contains: listStoreDto.search, mode: 'insensitive' } },
                { code: { contains: listStoreDto.search, mode: 'insensitive' } },
                { address: { contains: listStoreDto.search, mode: 'insensitive' } },
            ];
        }

        if (listStoreDto.type) {
            where.type = listStoreDto.type;
        }

        if (!listStoreDto.includeInactive) {
            where.isActive = true;
        }

        return prisma.store.findMany({
            where,
            orderBy: { name: 'asc' },
            skip: (listStoreDto.skip - 1) * listStoreDto.take,
            take: listStoreDto.take,
        });
    }

    async updateStore(id: number, updateStoreDto: UpdateStoreDto) {
        const existing = await prisma.store.findUnique({ where: { id } });
        if (!existing) {
            throw CustomError.notFound(`La tienda con ID ${id} no existe`);
        }

        if (updateStoreDto.code && updateStoreDto.code !== existing.code) {
            const codeInUse = await prisma.store.findUnique({ where: { code: updateStoreDto.code } });
            if (codeInUse) {
                throw CustomError.badRequest(`El código ${updateStoreDto.code} ya está en uso`);
            }
        }

        const updateData: any = {};
        if (updateStoreDto.name !== undefined) updateData.name = updateStoreDto.name;
        if (updateStoreDto.code !== undefined) updateData.code = updateStoreDto.code;
        if (updateStoreDto.type !== undefined) updateData.type = updateStoreDto.type;
        if (updateStoreDto.address !== undefined) updateData.address = updateStoreDto.address ?? null;
        if (updateStoreDto.isActive !== undefined) updateData.isActive = updateStoreDto.isActive;

        return prisma.store.update({
            where: { id },
            data: updateData,
        });
    }

    async deactivateStore(id: number) {
        const existing = await prisma.store.findUnique({ where: { id } });
        if (!existing) {
            throw CustomError.notFound(`La tienda con ID ${id} no existe`);
        }

        return prisma.store.update({
            where: { id },
            data: { isActive: false },
        });
    }
}
