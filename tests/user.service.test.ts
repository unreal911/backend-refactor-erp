import { TenantMembershipRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/prisma', () => {
  const client: Record<string, any> = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
    },
    tenantMembership: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  client.$transaction = vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client));
  return { prisma: client, platformPrisma: client };
});

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';
import { prisma } from '../src/data/prisma';
import { UserService } from '../src/presentation/services/user.service';

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when creating a user with duplicated email', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 1 } as never);

    await expect(
      UserService.create({
        firstName: 'Ana',
        lastName: 'Lopez',
        email: 'ana@tienda.com',
        password: 'secret',
        roleId: 1,
        isActive: true,
      } as never),
    ).rejects.toThrow('El correo electronico ya esta registrado');
  });

  it('throws when selected role is inactive', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: 1,
      isActive: false,
    } as never);

    await expect(
      UserService.create({
        firstName: 'Ana',
        lastName: 'Lopez',
        email: 'ana@tienda.com',
        password: 'secret',
        roleId: 1,
        isActive: true,
      } as never),
    ).rejects.toThrow('No se puede asignar un rol inactivo');
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('creates user and removes password from response', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: 2,
      isActive: true,
    } as never);
    vi.mocked(bcrypt.hash).mockResolvedValueOnce('hashed-pass' as never);
    vi.mocked(prisma.user.create).mockResolvedValueOnce({
      id: 15,
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@tienda.com',
      password: 'hashed-pass',
      isActive: true,
      roleId: 2,
      role: {
        id: 2,
        name: 'MANAGER',
      },
    } as never);

    const result = await UserService.create({
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@tienda.com',
      password: 'secret',
      roleId: 2,
      isActive: true,
    } as never);

    expect(bcrypt.hash).toHaveBeenCalledWith('secret', 10);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          password: 'hashed-pass',
        }),
      }),
    );
    expect(result).toEqual({
      id: 15,
      firstName: 'Ana',
      lastName: 'Lopez',
      email: 'ana@tienda.com',
      isActive: true,
      roleId: 2,
      role: {
        id: 2,
        name: 'MANAGER',
      },
    });
  });

  it('changes user password using hash', async () => {
    vi.mocked(bcrypt.hash).mockResolvedValueOnce('next-hash' as never);
    vi.mocked(prisma.user.update).mockResolvedValueOnce({ id: 15 } as never);

    const result = await UserService.changePassword(15, 'new-secret');

    expect(bcrypt.hash).toHaveBeenCalledWith('new-secret', 10);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 15 },
      data: { password: 'next-hash' },
    });
    expect(result).toEqual({ message: 'Contrasena actualizada exitosamente' });
  });

  it('impide que MANAGER se promueva a ADMIN', async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: 1,
      name: 'ADMIN',
      isActive: true,
    } as never);
    vi.mocked(prisma.tenantMembership.findUnique).mockResolvedValueOnce({
      id: 'membership-manager',
      userId: 15,
      role: TenantMembershipRole.MANAGER,
    } as never);

    await expect(UserService.update(
      15,
      { roleId: 1 } as never,
      '00000000-0000-4000-8000-000000000001',
      { userId: 15, role: TenantMembershipRole.MANAGER },
    )).rejects.toThrow('No puedes cambiar tu propio rol o estado');
  });

  it('impide que MANAGER promueva a otro usuario a ADMIN', async () => {
    vi.mocked(prisma.role.findUnique).mockResolvedValueOnce({
      id: 1,
      name: 'ADMIN',
      isActive: true,
    } as never);
    vi.mocked(prisma.tenantMembership.findUnique).mockResolvedValueOnce({
      id: 'membership-seller',
      userId: 22,
      role: TenantMembershipRole.SELLER,
    } as never);

    await expect(UserService.update(
      22,
      { roleId: 1 } as never,
      '00000000-0000-4000-8000-000000000001',
      { userId: 15, role: TenantMembershipRole.MANAGER },
    )).rejects.toThrow('No puedes asignar un rol igual o superior al tuyo');
  });

  it('impide modificar o desactivar la membresia OWNER', async () => {
    vi.mocked(prisma.tenantMembership.findUnique).mockResolvedValueOnce({
      id: 'membership-owner',
      userId: 10,
      role: TenantMembershipRole.OWNER,
    } as never);

    await expect(UserService.update(
      10,
      { isActive: false } as never,
      '00000000-0000-4000-8000-000000000001',
      { userId: 20, role: TenantMembershipRole.ADMIN },
    )).rejects.toThrow('La membresía OWNER no se modifica');
  });
});
