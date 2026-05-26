import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

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
    resolvePermissionsForUser: vi.fn(),
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
import { AuthService } from '../src/presentation/services/auth.service';
import { PermissionService } from '../src/presentation/services/permission.service';

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when login user is not found', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    await expect(AuthService.login(loginDto!)).rejects.toThrow('Credenciales invalidas');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('throws when login user is inactive', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 1,
      firstName: 'Demo',
      lastName: 'User',
      email: 'demo@tienda.com',
      password: 'hashed',
      isActive: false,
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
      role: { name: 'ADMIN' },
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    vi.mocked(PermissionService.resolvePermissionsForUser).mockResolvedValueOnce(['users.view'] as never);
    vi.mocked(jwt.sign).mockReturnValueOnce('token-123' as never);

    const [, loginDto] = LoginDto.create({ email: 'demo@tienda.com', password: 'secret' });
    const result = await AuthService.login(loginDto!);

    expect(jwt.sign).toHaveBeenCalledWith(
      {
        id: 1,
        email: 'demo@tienda.com',
        role: 'ADMIN',
        permissions: ['users.view'],
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
    vi.mocked(PermissionService.resolvePermissionsForUser).mockResolvedValueOnce(['orders.view'] as never);

    const result = await AuthService.me(7, 'MANAGER', ['orders.view']);

    expect(PermissionService.resolvePermissionsForUser).toHaveBeenCalledWith({
      userId: 7,
      roleName: 'MANAGER',
      tokenPermissions: ['orders.view'],
    });
    expect(result).toEqual({
      user: {
        id: 7,
        firstName: 'Ana',
        lastName: 'Lopez',
        email: 'ana@tienda.com',
        role: 'MANAGER',
        permissions: ['orders.view'],
      },
    });
  });
});
