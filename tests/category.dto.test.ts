import { describe, expect, it } from 'vitest';

import { CategoryDto } from '../src/domain/dtos/create-category.dto';

describe('CategoryDto.create', () => {
  it('returns an error when name is missing', () => {
    const [error, dto] = CategoryDto.create({});

    expect(error).toBeDefined();
    expect(dto).toBeUndefined();
  });

  it('defaults isActive to true', () => {
    const [error, dto] = CategoryDto.create({ name: 'Calzado' });

    expect(error).toBeUndefined();
    expect(dto).toBeDefined();
    expect(dto?.name).toBe('Calzado');
    expect(dto?.isActive).toBe(true);
  });

  it('coerces isActive from "true" string', () => {
    const [error, dto] = CategoryDto.create({ name: 'Ropa', isActive: 'true' });

    expect(error).toBeUndefined();
    expect(dto).toBeDefined();
    expect(dto?.isActive).toBe(true);
  });

  it('coerces isActive from non-boolean values', () => {
    const [error, dto] = CategoryDto.create({ name: 'Accesorios', isActive: 'false' });

    expect(error).toBeUndefined();
    expect(dto).toBeDefined();
    expect(dto?.isActive).toBe(false);
  });
});
