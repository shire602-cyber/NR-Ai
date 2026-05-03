import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../server/config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'production',
    SESSION_SECRET: 's'.repeat(32),
  }),
  isProduction: () => true,
}));

vi.mock('../../server/config/logger', () => ({
  createLogger: () => ({
    warn: vi.fn(),
  }),
}));

import { csrfIdentifierCookieName, resolveCsrfIdentifier } from '../../server/middleware/csrf';

function createRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    headers: {},
    cookies: {},
    ip: '127.0.0.1',
    ...overrides,
  } as Request;
}

function createResponse(): Response {
  return {
    cookie: vi.fn(),
  } as unknown as Response;
}

describe('CSRF identifier cookie', () => {
  it('creates one stable client identifier before token generation', () => {
    const req = createRequest();
    const res = createResponse();

    const id = resolveCsrfIdentifier(req, res);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.cookie).toHaveBeenCalledWith(
      '__Host-x-csrf-id',
      id,
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'none',
        secure: true,
      }),
    );
    expect(resolveCsrfIdentifier(req)).toBe(id);
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing parsed identifier cookie', () => {
    const res = createResponse();
    const id = resolveCsrfIdentifier(
      createRequest({
        cookies: { '__Host-x-csrf-id': 'client-123' },
      }),
      res,
    );

    expect(id).toBe('client-123');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('can recover the identifier from the raw cookie header', () => {
    const res = createResponse();
    const id = resolveCsrfIdentifier(
      createRequest({
        cookies: undefined,
        headers: { cookie: `${csrfIdentifierCookieName()}=client%20456` },
      }),
      res,
    );

    expect(id).toBe('client 456');
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
