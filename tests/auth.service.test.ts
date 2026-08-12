import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => {
  const client = {
    user: {
      findUnique: vi.fn(),
    },
    ownerRegistration: {
      findUnique: vi.fn(),
    },
  };
  return { prisma: client, platformPrisma: client };
});

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
  },
}));

vi.mock('../src/presentation/services/permission.service', () => ({
  PermissionService: {
    resolvePermissionsForTenantRole: vi.fn(),
  },
}));

vi.mock('../src/modules/tenant/tenant-context.service', () => ({
  TenantContextService: {
    resolveForLogin: vi.fn(),
  },
}));

vi.mock('../src/config/envs', () => ({
  envs: {
    JWT_SECRET: 'test-secret',
  },
}));

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/data/prisma';
import { LoginDto } from '../src/domain/dtos/login.dto';
import {
  AccountActivationRequiredError,
  AuthService,
} from '../src/presentation/services/auth.service';
import { PermissionService } from '../src/presentation/services/permission.service';
import { TenantContextService } from '../src/modules/tenant/tenant-context.service';

const tenantContext = {
  tenant: {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'legacy-main',
    name: 'Empresa principal',
    status: 'ACTIVE',
    databaseMode: 'SHARED',
    trialEndsAt: null,
  },
  membership: {
    id: '10000000-0000-4000-8000-000000000001',
    role: 'OWNER',
    status: 'ACTIVE',
  },
  rbacRole: 'ADMIN',
};

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.ownerRegistration.findUnique).mockResolvedValue(null as never);
  });

  it('throws when login user is not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    await expect(AuthService.login(loginDto!)).rejects.toThrow('Credenciales invalidas');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('informa cuando las credenciales pertenecen a un correo pendiente de verificar', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.ownerRegistration.findUnique).mockResolvedValueOnce({
      passwordHash: 'pending-hash',
      status: 'EMAIL_PENDING',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);

    const [, loginDto] = LoginDto.create({ email: 'pendiente@tienda.com', password: 'secret' });
    const error = await AuthService.login(loginDto!).catch((caught) => caught);

    expect(error).toBeInstanceOf(AccountActivationRequiredError);
    expect(error).toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED', statusCode: 403 });
  });

  it('no revela un registro pendiente cuando la contrasena no coincide', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.ownerRegistration.findUnique).mockResolvedValueOnce({
      passwordHash: 'pending-hash',
      status: 'EMAIL_PENDING',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const [, loginDto] = LoginDto.create({ email: 'pendiente@tienda.com', password: 'wrong' });
    await expect(AuthService.login(loginDto!)).rejects.toThrow('Credenciales invalidas');
  });

  it('throws when login user is inactive', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 1,
      firstName: 'Demo',
      lastName: 'User',
      email: 'demo@tienda.com',
      password: 'hashed',
      isActive: false,
      authVersion: 0,
      role: { name: 'ADMIN' },
    } as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    await expect(AuthService.login(loginDto!)).rejects.toThrow('Usuario inactivo');
  });

  it('throws when password is invalid', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 1,
      firstName: 'Demo',
      lastName: 'User',
      email: 'demo@tienda.com',
      password: 'hashed',
      isActive: true,
      authVersion: 0,
      role: { name: 'ADMIN' },
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    await expect(AuthService.login(loginDto!)).rejects.toThrow('Credenciales invalidas');
  });

  it('returns token and user context when login is valid', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 1,
      firstName: 'Demo',
      lastName: 'User',
      email: 'demo@tienda.com',
      password: 'hashed',
      isActive: true,
      authVersion: 0,
      role: { name: 'ADMIN' },
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    vi.mocked(TenantContextService.resolveForLogin).mockResolvedValueOnce(tenantContext as never);
    vi.mocked(PermissionService.resolvePermissionsForTenantRole).mockResolvedValueOnce(['users.view'] as never);
    vi.mocked(jwt.sign).mockReturnValueOnce('token-123' as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    const result = await AuthService.login(loginDto!);

    expect(jwt.sign).toHaveBeenCalledWith(
      {
        scope: 'tenant',
        id: 1,
        email: 'demo@tienda.com',
        role: 'ADMIN',
        permissions: ['users.view'],
        tenantId: tenantContext.tenant.id,
        tenantSlug: tenantContext.tenant.slug,
        membershipId: tenantContext.membership.id,
        tenantRole: tenantContext.membership.role,
        authVersion: 0,
      },
      'test-secret',
      { expiresIn: '1h' },
    );
    expect(result).toEqual({
      token: 'token-123',
      user: {
        id: 1,
        firstName: 'Demo',
        lastName: 'User',
        email: 'demo@tienda.com',
        role: 'ADMIN',
        permissions: ['users.view'],
        tenant: tenantContext.tenant,
        membership: tenantContext.membership,
        plan: {
          code: 'STARTER',
          features: ['picking.basic', 'sunat'],
        },
      },
    });
  });

  it('throws in me() when user is not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    await expect(AuthService.me(10)).rejects.toThrow('Usuario no encontrado');
  });

  it('returns fallback role and permissions in me()', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 7,
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@tienda.com',
      isActive: true,
      role: null,
    } as never);
    vi.mocked(PermissionService.resolvePermissionsForTenantRole).mockResolvedValueOnce(['orders.view'] as never);

    const result = await AuthService.me(7, tenantContext as never, ['orders.view']);

    expect(PermissionService.resolvePermissionsForTenantRole).toHaveBeenCalledWith('ADMIN');
    expect(result).toEqual({
      user: {
        id: 7,
        firstName: 'Ana',
        lastName: 'Lopez',
        email: 'ana@tienda.com',
        role: 'ADMIN',
        permissions: ['orders.view'],
        tenant: tenantContext.tenant,
        membership: tenantContext.membership,
        plan: {
          code: 'STARTER',
          features: ['picking.basic', 'sunat'],
        },
      },
    });
  });
});
