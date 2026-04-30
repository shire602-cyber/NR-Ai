/**
 * Phase 6: Firm-Wide Command Center
 *
 * Pure-logic service powering NRA management's bird's-eye view across 100+
 * client companies. The exported functions are split into two groups:
 *
 *   1. PURE LOGIC (no DB) — health scoring, alert generation, period
 *      comparison, ranking. These are unit-tested directly.
 *   2. DB-BACKED HELPERS — efficient SQL aggregations + cache I/O. These
 *      compose the pure functions on top of database results.
 *
 * Aggregations use SQL `GROUP BY` over `inArray(companyIds, ...)` to avoid
 * N+1 loops. Expensive results are memoized in `firm_metrics_cache` with a
 * caller-supplied TTL.
 */

import { db } from '../db';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  max,
  ne,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import {
  bankTransactions,
  companies,
  firmAlerts,
  firmMetricsCache,
  firmStaffAssignments,
  invoices,
  receipts,
  users,
  vatReturns,
  type FirmAlert,
  type FirmAlertSeverity,
  type FirmAlertType,
} from '../../shared/schema';
import { NotFoundError, ValidationError } from '../errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClientHealthInputs {
  companyId: string;
  companyName: string;
  /** Number of expected onboarding documents still missing. */
  missingDocuments: number;
  /** Outstanding AED amount across overdue invoices. */
  overdueBalance: number;
  /** Number of overdue invoices. */
  overdueInvoiceCount: number;
  /** Latest VAT return status, or null if none filed yet. */
  vatStatus: 'draft' | 'pending_review' | 'submitted' | 'filed' | 'amended' | null;
  /** Due date of latest VAT return, or null. */
  vatDueDate: Date | null;
  /** Receipts uploaded but not yet posted to GL. */
  receiptBacklog: number;
  /** Most recent activity date (latest of any tracked event), or null. */
  lastActivityAt: Date | null;
  /** Whether onboarding wizard was completed. */
  onboardingCompleted: boolean;
  /** Reference "now" for deterministic scoring (defaults to current time). */
  now?: Date;
}

export interface ClientHealthScore {
  companyId: string;
  companyName: string;
  score: number; // 0..100, higher = healthier
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  factors: {
    missingDocuments: number;
    overdueBalance: number;
    overdueInvoiceCount: number;
    vatOnTime: boolean;
    vatOverdue: boolean;
    receiptBacklog: number;
    daysSinceActivity: number | null;
    onboardingCompleted: boolean;
  };
}

export interface FirmDashboardSummary {
  totalClients: number;
  activeClients: number;
  totalRevenue: number;
  totalOutstandingAr: number;
  totalVatLiability: number;
  receiptsProcessedThisMonth: number;
  invoicesIssuedThisMonth: number;
  criticalAlertCount: number;
  warningAlertCount: number;
  averageHealthScore: number;
}

export interface PeriodComparison {
  current: { start: Date; end: Date; revenue: number; receipts: number; invoices: number };
  previous: { start: Date; end: Date; revenue: number; receipts: number; invoices: number };
  deltas: {
    revenuePct: number;
    receiptsPct: number;
    invoicesPct: number;
  };
}

export interface AlertCandidate {
  companyId: string | null;
  alertType: FirmAlertType;
  severity: FirmAlertSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ClientSnapshot {
  companyId: string;
  companyName: string;
  onboardingCompleted: boolean;
  vatStatus: ClientHealthInputs['vatStatus'];
  vatDueDate: Date | null;
  overdueBalance: number;
  overdueInvoiceCount: number;
  missingDocuments: number;
  receiptBacklog: number;
  lastActivityAt: Date | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Health score thresholds. */
const HEALTH_RATINGS: Array<{ min: number; rating: ClientHealthScore['rating'] }> = [
  { min: 85, rating: 'excellent' },
  { min: 70, rating: 'good' },
  { min: 50, rating: 'fair' },
  { min: 30, rating: 'poor' },
  { min: 0, rating: 'critical' },
];

/** Days a client may be inactive before triggering a stale_activity alert. */
export const STALE_ACTIVITY_DAYS = 30;
/** Overdue AR threshold (AED) for an overdue_balance alert. */
export const OVERDUE_BALANCE_THRESHOLD = 10_000;
/** Days before a VAT due date to start surfacing it as critical. */
export const VAT_DEADLINE_CRITICAL_DAYS = 7;
/** Days before a VAT due date to start surfacing it as warning. */
export const VAT_DEADLINE_WARNING_DAYS = 30;

// ─── Pure logic: health scoring ───────────────────────────────────────────────

/**
 * Compute a 0..100 health score for one client.
 *
 * Scoring is additive starting from 100 and subtracting penalties. We deliberately
 * keep this readable rather than weighted-multiplicative — the firm UI shows the
 * factor list alongside the score, so penalties must map 1:1 to displayed reasons.
 */
export function calculateHealthScore(inputs: ClientHealthInputs): ClientHealthScore {
  const now = inputs.now ?? new Date();
  let score = 100;

  // Missing documents: each missing doc costs up to 5 points (cap at 20).
  const docPenalty = Math.min(inputs.missingDocuments * 5, 20);
  score -= docPenalty;

  // Overdue balance: tiered. >100k = -25, >50k = -15, >10k = -8, >0 = -3.
  let balancePenalty = 0;
  if (inputs.overdueBalance > 100_000) balancePenalty = 25;
  else if (inputs.overdueBalance > 50_000) balancePenalty = 15;
  else if (inputs.overdueBalance > 10_000) balancePenalty = 8;
  else if (inputs.overdueBalance > 0) balancePenalty = 3;
  score -= balancePenalty;

  // VAT status: filed = no penalty, submitted = no penalty, draft + overdue = -20,
  // draft + due-soon (<=14 days) = -10, no return = -5.
  let vatOnTime = true;
  let vatOverdue = false;
  if (inputs.vatStatus === null) {
    score -= 5;
    vatOnTime = false;
  } else if (inputs.vatStatus !== 'filed' && inputs.vatStatus !== 'submitted') {
    if (inputs.vatDueDate) {
      const msUntilDue = inputs.vatDueDate.getTime() - now.getTime();
      const daysUntilDue = Math.floor(msUntilDue / (1000 * 60 * 60 * 24));
      if (msUntilDue < 0) {
        score -= 20;
        vatOnTime = false;
        vatOverdue = true;
      } else if (daysUntilDue <= 14) {
        score -= 10;
        vatOnTime = false;
      }
    }
  }

  // Receipt backlog: each pending receipt costs 0.5pt (cap at 15).
  const backlogPenalty = Math.min(inputs.receiptBacklog * 0.5, 15);
  score -= backlogPenalty;

  // Days since activity: 30+ days = -10, 60+ = -20, 90+ = -30. Null = -10.
  let daysSinceActivity: number | null = null;
  if (inputs.lastActivityAt === null) {
    score -= 10;
  } else {
    daysSinceActivity = Math.floor(
      (now.getTime() - inputs.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceActivity >= 90) score -= 30;
    else if (daysSinceActivity >= 60) score -= 20;
    else if (daysSinceActivity >= 30) score -= 10;
  }

  // Onboarding incomplete: -5
  if (!inputs.onboardingCompleted) score -= 5;

  // Clamp.
  score = Math.max(0, Math.min(100, Math.round(score)));

  const rating =
    HEALTH_RATINGS.find((r) => score >= r.min)?.rating ?? 'critical';

  return {
    companyId: inputs.companyId,
    companyName: inputs.companyName,
    score,
    rating,
    factors: {
      missingDocuments: inputs.missingDocuments,
      overdueBalance: inputs.overdueBalance,
      overdueInvoiceCount: inputs.overdueInvoiceCount,
      vatOnTime,
      vatOverdue,
      receiptBacklog: inputs.receiptBacklog,
      daysSinceActivity,
      onboardingCompleted: inputs.onboardingCompleted,
    },
  };
}

// ─── Pure logic: alert generation ─────────────────────────────────────────────

/**
 * Generate alert candidates for a single client snapshot. The caller decides
 * whether to persist them — typically by deduplicating against existing rows
 * in firm_alerts.
 */
export function generateAlertsForClient(
  snapshot: ClientSnapshot,
  now: Date = new Date()
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];

  // 1. VAT deadline approaching / overdue
  if (
    snapshot.vatDueDate &&
    snapshot.vatStatus !== 'filed' &&
    snapshot.vatStatus !== 'submitted'
  ) {
    const msUntilDue = snapshot.vatDueDate.getTime() - now.getTime();
    const daysUntilDue = Math.floor(msUntilDue / (1000 * 60 * 60 * 24));
    if (msUntilDue < 0) {
      alerts.push({
        companyId: snapshot.companyId,
        alertType: 'vat_deadline',
        severity: 'critical',
        message: `${snapshot.companyName}: VAT return ${Math.abs(daysUntilDue)} days overdue`,
        metadata: { dueDate: snapshot.vatDueDate.toISOString(), daysOverdue: Math.abs(daysUntilDue) },
      });
    } else if (daysUntilDue <= VAT_DEADLINE_CRITICAL_DAYS) {
      alerts.push({
        companyId: snapshot.companyId,
        alertType: 'vat_deadline',
        severity: 'critical',
        message: `${snapshot.companyName}: VAT return due in ${daysUntilDue} days`,
        metadata: { dueDate: snapshot.vatDueDate.toISOString(), daysUntilDue },
      });
    } else if (daysUntilDue <= VAT_DEADLINE_WARNING_DAYS) {
      alerts.push({
        companyId: snapshot.companyId,
        alertType: 'vat_deadline',
        severity: 'warning',
        message: `${snapshot.companyName}: VAT return due in ${daysUntilDue} days`,
        metadata: { dueDate: snapshot.vatDueDate.toISOString(), daysUntilDue },
      });
    }
  }

  // 2. Stale activity
  if (snapshot.lastActivityAt) {
    const daysSince = Math.floor(
      (now.getTime() - snapshot.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSince >= STALE_ACTIVITY_DAYS) {
      alerts.push({
        companyId: snapshot.companyId,
        alertType: 'stale_activity',
        severity: daysSince >= 90 ? 'critical' : 'warning',
        message: `${snapshot.companyName}: no activity for ${daysSince} days`,
        metadata: { daysSinceActivity: daysSince },
      });
    }
  } else {
    alerts.push({
      companyId: snapshot.companyId,
      alertType: 'stale_activity',
      severity: 'warning',
      message: `${snapshot.companyName}: no activity recorded yet`,
    });
  }

  // 3. High overdue balance
  if (snapshot.overdueBalance >= OVERDUE_BALANCE_THRESHOLD) {
    const severity: FirmAlertSeverity =
      snapshot.overdueBalance >= 100_000 ? 'critical' : 'warning';
    alerts.push({
      companyId: snapshot.companyId,
      alertType: 'overdue_balance',
      severity,
      message: `${snapshot.companyName}: AED ${snapshot.overdueBalance.toLocaleString('en-AE')} overdue across ${snapshot.overdueInvoiceCount} invoices`,
      metadata: {
        overdueBalance: snapshot.overdueBalance,
        overdueInvoiceCount: snapshot.overdueInvoiceCount,
      },
    });
  }

  // 4. Incomplete onboarding
  if (!snapshot.onboardingCompleted) {
    alerts.push({
      companyId: snapshot.companyId,
      alertType: 'incomplete_onboarding',
      severity: 'info',
      message: `${snapshot.companyName}: onboarding not yet completed`,
    });
  }

  // 5. Missing documents
  if (snapshot.missingDocuments > 0) {
    alerts.push({
      companyId: snapshot.companyId,
      alertType: 'document_missing',
      severity: snapshot.missingDocuments >= 5 ? 'warning' : 'info',
      message: `${snapshot.companyName}: ${snapshot.missingDocuments} document(s) missing`,
      metadata: { missingCount: snapshot.missingDocuments },
    });
  }

  return alerts;
}

// ─── Pure logic: ranking ──────────────────────────────────────────────────────

export type ClientRankBy = 'health' | 'revenue' | 'overdue' | 'compliance';
export type SortDir = 'asc' | 'desc';

export interface RankableClient {
  companyId: string;
  companyName: string;
  healthScore: number;
  revenue: number;
  overdueBalance: number;
  /** Lower compliance number = worse compliance (matches health.factors). */
  complianceScore: number;
}

export function rankClients<T extends RankableClient>(
  clients: T[],
  by: ClientRankBy,
  dir: SortDir = 'desc'
): T[] {
  const keyFn: Record<ClientRankBy, (c: T) => number> = {
    health: (c) => c.healthScore,
    revenue: (c) => c.revenue,
    overdue: (c) => c.overdueBalance,
    compliance: (c) => c.complianceScore,
  };
  const fn = keyFn[by];
  const factor = dir === 'asc' ? 1 : -1;
  return [...clients].sort((a, b) => factor * (fn(a) - fn(b)));
}

// ─── Pure logic: period comparison ────────────────────────────────────────────

export interface PeriodMetric {
  revenue: number;
  receipts: number;
  invoices: number;
}

export function calculatePeriodComparison(
  currentRange: { start: Date; end: Date },
  current: PeriodMetric,
  previousRange: { start: Date; end: Date },
  previous: PeriodMetric
): PeriodComparison {
  const pct = (curr: number, prev: number): number => {
    if (prev === 0) return curr === 0 ? 0 : 100;
    return Math.round(((curr - prev) / prev) * 1000) / 10; // one decimal
  };

  return {
    current: {
      start: currentRange.start,
      end: currentRange.end,
      revenue: current.revenue,
      receipts: current.receipts,
      invoices: current.invoices,
    },
    previous: {
      start: previousRange.start,
      end: previousRange.end,
      revenue: previous.revenue,
      receipts: previous.receipts,
      invoices: previous.invoices,
    },
    deltas: {
      revenuePct: pct(current.revenue, previous.revenue),
      receiptsPct: pct(current.receipts, previous.receipts),
      invoicesPct: pct(current.invoices, previous.invoices),
    },
  };
}

/** Build prev-period range matching the length of currentRange (immediately preceding). */
export function previousPeriodRange(currentRange: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  const lenMs = currentRange.end.getTime() - currentRange.start.getTime();
  return {
    start: new Date(currentRange.start.getTime() - lenMs),
    end: new Date(currentRange.start.getTime()),
  };
}

// ─── Pure logic: workload distribution ────────────────────────────────────────

export interface StaffWorkloadInput {
  userId: string;
  userName: string;
  userEmail: string;
  assignments: Array<{ companyId: string; role: string }>;
}

export interface StaffWorkloadRow {
  userId: string;
  userName: string;
  userEmail: string;
  clientCount: number;
  rolesByName: Record<string, number>;
}

export function computeStaffWorkload(input: StaffWorkloadInput[]): StaffWorkloadRow[] {
  return input.map((s) => {
    const rolesByName: Record<string, number> = {};
    for (const a of s.assignments) {
      rolesByName[a.role] = (rolesByName[a.role] ?? 0) + 1;
    }
    return {
      userId: s.userId,
      userName: s.userName,
      userEmail: s.userEmail,
      clientCount: s.assignments.length,
      rolesByName,
    };
  });
}

// ─── Pure logic: batch scoping ────────────────────────────────────────────────

export interface BatchScopingResult {
  allowedCompanyIds: string[];
  rejectedCompanyIds: string[];
}

/**
 * Reduce a caller-supplied list of companyIds down to the ones the firm staff
 * member actually has access to. Returns both the allowed and rejected sets so
 * the caller can return per-company status to the UI.
 */
export function scopeBatchToAccessible(
  requested: string[],
  accessible: string[] | null
): BatchScopingResult {
  const dedupedRequested = Array.from(new Set(requested));
  if (accessible === null) {
    return { allowedCompanyIds: dedupedRequested, rejectedCompanyIds: [] };
  }
  const accessibleSet = new Set(accessible);
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const id of dedupedRequested) {
    if (accessibleSet.has(id)) allowed.push(id);
    else rejected.push(id);
  }
  return { allowedCompanyIds: allowed, rejectedCompanyIds: rejected };
}

// ─── DB-backed: client snapshots ──────────────────────────────────────────────

/**
 * Build snapshot rows for a list of company IDs in a single SQL pass per metric
 * type. No N+1 — all aggregations use GROUP BY + inArray.
 */
export async function buildClientSnapshots(
  companyIds: string[],
  now: Date = new Date()
): Promise<ClientSnapshot[]> {
  if (companyIds.length === 0) return [];

  const companyRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      onboardingCompleted: companies.onboardingCompleted,
    })
    .from(companies)
    .where(inArray(companies.id, companyIds));

  // Overdue invoices per company.
  type OverdueRow = { companyId: string; balance: string | null; cnt: number };
  const overdueRows = (await db
    .select({
      companyId: invoices.companyId,
      balance: sum(invoices.total),
      cnt: count(),
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.companyId, companyIds),
        or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
        lt(invoices.dueDate, now)
      )
    )
    .groupBy(invoices.companyId)) as OverdueRow[];
  const overdueMap = new Map(overdueRows.map((r) => [r.companyId, r]));

  // Latest VAT return per company.
  const latestVatSub = db
    .select({
      companyId: vatReturns.companyId,
      maxPeriodEnd: max(vatReturns.periodEnd).as('max_period_end'),
    })
    .from(vatReturns)
    .where(inArray(vatReturns.companyId, companyIds))
    .groupBy(vatReturns.companyId)
    .as('latest_vat_phase6');

  type VatRow = {
    companyId: string;
    status: string;
    dueDate: Date;
  };
  const vatRows = (await db
    .select({
      companyId: vatReturns.companyId,
      status: vatReturns.status,
      dueDate: vatReturns.dueDate,
    })
    .from(vatReturns)
    .innerJoin(
      latestVatSub,
      and(
        eq(vatReturns.companyId, latestVatSub.companyId),
        eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd)
      )
    )) as VatRow[];
  const vatMap = new Map(vatRows.map((r) => [r.companyId, r]));

  // Unposted receipt backlog.
  type BacklogRow = { companyId: string; cnt: number };
  const backlogRows = (await db
    .select({ companyId: receipts.companyId, cnt: count() })
    .from(receipts)
    .where(and(inArray(receipts.companyId, companyIds), eq(receipts.posted, false)))
    .groupBy(receipts.companyId)) as BacklogRow[];
  const backlogMap = new Map(backlogRows.map((r) => [r.companyId, r.cnt]));

  // Last activity = max(last invoice, last receipt, last bank tx) per company.
  type ActivityRow = { companyId: string; lastDate: Date | null };
  const [lastInvoice, lastReceipt, lastBank] = await Promise.all([
    db
      .select({ companyId: invoices.companyId, lastDate: max(invoices.createdAt) })
      .from(invoices)
      .where(inArray(invoices.companyId, companyIds))
      .groupBy(invoices.companyId) as Promise<ActivityRow[]>,
    db
      .select({ companyId: receipts.companyId, lastDate: max(receipts.createdAt) })
      .from(receipts)
      .where(inArray(receipts.companyId, companyIds))
      .groupBy(receipts.companyId) as Promise<ActivityRow[]>,
    db
      .select({
        companyId: bankTransactions.companyId,
        lastDate: max(bankTransactions.transactionDate),
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.companyId, companyIds))
      .groupBy(bankTransactions.companyId) as Promise<ActivityRow[]>,
  ]);
  const activityMap = new Map<string, Date | null>();
  for (const set of [lastInvoice, lastReceipt, lastBank]) {
    for (const r of set) {
      const existing = activityMap.get(r.companyId);
      if (!existing || (r.lastDate && r.lastDate > existing)) {
        activityMap.set(r.companyId, r.lastDate);
      }
    }
  }

  return companyRows.map((c: { id: string; name: string; onboardingCompleted: boolean }) => {
    const overdue = overdueMap.get(c.id);
    const vat = vatMap.get(c.id);
    return {
      companyId: c.id,
      companyName: c.name,
      onboardingCompleted: c.onboardingCompleted,
      vatStatus: (vat?.status as ClientSnapshot['vatStatus']) ?? null,
      vatDueDate: vat?.dueDate ?? null,
      overdueBalance: Number(overdue?.balance ?? 0),
      overdueInvoiceCount: Number(overdue?.cnt ?? 0),
      // Phase 6 doesn't yet model "missing documents" as a first-class concept;
      // we approximate by checking onboardingCompleted (Phase 5 builds the doc
      // chase queue separately). 0 here = no signal; UI can layer in document
      // chasing data when available.
      missingDocuments: c.onboardingCompleted ? 0 : 3,
      receiptBacklog: backlogMap.get(c.id) ?? 0,
      lastActivityAt: activityMap.get(c.id) ?? null,
    };
  });
}

// ─── DB-backed: dashboard summary ─────────────────────────────────────────────

export async function buildDashboardSummary(
  companyIds: string[],
  now: Date = new Date()
): Promise<FirmDashboardSummary> {
  if (companyIds.length === 0) {
    return {
      totalClients: 0,
      activeClients: 0,
      totalRevenue: 0,
      totalOutstandingAr: 0,
      totalVatLiability: 0,
      receiptsProcessedThisMonth: 0,
      invoicesIssuedThisMonth: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      averageHealthScore: 0,
    };
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [companyRows, revenueRow, arRow, vatRow, monthReceipts, monthInvoices] = await Promise.all(
    [
      db
        .select({ id: companies.id, isActive: companies.isActive })
        .from(companies)
        .where(inArray(companies.id, companyIds)),
      db
        .select({ total: sum(invoices.total) })
        .from(invoices)
        .where(and(inArray(invoices.companyId, companyIds), eq(invoices.status, 'paid'))),
      db
        .select({ total: sum(invoices.total) })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, companyIds),
            or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial'))
          )
        ),
      db
        .select({ liability: sum(vatReturns.box14PayableTax) })
        .from(vatReturns)
        .where(
          and(
            inArray(vatReturns.companyId, companyIds),
            ne(vatReturns.status, 'filed'),
            ne(vatReturns.status, 'submitted')
          )
        ),
      db
        .select({ cnt: count() })
        .from(receipts)
        .where(
          and(inArray(receipts.companyId, companyIds), gte(receipts.createdAt, monthStart))
        ),
      db
        .select({ cnt: count() })
        .from(invoices)
        .where(
          and(inArray(invoices.companyId, companyIds), gte(invoices.createdAt, monthStart))
        ),
    ]
  );

  return {
    totalClients: companyRows.length,
    activeClients: companyRows.filter((c: { isActive: boolean }) => c.isActive).length,
    totalRevenue: Number(revenueRow[0]?.total ?? 0),
    totalOutstandingAr: Number(arRow[0]?.total ?? 0),
    totalVatLiability: Number(vatRow[0]?.liability ?? 0),
    receiptsProcessedThisMonth: Number(monthReceipts[0]?.cnt ?? 0),
    invoicesIssuedThisMonth: Number(monthInvoices[0]?.cnt ?? 0),
    // Filled in by buildHealthScores() composer downstream.
    criticalAlertCount: 0,
    warningAlertCount: 0,
    averageHealthScore: 0,
  };
}

// ─── DB-backed: period comparison ─────────────────────────────────────────────

export async function fetchPeriodMetric(
  companyIds: string[],
  range: { start: Date; end: Date }
): Promise<PeriodMetric> {
  if (companyIds.length === 0) return { revenue: 0, receipts: 0, invoices: 0 };

  const [revenue, recCount, invCount] = await Promise.all([
    db
      .select({ total: sum(invoices.total) })
      .from(invoices)
      .where(
        and(
          inArray(invoices.companyId, companyIds),
          eq(invoices.status, 'paid'),
          gte(invoices.createdAt, range.start),
          lt(invoices.createdAt, range.end)
        )
      ),
    db
      .select({ cnt: count() })
      .from(receipts)
      .where(
        and(
          inArray(receipts.companyId, companyIds),
          gte(receipts.createdAt, range.start),
          lt(receipts.createdAt, range.end)
        )
      ),
    db
      .select({ cnt: count() })
      .from(invoices)
      .where(
        and(
          inArray(invoices.companyId, companyIds),
          gte(invoices.createdAt, range.start),
          lt(invoices.createdAt, range.end)
        )
      ),
  ]);

  return {
    revenue: Number(revenue[0]?.total ?? 0),
    receipts: Number(recCount[0]?.cnt ?? 0),
    invoices: Number(invCount[0]?.cnt ?? 0),
  };
}

// ─── DB-backed: alerts ────────────────────────────────────────────────────────

export async function listFirmAlerts(
  firmId: string,
  filters: { severity?: FirmAlertSeverity; isRead?: boolean } = {}
): Promise<FirmAlert[]> {
  const conds = [eq(firmAlerts.firmId, firmId)];
  if (filters.severity) conds.push(eq(firmAlerts.severity, filters.severity));
  if (filters.isRead !== undefined) conds.push(eq(firmAlerts.isRead, filters.isRead));

  return db
    .select()
    .from(firmAlerts)
    .where(and(...conds))
    .orderBy(desc(firmAlerts.createdAt));
}

export async function persistAlertCandidates(
  firmId: string,
  candidates: AlertCandidate[]
): Promise<FirmAlert[]> {
  if (candidates.length === 0) return [];

  const rows = candidates.map((c) => ({
    firmId,
    companyId: c.companyId,
    alertType: c.alertType,
    severity: c.severity,
    message: c.message,
    metadata: c.metadata ? JSON.stringify(c.metadata) : null,
  }));

  return db.insert(firmAlerts).values(rows).returning();
}

/**
 * Atomically generate alert candidates and persist only the ones that don't
 * already have an unresolved row for the same (companyId, alertType).
 *
 * Uses a transaction-scoped advisory lock keyed on the firm id so concurrent
 * /alerts/refresh calls from the same firm serialize on the dedupe step. This
 * prevents the read-then-insert race that would otherwise let two callers each
 * pass the dedupe filter and create duplicate alerts.
 */
export async function refreshFirmAlerts(
  firmId: string,
  candidates: AlertCandidate[]
): Promise<{ generated: number; created: FirmAlert[] }> {
  if (candidates.length === 0) return { generated: 0, created: [] };

  return await db.transaction(async (tx: typeof db) => {
    // Hash the firm id into two int4 keys to fit pg_advisory_xact_lock(int, int).
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${'firm_alerts_refresh'}), hashtext(${firmId}))`,
    );

    const existing = await tx
      .select({ companyId: firmAlerts.companyId, alertType: firmAlerts.alertType })
      .from(firmAlerts)
      .where(and(eq(firmAlerts.firmId, firmId), sql`${firmAlerts.resolvedAt} IS NULL`));

    const existingKeys = new Set(
      existing.map(
        (a: { companyId: string | null; alertType: string }) =>
          `${a.companyId ?? ''}|${a.alertType}`,
      ),
    );
    const fresh = candidates.filter(
      (c) => !existingKeys.has(`${c.companyId ?? ''}|${c.alertType}`),
    );
    if (fresh.length === 0) return { generated: candidates.length, created: [] };

    const rows = fresh.map((c) => ({
      firmId,
      companyId: c.companyId,
      alertType: c.alertType,
      severity: c.severity,
      message: c.message,
      metadata: c.metadata ? JSON.stringify(c.metadata) : null,
    }));

    const created = await tx.insert(firmAlerts).values(rows).returning();
    return { generated: candidates.length, created };
  });
}

export async function markAlertRead(firmId: string, alertId: string): Promise<FirmAlert | null> {
  const [updated] = await db
    .update(firmAlerts)
    .set({ isRead: true })
    .where(and(eq(firmAlerts.id, alertId), eq(firmAlerts.firmId, firmId)))
    .returning();
  return updated ?? null;
}

export async function resolveAlert(firmId: string, alertId: string): Promise<FirmAlert | null> {
  const [updated] = await db
    .update(firmAlerts)
    .set({ isRead: true, resolvedAt: new Date() })
    .where(and(eq(firmAlerts.id, alertId), eq(firmAlerts.firmId, firmId)))
    .returning();
  return updated ?? null;
}

// ─── DB-backed: staff workload ────────────────────────────────────────────────

export async function fetchStaffWorkload(): Promise<StaffWorkloadRow[]> {
  type Row = {
    userId: string;
    userName: string;
    userEmail: string;
    companyId: string | null;
    role: string | null;
  };
  const rows = (await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      companyId: firmStaffAssignments.companyId,
      role: firmStaffAssignments.role,
    })
    .from(users)
    .leftJoin(firmStaffAssignments, eq(firmStaffAssignments.userId, users.id))
    .where(eq(users.firmRole, 'firm_admin'))) as Row[];

  const grouped = new Map<string, StaffWorkloadInput>();
  for (const r of rows) {
    let entry = grouped.get(r.userId);
    if (!entry) {
      entry = {
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        assignments: [],
      };
      grouped.set(r.userId, entry);
    }
    if (r.companyId && r.role) {
      entry.assignments.push({ companyId: r.companyId, role: r.role });
    }
  }
  return computeStaffWorkload(Array.from(grouped.values()));
}

export async function assignStaffToCompany(
  userId: string,
  companyId: string,
  role: string = 'accountant'
): Promise<void> {
  // Validate the user is firm_admin. firm_owner doesn't need explicit assignment.
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new NotFoundError('User');
  if (u.firmRole !== 'firm_admin') {
    throw new ValidationError('Only firm_admin users can be assigned via this endpoint');
  }
  // Validate the target is a managed client company.
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) throw new NotFoundError('Company');
  if (c.companyType !== 'client') {
    throw new ValidationError('Only managed client companies can have staff assignments');
  }

  await db
    .insert(firmStaffAssignments)
    .values({ userId, companyId, role })
    .onConflictDoUpdate({
      target: [firmStaffAssignments.userId, firmStaffAssignments.companyId],
      set: { role },
    });
}

// ─── DB-backed: cache ─────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function readMetricsCache<T>(
  firmId: string,
  metricType: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
  period?: { start: Date | null; end: Date | null }
): Promise<T | null> {
  const conds = [
    eq(firmMetricsCache.firmId, firmId),
    eq(firmMetricsCache.metricType, metricType),
  ];
  if (period) {
    if (period.start) conds.push(eq(firmMetricsCache.periodStart, period.start));
    if (period.end) conds.push(eq(firmMetricsCache.periodEnd, period.end));
  }
  const [row] = await db
    .select()
    .from(firmMetricsCache)
    .where(and(...conds))
    .orderBy(desc(firmMetricsCache.calculatedAt))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.calculatedAt.getTime() > ttlMs) return null;
  try {
    return JSON.parse(row.metricValue) as T;
  } catch {
    return null;
  }
}

export async function writeMetricsCache<T>(
  firmId: string,
  metricType: string,
  value: T,
  period?: { start: Date | null; end: Date | null }
): Promise<void> {
  await db
    .insert(firmMetricsCache)
    .values({
      firmId,
      metricType,
      metricValue: JSON.stringify(value),
      periodStart: period?.start ?? null,
      periodEnd: period?.end ?? null,
    })
    .onConflictDoUpdate({
      target: [
        firmMetricsCache.firmId,
        firmMetricsCache.metricType,
        firmMetricsCache.periodStart,
        firmMetricsCache.periodEnd,
      ],
      set: {
        metricValue: JSON.stringify(value),
        calculatedAt: new Date(),
      },
    });
}

// ─── Helpers re-exported from rbac ────────────────────────────────────────────

/**
 * Resolve the companyIds the firm staff member can access. firm_owner gets all
 * client companies; firm_admin gets only assigned companies.
 */
export async function resolveAccessibleClientIds(
  userId: string,
  firmRole: string | null
): Promise<string[]> {
  if (firmRole === 'firm_owner') {
    const rows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.companyType, 'client'));
    return rows.map((r: { id: string }) => r.id);
  }
  if (firmRole === 'firm_admin') {
    const rows = await db
      .select({ id: firmStaffAssignments.companyId })
      .from(firmStaffAssignments)
      .innerJoin(companies, eq(companies.id, firmStaffAssignments.companyId))
      .where(
        and(eq(firmStaffAssignments.userId, userId), eq(companies.companyType, 'client'))
      );
    return rows.map((r: { id: string }) => r.id);
  }
  return [];
}

// ─── Aggregate composer ───────────────────────────────────────────────────────

/**
 * High-level orchestrator for the dashboard endpoint: aggregates summary,
 * health scores, and alert counts in one pass, applying caching when possible.
 */
export async function buildFirmDashboard(
  firmId: string,
  firmRole: string | null,
  options: { skipCache?: boolean } = {}
): Promise<{
  summary: FirmDashboardSummary;
  healthScores: ClientHealthScore[];
}> {
  const cacheKey = 'dashboard_summary';
  if (!options.skipCache) {
    const cached = await readMetricsCache<{
      summary: FirmDashboardSummary;
      healthScores: ClientHealthScore[];
    }>(firmId, cacheKey);
    if (cached) return cached;
  }

  const companyIds = await resolveAccessibleClientIds(firmId, firmRole);
  const [summary, snapshots] = await Promise.all([
    buildDashboardSummary(companyIds),
    buildClientSnapshots(companyIds),
  ]);

  const healthScores = snapshots.map((s) =>
    calculateHealthScore({
      companyId: s.companyId,
      companyName: s.companyName,
      missingDocuments: s.missingDocuments,
      overdueBalance: s.overdueBalance,
      overdueInvoiceCount: s.overdueInvoiceCount,
      vatStatus: s.vatStatus,
      vatDueDate: s.vatDueDate,
      receiptBacklog: s.receiptBacklog,
      lastActivityAt: s.lastActivityAt,
      onboardingCompleted: s.onboardingCompleted,
    })
  );

  const avg =
    healthScores.length === 0
      ? 0
      : Math.round(healthScores.reduce((a, h) => a + h.score, 0) / healthScores.length);

  // Pull alert counts from the persisted feed so the dashboard matches the alert UI.
  const [alertCounts] = await db
    .select({
      critical: sql<number>`sum(case when ${firmAlerts.severity} = 'critical' and ${firmAlerts.resolvedAt} is null then 1 else 0 end)`,
      warning: sql<number>`sum(case when ${firmAlerts.severity} = 'warning' and ${firmAlerts.resolvedAt} is null then 1 else 0 end)`,
    })
    .from(firmAlerts)
    .where(eq(firmAlerts.firmId, firmId));

  const enrichedSummary: FirmDashboardSummary = {
    ...summary,
    averageHealthScore: avg,
    criticalAlertCount: Number(alertCounts?.critical ?? 0),
    warningAlertCount: Number(alertCounts?.warning ?? 0),
  };

  const result = { summary: enrichedSummary, healthScores };
  if (!options.skipCache) {
    await writeMetricsCache(firmId, cacheKey, result);
  }
  return result;
}

