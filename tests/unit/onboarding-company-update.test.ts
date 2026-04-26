import { describe, it, expect } from 'vitest';
import express from 'express';
import { asyncHandler } from '../../server/middleware/errorHandler';

// Repro for the "stuck at step 2" onboarding bug.
//
// The original schema (migration 0000) created a global UNIQUE constraint on
// companies(name). In a multi-tenant SaaS, two unrelated tenants can share a
// legal name, so the second tenant's PATCH /api/companies/:id "Save & Continue"
// during onboarding fails with a 23505 unique_violation. The wizard's generic
// "Failed to save company details" toast left users with no idea why the
// button stopped working.
//
// The fix has two parts:
//   1. server/db.ts ensureCriticalSchema drops the constraint on every
//      startup (idempotent), repairing any environment where migration 0029
//      didn't fully run.
//   2. server/routes/companies.routes.ts catches code 23505 and returns a
//      409 with a clear message instead of letting it bubble to a 500.
//
// This test exercises the same handler shape against a fake storage layer
// that throws a Postgres unique-violation error, and verifies the response
// shape the wizard now relies on for its error toast.

function buildPatchRoute(updateCompany: (id: string, data: any) => Promise<any>) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/companies/:id',
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const updateData = { ...req.body };
      if (!updateData.taxRegistrationDate) delete updateData.taxRegistrationDate;
      try {
        const company = await updateCompany(id, updateData);
        res.json(company);
      } catch (err: any) {
        if (err?.code === '23505') {
          return res.status(409).json({
            message: 'That value is already taken by another tenant. Please pick a different one.',
            field: err.constraint?.includes('name') ? 'name' : undefined,
          });
        }
        throw err;
      }
    }),
  );
  return app;
}

async function call(
  app: express.Express,
  method: 'PATCH',
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  // Drive the express handler in-process via a node http request to a listening
  // socket — avoids pulling in supertest just for this test.
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const url = `http://127.0.0.1:${addr.port}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not json
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe('Onboarding step 2 (PATCH /api/companies/:id) error handling', () => {
  it('maps Postgres unique_violation (23505) on companies.name to 409 with actionable message', async () => {
    const app = buildPatchRoute(async () => {
      const err: any = new Error('duplicate key value violates unique constraint "companies_name_unique"');
      err.code = '23505';
      err.constraint = 'companies_name_unique';
      throw err;
    });

    const res = await call(app, 'PATCH', '/api/companies/c1', { name: 'Acme LLC' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already taken/i);
    expect(res.body.field).toBe('name');
  });

  it('passes through non-unique-violation errors so the global error handler can deal with them', async () => {
    const app = buildPatchRoute(async () => {
      throw new Error('database connection lost');
    });
    // We don't install a global error handler in this mini app; an unhandled
    // throw from asyncHandler should yield a 500.
    const res = await call(app, 'PATCH', '/api/companies/c1', { name: 'Acme LLC' });
    expect(res.status).toBe(500);
  });

  it('returns the updated row on success', async () => {
    const app = buildPatchRoute(async (id, data) => ({ id, ...data }));
    const res = await call(app, 'PATCH', '/api/companies/c1', { name: 'Acme LLC' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'c1', name: 'Acme LLC' });
  });
});
