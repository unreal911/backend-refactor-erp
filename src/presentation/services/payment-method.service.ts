import { Prisma } from '@prisma/client';
import { prisma } from '../../data/prisma';
import { CustomError } from '../../domain/errors/custom.error';
import { CreatePaymentMethodDto } from '../../domain/dtos/create-payment-method.dto';
import { ListPaymentMethodDto } from '../../domain/dtos/list-payment-method.dto';
import { UpdatePaymentMethodDto } from '../../domain/dtos/update-payment-method.dto';

type PaymentMethodRow = {
    id: number;
    name: string;
    code: string;
    displayOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};

type PaymentMethodResponse = {
    id: number;
    name: string;
    code: string;
    displayOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export class PaymentMethodService {
    constructor() {}

    private toResponse(row: PaymentMethodRow): PaymentMethodResponse {
        return {
            id: Number(row.id),
            name: String(row.name),
            code: String(row.code),
            displayOrder: Number(row.displayOrder || 0),
            isActive: Boolean(row.isActive),
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }

    private normalizeCode(name: string): string {
        return name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    async list(dto: ListPaymentMethodDto) {
        const where: Prisma.Sql[] = [];
        if (dto.isActive !== undefined) {
            where.push(Prisma.sql`"isActive" = ${dto.isActive}`);
        }
        if (dto.search) {
            const like = `%${dto.search}%`;
            where.push(Prisma.sql`("name" ILIKE ${like} OR "code" ILIKE ${like})`);
        }

        const whereSql = where.length > 0
            ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
            : Prisma.empty;

        const offset = (dto.skip - 1) * dto.take;

        const rows = await prisma.$queryRaw<PaymentMethodRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive",
                    "createdAt",
                    "updatedAt"
                FROM "PaymentMethod"
                ${whereSql}
                ORDER BY "isActive" DESC, "displayOrder" ASC, "name" ASC
                OFFSET ${offset}
                LIMIT ${dto.take}
            `,
        );

        const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>(
            Prisma.sql`
                SELECT COUNT(*) AS total
                FROM "PaymentMethod"
                ${whereSql}
            `,
        );

        const totalRaw = totalRows[0]?.total ?? 0;
        const total = typeof totalRaw === 'bigint' ? Number(totalRaw) : Number(totalRaw || 0);

        return {
            data: rows.map((row) => this.toResponse(row)),
            total,
            page: dto.skip,
            limit: dto.take,
        };
    }

    async listActive() {
        const rows = await prisma.$queryRaw<PaymentMethodRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive",
                    "createdAt",
                    "updatedAt"
                FROM "PaymentMethod"
                WHERE "isActive" = true
                ORDER BY "displayOrder" ASC, "name" ASC
            `,
        );

        return rows.map((row) => this.toResponse(row));
    }

    async create(dto: CreatePaymentMethodDto) {
        const code = dto.code && dto.code.length > 0 ? dto.code : this.normalizeCode(dto.name);
        if (!code) {
            throw CustomError.badRequest('No se pudo generar un codigo valido para el metodo de pago');
        }

        const existingByName = await prisma.$queryRaw<Array<{ id: number }>>(
            Prisma.sql`SELECT "id" FROM "PaymentMethod" WHERE lower("name") = lower(${dto.name}) LIMIT 1`,
        );
        if (existingByName.length > 0) {
            throw CustomError.badRequest('Ya existe un metodo de pago con ese nombre');
        }

        const existingByCode = await prisma.$queryRaw<Array<{ id: number }>>(
            Prisma.sql`SELECT "id" FROM "PaymentMethod" WHERE "code" = ${code} LIMIT 1`,
        );
        if (existingByCode.length > 0) {
            throw CustomError.badRequest('Ya existe un metodo de pago con ese codigo');
        }

        const inserted = await prisma.$queryRaw<PaymentMethodRow[]>(
            Prisma.sql`
                INSERT INTO "PaymentMethod" ("name", "code", "displayOrder", "isActive", "updatedAt")
                VALUES (
                    ${dto.name},
                    ${code},
                    COALESCE((SELECT MAX("displayOrder") + 10 FROM "PaymentMethod"), 10),
                    ${dto.isActive},
                    CURRENT_TIMESTAMP
                )
                RETURNING
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive",
                    "createdAt",
                    "updatedAt"
            `,
        );

        const created = inserted[0];
        if (!created) {
            throw CustomError.internal('No se pudo crear el metodo de pago');
        }
        return this.toResponse(created);
    }

    async update(dto: UpdatePaymentMethodDto) {
        const existing = await prisma.$queryRaw<PaymentMethodRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive",
                    "createdAt",
                    "updatedAt"
                FROM "PaymentMethod"
                WHERE "id" = ${dto.id}
                LIMIT 1
            `,
        );

        if (existing.length === 0) {
            throw CustomError.notFound('Metodo de pago no encontrado');
        }

        if (dto.name) {
            const duplicated = await prisma.$queryRaw<Array<{ id: number }>>(
                Prisma.sql`
                    SELECT "id"
                    FROM "PaymentMethod"
                    WHERE lower("name") = lower(${dto.name})
                      AND "id" <> ${dto.id}
                    LIMIT 1
                `,
            );
            if (duplicated.length > 0) {
                throw CustomError.badRequest('Ya existe un metodo de pago con ese nombre');
            }
        }

        const updated = await prisma.$queryRaw<PaymentMethodRow[]>(
            Prisma.sql`
                UPDATE "PaymentMethod"
                SET
                    "name" = COALESCE(${dto.name ?? null}, "name"),
                    "isActive" = COALESCE(${dto.isActive ?? null}, "isActive"),
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ${dto.id}
                RETURNING
                    "id",
                    "name",
                    "code",
                    "displayOrder",
                    "isActive",
                    "createdAt",
                    "updatedAt"
            `,
        );

        const row = updated[0];
        if (!row) {
            throw CustomError.internal('No se pudo actualizar el metodo de pago');
        }
        return this.toResponse(row);
    }
}
