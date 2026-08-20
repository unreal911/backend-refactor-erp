import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('../src/data/platform-prisma', () => ({
  platformPrisma: {
    role: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  },
}));

import { TenantDataContext } from '../src/modules/tenant/tenant-data-context';
import { RoleService } from '../src/presentation/services/role.service';

describe('privacidad del catálogo de roles en contexto tenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
  });

  it('filtra usuarios por tenant y solo devuelve sus identificadores', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000123';

    await TenantDataContext.run(tenantId, () => RoleService.findAll());

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        users: {
          where: { tenantMemberships: { some: { tenantId } } },
          select: { id: true },
        },
      },
    }));
  });
});
