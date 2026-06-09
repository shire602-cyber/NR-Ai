import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

// Route-level regression tests proving the tenant-move / mass-assignment fix is
// actually wired into the customer-contacts, corporate-tax, and receipts update
// handlers (the helper unit test in sanitize.test.ts only proves the helper, not
// that each route calls it). Contacts + corporate-tax storage methods scope their
// WHERE by id ONLY, so stripping companyId from the body is the sole cross-tenant
// defense there — hence these tests.
const state = vi.hoisted(() => ({
  contact: { id: 'contact-1', companyId: 'company-A', name: 'Acme' } as Record<string, unknown>,
  taxReturn: { id: 'ctr-1', companyId: 'company-A', status: 'draft' } as Record<string, unknown>,
  receipt: { id: 'rec-1', companyId: 'company-A', merchant: 'Shop' } as Record<string, unknown>,
  calls: {} as Record<string, { id: string; companyId?: string; data: Record<string, unknown> }>,
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'u@example.com', isAdmin: false, userType: 'customer' };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../server/services/audit.service', () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock('../../server/storage', () => ({
  storage: {
    hasCompanyAccess: vi.fn(async () => true),
    getCustomerContact: vi.fn(async () => state.contact),
    updateCustomerContact: vi.fn(async (id: string, data: Record<string, unknown>) => {
      state.calls.contact = { id, data };
      return { ...state.contact, ...data };
    }),
    getCorporateTaxReturn: vi.fn(async () => state.taxReturn),
    updateCorporateTaxReturn: vi.fn(async (id: string, data: Record<string, unknown>) => {
      state.calls.tax = { id, data };
      return { ...state.taxReturn, ...data };
    }),
    getCompaniesByUserId: vi.fn(async () => [{ id: 'company-A' }]),
    getReceipt: vi.fn(async (_id: string, companyId: string) => (companyId === 'company-A' ? state.receipt : undefined)),
    updateReceipt: vi.fn(async (id: string, companyId: string, data: Record<string, unknown>) => {
      state.calls.receipt = { id, companyId, data };
      return { ...state.receipt, ...data };
    }),
  },
}));

import { registerContactRoutes } from '../../server/routes/contacts.routes';
import { registerCorporateTaxRoutes } from '../../server/routes/corporate-tax.routes';
import { registerReceiptRoutes } from '../../server/routes/receipts.routes';
import { storage } from '../../server/storage';

function appWith(register: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

async function send(app: express.Express, method: string, path: string, body: unknown) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

beforeEach(() => {
  state.calls = {};
  vi.clearAllMocks();
});

describe('PUT /api/companies/:companyId/customer-contacts/:id', () => {
  it('strips companyId/id from the body (companyId-in-body is the only cross-tenant guard here)', async () => {
    const res = await send(appWith(registerContactRoutes), 'PUT', '/api/companies/company-A/customer-contacts/contact-1', {
      companyId: 'company-B',
      id: 'evil',
      name: 'Renamed',
    });
    expect(res.status).toBe(200);
    expect(state.calls.contact.data).not.toHaveProperty('companyId');
    expect(state.calls.contact.data).not.toHaveProperty('id');
    expect(state.calls.contact.data.name).toBe('Renamed');
  });
});

describe('PATCH /api/corporate-tax/returns/:id', () => {
  it('strips companyId/id from the body', async () => {
    const res = await send(appWith(registerCorporateTaxRoutes), 'PATCH', '/api/corporate-tax/returns/ctr-1', {
      companyId: 'company-B',
      id: 'evil',
      taxableIncome: 1000,
    });
    expect(res.status).toBe(200);
    expect(state.calls.tax.data).not.toHaveProperty('companyId');
    expect(state.calls.tax.data).not.toHaveProperty('id');
    expect(state.calls.tax.data.taxableIncome).toBe(1000);
  });

  it('no-ops (does not call storage) when the body has only blocked fields', async () => {
    const res = await send(appWith(registerCorporateTaxRoutes), 'PATCH', '/api/corporate-tax/returns/ctr-1', {
      companyId: 'company-B',
    });
    expect(res.status).toBe(200);
    expect(storage.updateCorporateTaxReturn).not.toHaveBeenCalled();
  });
});

describe('PUT /api/receipts/:id', () => {
  it('strips companyId/posted/journalEntryId and scopes the update to the owner company', async () => {
    const res = await send(appWith(registerReceiptRoutes), 'PUT', '/api/receipts/rec-1', {
      companyId: 'company-B',
      posted: true,
      journalEntryId: 'forged',
      merchant: 'New Merchant',
    });
    expect(res.status).toBe(200);
    expect(state.calls.receipt.companyId).toBe('company-A'); // trusted owner company, not the body value
    expect(state.calls.receipt.data).not.toHaveProperty('companyId');
    expect(state.calls.receipt.data).not.toHaveProperty('posted');
    expect(state.calls.receipt.data).not.toHaveProperty('journalEntryId');
    expect(state.calls.receipt.data.merchant).toBe('New Merchant');
  });

  it('no-ops (does not call updateReceipt) when the body has only blocked fields', async () => {
    const res = await send(appWith(registerReceiptRoutes), 'PUT', '/api/receipts/rec-1', {
      companyId: 'company-B',
      posted: true,
    });
    expect(res.status).toBe(200);
    expect(storage.updateReceipt).not.toHaveBeenCalled();
  });
});
