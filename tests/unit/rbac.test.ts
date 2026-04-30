import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the db module before importing rbac so the queries inside
// getAccessibleCompanyIds (firm_staff_assignments + company_users) are
// intercepted. Both queries chain `.from().innerJoin().where()`, so the mock
// supports that shape (and also bare `.from().where()` for forward-compat).
const mockDbSelect = vi.fn();
vi.mock('../../server/db', () => {
  const where = () => mockDbSelect();
  const builder: any = { where, innerJoin: () => ({ where }) };
  return {
    db: {
      select: () => ({ from: () => builder }),
    },
  };
});

import { requireFirmRole, getAccessibleCompanyIds } from '../../server/middleware/rbac';

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('rbac.requireFirmRole', () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it('blocks unauthenticated requests with 401', () => {
    const middleware = requireFirmRole();
    const req = {} as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks users without a firm role', () => {
    const middleware = requireFirmRole();
    const req = { user: { id: 'u1', firmRole: null } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks users with an unknown role string', () => {
    const middleware = requireFirmRole();
    const req = { user: { id: 'u1', firmRole: 'visitor' } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows firm_owner', () => {
    const middleware = requireFirmRole();
    const req = { user: { id: 'u1', firmRole: 'firm_owner' } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows firm_admin', () => {
    const middleware = requireFirmRole();
    const req = { user: { id: 'u1', firmRole: 'firm_admin' } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('rbac.getAccessibleCompanyIds', () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it('returns null for firm_owner — caller should not filter', async () => {
    const result = await getAccessibleCompanyIds('user-1', 'firm_owner');
    expect(result).toBeNull();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it('unions firm_staff_assignments + company_users for firm_admin', async () => {
    // First call → firm_staff_assignments rows; second → company_users rows.
    mockDbSelect.mockResolvedValueOnce([{ companyId: 'c1' }]);
    mockDbSelect.mockResolvedValueOnce([{ companyId: 'c2' }]);

    const result = await getAccessibleCompanyIds('user-1', 'firm_admin');
    expect(result).not.toBeNull();
    expect((result as string[]).sort()).toEqual(['c1', 'c2']);
  });

  it('deduplicates companies that appear in both access tables', async () => {
    mockDbSelect.mockResolvedValueOnce([{ companyId: 'c1' }, { companyId: 'c2' }]);
    mockDbSelect.mockResolvedValueOnce([{ companyId: 'c2' }, { companyId: 'c3' }]);

    const result = await getAccessibleCompanyIds('user-1', 'firm_admin');
    expect((result as string[]).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns an empty array when firm_admin has no access via either table', async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await getAccessibleCompanyIds('user-1', 'firm_admin');
    expect(result).toEqual([]);
  });

  it('treats unknown role strings as restricted (does not return null)', async () => {
    // Defensive default: unknown roles fall through to the restricted-list
    // path so a misconfigured user never accidentally sees every client.
    mockDbSelect.mockResolvedValueOnce([{ companyId: 'c1' }]);
    mockDbSelect.mockResolvedValueOnce([]);
    const result = await getAccessibleCompanyIds('user-1', 'visitor');
    expect(Array.isArray(result)).toBe(true);
  });
});
