import { Prisma } from '@prisma/client';
import { prisma } from '../../data/prisma';
import { ListUserActivityDto } from '../../domain/dtos/list-user-activity.dto';

export type UserActivityProduct = {
    variantId: number;
    sku?: string | null;
    productName?: string | null;
    color?: string | null;
    size?: string | null;
    quantity?: number | null;
};

export type RegisterUserActivityInput = {
    userId?: number | null;
    userEmail?: string | null;
    userRole?: string | null;
    module: string;
    actionType: string;
    actionLabel: string;
    entityType: string;
    entityId?: number | null;
    entityCode?: string | null;
    description?: string | null;
    products?: UserActivityProduct[];
    context?: Record<string, unknown> | null;
};

type UserActivityRow = {
    id: number;
    userId: number | null;
    userEmail: string | null;
    userRole: string | null;
    module: string;
    actionType: string;
    actionLabel: string;
    entityType: string;
    entityId: number | null;
    entityCode: string | null;
    description: string | null;
    products: unknown;
    context: unknown;
    createdAt: Date;
};

type UserActivityResponse = {
    id: number;
    createdAt: Date;
    user: {
        id: number | null;
        email: string | null;
        role: string | null;
    };
    module: string;
    actionType: string;
    actionLabel: string;
    entity: {
        type: string;
        id: number | null;
        code: string | null;
    };
    description: string | null;
    products: UserActivityProduct[];
    context: Record<string, unknown>;
};

export class UserActivityService {
    constructor() {}

    private sanitizeText(value: unknown, fallback = '', maxLength = 120): string {
        const normalized = String(value ?? '').trim();
        if (!normalized) {
            return fallback;
        }
        return normalized.slice(0, maxLength);
    }

    private stringifyJson(value: unknown, fallback: string): string {
        if (value === undefined) {
            return fallback;
        }

        try {
            const serialized = JSON.stringify(value, (_key, innerValue) => {
                if (typeof innerValue === 'bigint') {
                    return Number(innerValue);
                }
                return innerValue;
            });

            return serialized === undefined ? fallback : serialized;
        } catch {
            return fallback;
        }
    }

    private parseJsonValue(value: unknown): unknown {
        if (value === null || value === undefined) {
            return null;
        }

        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }

        return value;
    }

    private normalizeProducts(rawValue: unknown): UserActivityProduct[] {
        const parsed = this.parseJsonValue(rawValue);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .map((item) => item as UserActivityProduct)
            .filter((item) => Number.isInteger(Number(item?.variantId)) && Number(item?.variantId) > 0)
            .map((item) => ({
                variantId: Number(item.variantId),
                sku: item.sku ? String(item.sku) : null,
                productName: item.productName ? String(item.productName) : null,
                color: item.color ? String(item.color) : null,
                size: item.size ? String(item.size) : null,
                quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
            }));
    }

    private normalizeContext(rawValue: unknown): Record<string, unknown> {
        const parsed = this.parseJsonValue(rawValue);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    }

    private toResponse(row: UserActivityRow): UserActivityResponse {
        return {
            id: Number(row.id),
            createdAt: new Date(row.createdAt),
            user: {
                id: row.userId === null ? null : Number(row.userId),
                email: row.userEmail ? String(row.userEmail) : null,
                role: row.userRole ? String(row.userRole) : null,
            },
            module: String(row.module || ''),
            actionType: String(row.actionType || ''),
            actionLabel: String(row.actionLabel || ''),
            entity: {
                type: String(row.entityType || ''),
                id: row.entityId === null ? null : Number(row.entityId),
                code: row.entityCode ? String(row.entityCode) : null,
            },
            description: row.description ? String(row.description) : null,
            products: this.normalizeProducts(row.products),
            context: this.normalizeContext(row.context),
        };
    }

    async register(input: RegisterUserActivityInput): Promise<void> {
        const module = this.sanitizeText(input.module, 'GENERAL', 50).toUpperCase();
        const actionType = this.sanitizeText(input.actionType, 'ACTION', 80).toUpperCase();
        const actionLabel = this.sanitizeText(input.actionLabel, actionType, 140);
        const entityType = this.sanitizeText(input.entityType, 'UNKNOWN', 50).toUpperCase();

        const description = this.sanitizeText(input.description, '', 500) || null;
        const entityCode = this.sanitizeText(input.entityCode, '', 120) || null;
        const userEmail = this.sanitizeText(input.userEmail, '', 180) || null;
        const userRole = this.sanitizeText(input.userRole, '', 80) || null;

        const productsJson = this.stringifyJson(Array.isArray(input.products) ? input.products : [], '[]');
        const contextJson = this.stringifyJson(input.context ?? {}, '{}');

        try {
            await prisma.$executeRaw(
                Prisma.sql`
                    INSERT INTO "UserActivityLog" (
                        "userId",
                        "userEmail",
                        "userRole",
                        "module",
                        "actionType",
                        "actionLabel",
                        "entityType",
                        "entityId",
                        "entityCode",
                        "description",
                        "products",
                        "context"
                    )
                    VALUES (
                        ${input.userId ?? null},
                        ${userEmail},
                        ${userRole},
                        ${module},
                        ${actionType},
                        ${actionLabel},
                        ${entityType},
                        ${input.entityId ?? null},
                        ${entityCode},
                        ${description},
                        ${productsJson}::jsonb,
                        ${contextJson}::jsonb
                    )
                `,
            );
        } catch (error) {
            console.error('User activity log insert warning:', error);
        }
    }

    async list(dto: ListUserActivityDto) {
        const where: Prisma.Sql[] = [];

        if (dto.search) {
            const like = `%${dto.search}%`;
            where.push(
                Prisma.sql`
                    (
                        "userEmail" ILIKE ${like}
                        OR "userRole" ILIKE ${like}
                        OR "module" ILIKE ${like}
                        OR "actionType" ILIKE ${like}
                        OR "actionLabel" ILIKE ${like}
                        OR "entityCode" ILIKE ${like}
                        OR "description" ILIKE ${like}
                    )
                `,
            );
        }

        if (dto.userId !== undefined) {
            where.push(Prisma.sql`"userId" = ${dto.userId}`);
        }

        if (dto.module) {
            where.push(Prisma.sql`"module" = ${dto.module}`);
        }

        if (dto.actionType) {
            where.push(Prisma.sql`"actionType" = ${dto.actionType}`);
        }

        if (dto.entityType) {
            where.push(Prisma.sql`"entityType" = ${dto.entityType}`);
        }

        if (dto.startDate) {
            where.push(Prisma.sql`"createdAt" >= ${dto.startDate}`);
        }

        if (dto.endDate) {
            where.push(Prisma.sql`"createdAt" <= ${dto.endDate}`);
        }

        const whereSql = where.length > 0
            ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`
            : Prisma.empty;

        const offset = (dto.page - 1) * dto.limit;

        const rows = await prisma.$queryRaw<UserActivityRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "userId",
                    "userEmail",
                    "userRole",
                    "module",
                    "actionType",
                    "actionLabel",
                    "entityType",
                    "entityId",
                    "entityCode",
                    "description",
                    "products",
                    "context",
                    "createdAt"
                FROM "UserActivityLog"
                ${whereSql}
                ORDER BY "createdAt" DESC, "id" DESC
                OFFSET ${offset}
                LIMIT ${dto.limit}
            `,
        );

        const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>(
            Prisma.sql`
                SELECT COUNT(*) AS total
                FROM "UserActivityLog"
                ${whereSql}
            `,
        );

        const totalRaw = totalRows[0]?.total ?? 0;
        const total = typeof totalRaw === 'bigint' ? Number(totalRaw) : Number(totalRaw || 0);

        return {
            data: rows.map((row) => this.toResponse(row)),
            total,
            page: dto.page,
            limit: dto.limit,
        };
    }
}
