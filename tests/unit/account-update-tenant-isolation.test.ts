import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

// Regression test for the audit finding: PUT /api/accounts/:id passed the raw
// request body to storage.updateAccount, letting an owner move their account to
// another company (companyId in body) or self-promote it (isSystemAccount).
const state = vi.hoisted(() => ({
  account: {
    id: 'acc-1',
    companyId: 'company-A',
    code: '1010',
    nameEn: 'Cash',
    type: 'asset',
    isSystemAccount: false,
    isActive: true,
  } as Record<string, unknown>,
  updateArgs: null as null | { id: string; companyId: string; data: Record<string, unknown> },
}));

vi.mock('../../server/middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'u@example.com', isAdmin: false, userType: 'customer' };
    next();
  },
  requireCustomer: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/services/audit.service', () => ({
  recordAudit: vi.fn(async () => {}),
}));

vi.mock('../../server/storage', () => ({
  storage: {
    getCompaniesByUserId: vi.fn(async () => [{ id: 'company-A' }]),
    getAccount: vi.fn(async (id: string, companyId: string) =>
      id === state.account.id && companyId === 'company-A' ? state.account : undefined,
    ),
    accountHasTransactions: vi.fn(async () => false),
    updateAccount: vi.fn(async (id: string, companyId: string, data: Record<string, unknown>) => {
      state.updateArgs = { id, companyId, data };
      return { ...state.account, ...data };
    }),
  },
}));

import { registerAccountRoutes } from '../../server/routes/accounts.routes';

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerAccountRoutes(app);
  return app;
}

async function put(app: express.Express, id: string, body: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === 'string' || !addr) throw new Error('no address');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/accounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('PUT /api/accounts/:id tenant isolation', () => {
  beforeEach(() => {
    state.updateArgs = null;
  });

  it('ignores companyId / id / isSystemAccount in the body (no cross-tenant move, no privilege escalation)', async () => {
    const res = await put(appWithRoutes(), 'acc-1', {
      nameEn: 'Renamed',
      isActive: false,
      companyId: 'company-B', // attacker attempts a cross-tenant move
      id: 'acc-evil',
      isSystemAccount: true, // attacker attempts to mark it a protected system account
    });

    expect(res.status).toBe(200);
    // storage is scoped to the trusted owner company, never the body value
    expect(state.updateArgs?.companyId).toBe('company-A');
    // dangerous fields stripped from the update payload
    expect(state.updateArgs?.data).not.toHaveProperty('companyId');
    expect(state.updateArgs?.data).not.toHaveProperty('id');
    expect(state.updateArgs?.data).not.toHaveProperty('isSystemAccount');
    // legitimate fields still applied
    expect(state.updateArgs?.data.nameEn).toBe('Renamed');
    expect(state.updateArgs?.data.isActive).toBe(false);
    // server controls the audit timestamp
    expect(state.updateArgs?.data.updatedAt).toBeInstanceOf(Date);
    // the persisted row stays in company-A
    expect(res.body.companyId).toBe('company-A');
  });
});
