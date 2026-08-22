import { Prisma } from '@prisma/client';
import { tenantPrisma as prisma } from '../../data/tenant-prisma';
import { CustomError } from '../../domain/errors/custom.error';
import { ListCustomerDto, SaveCustomerDto } from '../../domain/dtos/customer.dto';
import { TenantDataContext } from '../../modules/tenant/tenant-data-context';

type CustomerRow = {
    id: number;
    name: string;
    documentType: string | null;
    documentNumber: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export class CustomerService {
    async list(dto: ListCustomerDto) {
        const tenantId = TenantDataContext.requireTenantId();
        const filters: Prisma.Sql[] = [Prisma.sql`"tenantId" = ${tenantId}::uuid`];
        if (dto.isActive !== undefined) filters.push(Prisma.sql`"isActive" = ${dto.isActive}`);
        if (dto.search) {
            const pattern = `%${dto.search}%`;
            filters.push(Prisma.sql`(
                "name" ILIKE ${pattern}
                OR COALESCE("documentNumber", '') ILIKE ${pattern}
                OR COALESCE("email", '') ILIKE ${pattern}
                OR COALESCE("phone", '') ILIKE ${pattern}
            )`);
        }
        const where = Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
        const offset = (dto.page - 1) * dto.limit;
        const [rows, totals] = await Promise.all([
            prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
                SELECT "id", "name", "documentType", "documentNumber", "email", "phone", "address", "isActive", "createdAt", "updatedAt"
                FROM "Customer" ${where}
                ORDER BY "isActive" DESC, "name" ASC
                OFFSET ${offset} LIMIT ${dto.limit}
            `),
            prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
                SELECT COUNT(*) AS total FROM "Customer" ${where}
            `),
        ]);
        return { data: rows, total: Number(totals[0]?.total ?? 0), page: dto.page, limit: dto.limit };
    }

    async create(dto: SaveCustomerDto) {
        const tenantId = TenantDataContext.requireTenantId();
        await this.assertDocumentAvailable(tenantId, dto.documentNumber);
        const rows = await prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
            INSERT INTO "Customer" ("tenantId", "name", "documentType", "documentNumber", "email", "phone", "address", "isActive", "updatedAt")
            VALUES (${tenantId}::uuid, ${dto.name}, ${dto.documentType ?? null}, ${dto.documentNumber ?? null}, ${dto.email ?? null}, ${dto.phone ?? null}, ${dto.address ?? null}, ${dto.isActive}, CURRENT_TIMESTAMP)
            RETURNING "id", "name", "documentType", "documentNumber", "email", "phone", "address", "isActive", "createdAt", "updatedAt"
        `);
        if (!rows[0]) throw CustomError.internal('No se pudo registrar el cliente');
        return rows[0];
    }

    async update(id: number, dto: SaveCustomerDto) {
        const tenantId = TenantDataContext.requireTenantId();
        const exists = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT "id" FROM "Customer" WHERE "id" = ${id} AND "tenantId" = ${tenantId}::uuid LIMIT 1
        `);
        if (!exists[0]) throw CustomError.notFound('Cliente no encontrado');
        await this.assertDocumentAvailable(tenantId, dto.documentNumber, id);
        const rows = await prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
            UPDATE "Customer"
            SET "name" = ${dto.name}, "documentType" = ${dto.documentType ?? null},
                "documentNumber" = ${dto.documentNumber ?? null}, "email" = ${dto.email ?? null},
                "phone" = ${dto.phone ?? null}, "address" = ${dto.address ?? null},
                "isActive" = ${dto.isActive}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}::uuid
            RETURNING "id", "name", "documentType", "documentNumber", "email", "phone", "address", "isActive", "createdAt", "updatedAt"
        `);
        if (!rows[0]) throw CustomError.internal('No se pudo actualizar el cliente');
        return rows[0];
    }

    private async assertDocumentAvailable(tenantId: string, documentNumber?: string, excludedId?: number) {
        if (!documentNumber) return;
        const duplicate = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT "id" FROM "Customer"
            WHERE "tenantId" = ${tenantId}::uuid AND "documentNumber" = ${documentNumber}
              ${excludedId ? Prisma.sql`AND "id" <> ${excludedId}` : Prisma.empty}
            LIMIT 1
        `);
        if (duplicate[0]) throw CustomError.badRequest('Ya existe un cliente con ese documento');
    }
}
