import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../server/config/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('../../server/config/env', () => ({
  isProduction: () => false,
  getEnv: () => ({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long-unique',
  }),
}));

const hasCompanyAccess = vi.fn();
vi.mock('../../server/storage', () => ({
  storage: {
    hasCompanyAccess: (...args: unknown[]) => hasCompanyAccess(...args),
    getUser: vi.fn(),
  },
}));

import { requireCompanyAccess } from '../../server/middleware/auth';

function mockRes(): Response {
  const r: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return r as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: 'user-1', email: 'a@b.c', isAdmin: false, userType: 'customer', firmRole: null },
    params: {},
    body: {},
    query: {},
    path: '/test',
    ...overrides,
  } as Request;
}

describe('requireCompanyAccess', () => {
  beforeEach(() => {
    hasCompanyAccess.mockReset();
  });

  it('returns 401 when req.user is missing', async () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    const req = mockReq({ user: undefined as any });
    await requireCompanyAccess()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(hasCompanyAccess).not.toHaveBeenCalled();
  });

  it('returns 400 when no companyId in params/body/query', async () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess()(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user lacks access to the company', async () => {
    hasCompanyAccess.mockResolvedValue(false);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess()(mockReq({ body: { companyId: 'co-9' } }), res, next);
    expect(hasCompanyAccess).toHaveBeenCalledWith('user-1', 'co-9');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user has access', async () => {
    hasCompanyAccess.mockResolvedValue(true);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess()(mockReq({ params: { companyId: 'co-1' } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('prefers params over body when source not specified', async () => {
    hasCompanyAccess.mockResolvedValue(true);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess()(
      mockReq({ params: { companyId: 'co-params' }, body: { companyId: 'co-body' } }),
      res,
      next,
    );
    expect(hasCompanyAccess).toHaveBeenCalledWith('user-1', 'co-params');
  });

  it('reads from body when source="body"', async () => {
    hasCompanyAccess.mockResolvedValue(true);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess('body')(
      mockReq({ params: { companyId: 'co-params' }, body: { companyId: 'co-body' } }),
      res,
      next,
    );
    expect(hasCompanyAccess).toHaveBeenCalledWith('user-1', 'co-body');
  });

  it('reads from query when source="query"', async () => {
    hasCompanyAccess.mockResolvedValue(true);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess('query')(
      mockReq({ query: { companyId: 'co-query' } }),
      res,
      next,
    );
    expect(hasCompanyAccess).toHaveBeenCalledWith('user-1', 'co-query');
  });

  it('rejects non-string companyId (defensive)', async () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requireCompanyAccess()(mockReq({ body: { companyId: 12345 as any } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(hasCompanyAccess).not.toHaveBeenCalled();
  });
});
