import { NextFunction, Request, Response } from 'express';
import { AuthRequest } from '../auth/middleware';
import { AuditLogService } from '../services/audit-log.service';

const API_PREFIX = '/api';
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 500;
const SENSITIVE_KEY_PATTERNS = [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'apikey',
    'api_key',
    'access',
    'refresh',
    'card',
    'cvv',
];

export class AuditLogMiddleware {
    static capture(service: AuditLogService) {
        return (req: Request, res: Response, next: NextFunction) => {
            const originalUrl = String(req.originalUrl || req.url || '');
            if (!originalUrl.startsWith(API_PREFIX)) {
                return next();
            }

            const startedAt = Date.now();

            res.on('finish', () => {
                const user = (req as AuthRequest).user;
                const method = String(req.method || 'UNKNOWN').toUpperCase();

                const body = this.shouldCaptureBody(method) ? this.sanitizeValue(req.body) : null;
                const query = this.sanitizeValue(req.query);
                const params = this.sanitizeValue(req.params);

                void service.registerRequest({
                    actorUserId: user?.id ?? null,
                    actorEmail: user?.email ?? null,
                    actorRole: user?.role ?? null,
                    method,
                    path: originalUrl,
                    statusCode: Number(res.statusCode || 0),
                    durationMs: Math.max(0, Date.now() - startedAt),
                    ipAddress: this.resolveIpAddress(req),
                    userAgent: this.normalizeString(req.headers['user-agent']),
                    requestQuery: query,
                    requestParams: params,
                    requestBody: body,
                });
            });

            return next();
        };
    }

    private static shouldCaptureBody(method: string): boolean {
        const normalized = String(method || '').toUpperCase();
        return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized);
    }

    private static normalizeString(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }
        const normalized = value.trim();
        return normalized.length > 0 ? normalized.slice(0, 400) : null;
    }

    private static resolveIpAddress(req: Request): string | null {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            const first = forwarded.split(',')[0]?.trim() || '';
            if (first.length > 0) {
                return first.slice(0, 120);
            }
        }

        if (Array.isArray(forwarded) && forwarded.length > 0) {
            const first = String(forwarded[0] || '').trim();
            if (first.length > 0) {
                return first.slice(0, 120);
            }
        }

        const ip = String(req.ip || '').trim();
        return ip.length > 0 ? ip.slice(0, 120) : null;
    }

    private static isSensitiveKey(key: string): boolean {
        const normalized = key.trim().toLowerCase();
        return SENSITIVE_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
    }

    private static sanitizeValue(value: unknown, depth = 0): unknown {
        if (value === undefined) {
            return null;
        }

        if (value === null) {
            return null;
        }

        if (depth >= MAX_DEPTH) {
            return '[depth-limited]';
        }

        if (typeof value === 'string') {
            return value.length > MAX_STRING_LENGTH
                ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
                : value;
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'bigint') {
            return Number(value);
        }

        if (Array.isArray(value)) {
            return value.slice(0, MAX_ARRAY_ITEMS).map((item) => this.sanitizeValue(item, depth + 1));
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            const entries = Object.entries(record).slice(0, MAX_OBJECT_KEYS);
            const sanitized: Record<string, unknown> = {};

            for (const [key, innerValue] of entries) {
                sanitized[key] = this.isSensitiveKey(key)
                    ? '[redacted]'
                    : this.sanitizeValue(innerValue, depth + 1);
            }

            return sanitized;
        }

        return String(value);
    }
}
