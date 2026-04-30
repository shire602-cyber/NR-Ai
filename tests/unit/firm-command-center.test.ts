/**
 * Phase 6: Firm Command Center — unit tests.
 *
 * The service file is split into pure functions and DB-backed helpers; these
 * tests exercise the pure logic directly. RBAC middleware is also tested with
 * a mocked Express request.
 *
 * Tests intentionally avoid hitting the database — the pure-function design
 * makes that possible without integration scaffolding.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  calculateHealthScore,
  generateAlertsForClient,
  rankClients,
  calculatePeriodComparison,
  previousPeriodRange,
  computeStaffWorkload,
  scopeBatchToAccessible,
  STALE_ACTIVITY_DAYS,
  OVERDUE_BALANCE_THRESHOLD,
  VAT_DEADLINE_CRITICAL_DAYS,
  type ClientHealthInputs,
  type ClientSnapshot,
  type RankableClient,
} from '../../server/services/firm-command-center.service';
import { requireFirmOwner, requireFirmAdmin } from '../../server/middleware/rbac';

// ─── Mocks: keep these tests isolated from the DB layer ──────────────────────

vi.mock('../../server/config/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// rbac.ts imports the db; replace with no-op so the module loads cleanly.
vi.mock('../../server/db', () => ({
  db: {},
}));

// ─── Test fixtures ───────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-30T12:00:00Z');

function baseInputs(overrides: Partial<ClientHealthInputs> = {}): ClientHealthInputs {
  return {
    companyId: 'co-1',
    companyName: 'Acme LLC',
    missingDocuments: 0,
    overdueBalance: 0,
    overdueInvoiceCount: 0,
    vatStatus: 'filed',
    vatDueDate: new Date('2026-06-30T00:00:00Z'),
    receiptBacklog: 0,
    lastActivityAt: new Date('2026-04-29T00:00:00Z'),
    onboardingCompleted: true,
    now: FIXED_NOW,
    ...overrides,
  };
}

function baseSnapshot(overrides: Partial<ClientSnapshot> = {}): ClientSnapshot {
  return {
    companyId: 'co-1',
    companyName: 'Acme LLC',
    onboardingCompleted: true,
    vatStatus: 'filed',
    vatDueDate: new Date('2026-06-30T00:00:00Z'),
    overdueBalance: 0,
    overdueInvoiceCount: 0,
    missingDocuments: 0,
    receiptBacklog: 0,
    lastActivityAt: new Date('2026-04-29T00:00:00Z'),
    ...overrides,
  };
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// ─── Health score calculation ────────────────────────────────────────────────

describe('calculateHealthScore — boundary cases', () => {
  it('returns 100 / excellent for a perfect-health client', () => {
    const result = calculateHealthScore(baseInputs());
    expect(result.score).toBe(100);
    expect(result.rating).toBe('excellent');
    expect(result.factors.vatOnTime).toBe(true);
    expect(result.factors.vatOverdue).toBe(false);
  });

  it('penalizes missing documents up to a 20-point cap', () => {
    const small = calculateHealthScore(baseInputs({ missingDocuments: 2 }));
    const huge = calculateHealthScore(baseInputs({ missingDocuments: 100 }));
    expect(small.score).toBe(90); // 2 * 5 = 10
    expect(huge.score).toBe(80); // capped at 20
  });

  it('penalizes overdue balance in tiers', () => {
    expect(calculateHealthScore(baseInputs({ overdueBalance: 0 })).score).toBe(100);
    expect(calculateHealthScore(baseInputs({ overdueBalance: 5_000 })).score).toBe(97);
    expect(calculateHealthScore(baseInputs({ overdueBalance: 25_000 })).score).toBe(92);
    expect(calculateHealthScore(baseInputs({ overdueBalance: 75_000 })).score).toBe(85);
    expect(calculateHealthScore(baseInputs({ overdueBalance: 250_000 })).score).toBe(75);
  });

  it('marks VAT overdue when due date is in the past and not filed', () => {
    const result = calculateHealthScore(
      baseInputs({
        vatStatus: 'draft',
        vatDueDate: new Date('2026-04-01T00:00:00Z'),
      })
    );
    expect(result.factors.vatOverdue).toBe(true);
    expect(result.factors.vatOnTime).toBe(false);
    expect(result.score).toBe(80); // 100 - 20 vat
  });

  it('marks VAT due-soon when within 14 days', () => {
    const result = calculateHealthScore(
      baseInputs({
        vatStatus: 'draft',
        vatDueDate: new Date('2026-05-10T00:00:00Z'), // 10d from FIXED_NOW
      })
    );
    expect(result.factors.vatOnTime).toBe(false);
    expect(result.factors.vatOverdue).toBe(false);
    expect(result.score).toBe(90);
  });

  it('treats submitted VAT identically to filed', () => {
    expect(
      calculateHealthScore(baseInputs({ vatStatus: 'submitted' })).score
    ).toBe(100);
  });

  it('does not penalize when no VAT return exists with -5', () => {
    const result = calculateHealthScore(baseInputs({ vatStatus: null, vatDueDate: null }));
    expect(result.score).toBe(95);
  });

  it('penalizes receipt backlog up to a 15-point cap', () => {
    expect(calculateHealthScore(baseInputs({ receiptBacklog: 4 })).score).toBe(98); // 4 * 0.5 = 2 → -2
    expect(calculateHealthScore(baseInputs({ receiptBacklog: 100 })).score).toBe(85); // capped at 15
  });

  it('penalizes stale activity in tiers and handles null', () => {
    const fresh = calculateHealthScore(baseInputs({ lastActivityAt: FIXED_NOW }));
    expect(fresh.score).toBe(100);

    const oneMonth = calculateHealthScore(
      baseInputs({ lastActivityAt: new Date('2026-03-15T00:00:00Z') })
    );
    expect(oneMonth.factors.daysSinceActivity).toBeGreaterThanOrEqual(30);
    expect(oneMonth.score).toBe(90);

    const threeMonths = calculateHealthScore(
      baseInputs({ lastActivityAt: new Date('2026-01-15T00:00:00Z') })
    );
    expect(threeMonths.score).toBe(70);

    const never = calculateHealthScore(baseInputs({ lastActivityAt: null }));
    expect(never.factors.daysSinceActivity).toBeNull();
    expect(never.score).toBe(90); // -10 for null activity
  });

  it('penalizes incomplete onboarding by 5', () => {
    const result = calculateHealthScore(baseInputs({ onboardingCompleted: false }));
    expect(result.factors.onboardingCompleted).toBe(false);
    expect(result.score).toBe(95);
  });

  it('clamps to [0, 100]', () => {
    const catastrophic = calculateHealthScore(
      baseInputs({
        missingDocuments: 100,
        overdueBalance: 1_000_000,
        vatStatus: 'draft',
        vatDueDate: new Date('2025-01-01T00:00:00Z'),
        receiptBacklog: 1000,
        lastActivityAt: new Date('2025-01-01T00:00:00Z'),
        onboardingCompleted: false,
      })
    );
    expect(catastrophic.score).toBe(0);
    expect(catastrophic.rating).toBe('critical');
  });

  it('maps scores to rating bands', () => {
    // 100 → excellent
    expect(calculateHealthScore(baseInputs()).rating).toBe('excellent');
    // 100 - 5 (docs) - 8 (overdue 25k) = 87 → excellent (>=85)
    expect(
      calculateHealthScore(baseInputs({ overdueBalance: 25_000, missingDocuments: 1 })).rating
    ).toBe('excellent');
    // 100 - 20 (docs cap) - 15 (overdue 75k) = 65 → fair (>=50)
    expect(
      calculateHealthScore(
        baseInputs({
          missingDocuments: 5,
          overdueBalance: 75_000,
        })
      ).rating
    ).toBe('fair');
    // 100 - 20 (docs) - 25 (overdue 250k) - 20 (vat overdue) = 35 → poor (>=30)
    expect(
      calculateHealthScore(
        baseInputs({
          missingDocuments: 5,
          overdueBalance: 250_000,
          vatStatus: 'draft',
          vatDueDate: new Date('2025-01-01T00:00:00Z'),
        })
      ).rating
    ).toBe('poor');
  });

  it('uses fallback now when not provided', () => {
    const r = calculateHealthScore({ ...baseInputs(), now: undefined });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

// ─── Alert generation ────────────────────────────────────────────────────────

describe('generateAlertsForClient — alert types', () => {
  it('emits a critical vat_deadline alert when overdue', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({
        vatStatus: 'draft',
        vatDueDate: new Date('2026-04-01T00:00:00Z'),
      }),
      FIXED_NOW
    );
    const vat = alerts.find((a) => a.alertType === 'vat_deadline');
    expect(vat?.severity).toBe('critical');
    expect(vat?.message).toMatch(/overdue/i);
  });

  it('emits a critical vat_deadline alert within VAT_DEADLINE_CRITICAL_DAYS', () => {
    const dueIn = new Date(FIXED_NOW.getTime() + (VAT_DEADLINE_CRITICAL_DAYS - 1) * 86400_000);
    const alerts = generateAlertsForClient(
      baseSnapshot({ vatStatus: 'draft', vatDueDate: dueIn }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'vat_deadline')?.severity).toBe('critical');
  });

  it('emits a warning vat_deadline alert when due in 8–30 days', () => {
    const dueIn = new Date(FIXED_NOW.getTime() + 20 * 86400_000);
    const alerts = generateAlertsForClient(
      baseSnapshot({ vatStatus: 'draft', vatDueDate: dueIn }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'vat_deadline')?.severity).toBe('warning');
  });

  it('does not emit a vat_deadline alert when filed', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({
        vatStatus: 'filed',
        vatDueDate: new Date('2026-04-01T00:00:00Z'),
      }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'vat_deadline')).toBeUndefined();
  });

  it('emits a stale_activity warning at exactly STALE_ACTIVITY_DAYS', () => {
    const last = new Date(FIXED_NOW.getTime() - STALE_ACTIVITY_DAYS * 86400_000);
    const alerts = generateAlertsForClient(baseSnapshot({ lastActivityAt: last }), FIXED_NOW);
    const stale = alerts.find((a) => a.alertType === 'stale_activity');
    expect(stale?.severity).toBe('warning');
  });

  it('emits a stale_activity critical at 90+ days', () => {
    const last = new Date(FIXED_NOW.getTime() - 100 * 86400_000);
    const alerts = generateAlertsForClient(baseSnapshot({ lastActivityAt: last }), FIXED_NOW);
    expect(alerts.find((a) => a.alertType === 'stale_activity')?.severity).toBe('critical');
  });

  it('emits a stale_activity warning when no activity exists', () => {
    const alerts = generateAlertsForClient(baseSnapshot({ lastActivityAt: null }), FIXED_NOW);
    expect(alerts.find((a) => a.alertType === 'stale_activity')?.severity).toBe('warning');
  });

  it('emits a warning overdue_balance at exactly the threshold', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({ overdueBalance: OVERDUE_BALANCE_THRESHOLD, overdueInvoiceCount: 3 }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'overdue_balance')?.severity).toBe('warning');
  });

  it('emits a critical overdue_balance at 100k+', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({ overdueBalance: 250_000, overdueInvoiceCount: 5 }),
      FIXED_NOW
    );
    const a = alerts.find((x) => x.alertType === 'overdue_balance');
    expect(a?.severity).toBe('critical');
    expect(a?.metadata?.overdueBalance).toBe(250_000);
  });

  it('does not emit overdue_balance below threshold', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({ overdueBalance: OVERDUE_BALANCE_THRESHOLD - 1 }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'overdue_balance')).toBeUndefined();
  });

  it('emits an info incomplete_onboarding alert', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({ onboardingCompleted: false }),
      FIXED_NOW
    );
    expect(alerts.find((a) => a.alertType === 'incomplete_onboarding')?.severity).toBe('info');
  });

  it('emits document_missing info <5 docs and warning ≥5', () => {
    const small = generateAlertsForClient(
      baseSnapshot({ missingDocuments: 2 }),
      FIXED_NOW
    );
    expect(small.find((a) => a.alertType === 'document_missing')?.severity).toBe('info');

    const big = generateAlertsForClient(baseSnapshot({ missingDocuments: 7 }), FIXED_NOW);
    expect(big.find((a) => a.alertType === 'document_missing')?.severity).toBe('warning');
  });

  it('emits no alerts for a perfectly healthy client', () => {
    const alerts = generateAlertsForClient(baseSnapshot(), FIXED_NOW);
    expect(alerts).toEqual([]);
  });

  it('combines multiple alerts on a stressed client', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({
        onboardingCompleted: false,
        missingDocuments: 8,
        overdueBalance: 200_000,
        overdueInvoiceCount: 4,
        vatStatus: 'draft',
        vatDueDate: new Date('2026-04-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
      }),
      FIXED_NOW
    );
    const types = new Set(alerts.map((a) => a.alertType));
    expect(types.has('vat_deadline')).toBe(true);
    expect(types.has('stale_activity')).toBe(true);
    expect(types.has('overdue_balance')).toBe(true);
    expect(types.has('incomplete_onboarding')).toBe(true);
    expect(types.has('document_missing')).toBe(true);
  });
});

// ─── Client ranking ──────────────────────────────────────────────────────────

const RANKABLE: RankableClient[] = [
  { companyId: 'a', companyName: 'A', healthScore: 90, revenue: 100_000, overdueBalance: 0, complianceScore: 100 },
  { companyId: 'b', companyName: 'B', healthScore: 50, revenue: 500_000, overdueBalance: 80_000, complianceScore: 60 },
  { companyId: 'c', companyName: 'C', healthScore: 75, revenue: 250_000, overdueBalance: 5_000, complianceScore: 80 },
];

describe('rankClients', () => {
  it('sorts by health desc by default', () => {
    const r = rankClients(RANKABLE, 'health');
    expect(r.map((c) => c.companyId)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by revenue desc', () => {
    const r = rankClients(RANKABLE, 'revenue');
    expect(r.map((c) => c.companyId)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by overdue desc (worst first)', () => {
    const r = rankClients(RANKABLE, 'overdue');
    expect(r.map((c) => c.companyId)).toEqual(['b', 'c', 'a']);
  });

  it('sorts ascending when dir=asc', () => {
    const r = rankClients(RANKABLE, 'health', 'asc');
    expect(r.map((c) => c.companyId)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate input', () => {
    const before = [...RANKABLE];
    rankClients(RANKABLE, 'compliance');
    expect(RANKABLE).toEqual(before);
  });

  it('handles empty input', () => {
    expect(rankClients([], 'health')).toEqual([]);
  });
});

// ─── Period comparison ───────────────────────────────────────────────────────

describe('calculatePeriodComparison', () => {
  const range = { start: new Date('2026-04-01'), end: new Date('2026-05-01') };
  const prev = previousPeriodRange(range);

  it('computes correct percentage deltas', () => {
    const c = calculatePeriodComparison(
      range,
      { revenue: 110, receipts: 50, invoices: 10 },
      prev,
      { revenue: 100, receipts: 25, invoices: 10 }
    );
    expect(c.deltas.revenuePct).toBe(10);
    expect(c.deltas.receiptsPct).toBe(100);
    expect(c.deltas.invoicesPct).toBe(0);
  });

  it('handles zero previous period without dividing by zero', () => {
    const c = calculatePeriodComparison(
      range,
      { revenue: 50, receipts: 0, invoices: 0 },
      prev,
      { revenue: 0, receipts: 0, invoices: 0 }
    );
    expect(c.deltas.revenuePct).toBe(100);
    expect(c.deltas.receiptsPct).toBe(0);
  });

  it('reports negative deltas when current < previous', () => {
    const c = calculatePeriodComparison(
      range,
      { revenue: 50, receipts: 10, invoices: 5 },
      prev,
      { revenue: 100, receipts: 20, invoices: 5 }
    );
    expect(c.deltas.revenuePct).toBe(-50);
    expect(c.deltas.receiptsPct).toBe(-50);
  });

  it('rounds to one decimal', () => {
    const c = calculatePeriodComparison(
      range,
      { revenue: 103, receipts: 0, invoices: 0 },
      prev,
      { revenue: 97, receipts: 0, invoices: 0 }
    );
    // (103 - 97) / 97 = 0.0618... → 6.2
    expect(c.deltas.revenuePct).toBe(6.2);
  });

  it('previousPeriodRange returns a range of equal length immediately preceding', () => {
    const r = previousPeriodRange(range);
    const lenCurrent = range.end.getTime() - range.start.getTime();
    const lenPrev = r.end.getTime() - r.start.getTime();
    expect(lenPrev).toBe(lenCurrent);
    expect(r.end.getTime()).toBe(range.start.getTime());
  });
});

// ─── Staff workload ──────────────────────────────────────────────────────────

describe('computeStaffWorkload', () => {
  it('counts assignments and rolls up roles', () => {
    const result = computeStaffWorkload([
      {
        userId: 'u1',
        userName: 'Alice',
        userEmail: 'a@e.com',
        assignments: [
          { companyId: 'c1', role: 'accountant' },
          { companyId: 'c2', role: 'accountant' },
          { companyId: 'c3', role: 'reviewer' },
        ],
      },
    ]);
    expect(result[0].clientCount).toBe(3);
    expect(result[0].rolesByName).toEqual({ accountant: 2, reviewer: 1 });
  });

  it('handles a staff member with no assignments', () => {
    const result = computeStaffWorkload([
      { userId: 'u2', userName: 'Bob', userEmail: 'b@e.com', assignments: [] },
    ]);
    expect(result[0].clientCount).toBe(0);
    expect(result[0].rolesByName).toEqual({});
  });
});

// ─── Batch scoping ───────────────────────────────────────────────────────────

describe('scopeBatchToAccessible — RBAC for batch operations', () => {
  it('passes through everything when accessible=null (firm_owner)', () => {
    const r = scopeBatchToAccessible(['a', 'b', 'c'], null);
    expect(r.allowedCompanyIds).toEqual(['a', 'b', 'c']);
    expect(r.rejectedCompanyIds).toEqual([]);
  });

  it('filters to assigned companies for firm_admin', () => {
    const r = scopeBatchToAccessible(['a', 'b', 'c'], ['b']);
    expect(r.allowedCompanyIds).toEqual(['b']);
    expect(r.rejectedCompanyIds).toEqual(['a', 'c']);
  });

  it('returns all rejected when nothing is accessible', () => {
    const r = scopeBatchToAccessible(['a', 'b'], []);
    expect(r.allowedCompanyIds).toEqual([]);
    expect(r.rejectedCompanyIds).toEqual(['a', 'b']);
  });

  it('dedupes the requested list', () => {
    const r = scopeBatchToAccessible(['a', 'a', 'a'], null);
    expect(r.allowedCompanyIds).toEqual(['a']);
  });

  it('returns empty arrays for an empty request', () => {
    const r = scopeBatchToAccessible([], ['a']);
    expect(r.allowedCompanyIds).toEqual([]);
    expect(r.rejectedCompanyIds).toEqual([]);
  });
});

// ─── RBAC middleware ─────────────────────────────────────────────────────────

describe('requireFirmOwner', () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
  });

  it('allows firm_owner', () => {
    const req = { user: { firmRole: 'firm_owner' } } as Request;
    requireFirmOwner()(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects firm_admin with 403', () => {
    const req = { user: { firmRole: 'firm_admin' } } as Request;
    const res = mockRes();
    requireFirmOwner()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects regular users with 403', () => {
    const req = { user: { firmRole: null } } as unknown as Request;
    const res = mockRes();
    requireFirmOwner()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects unauthenticated requests with 401', () => {
    const req = {} as Request;
    const res = mockRes();
    requireFirmOwner()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireFirmAdmin', () => {
  let next: NextFunction;
  beforeEach(() => {
    next = vi.fn();
  });

  it('allows firm_owner', () => {
    const req = { user: { firmRole: 'firm_owner' } } as Request;
    requireFirmAdmin()(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows firm_admin', () => {
    const req = { user: { firmRole: 'firm_admin' } } as Request;
    requireFirmAdmin()(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects regular users with 403', () => {
    const req = { user: { firmRole: null } } as unknown as Request;
    const res = mockRes();
    requireFirmAdmin()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects unauthenticated requests with 401', () => {
    const req = {} as Request;
    const res = mockRes();
    requireFirmAdmin()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Aggregation accuracy ────────────────────────────────────────────────────

describe('firm-wide aggregation accuracy', () => {
  it('average health score is the mean of per-client scores', () => {
    const scores = [
      calculateHealthScore(baseInputs({ companyId: 'a' })),
      calculateHealthScore(baseInputs({ companyId: 'b', overdueBalance: 25_000 })),
      calculateHealthScore(baseInputs({ companyId: 'c', missingDocuments: 5 })),
    ];
    const avg = Math.round(scores.reduce((s, h) => s + h.score, 0) / scores.length);
    // 100 (clean) + 92 (-8 for 25k overdue) + 80 (-20 docs cap) = 272 / 3 ≈ 91
    expect(avg).toBe(91);
  });

  it('alert candidate count equals the number of distinct issues', () => {
    const alerts = generateAlertsForClient(
      baseSnapshot({
        overdueBalance: 50_000,
        overdueInvoiceCount: 1,
        missingDocuments: 1,
      }),
      FIXED_NOW
    );
    // overdue_balance + document_missing
    expect(alerts.length).toBe(2);
  });
});
