import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantFindMany: vi.fn(),
  runTenantDatabaseTransaction: vi.fn(),
  continueThroughResponse: vi.fn(),
}));

vi.mock('../src/data/platform-prisma', () => ({
  platformPrisma: {
    tenant: { findMany: mocks.tenantFindMany },
  },
}));

vi.mock('../src/data/prisma', () => ({
  runTenantDatabaseTransaction: mocks.runTenantDatabaseTransaction,
}));

vi.mock('../src/presentation/response-tasks', () => ({
  continueThroughResponse: mocks.continueThroughResponse,
}));

import {
  PublicTenantMiddleware,
  PublicTenantRequest,
} from '../src/presentation/public/tenant.middleware';

function request(slug?: string): PublicTenantRequest {
  return {
    query: {},
    header: (name: string) => name.toLowerCase() === 'x-tenant-slug' ? slug : undefined,
  } as PublicTenantRequest;
}

function response() {
  const value = { status: vi.fn(), json: vi.fn() };
  value.status.mockReturnValue(value);
  value.json.mockReturnValue(value);
  return value;
}

describe('resolucion publica por marketplaceSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runTenantDatabaseTransaction.mockImplementation(
      async (_tenantId: string, callback: () => unknown) => callback(),
    );
    mocks.continueThroughResponse.mockImplementation((_res, next) => next());
  });

  it('resuelve el slug publico sin depender del slug administrativo', async () => {
    mocks.tenantFindMany.mockResolvedValueOnce([{
      id: '10000000-0000-4000-8000-000000000001',
      slug: 'empresa-interna-estable',
      marketplaceSlug: 'fatima',
    }]);
    const req = request('fatima');
    const res = response();
    const next = vi.fn();

    await PublicTenantMiddleware.resolve(req, res as never, next);

    expect(mocks.tenantFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { marketplaceSlug: 'fatima' },
            ]),
          }),
        ]),
      }),
    }));
    expect(req.publicTenant).toEqual({
      id: '10000000-0000-4000-8000-000000000001',
      marketplaceSlug: 'fatima',
    });
    expect(mocks.runTenantDatabaseTransaction).toHaveBeenCalledWith(
      req.publicTenant?.id,
      expect.any(Function),
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('responde 404 cuando la direccion publica no existe', async () => {
    mocks.tenantFindMany.mockResolvedValueOnce([]);
    const req = request('desconocida');
    const res = response();

    await PublicTenantMiddleware.resolve(req, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Empresa no disponible' });
    expect(mocks.runTenantDatabaseTransaction).not.toHaveBeenCalled();
  });

  it('permite publicar la tienda de un trial vigente', async () => {
    mocks.tenantFindMany.mockResolvedValueOnce([{
      id: '10000000-0000-4000-8000-000000000002',
      slug: 'trial-publico',
      marketplaceSlug: 'trial-publico',
    }]);

    await PublicTenantMiddleware.resolve(request('trial-publico'), response() as never, vi.fn());

    expect(mocks.tenantFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            status: { in: expect.arrayContaining(['TRIAL']) },
            planCode: { in: expect.arrayContaining(['TRIAL']) },
            OR: expect.arrayContaining([
              { trialEndsAt: { gt: expect.any(Date) } },
            ]),
          }),
        ]),
      }),
    }));
  });
});
