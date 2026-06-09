import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

// Route-level coverage for vendor-bill import-of-goods capture (review M17) and
// the H9 (reject reverse_charge + import) / H16 (non-AED needs AED override) guards.
const state = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: any[] }> }));

vi.mock('../../server/db', () => {
  const query = async (sql: string, params: any[] = []) => {
    state.queries.push({ sql, params });
    return { rows: [{ id: 'bill-1', company_id: 'company-A' }] };
  };
  return {
    pool: {
      query: vi.fn(query),
      // Atomic create uses pool.connect()-style client (BEGIN/COMMIT/ROLLBACK).
      connect: vi.fn(async () => ({ query: vi.fn(query), release: vi.fn() })),
    },
  };
});
vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.user = { id: 'user-1' }; next(); },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../server/services/period-lock.service', () => ({ assertPeriodNotLocked: vi.fn(async () => {}) }));
vi.mock('../../server/services/retention.service', () => ({ assertRetentionExpired: vi.fn(async () => {}) }));
vi.mock('../../server/storage', () => ({ storage: { hasCompanyAccess: vi.fn(async () => true) } }));

import { registerBillPayRoutes } from '../../server/routes/bill-pay.routes';

function app() {
  const a = express();
  a.use(express.json());
  registerBillPayRoutes(a);
  return a;
}

async function postBill(body: unknown) {
  const server = app().listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/companies/company-A/bills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const baseLine = { description: 'Imported goods', quantity: 1, unit_price: 1000, vat_rate: 5 };

beforeEach(() => { state.queries = []; });

describe('POST /api/companies/:companyId/bills — import capture', () => {
  it('persists import role + customs override into the vendor_bills INSERT', async () => {
    const res = await postBill({
      vendor_name: 'Foreign Supplier',
      bill_date: '2026-01-15',
      line_items: [baseLine],
      vat_import_role: 'import',
      import_taxable_amount_aed: 1200,
      import_vat_amount_aed: 60,
      customs_declaration_number: 'CUS-123',
    });
    expect(res.status).toBe(200);
    const insert = state.queries.find((q) => /INSERT INTO vendor_bills/.test(q.sql));
    expect(insert).toBeTruthy();
    expect(insert!.params).toContain('import');
    expect(insert!.params).toContain('1200.00');
    expect(insert!.params).toContain('60.00');
    expect(insert!.params).toContain('CUS-123');
  });

  it('rejects a bill flagged both reverse_charge and import (H9)', async () => {
    const res = await postBill({
      vendor_name: 'X',
      bill_date: '2026-01-15',
      line_items: [baseLine],
      reverse_charge: true,
      vat_import_role: 'import',
    });
    expect(res.status).toBe(400);
    // never reached the INSERT
    expect(state.queries.some((q) => /INSERT INTO vendor_bills/.test(q.sql))).toBe(false);
  });

  it('rejects a non-AED import bill without an AED customs override (H16)', async () => {
    const res = await postBill({
      vendor_name: 'X',
      bill_date: '2026-01-15',
      currency: 'EUR',
      line_items: [baseLine],
      vat_import_role: 'import',
    });
    expect(res.status).toBe(400);
    expect(state.queries.some((q) => /INSERT INTO vendor_bills/.test(q.sql))).toBe(false);
  });

  it('rejects import_adjustment without a justification', async () => {
    const res = await postBill({
      vendor_name: 'X',
      bill_date: '2026-01-15',
      line_items: [baseLine],
      vat_import_role: 'import_adjustment',
    });
    expect(res.status).toBe(400);
  });
});
