import { describe, expect, it } from 'vitest';

import { CustomError } from '../src/domain/errors/custom.error';

describe('CustomError', () => {
  it('creates badRequest with status code 400', () => {
    const error = CustomError.badRequest('invalid payload');

    expect(error).toBeInstanceOf(CustomError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe('invalid payload');
  });

  it('creates unauthorized with status code 401', () => {
    const error = CustomError.unauthorized('missing token');

    expect(error.statusCode).toBe(401);
  });

  it('creates forbidden with status code 403', () => {
    const error = CustomError.forbidden('not allowed');

    expect(error.statusCode).toBe(403);
  });

  it('creates notFound with status code 404', () => {
    const error = CustomError.notFound('resource not found');

    expect(error.statusCode).toBe(404);
  });

  it('creates internal with status code 500', () => {
    const error = CustomError.internal('unexpected');

    expect(error.statusCode).toBe(500);
  });
});
