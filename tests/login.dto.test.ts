import { describe, expect, it } from 'vitest';

import { LoginDto } from '../src/domain/dtos/login.dto';

describe('LoginDto.create', () => {
  it('returns error when email is missing', () => {
    const [error, dto] = LoginDto.create({ password: 'secret' });

    expect(error).toBeDefined();
    expect(dto).toBeUndefined();
  });

  it('returns error when password is missing', () => {
    const [error, dto] = LoginDto.create({ email: 'demo@tienda.com' });

    expect(error).toBeDefined();
    expect(dto).toBeUndefined();
  });

  it('creates dto when payload is valid', () => {
    const [error, dto] = LoginDto.create({
      email: 'demo@tienda.com',
      password: 'secret',
    });

    expect(error).toBeUndefined();
    expect(dto).toBeDefined();
    expect(dto?.email).toBe('demo@tienda.com');
    expect(dto?.password).toBe('secret');
  });
});
