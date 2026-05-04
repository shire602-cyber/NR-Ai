import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { handleCompanyWriteError } from '../../server/routes/companies.routes';

// Builds a minimal Response stub that records the last status/body pair so we
// can assert on the response shape without booting Express.
function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    res: { status, json } as unknown as Response,
    status,
    json,
  };
}

function pgError(code: string, extras: Record<string, unknown> = {}): any {
  const err: any = new Error(`pg ${code}`);
  err.code = code;
  Object.assign(err, extras);
  return err;
}

describe('handleCompanyWriteError', () => {
  const ctx = { route: 'PATCH /api/companies/:id', id: 'c1', userId: 'u1' };

  // The original onboarding-stuck-at-step-2 bug. The DB-level constraint was
  // dropped in migration 0029 + ensureCriticalSchema, but if it lingers we
  // still want a 409 with an actionable message rather than a generic 500.
  it('maps 23505 (unique violation) to 409 with field hint', () => {
    const { res, status, json } = makeRes();
    const handled = handleCompanyWriteError(
      pgError('23505', { constraint: 'companies_name_unique' }),
      ctx,
      res,
    );
    expect(handled).toBe(true);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/already taken/i), field: 'name' }),
    );
  });

  it('maps 23502 (NOT NULL violation) to 400 with the offending column', () => {
    const { res, status, json } = makeRes();
    const handled = handleCompanyWriteError(
      pgError('23502', { column: 'name' }),
      ctx,
      res,
    );
    expect(handled).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/missing/i), field: 'name' }),
    );
  });

  it('maps 23514 (CHECK violation) to 400 with the constraint name', () => {
    const { res, status, json } = makeRes();
    const handled = handleCompanyWriteError(
      pgError('23514', { constraint: 'exempt_supply_ratio_range' }),
      ctx,
      res,
    );
    expect(handled).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('exempt_supply_ratio_range') }),
    );
  });

  it('maps 22001 (string too long) to 400', () => {
    const { res, status } = makeRes();
    expect(handleCompanyWriteError(pgError('22001'), ctx, res)).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
  });

  // 22P02 fires when an :id path param is not a valid uuid (e.g. "undefined"
  // when the client navigates before the company query has resolved). Without
  // this case it bubbled to a 500 and confused the user.
  it('maps 22P02 (invalid input syntax) to 400', () => {
    const { res, status } = makeRes();
    expect(handleCompanyWriteError(pgError('22P02'), ctx, res)).toBe(true);
    expect(status).toHaveBeenCalledWith(400);
  });

  // Schema/DB drift — a column referenced in the schema doesn't exist in the
  // DB. Route handlers retry once after running ensureCriticalSchema; if that
  // still fails, users should see a clear retryable service error, not a
  // generic "Internal Server Error".
  it('maps 42703 (undefined column) to retryable 503 after repair fails', () => {
    const { res, status, json } = makeRes();
    expect(
      handleCompanyWriteError(pgError('42703', { message: 'column "legal_name" does not exist' }), ctx, res),
    ).toBe(true);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'COMPANY_SCHEMA_REPAIR_REQUIRED' }),
    );
  });

  it('maps 42P01 (undefined table) to retryable 503 after repair fails', () => {
    const { res, status } = makeRes();
    expect(handleCompanyWriteError(pgError('42P01'), ctx, res)).toBe(true);
    expect(status).toHaveBeenCalledWith(503);
  });

  it('returns false on unknown error codes so the global handler can render them', () => {
    const { res, status } = makeRes();
    expect(handleCompanyWriteError(pgError('XX999'), ctx, res)).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });

  it('returns false when the error has no SQLSTATE at all (e.g. connection drop)', () => {
    const { res, status } = makeRes();
    expect(handleCompanyWriteError(new Error('ECONNRESET'), ctx, res)).toBe(false);
    expect(status).not.toHaveBeenCalled();
  });
});
