import { describe, expect, it } from 'vitest';
import { AuditLogMiddleware } from '../src/presentation/audit-log/middleware';

// Acceso a los estáticos privados (mismo patrón que otros tests del repo).
const mw = AuditLogMiddleware as any;

describe('AuditLogMiddleware.resolvePath', () => {
    it('descarta el query string del path (evita PII/secretos en claro)', () => {
        expect(mw.resolvePath('/api/public/orders/ABC123?phone=999888777&email=a@b.com'))
            .toBe('/api/public/orders/ABC123');
        expect(mw.resolvePath('/api/auth/reset?token=super-secreto'))
            .toBe('/api/auth/reset');
    });

    it('deja el path intacto cuando no hay query', () => {
        expect(mw.resolvePath('/api/orders/42/returns')).toBe('/api/orders/42/returns');
    });

    it('recorta en el primer ? aunque el valor contenga otro ?', () => {
        expect(mw.resolvePath('/api/x?a=1?b=2')).toBe('/api/x');
    });
});

describe('AuditLogMiddleware.sanitizeValue', () => {
    it('redacta claves sensibles (incl. secretos SUNAT) a cualquier profundidad', () => {
        const out: any = mw.sanitizeValue({
            email: 'admin@tienda.com',
            password: 'hunter2',
            token: 'jwt.abc',
            nested: {
                solPassword: 'CLAVESOL',
                certP12Password: 'p12pass',
                authorization: 'Bearer xyz',
                ok: 'visible',
            },
        });

        expect(out.email).toBe('admin@tienda.com');
        expect(out.password).toBe('[redacted]');
        expect(out.token).toBe('[redacted]');
        expect(out.nested.solPassword).toBe('[redacted]');
        expect(out.nested.certP12Password).toBe('[redacted]');
        expect(out.nested.authorization).toBe('[redacted]');
        expect(out.nested.ok).toBe('visible');
    });

    it('trunca strings largos y limita profundidad', () => {
        const long = 'x'.repeat(600);
        expect(String(mw.sanitizeValue(long)).endsWith('...[truncated]')).toBe(true);

        const deep = { a: { b: { c: { d: { e: 'muy hondo' } } } } };
        expect(JSON.stringify(mw.sanitizeValue(deep))).toContain('[depth-limited]');
    });

    it('normaliza undefined a null', () => {
        expect(mw.sanitizeValue(undefined)).toBeNull();
    });
});
