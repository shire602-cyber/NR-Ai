import express from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn(async () => client),
    poolQuery: vi.fn(),
    assertPeriodNotLocked: vi.fn(),
    hasCompanyAccess: vi.fn(),
    getAccountsByCompanyId: vi.fn(),
  };
});

vi.mock('../../server/db', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/services/period-lock.service', () => ({
  assertPeriodNotLocked: mocks.assertPeriodNotLocked,
}));

vi.mock('../../server/storage', () => ({
  storage: {
    hasCompanyAccess: mocks.hasCompanyAccess,
    getAccountsByCompanyId: mocks.getAccountsByCompanyId,
  },
}));

import { registerBillPayRoutes } from '../../server/routes/bill-pay.routes';

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerBillPayRoutes(app);
  return app;
}

async function requestJson(
  app: express.Express,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const server = await new Promise<ReturnType<express.Express['listen']>>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('bill-pay route accounting writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasCompanyAccess.mockResolvedValue(true);
    mocks.getAccountsByCompanyId.mockResolvedValue([
      { id: 'expense-1', code: '5010', type: 'expense', isVatAccount: false },
      { id: 'ap-1', code: '2010', type: 'liability', isSystemAccount: true },
      { id: 'vat-input-1', code: '1050', type: 'asset', isVatAccount: true, vatType: 'input' },
      { id: 'vat-output-1', code: '2020', type: 'liability', isVatAccount: true, vatType: 'output' },
    ]);
    mocks.assertPeriodNotLocked.mockResolvedValue(undefined);
    mocks.client.query.mockReset();
    mocks.client.release.mockReset();
    mocks.connect.mockClear();
    mocks.poolQuery.mockReset();
  });

  it('creates vendor bill header and lines in one transaction', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('INSERT INTO vendor_bills')) {
        return { rows: [{ id: 'bill-1', company_id: 'company-1' }] };
      }
      if (sql.includes('INSERT INTO bill_line_items')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });

    const res = await requestJson(appWithRoutes(), 'POST', '/api/companies/company-1/bills', {
      vendor_name: 'Supplier',
      bill_date: '2026-06-01',
      line_items: [{ description: 'Goods', quantity: 1, unit_price: 100, vat_rate: 5 }],
    });

    expect(res.status).toBe(200);
    expect(mocks.client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO vendor_bills'),
      expect.stringContaining('INSERT INTO bill_line_items'),
      'COMMIT',
    ]);
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back vendor bill create if a line insert fails', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('INSERT INTO vendor_bills')) {
        return { rows: [{ id: 'bill-1', company_id: 'company-1' }] };
      }
      if (sql.includes('INSERT INTO bill_line_items')) throw new Error('line insert failed');
      throw new Error(`unexpected query: ${sql}`);
    });

    const res = await requestJson(appWithRoutes(), 'POST', '/api/companies/company-1/bills', {
      vendor_name: 'Supplier',
      bill_date: '2026-06-01',
      line_items: [{ description: 'Goods', quantity: 1, unit_price: 100, vat_rate: 5 }],
    });

    expect(res.status).toBe(500);
    expect(mocks.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });

  it('keeps reverse-charge totals and line flags when replacing bill lines', async () => {
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'bill-1',
        company_id: 'company-1',
        bill_date: '2026-06-01',
        reverse_charge: true,
        status: 'pending',
        journal_entry_id: null,
      }],
    });
    mocks.client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('SELECT status, journal_entry_id, reverse_charge')) {
        return { rows: [{ status: 'pending', journal_entry_id: null, reverse_charge: true }] };
      }
      if (sql.includes('UPDATE vendor_bills')) {
        return { rows: [{ id: 'bill-1', total_amount: '100.00' }] };
      }
      if (sql.includes('DELETE FROM bill_line_items')) return { rows: [] };
      if (sql.includes('INSERT INTO bill_line_items')) return { rows: [], params };
      throw new Error(`unexpected query: ${sql}`);
    });

    const res = await requestJson(appWithRoutes(), 'PATCH', '/api/bills/bill-1', {
      line_items: [{ description: 'Imported service', quantity: 1, unit_price: 100, vat_rate: 5 }],
    });

    expect(res.status).toBe(200);
    const updateCall = mocks.client.query.mock.calls.find((call) => String(call[0]).includes('UPDATE vendor_bills'));
    expect(updateCall?.[1]).toEqual(['100.00', '5.00', '100.00', 'bill-1']);
    const lineInsertCall = mocks.client.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO bill_line_items'));
    expect(lineInsertCall?.[1]?.at(-1)).toBe(true);
  });

  it('approves a vendor bill by posting the AP journal entry atomically', async () => {
    mocks.poolQuery.mockResolvedValueOnce({
      rows: [{
        id: 'bill-1',
        company_id: 'company-1',
        vendor_name: 'Supplier',
        bill_number: 'B-1',
        bill_date: '2026-06-01',
        currency: 'AED',
        status: 'pending',
        vat_amount: '5.00',
        reverse_charge: false,
      }],
    });
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('SELECT status, journal_entry_id FROM vendor_bills')) {
        return { rows: [{ status: 'pending', journal_entry_id: null }] };
      }
      if (sql.includes('SELECT * FROM bill_line_items')) {
        return { rows: [{ account_id: 'expense-1', amount: '100.00', description: 'Goods' }] };
      }
      if (sql.includes('INSERT INTO journal_entry_number_sequences')) {
        return { rows: [{ last_value: 1 }] };
      }
      if (sql.includes('INSERT INTO journal_entries')) {
        return { rows: [{ id: 'je-1' }] };
      }
      if (sql.includes('INSERT INTO journal_lines')) return { rows: [] };
      if (sql.includes('UPDATE vendor_bills')) {
        return { rows: [{ id: 'bill-1', status: 'approved', journal_entry_id: 'je-1' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const res = await requestJson(appWithRoutes(), 'POST', '/api/bills/bill-1/approve', {});

    expect(res.status).toBe(200);
    const journalEntryCall = mocks.client.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO journal_entries'));
    expect(journalEntryCall?.[1]).toEqual([
      'company-1',
      '2026-06-01',
      'Vendor bill approved - Supplier (B-1)',
      'JE-20260601-001',
      'bill-1',
      'user-1',
    ]);
    const journalLineCalls = mocks.client.query.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO journal_lines'));
    expect(journalLineCalls.map((call) => call[1])).toEqual([
      ['je-1', 'expense-1', 100, 0, 'Goods'],
      ['je-1', 'vat-input-1', 5, 0, 'Vendor bill B-1 - input VAT'],
      ['je-1', 'ap-1', 0, 105, 'Vendor bill B-1 - accounts payable'],
    ]);
    expect(mocks.client.query).toHaveBeenCalledWith('COMMIT');
  });
});
