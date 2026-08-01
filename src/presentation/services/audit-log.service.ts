import { Prisma } from '@prisma/client';
import { platformPrisma } from '../../data/platform-prisma';
import { tenantPrisma } from '../../data/tenant-prisma';
import { ListAuditLogDto } from '../../domain/dtos/list-audit-log.dto';
import { TenantDataContext } from '../../modules/tenant/tenant-data-context';
import { sanitizeAuditValue } from '../audit-log/sanitize-audit-value';

type AuditLogRow = {
    id: number;
    tenantId: string | null;
    dataScope: 'TENANT' | 'PLATFORM' | 'QUARANTINE';
    actorUserId: number | null;
    actorEmail: string | null;
    actorRole: string | null;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    ipAddress: string | null;
    userAgent: string | null;
    requestQuery: unknown;
    requestParams: unknown;
    requestBody: unknown;
    createdAt: Date;
};

type AuditLogInsertInput = {
    tenantId?: string | null;
    actorUserId?: number | null;
    actorEmail?: string | null;
    actorRole?: string | null;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    ipAddress?: string | null;
    userAgent?: string | null;
    requestQuery?: unknown;
    requestParams?: unknown;
    requestBody?: unknown;
};

type AuditLogResponse = {
    id: number;
    createdAt: Date;
    actor: {
        id: number | null;
        email: string | null;
        role: string | null;
    };
    request: {
        method: string;
        path: string;
        query: unknown;
        params: unknown;
        body: unknown;
    };
    response: {
        statusCode: number;
        durationMs: number;
        isError: boolean;
    };
    context: {
        tenantId: string | null;
        ipAddress: string | null;
        userAgent: string | null;
    };
};

export class AuditLogService {
    constructor() {}

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

    private toResponse(row: AuditLogRow): AuditLogResponse {
        const statusCode = Number(row.statusCode || 0);
        const durationMs = Number(row.durationMs || 0);

        return {
            id: Number(row.id),
            createdAt: new Date(row.createdAt),
            actor: {
                id: row.actorUserId === null ? null : Number(row.actorUserId),
                email: row.actorEmail ? String(row.actorEmail) : null,
                role: row.actorRole ? String(row.actorRole) : null,
            },
            request: {
                method: String(row.method || '').toUpperCase(),
                path: String(row.path || ''),
                query: this.parseJsonValue(row.requestQuery),
                params: this.parseJsonValue(row.requestParams),
                body: this.parseJsonValue(row.requestBody),
            },
            response: {
                statusCode,
                durationMs,
                isError: statusCode >= 400,
            },
            context: {
                tenantId: row.tenantId ? String(row.tenantId) : null,
                ipAddress: row.ipAddress ? String(row.ipAddress) : null,
                userAgent: row.userAgent ? String(row.userAgent) : null,
            },
        };
    }

    async registerRequest(input: AuditLogInsertInput): Promise<void> {
        const method = String(input.method || 'UNKNOWN').trim().toUpperCase().slice(0, 16) || 'UNKNOWN';
        const path = String(input.path || '').trim().slice(0, 500) || '/';
        const statusCode = Number.isInteger(input.statusCode) ? Number(input.statusCode) : 0;
        const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0;

        const requestQuery = this.stringifyJson(
            sanitizeAuditValue(input.requestQuery ?? {}),
            '{}',
        );
        const requestParams = this.stringifyJson(
            sanitizeAuditValue(input.requestParams ?? {}),
            '{}',
        );
        const requestBody = this.stringifyJson(
            sanitizeAuditValue(input.requestBody ?? null),
            'null',
        );
        const tenantId = input.tenantId ?? TenantDataContext.currentTenantId();
        const dataScope = tenantId ? 'TENANT' : 'QUARANTINE';
        const prisma = tenantId ? tenantPrisma : platformPrisma;

        try {
            await prisma.$executeRaw(
                Prisma.sql`
                    INSERT INTO "AuditLog" (
                        "tenantId",
                        "dataScope",
                        "actorUserId",
                        "actorEmail",
                        "actorRole",
                        "method",
                        "path",
                        "statusCode",
                        "durationMs",
                        "ipAddress",
                        "userAgent",
                        "requestQuery",
                        "requestParams",
                        "requestBody"
                    )
                    VALUES (
                        ${tenantId}::uuid,
                        ${dataScope},
                        ${input.actorUserId ?? null},
                        ${input.actorEmail ?? null},
                        ${input.actorRole ?? null},
                        ${method},
                        ${path},
                        ${statusCode},
                        ${durationMs},
                        ${input.ipAddress ?? null},
                        ${input.userAgent ?? null},
                        ${requestQuery}::jsonb,
                        ${requestParams}::jsonb,
                        ${requestBody}::jsonb
                    )
                `,
            );
        } catch (error) {
            console.error('Audit log insert warning:', error);
        }
    }

    async list(dto: ListAuditLogDto) {
        const tenantId = TenantDataContext.requireTenantId();
        const prisma = tenantPrisma;
        const where: Prisma.Sql[] = [
            Prisma.sql`"tenantId" = ${tenantId}::uuid`,
            Prisma.sql`"dataScope" = 'TENANT'`,
        ];

        if (dto.search) {
            const like = `%${dto.search}%`;
            where.push(
                Prisma.sql`
                    (
                        "path" ILIKE ${like}
                        OR "method" ILIKE ${like}
                        OR "actorEmail" ILIKE ${like}
                        OR "actorRole" ILIKE ${like}
                    )
                `,
            );
        }

        if (dto.method) {
            where.push(Prisma.sql`"method" = ${dto.method}`);
        }

        if (dto.statusCode !== undefined) {
            where.push(Prisma.sql`"statusCode" = ${dto.statusCode}`);
        }

        if (dto.actorUserId !== undefined) {
            where.push(Prisma.sql`"actorUserId" = ${dto.actorUserId}`);
        }

        if (dto.path) {
            const pathLike = `%${dto.path}%`;
            where.push(Prisma.sql`"path" ILIKE ${pathLike}`);
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

        const rows = await prisma.$queryRaw<AuditLogRow[]>(
            Prisma.sql`
                SELECT
                    "id",
                    "tenantId",
                    "dataScope",
                    "actorUserId",
                    "actorEmail",
                    "actorRole",
                    "method",
                    "path",
                    "statusCode",
                    "durationMs",
                    "ipAddress",
                    "userAgent",
                    "requestQuery",
                    "requestParams",
                    "requestBody",
                    "createdAt"
                FROM "AuditLog"
                ${whereSql}
                ORDER BY "createdAt" DESC, "id" DESC
                OFFSET ${offset}
                LIMIT ${dto.limit}
            `,
        );

        const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number }>>(
            Prisma.sql`
                SELECT COUNT(*) AS total
                FROM "AuditLog"
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
