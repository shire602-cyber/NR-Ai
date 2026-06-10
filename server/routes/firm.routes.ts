import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Express } from 'express';
import { z } from 'zod';

import { storage } from '../storage';
import { authMiddleware } from '../middleware/auth';
import { requireFirmRole, getAccessibleCompanyIds } from '../middleware/rbac';
import { asyncHandler } from '../middleware/errorHandler';
import { createLogger } from '../config/logger';
import { createDefaultAccountsForCompany } from '../defaultChartOfAccounts';
import {
  currentVatPeriodForCompany,
  mapImportRow,
  nextCorporateTaxFilingWindow,
  validateImportedClient,
  vatCohortFromPeriodStart,
  type VatCohort,
  type VatCohortKey,
} from '../services/firm-clients.service';
import {
  CLIENT_SERVICE_OPTIONS,
  DEFAULT_CLIENT_SERVICE_CODES,
  engagementTypeForServices,
  normalizeClientServices,
  type ClientServiceCode,
  type ClientServicePlan,
} from '@shared/client-services';
import { parseSpreadsheet } from '../services/spreadsheet.service';
import { db } from '../db';
import { eq, and, count, sum, max, or, desc, inArray, sql, lt, ne, lte } from 'drizzle-orm';
import {
  companies,
  companyUsers,
  users,
  invoices,
  receipts,
  vatReturns,
  corporateTaxReturns,
  bankTransactions,
  journalEntries,
  journalLines,
  engagements,
} from '../../shared/schema';

const logger = createLogger('firm-routes');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedChartOfAccounts(companyId: string): Promise<void> {
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) return;
  const defaultAccounts = createDefaultAccountsForCompany(companyId);
  await storage.createBulkAccounts(defaultAccounts as any);
}

async function getClientStats(companyId: string) {
  const [
    invoiceStats,
    arStats,
    lastReceipt,
    lastBankTx,
    latestVatReturn,
    staffRows,
  ] = await Promise.all([
    // Total invoices: count + sum
    db
      .select({ cnt: count(), total: sum(invoices.total) })
      .from(invoices)
      .where(eq(invoices.companyId, companyId))
      .then((r: { cnt: number; total: string | null }[]) => r[0]),

    // Outstanding AR: sum of totals for sent/partial invoices
    db
      .select({ ar: sum(invoices.total) })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial'))
        )
      )
      .then((r: { ar: string | null }[]) => r[0]),

    // Last receipt uploaded
    db
      .select({ lastDate: max(receipts.createdAt) })
      .from(receipts)
      .where(eq(receipts.companyId, companyId))
      .then((r: { lastDate: Date | null }[]) => r[0]),

    // Last bank transaction (proxy for last reconciliation activity)
    db
      .select({ lastDate: max(bankTransactions.transactionDate) })
      .from(bankTransactions)
      .where(eq(bankTransactions.companyId, companyId))
      .then((r: { lastDate: Date | null }[]) => r[0]),

    // Latest VAT return
    db
      .select({
        status: vatReturns.status,
        dueDate: vatReturns.dueDate,
        periodEnd: vatReturns.periodEnd,
      })
      .from(vatReturns)
      .where(eq(vatReturns.companyId, companyId))
      .orderBy(desc(vatReturns.periodEnd))
      .limit(1)
      .then((r: { status: string; dueDate: Date; periodEnd: Date }[]) => r[0] || null),

    // Assigned staff: users linked to this company who are admins
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: companyUsers.role,
      })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, companyId), eq(users.isAdmin, true))),
  ]);

  return {
    invoiceCount: Number(invoiceStats?.cnt ?? 0),
    invoiceTotal: Number(invoiceStats?.total ?? 0),
    outstandingAr: Number(arStats?.ar ?? 0),
    lastReceiptDate: lastReceipt?.lastDate ?? null,
    lastBankActivityDate: lastBankTx?.lastDate ?? null,
    vatStatus: latestVatReturn
      ? {
          status: latestVatReturn.status,
          dueDate: latestVatReturn.dueDate,
          periodEnd: latestVatReturn.periodEnd,
        }
      : null,
    assignedStaff: staffRows,
  };
}

type HealthStatus = 'healthy' | 'attention' | 'critical';
type VatHealthStatus = 'on-track' | 'due-soon' | 'overdue';
type DeadlineStatus = 'upcoming' | 'due-soon' | 'overdue';
type BookkeeperPriority = 'on_track' | 'attention' | 'critical';
type BookkeeperInterventionLevel = 'low' | 'medium' | 'high';
type BookkeeperQueueItem = {
  companyId: string;
  companyName: string;
  priority: BookkeeperPriority;
  ownerNames: string[];
  dueDate: string | null;
  daysTilDue: number | null;
  metric: string;
  action: string;
  blockers: string[];
};

function daysUntil(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSince(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function mostRecentDate(...dates: Array<Date | string | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of dates) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function maxHealthStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('attention')) return 'attention';
  return 'healthy';
}

function vatHealthFromReturn(
  vat: { status: string; dueDate: Date | string | null } | null | undefined,
  now: Date,
): VatHealthStatus {
  if (!vat) return 'on-track';
  if (vat.status === 'filed' || vat.status === 'submitted') return 'on-track';
  const dueIn = daysUntil(vat.dueDate, now);
  if (dueIn === null) return 'on-track';
  if (dueIn < 0) return 'overdue';
  if (dueIn <= 14) return 'due-soon';
  return 'on-track';
}

function vatStatusToHealth(status: VatHealthStatus): HealthStatus {
  if (status === 'overdue') return 'critical';
  if (status === 'due-soon') return 'attention';
  return 'healthy';
}

function deadlineStatus(daysTilDue: number): DeadlineStatus {
  if (daysTilDue < 0) return 'overdue';
  if (daysTilDue <= 14) return 'due-soon';
  return 'upcoming';
}

function emptyHealthPayload() {
  return {
    clients: [],
    summary: {
      totalClients: 0,
      healthy: 0,
      attention: 0,
      critical: 0,
    },
  };
}

function priorityRank(priority: BookkeeperPriority): number {
  if (priority === 'critical') return 3;
  if (priority === 'attention') return 2;
  return 1;
}

function maxPriority(...priorities: BookkeeperPriority[]): BookkeeperPriority {
  return priorities.reduce(
    (current, next) => (priorityRank(next) > priorityRank(current) ? next : current),
    'on_track' as BookkeeperPriority,
  );
}

function priorityFromDueDays(
  daysTilDue: number | null,
  attentionWindowDays: number,
  criticalWindowDays = 0,
): BookkeeperPriority {
  if (daysTilDue === null) return 'on_track';
  if (daysTilDue < criticalWindowDays) return 'critical';
  if (daysTilDue <= attentionWindowDays) return 'attention';
  return 'on_track';
}

function shortIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function sortBookkeeperQueue<T extends Pick<BookkeeperQueueItem, 'priority' | 'daysTilDue' | 'companyName'>>(items: T[]): T[] {
  return items.sort((a, b) => {
    const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
    if (priorityDelta !== 0) return priorityDelta;
    const aDue = a.daysTilDue ?? 99999;
    const bDue = b.daysTilDue ?? 99999;
    if (aDue !== bDue) return aDue - bDue;
    return a.companyName.localeCompare(b.companyName);
  });
}

function scoreDeadlinePressure(daysTilDue: number | null, overdue: number, week: number, month: number, quarter = 0): number {
  if (daysTilDue === null) return 0;
  if (daysTilDue <= 0) return overdue;
  if (daysTilDue <= 7) return week;
  if (daysTilDue <= 28) return month;
  if (daysTilDue <= 90) return quarter;
  return 0;
}

function dueLabel(daysTilDue: number | null): string {
  if (daysTilDue === null) return 'no date';
  if (daysTilDue < 0) return `${Math.abs(daysTilDue)}d overdue`;
  if (daysTilDue === 0) return 'due today';
  return `${daysTilDue}d left`;
}

function interventionLevel(score: number): BookkeeperInterventionLevel {
  if (score >= 65) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function buildBookkeeperIntervention(input: {
  priority: BookkeeperPriority;
  nextBestAction: string;
  assignedStaffCount: number;
  vatDaysTilDue: number | null;
  ctDaysTilDue: number | null;
  vatBlockers: string[];
  ctBlockers: string[];
  bookkeepingBlockers: string[];
  accountingBlockers: string[];
  closeProgress: number;
  openAr: number;
  overdueInvoiceCount: number;
  missingCustomerTrnCount: number;
  unpostedReceiptCount: number;
  unreconciledBankCount: number;
  daysSinceActivity: number | null;
  noOperatingDocs: boolean;
  discrepancy: number;
}) {
  let score = input.priority === 'critical' ? 24 : input.priority === 'attention' ? 12 : 0;
  score += scoreDeadlinePressure(input.vatDaysTilDue, 24, 18, 10);
  score += scoreDeadlinePressure(input.ctDaysTilDue, 18, 14, 8, 4);
  score += input.assignedStaffCount === 0 ? 12 : 0;
  score += input.noOperatingDocs ? 18 : 0;
  score += Math.min(16, input.overdueInvoiceCount * 4);
  score += Math.min(14, input.unreconciledBankCount * 2);
  score += Math.min(12, input.unpostedReceiptCount * 3);
  score += Math.min(8, input.missingCustomerTrnCount * 2);
  score += input.closeProgress < 50 ? 12 : input.closeProgress < 75 ? 6 : 0;
  score += input.daysSinceActivity !== null && input.daysSinceActivity > 60 ? 12 : input.daysSinceActivity !== null && input.daysSinceActivity > 30 ? 6 : 0;
  score += input.discrepancy > 0.01 ? 14 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons: string[] = [];
  if (input.vatDaysTilDue !== null && input.vatDaysTilDue <= 28) reasons.push(`VAT ${dueLabel(input.vatDaysTilDue)}`);
  if (input.ctDaysTilDue !== null && input.ctDaysTilDue <= 90) reasons.push(`CT ${dueLabel(input.ctDaysTilDue)}`);
  if (input.assignedStaffCount === 0) reasons.push('No owner assigned');
  if (input.noOperatingDocs) reasons.push('No source documents loaded');
  if (input.overdueInvoiceCount > 0) reasons.push(`${input.overdueInvoiceCount} overdue invoices`);
  if (input.unreconciledBankCount > 0) reasons.push(`${input.unreconciledBankCount} unreconciled bank lines`);
  if (input.unpostedReceiptCount > 0) reasons.push(`${input.unpostedReceiptCount} unposted receipts`);
  if (input.missingCustomerTrnCount > 0) reasons.push(`${input.missingCustomerTrnCount} invoice TRN gaps`);
  if (input.daysSinceActivity !== null && input.daysSinceActivity > 30) reasons.push(`${input.daysSinceActivity}d since activity`);
  if (input.discrepancy > 0.01) reasons.push('Trial balance variance');
  if (reasons.length === 0) reasons.push('No active intervention signals');

  const nearestDeadline = [
    { label: 'VAT', daysTilDue: input.vatDaysTilDue },
    { label: 'CT', daysTilDue: input.ctDaysTilDue },
  ]
    .filter((item): item is { label: string; daysTilDue: number } => item.daysTilDue !== null)
    .sort((a, b) => a.daysTilDue - b.daysTilDue)[0];

  const title =
    input.assignedStaffCount === 0 && score >= 35 ? 'Owner assignment needed'
      : input.vatDaysTilDue !== null && input.vatDaysTilDue <= 7 && input.vatBlockers.length > 0 ? 'VAT filing at risk'
        : input.ctDaysTilDue !== null && input.ctDaysTilDue <= 30 && input.ctBlockers.length > 0 ? 'Corporate tax at risk'
          : input.noOperatingDocs || input.closeProgress < 50 ? 'Source-document intervention'
            : input.openAr > 0 && input.overdueInvoiceCount > 0 ? 'Payment collection drag'
              : input.discrepancy > 0.01 ? 'Accounting review required'
                : input.nextBestAction;

  const ownerAction =
    input.assignedStaffCount === 0 ? 'Assign an owner'
      : input.vatDaysTilDue !== null && input.vatDaysTilDue <= 0 ? 'Escalate VAT filing'
        : input.ctDaysTilDue !== null && input.ctDaysTilDue <= 30 ? 'Lock CT preparation plan'
          : input.noOperatingDocs ? 'Request missing source documents'
            : input.overdueInvoiceCount > 0 ? 'Start payment chase'
              : input.unreconciledBankCount > 0 || input.unpostedReceiptCount > 0 ? 'Clear close blockers'
                : input.discrepancy > 0.01 ? 'Review trial balance'
                  : input.nextBestAction;

  return {
    score,
    level: interventionLevel(score),
    title,
    reasons: reasons.slice(0, 5),
    ownerAction,
    deadlineLabel: nearestDeadline ? `${nearestDeadline.label} ${dueLabel(nearestDeadline.daysTilDue)}` : 'No deadline pressure',
    exposureAed: Math.round(Math.max(0, input.openAr)),
  };
}

const STANDARD_VAT_COHORTS = [
  vatCohortFromPeriodStart(11, 'quarterly'),
  vatCohortFromPeriodStart(12, 'quarterly'),
  vatCohortFromPeriodStart(1, 'quarterly'),
] as VatCohort[];

function emptyBookkeeperDashboard() {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalClients: 0,
      critical: 0,
      attention: 0,
      onTrack: 0,
      vatDue28Days: 0,
      corporateTaxDue90Days: 0,
      bookkeepingBlocked: 0,
      interventionHigh: 0,
      interventionMedium: 0,
    },
    vatCohorts: STANDARD_VAT_COHORTS.map(cohort => ({
      key: cohort.key,
      label: cohort.label,
      closeMonths: cohort.closeMonths,
      closeMonthLabels: cohort.closeMonthLabels,
      clientCount: 0,
      dueSoon: 0,
      blocked: 0,
      ready: 0,
      clients: [],
    })),
    queues: {
      vat: [],
      corporateTax: [],
      bookkeeping: [],
      accounting: [],
    },
    workload: {
      owners: [],
      unassignedClients: 0,
      overloadedStaff: 0,
    },
    clients: [],
  };
}

type EngagementSummaryRow = {
  id: string;
  companyId: string;
  engagementType: string;
  status: string;
  monthlyFee: unknown;
  billingCycle: string | null;
  servicesIncluded: string | null;
};

function moneyToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function servicePlanFromEngagement(row: EngagementSummaryRow | undefined): ClientServicePlan {
  if (!row) {
    return {
      engagementId: null,
      engagementType: 'full_service',
      servicesIncluded: [...DEFAULT_CLIENT_SERVICE_CODES],
      source: 'default',
      status: 'active',
      monthlyFee: null,
      billingCycle: 'monthly',
    };
  }

  const servicesIncluded = normalizeClientServices(row.servicesIncluded);
  return {
    engagementId: row.id,
    engagementType: row.engagementType || engagementTypeForServices(servicesIncluded),
    servicesIncluded,
    source: 'engagement',
    status: row.status || 'active',
    monthlyFee: moneyToNumber(row.monthlyFee),
    billingCycle: row.billingCycle ?? 'monthly',
  };
}

async function loadActiveServicePlans(companyIds: string[]): Promise<Map<string, ClientServicePlan>> {
  const planMap = new Map<string, ClientServicePlan>();
  if (companyIds.length === 0) return planMap;

  const rows = (await db
    .select({
      id: engagements.id,
      companyId: engagements.companyId,
      engagementType: engagements.engagementType,
      status: engagements.status,
      monthlyFee: engagements.monthlyFee,
      billingCycle: engagements.billingCycle,
      servicesIncluded: engagements.servicesIncluded,
    })
    .from(engagements)
    .where(and(inArray(engagements.companyId, companyIds), eq(engagements.status, 'active')))
    .orderBy(desc(engagements.updatedAt), desc(engagements.createdAt))) as EngagementSummaryRow[];

  for (const row of rows) {
    if (!planMap.has(row.companyId)) {
      planMap.set(row.companyId, servicePlanFromEngagement(row));
    }
  }

  return planMap;
}

async function upsertClientServicePlan(
  companyId: string,
  userId: string,
  services: readonly ClientServiceCode[],
): Promise<ClientServicePlan> {
  const normalizedServices = normalizeClientServices(services);
  const servicePayload = JSON.stringify(normalizedServices);
  const engagementType = engagementTypeForServices(normalizedServices);

  const [existing] = await db
    .select()
    .from(engagements)
    .where(and(eq(engagements.companyId, companyId), eq(engagements.status, 'active')))
    .orderBy(desc(engagements.updatedAt), desc(engagements.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(engagements)
      .set({
        engagementType,
        servicesIncluded: servicePayload,
        accountManagerId: existing.accountManagerId ?? userId,
        updatedAt: new Date(),
      })
      .where(eq(engagements.id, existing.id))
      .returning();
    return servicePlanFromEngagement(updated as EngagementSummaryRow);
  }

  const [created] = await db
    .insert(engagements)
    .values({
      companyId,
      accountManagerId: userId,
      engagementType,
      status: 'active',
      startDate: new Date(),
      billingCycle: 'monthly',
      servicesIncluded: servicePayload,
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    })
    .returning();

  return servicePlanFromEngagement(created as EngagementSummaryRow);
}

// ─── Route registration ───────────────────────────────────────────────────────

const clientServiceSchema = z.enum(['vat', 'bookkeeping', 'corporate_tax', 'accounting']);

const createClientSchema = z.object({
  name: z.string().min(1),
  trnVatNumber: z.string().optional(),
  legalStructure: z.string().optional(),
  industry: z.string().optional(),
  registrationNumber: z.string().optional(),
  businessAddress: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  websiteUrl: z.string().optional(),
  emirate: z.string().optional(),
  vatFilingFrequency: z.string().optional(),
  vatPeriodStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  taxRegistrationType: z.string().optional(),
  corporateTaxId: z.string().optional(),
  serviceScope: z.array(clientServiceSchema).optional(),
});

const updateClientSchema = createClientSchema.partial();

const assignStaffSchema = z.object({
  staffUserId: z.string().uuid(),
  action: z.enum(['assign', 'unassign']),
  role: z.string().default('accountant'),
});

const importPayloadSchema = z.object({
  rows: z.array(z.record(z.any())).min(1).max(500),
});

export function registerFirmRoutes(app: Express): void {
  const router = Router();

  // Scope to /firm prefix so unrelated /api/* paths don't get 403
  router.use('/firm', authMiddleware as any);
  router.use('/firm', requireFirmRole());

  // ─── GET /api/firm/clients ─────────────────────────────────────────────────
  router.get(
    '/firm/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientCompanies: Awaited<ReturnType<typeof storage.getClientCompanies>>;
      if (accessibleIds === null) {
        clientCompanies = await storage.getClientCompanies();
      } else if (accessibleIds.length === 0) {
        clientCompanies = [];
      } else {
        clientCompanies = await db
          .select()
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), inArray(companies.id, accessibleIds)));
      }

      const servicePlans = await loadActiveServicePlans(clientCompanies.map(company => company.id));

      const clientsWithStats = await Promise.all(
        clientCompanies.map(async company => {
          const stats = await getClientStats(company.id);
          const servicePlan = servicePlans.get(company.id) ?? servicePlanFromEngagement(undefined);
          return {
            ...company,
            ...stats,
            serviceScope: servicePlan.servicesIncluded,
            servicePlan,
          };
        })
      );

      res.json(clientsWithStats);
    })
  );

  // ─── GET /api/firm/clients/:companyId/summary ──────────────────────────────
  router.get(
    '/firm/clients/:companyId/summary',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      const [stats, companyUserList, recentInvoices, recentReceipts, servicePlanMap] = await Promise.all([
        getClientStats(companyId),
        storage.getCompanyUserWithUser(companyId),
        db
          .select()
          .from(invoices)
          .where(eq(invoices.companyId, companyId))
          .orderBy(desc(invoices.createdAt))
          .limit(10),
        db
          .select()
          .from(receipts)
          .where(eq(receipts.companyId, companyId))
          .orderBy(desc(receipts.createdAt))
          .limit(10),
        loadActiveServicePlans([companyId]),
      ]);
      const servicePlan = servicePlanMap.get(companyId) ?? servicePlanFromEngagement(undefined);

      res.json({
        company: {
          ...company,
          serviceScope: servicePlan.servicesIncluded,
          servicePlan,
        },
        stats,
        companyUsers: companyUserList,
        recentInvoices,
        recentReceipts,
        servicePlan,
      });
    })
  );

  // ─── POST /api/firm/clients ────────────────────────────────────────────────
  router.post(
    '/firm/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const validated = createClientSchema.parse(req.body);
      const { serviceScope, ...companyInput } = validated;

      const existing = await storage.getCompanyByName(companyInput.name);
      if (existing) {
        return res.status(400).json({ message: 'Company name already exists' });
      }

      const company = await storage.createCompany({
        name: companyInput.name,
        baseCurrency: 'AED',
        locale: 'en',
        companyType: 'client',
        trnVatNumber: companyInput.trnVatNumber,
        legalStructure: companyInput.legalStructure,
        industry: companyInput.industry,
        registrationNumber: companyInput.registrationNumber,
        businessAddress: companyInput.businessAddress,
        contactPhone: companyInput.contactPhone,
        contactEmail: companyInput.contactEmail || undefined,
        websiteUrl: companyInput.websiteUrl,
        emirate: companyInput.emirate || 'dubai',
        vatFilingFrequency: companyInput.vatFilingFrequency || 'quarterly',
        vatPeriodStartMonth: companyInput.vatPeriodStartMonth,
        fiscalYearStartMonth: companyInput.fiscalYearStartMonth,
        taxRegistrationType: companyInput.taxRegistrationType,
        corporateTaxId: companyInput.corporateTaxId,
      });
      const servicePlan = await upsertClientServicePlan(
        company.id,
        userId,
        serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES,
      );

      await seedChartOfAccounts(company.id);

      // Auto-assign firm_admin who created the client so they retain access.
      // firm_owner already has implicit access to all client companies via firmRole.
      if (firmRole === 'firm_admin') {
        await db
          .insert(companyUsers)
          .values({ companyId: company.id, userId, role: 'accountant' })
          .onConflictDoNothing();
      }

      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        description: `NRA firm created client: ${company.name}`,
      });

      res.status(201).json({
        ...company,
        serviceScope: servicePlan.servicesIncluded,
        servicePlan,
      });
    })
  );

  // ─── PUT /api/firm/clients/:companyId ──────────────────────────────────────
  router.put(
    '/firm/clients/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;
      const validated = updateClientSchema.parse(req.body);
      const { serviceScope, ...companyPatch } = validated;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }

      const updated = Object.keys(companyPatch).length > 0
        ? await storage.updateCompany(companyId, companyPatch as any)
        : company;
      const servicePlan = serviceScope !== undefined
        ? await upsertClientServicePlan(companyId, userId, serviceScope)
        : (await loadActiveServicePlans([companyId])).get(companyId) ?? servicePlanFromEngagement(undefined);

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'update',
        entityType: 'company',
        entityId: companyId,
        description: `NRA firm updated client: ${updated.name}`,
      });

      res.json({
        ...updated,
        serviceScope: servicePlan.servicesIncluded,
        servicePlan,
      });
    })
  );

  // ─── POST /api/firm/clients/:companyId/assign-staff ───────────────────────
  // Only firm_owner may assign or unassign staff. Without this restriction a
  // firm_admin could call this endpoint with any companyId — there is no
  // per-company access check inside the handler — and self-assign onto an
  // unrelated client (or even a customer-type self-signup company), gaining
  // full read/write access via the company_users → hasCompanyAccess path.
  router.post(
    '/firm/clients/:companyId/assign-staff',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const requestingUserId = (req as any).user.id;
      const requestingFirmRole = (req as any).user.firmRole as string | null;

      if (requestingFirmRole !== 'firm_owner') {
        return res.status(403).json({ message: 'Only firm owners may assign staff' });
      }

      const { staffUserId, action, role } = assignStaffSchema.parse(req.body);

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client' || company.deletedAt) {
        return res.status(400).json({ message: 'Company is not an active NRA client' });
      }

      const staffUser = await storage.getUser(staffUserId);
      if (!staffUser) {
        return res.status(404).json({ message: 'Staff user not found' });
      }
      if (!staffUser.isAdmin) {
        return res.status(400).json({ message: 'User is not a firm staff member' });
      }

      if (action === 'assign') {
        const existing = await storage.getUserRole(companyId, staffUserId);
        if (!existing) {
          await storage.createCompanyUser({
            companyId,
            userId: staffUserId,
            role,
          });
        }
        await storage.createActivityLog({
          userId: requestingUserId,
          companyId,
          action: 'create',
          entityType: 'company_user',
          entityId: staffUserId,
          description: `Assigned ${staffUser.name} to ${company.name}`,
        });
      } else {
        // Unassign: remove from companyUsers
        await db
          .delete(companyUsers)
          .where(
            and(
              eq(companyUsers.companyId, companyId),
              eq(companyUsers.userId, staffUserId)
            )
          );
        await storage.createActivityLog({
          userId: requestingUserId,
          companyId,
          action: 'delete',
          entityType: 'company_user',
          entityId: staffUserId,
          description: `Unassigned ${staffUser.name} from ${company.name}`,
        });
      }

      res.json({ success: true, action, companyId, staffUserId });
    })
  );

  // ─── GET /api/firm/staff ───────────────────────────────────────────────────
  router.get(
    '/firm/staff',
    asyncHandler(async (_req: Request, res: Response) => {
      const allUsers = await storage.getAllUsers();
      const firmStaff = allUsers.filter(u => u.isAdmin);

      const staffWithAssignments = await Promise.all(
        firmStaff.map(async staff => {
          const assignments = await db
            .select({
              companyId: companyUsers.companyId,
              role: companyUsers.role,
              companyName: companies.name,
              companyType: companies.companyType,
            })
            .from(companyUsers)
            .innerJoin(companies, eq(companies.id, companyUsers.companyId))
            .where(
              and(
                eq(companyUsers.userId, staff.id),
                eq(companies.companyType, 'client')
              )
            );

          const { passwordHash: _ph, ...safeStaff } = staff;
          return {
            ...safeStaff,
            assignedClients: assignments,
            assignedClientCount: assignments.length,
          };
        })
      );

      res.json(staffWithAssignments);
    })
  );

  // ─── GET /api/firm/bookkeeper-dashboard ───────────────────────────────────
  // Operational production board for NRA bookkeepers. It groups clients by
  // their VAT close months and surfaces corporate tax, bookkeeping close, and
  // accounting-review blockers before a staff member opens an individual file.
  router.get(
    '/firm/bookkeeper-dashboard',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      type BookkeeperClientRow = {
        id: string;
        name: string;
        trnVatNumber: string | null;
        vatFilingFrequency: string | null;
        vatPeriodStartMonth: number;
        fiscalYearStartMonth: number;
        corporateTaxId: string | null;
        createdAt: Date;
      };

      let clientList: BookkeeperClientRow[];
      if (accessibleIds === null) {
        clientList = await db
          .select({
            id: companies.id,
            name: companies.name,
            trnVatNumber: companies.trnVatNumber,
            vatFilingFrequency: companies.vatFilingFrequency,
            vatPeriodStartMonth: companies.vatPeriodStartMonth,
            fiscalYearStartMonth: companies.fiscalYearStartMonth,
            corporateTaxId: companies.corporateTaxId,
            createdAt: companies.createdAt,
          })
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`));
      } else if (accessibleIds.length === 0) {
        return res.json(emptyBookkeeperDashboard());
      } else {
        clientList = await db
          .select({
            id: companies.id,
            name: companies.name,
            trnVatNumber: companies.trnVatNumber,
            vatFilingFrequency: companies.vatFilingFrequency,
            vatPeriodStartMonth: companies.vatPeriodStartMonth,
            fiscalYearStartMonth: companies.fiscalYearStartMonth,
            corporateTaxId: companies.corporateTaxId,
            createdAt: companies.createdAt,
          })
          .from(companies)
          .where(
            and(
              eq(companies.companyType, 'client'),
              inArray(companies.id, accessibleIds),
              sql`${companies.deletedAt} IS NULL`,
            ),
          );
      }

      const clientIds = clientList.map(client => client.id);
      if (clientIds.length === 0) return res.json(emptyBookkeeperDashboard());
      const servicePlans = await loadActiveServicePlans(clientIds);

      const now = new Date();

      const latestVatSub = db
        .select({
          companyId: vatReturns.companyId,
          maxPeriodEnd: max(vatReturns.periodEnd).as('max_period_end'),
        })
        .from(vatReturns)
        .where(inArray(vatReturns.companyId, clientIds))
        .groupBy(vatReturns.companyId)
        .as('latest_vat_for_bookkeeper');

      const latestCorporateTaxSub = db
        .select({
          companyId: corporateTaxReturns.companyId,
          maxPeriodEnd: max(corporateTaxReturns.taxPeriodEnd).as('max_period_end'),
        })
        .from(corporateTaxReturns)
        .where(inArray(corporateTaxReturns.companyId, clientIds))
        .groupBy(corporateTaxReturns.companyId)
        .as('latest_ct_for_bookkeeper');

      type VatRow = {
        companyId: string;
        periodStart: Date;
        periodEnd: Date;
        dueDate: Date;
        status: string;
        payableTax: string | null;
        submittedAt: Date | null;
        updatedAt: Date | null;
      };
      type CorporateTaxRow = {
        companyId: string;
        taxPeriodStart: Date;
        taxPeriodEnd: Date;
        status: string;
        taxPayable: string | null;
        filedAt: Date | null;
      };
      type InvoiceOpsRow = {
        companyId: string;
        invoiceCount: number;
        openAr: string | null;
        overdueCount: string | null;
        missingCustomerTrnCount: string | null;
        latestInvoiceDate: Date | null;
      };
      type ReceiptOpsRow = {
        companyId: string;
        receiptCount: number;
        unpostedCount: string | null;
        latestReceiptDate: Date | null;
      };
      type BankOpsRow = {
        companyId: string;
        bankCount: number;
        unreconciledCount: string | null;
        latestBankDate: Date | null;
      };
      type TrialBalanceOpsRow = {
        companyId: string;
        totalDebit: string | null;
        totalCredit: string | null;
        latestJournalDate: Date | null;
      };
      type StaffAssignmentRow = {
        companyId: string;
        id: string;
        name: string;
        email: string;
        role: string;
      };

      const [
        vatRows,
        corporateTaxRows,
        invoiceRows,
        receiptRows,
        bankRows,
        trialBalanceRows,
        staffRows,
      ] = await Promise.all([
        db
          .select({
            companyId: vatReturns.companyId,
            periodStart: vatReturns.periodStart,
            periodEnd: vatReturns.periodEnd,
            dueDate: vatReturns.dueDate,
            status: vatReturns.status,
            payableTax: vatReturns.box14PayableTax,
            submittedAt: vatReturns.submittedAt,
            updatedAt: vatReturns.updatedAt,
          })
          .from(vatReturns)
          .innerJoin(
            latestVatSub,
            and(
              eq(vatReturns.companyId, latestVatSub.companyId),
              eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd),
            ),
          ) as Promise<VatRow[]>,
        db
          .select({
            companyId: corporateTaxReturns.companyId,
            taxPeriodStart: corporateTaxReturns.taxPeriodStart,
            taxPeriodEnd: corporateTaxReturns.taxPeriodEnd,
            status: corporateTaxReturns.status,
            taxPayable: corporateTaxReturns.taxPayable,
            filedAt: corporateTaxReturns.filedAt,
          })
          .from(corporateTaxReturns)
          .innerJoin(
            latestCorporateTaxSub,
            and(
              eq(corporateTaxReturns.companyId, latestCorporateTaxSub.companyId),
              eq(corporateTaxReturns.taxPeriodEnd, latestCorporateTaxSub.maxPeriodEnd),
            ),
          ) as Promise<CorporateTaxRow[]>,
        db
          .select({
            companyId: invoices.companyId,
            invoiceCount: count(),
            openAr: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') then ${invoices.total} else 0 end)`,
            overdueCount: sql<string>`count(*) filter (where ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now})`,
            missingCustomerTrnCount: sql<string>`count(*) filter (where ${invoices.vatAmount} > 0 and (${invoices.customerTrn} is null or ${invoices.customerTrn} = ''))`,
            latestInvoiceDate: max(invoices.createdAt),
          })
          .from(invoices)
          .where(inArray(invoices.companyId, clientIds))
          .groupBy(invoices.companyId) as Promise<InvoiceOpsRow[]>,
        db
          .select({
            companyId: receipts.companyId,
            receiptCount: count(),
            unpostedCount: sql<string>`count(*) filter (where ${receipts.posted} = false)`,
            latestReceiptDate: max(receipts.createdAt),
          })
          .from(receipts)
          .where(inArray(receipts.companyId, clientIds))
          .groupBy(receipts.companyId) as Promise<ReceiptOpsRow[]>,
        db
          .select({
            companyId: bankTransactions.companyId,
            bankCount: count(),
            unreconciledCount: sql<string>`count(*) filter (where ${bankTransactions.isReconciled} = false)`,
            latestBankDate: max(bankTransactions.transactionDate),
          })
          .from(bankTransactions)
          .where(inArray(bankTransactions.companyId, clientIds))
          .groupBy(bankTransactions.companyId) as Promise<BankOpsRow[]>,
        db
          .select({
            companyId: journalEntries.companyId,
            totalDebit: sum(journalLines.debit),
            totalCredit: sum(journalLines.credit),
            latestJournalDate: sql<Date | null>`max(coalesce(${journalEntries.updatedAt}, ${journalEntries.postedAt}, ${journalEntries.createdAt}))`,
          })
          .from(journalEntries)
          .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
          .where(and(inArray(journalEntries.companyId, clientIds), eq(journalEntries.status, 'posted')))
          .groupBy(journalEntries.companyId) as Promise<TrialBalanceOpsRow[]>,
        db
          .select({
            companyId: companyUsers.companyId,
            id: users.id,
            name: users.name,
            email: users.email,
            role: companyUsers.role,
          })
          .from(companyUsers)
          .innerJoin(users, eq(users.id, companyUsers.userId))
          .where(and(inArray(companyUsers.companyId, clientIds), eq(users.isAdmin, true))) as Promise<StaffAssignmentRow[]>,
      ]);

      const vatMap = new Map<string, VatRow>(vatRows.map(row => [row.companyId, row]));
      const corporateTaxMap = new Map<string, CorporateTaxRow>(
        corporateTaxRows.map(row => [row.companyId, row]),
      );
      const invoiceMap = new Map<string, InvoiceOpsRow>(invoiceRows.map(row => [row.companyId, row]));
      const receiptMap = new Map<string, ReceiptOpsRow>(receiptRows.map(row => [row.companyId, row]));
      const bankMap = new Map<string, BankOpsRow>(bankRows.map(row => [row.companyId, row]));
      const trialBalanceMap = new Map<string, TrialBalanceOpsRow>(
        trialBalanceRows.map(row => [row.companyId, row]),
      );
      const staffMap = new Map<string, StaffAssignmentRow[]>();
      for (const staff of staffRows) {
        const existing = staffMap.get(staff.companyId) ?? [];
        existing.push(staff);
        staffMap.set(staff.companyId, existing);
      }

      const clients = clientList.map(company => {
        const servicePlan = servicePlans.get(company.id) ?? servicePlanFromEngagement(undefined);
        const services = servicePlan.servicesIncluded;
        const hasVatService = services.includes('vat');
        const hasCorporateTaxService = services.includes('corporate_tax');
        const hasBookkeepingService = services.includes('bookkeeping');
        const hasAccountingService = services.includes('accounting');
        const vatCohort = vatCohortFromPeriodStart(
          company.vatPeriodStartMonth,
          company.vatFilingFrequency,
        );
        const plannedVat = currentVatPeriodForCompany(
          now,
          company.vatPeriodStartMonth,
          company.vatFilingFrequency,
        );
        const latestVat = vatMap.get(company.id) ?? null;
        const latestVatIsOpen =
          latestVat &&
          latestVat.status !== 'filed' &&
          latestVat.status !== 'submitted' &&
          new Date(latestVat.dueDate) <= plannedVat.dueDate;
        const vatWindow = latestVatIsOpen ? latestVat : plannedVat;
        const vatDueDate = latestVatIsOpen ? latestVat.dueDate : plannedVat.dueDate;
        const vatDaysTilDue = daysUntil(vatDueDate, now);

        const invoiceOps = invoiceMap.get(company.id);
        const receiptOps = receiptMap.get(company.id);
        const bankOps = bankMap.get(company.id);
        const trialBalance = trialBalanceMap.get(company.id);
        const assignedStaff = staffMap.get(company.id) ?? [];

        const missingCustomerTrnCount = Number(invoiceOps?.missingCustomerTrnCount ?? 0);
        const unpostedReceiptCount = Number(receiptOps?.unpostedCount ?? 0);
        const unreconciledBankCount = Number(bankOps?.unreconciledCount ?? 0);
        const overdueInvoiceCount = Number(invoiceOps?.overdueCount ?? 0);
        const totalInvoices = Number(invoiceOps?.invoiceCount ?? 0);
        const totalReceipts = Number(receiptOps?.receiptCount ?? 0);
        const totalBankLines = Number(bankOps?.bankCount ?? 0);
        const openAr = Number(invoiceOps?.openAr ?? 0);

        const totalDebit = Number(trialBalance?.totalDebit ?? 0);
        const totalCredit = Number(trialBalance?.totalCredit ?? 0);
        const discrepancy = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;

        const lastActivity = mostRecentDate(
          invoiceOps?.latestInvoiceDate,
          receiptOps?.latestReceiptDate,
          bankOps?.latestBankDate,
          trialBalance?.latestJournalDate,
          latestVat?.updatedAt,
          company.createdAt,
        );
        const daysSinceActivity = daysSince(lastActivity, now);
        const noOperatingDocs = totalInvoices === 0 && totalReceipts === 0 && totalBankLines === 0;

        const vatBlockers: string[] = [];
        if (!company.trnVatNumber) vatBlockers.push('Missing VAT TRN');
        if (missingCustomerTrnCount > 0) vatBlockers.push(`${missingCustomerTrnCount} taxable invoices missing customer TRN`);
        if (unpostedReceiptCount > 0) vatBlockers.push(`${unpostedReceiptCount} receipts not posted`);
        if (unreconciledBankCount > 0) vatBlockers.push(`${unreconciledBankCount} bank lines unreconciled`);
        if (latestVatIsOpen && latestVat.status === 'pending_review') vatBlockers.push('VAT return pending review');

        const vatFiled = latestVat
          && (latestVat.status === 'filed' || latestVat.status === 'submitted')
          && new Date(latestVat.periodEnd) >= plannedVat.periodEnd;
        const vatPriority = !hasVatService
          ? 'on_track'
          : vatFiled
          ? 'on_track'
          : maxPriority(
              priorityFromDueDays(vatDaysTilDue, 28, 0),
              vatBlockers.length > 0 ? 'attention' : 'on_track',
            );

        const ctWindow = nextCorporateTaxFilingWindow(now, company.fiscalYearStartMonth);
        const latestCorporateTax = corporateTaxMap.get(company.id) ?? null;
        const ctFiled = latestCorporateTax
          && (latestCorporateTax.status === 'filed' || latestCorporateTax.status === 'paid')
          && new Date(latestCorporateTax.taxPeriodEnd) >= ctWindow.periodEnd;
        const ctDaysTilDue = daysUntil(ctWindow.dueDate, now);
        const ctBlockers: string[] = [];
        if (!company.corporateTaxId) ctBlockers.push('Missing corporate tax registration');
        if (discrepancy > 0.01) ctBlockers.push('Trial balance not balanced');
        if (unpostedReceiptCount > 0) ctBlockers.push('Expense receipts not posted');
        if (unreconciledBankCount > 0) ctBlockers.push('Bank reconciliation incomplete');
        const ctPriority = !hasCorporateTaxService
          ? 'on_track'
          : ctFiled
          ? 'on_track'
          : maxPriority(
              priorityFromDueDays(ctDaysTilDue, 90, 0),
              ctBlockers.length > 0 && ctDaysTilDue !== null && ctDaysTilDue <= 180 ? 'attention' : 'on_track',
            );

        const bookkeepingBlockers: string[] = [];
        if (noOperatingDocs) bookkeepingBlockers.push('No operating documents loaded');
        if (unpostedReceiptCount > 0) bookkeepingBlockers.push(`${unpostedReceiptCount} unposted receipts`);
        if (unreconciledBankCount > 0) bookkeepingBlockers.push(`${unreconciledBankCount} unreconciled bank lines`);
        if (overdueInvoiceCount > 0) bookkeepingBlockers.push(`${overdueInvoiceCount} overdue invoices`);
        if (daysSinceActivity !== null && daysSinceActivity > 30) bookkeepingBlockers.push('No activity in 30+ days');
        const closeProgress = Math.max(
          0,
          Math.min(
            100,
            100
              - Math.min(35, unreconciledBankCount * 3)
              - Math.min(25, unpostedReceiptCount * 5)
              - Math.min(20, missingCustomerTrnCount * 4)
              - (noOperatingDocs ? 35 : 0)
              - (daysSinceActivity !== null && daysSinceActivity > 30 ? 15 : 0),
          ),
        );
        const bookkeepingPriority: BookkeeperPriority = !hasBookkeepingService
          ? 'on_track'
          : noOperatingDocs || unreconciledBankCount > 25 || unpostedReceiptCount > 15
            ? 'critical'
            : bookkeepingBlockers.length > 0
              ? 'attention'
              : 'on_track';

        const accountingBlockers: string[] = [];
        if (discrepancy > 0.01) accountingBlockers.push(`Trial balance off by AED ${discrepancy.toFixed(2)}`);
        if (!trialBalance) accountingBlockers.push('No posted journals');
        const accountingPriority: BookkeeperPriority = !hasAccountingService
          ? 'on_track'
          : discrepancy > 0.01 ? 'critical' : accountingBlockers.length > 0 ? 'attention' : 'on_track';

        const priority = maxPriority(vatPriority, ctPriority, bookkeepingPriority, accountingPriority);
        const nextBestAction =
          vatPriority === 'critical' ? 'Clear VAT filing blockers'
            : ctPriority === 'critical' ? 'Prepare corporate tax filing'
              : bookkeepingPriority === 'critical' ? 'Load and reconcile source documents'
                : accountingPriority === 'critical' ? 'Fix trial balance discrepancy'
                  : vatPriority === 'attention' ? 'Prepare upcoming VAT return'
                    : ctPriority === 'attention' ? 'Review corporate tax readiness'
                      : bookkeepingPriority === 'attention' ? 'Finish monthly close'
                        : accountingPriority === 'attention' ? 'Post journal activity'
                          : 'Ready for review';
        const intervention = buildBookkeeperIntervention({
          priority,
          nextBestAction,
          assignedStaffCount: assignedStaff.length,
          vatDaysTilDue,
          ctDaysTilDue,
          vatBlockers,
          ctBlockers,
          bookkeepingBlockers,
          accountingBlockers,
          closeProgress,
          openAr,
          overdueInvoiceCount,
          missingCustomerTrnCount,
          unpostedReceiptCount,
          unreconciledBankCount,
          daysSinceActivity,
          noOperatingDocs,
          discrepancy,
        });

        return {
          companyId: company.id,
          companyName: company.name,
          trn: company.trnVatNumber,
          serviceScope: services,
          servicePlan,
          assignedStaff: assignedStaff.map(staff => ({
            id: staff.id,
            name: staff.name,
            email: staff.email,
            role: staff.role,
          })),
          priority,
          nextBestAction,
          intervention,
          lastActivity: shortIso(lastActivity),
          vat: {
            cohortKey: vatCohort.key,
            cohortLabel: vatCohort.label,
            closeMonths: vatCohort.closeMonths,
            periodStart: shortIso('periodStart' in vatWindow ? vatWindow.periodStart : plannedVat.periodStart),
            periodEnd: shortIso('periodEnd' in vatWindow ? vatWindow.periodEnd : plannedVat.periodEnd),
            dueDate: shortIso(vatDueDate),
            daysTilDue: vatDaysTilDue,
            status: vatFiled ? 'filed' : vatPriority,
            payableTax: latestVat ? Number(latestVat.payableTax ?? 0) : null,
            blockers: hasVatService ? vatBlockers : [],
          },
          corporateTax: {
            periodStart: shortIso(ctWindow.periodStart),
            periodEnd: shortIso(ctWindow.periodEnd),
            dueDate: shortIso(ctWindow.dueDate),
            daysTilDue: ctDaysTilDue,
            status: ctFiled ? 'filed' : ctPriority,
            taxPayable: latestCorporateTax ? Number(latestCorporateTax.taxPayable ?? 0) : null,
            blockers: hasCorporateTaxService ? ctBlockers : [],
          },
          bookkeeping: {
            closeProgress,
            status: bookkeepingPriority,
            blockers: hasBookkeepingService ? bookkeepingBlockers : [],
            openAr,
            overdueInvoiceCount,
            missingCustomerTrnCount,
            unpostedReceiptCount,
            unreconciledBankCount,
            daysSinceActivity,
          },
          accounting: {
            status: accountingPriority,
            trialBalanceBalanced: discrepancy <= 0.01,
            discrepancy,
            blockers: hasAccountingService ? accountingBlockers : [],
          },
        };
      });

      const summary = clients.reduce(
        (acc, client) => {
          acc.totalClients += 1;
          if (client.priority === 'critical') acc.critical += 1;
          else if (client.priority === 'attention') acc.attention += 1;
          else acc.onTrack += 1;
          if (
            client.serviceScope.includes('vat')
            && client.vat.status !== 'filed'
            && client.vat.daysTilDue !== null
            && client.vat.daysTilDue <= 28
          ) {
            acc.vatDue28Days += 1;
          }
          if (
            client.serviceScope.includes('corporate_tax')
            && client.corporateTax.status !== 'filed'
            && client.corporateTax.daysTilDue !== null
            && client.corporateTax.daysTilDue <= 90
          ) {
            acc.corporateTaxDue90Days += 1;
          }
          if (client.serviceScope.includes('bookkeeping') && client.bookkeeping.status !== 'on_track') acc.bookkeepingBlocked += 1;
          if (client.intervention.level === 'high') acc.interventionHigh += 1;
          if (client.intervention.level === 'medium') acc.interventionMedium += 1;
          return acc;
        },
        {
          totalClients: 0,
          critical: 0,
          attention: 0,
          onTrack: 0,
          vatDue28Days: 0,
          corporateTaxDue90Days: 0,
          bookkeepingBlocked: 0,
          interventionHigh: 0,
          interventionMedium: 0,
        },
      );

      const cohortMap = new Map<VatCohortKey, VatCohort>();
      for (const cohort of STANDARD_VAT_COHORTS) cohortMap.set(cohort.key, cohort);
      for (const client of clients.filter(client => client.serviceScope.includes('vat'))) {
        if (!cohortMap.has(client.vat.cohortKey as VatCohortKey)) {
          cohortMap.set(client.vat.cohortKey as VatCohortKey, {
            key: client.vat.cohortKey as VatCohortKey,
            label: client.vat.cohortLabel,
            closeMonths: client.vat.closeMonths,
            closeMonthLabels: client.vat.closeMonths.map(month => new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(Date.UTC(2026, month - 1, 1)))),
          });
        }
      }

      const vatCohorts = Array.from(cohortMap.values()).map(cohort => {
        const cohortClients = clients
          .filter(client => client.serviceScope.includes('vat') && client.vat.cohortKey === cohort.key)
          .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
        return {
          key: cohort.key,
          label: cohort.label,
          closeMonths: cohort.closeMonths,
          closeMonthLabels: cohort.closeMonthLabels,
          clientCount: cohortClients.length,
          dueSoon: cohortClients.filter(client => client.vat.daysTilDue !== null && client.vat.daysTilDue <= 28).length,
          blocked: cohortClients.filter(client => client.vat.blockers.length > 0).length,
          ready: cohortClients.filter(client => client.vat.blockers.length === 0 && client.vat.status !== 'critical').length,
          clients: cohortClients.map(client => ({
            companyId: client.companyId,
            companyName: client.companyName,
            priority: client.priority,
            dueDate: client.vat.dueDate,
            daysTilDue: client.vat.daysTilDue,
            status: client.vat.status,
            blockers: client.vat.blockers,
            nextBestAction: client.nextBestAction,
          })),
        };
      });

      const ownerNames = (client: (typeof clients)[number]) =>
        client.assignedStaff.length > 0 ? client.assignedStaff.map(staff => staff.name) : ['Unassigned'];

      const queues = {
        vat: sortBookkeeperQueue(
          clients
            .filter(client => client.serviceScope.includes('vat') && client.vat.status !== 'filed' && client.vat.status !== 'on_track')
            .map(client => ({
              companyId: client.companyId,
              companyName: client.companyName,
              priority: client.vat.status as BookkeeperPriority,
              ownerNames: ownerNames(client),
              dueDate: client.vat.dueDate,
              daysTilDue: client.vat.daysTilDue,
              metric: client.vat.payableTax !== null ? `AED ${Math.round(client.vat.payableTax).toLocaleString('en-AE')} payable` : client.vat.cohortLabel,
              action: client.vat.blockers[0] ?? 'Prepare upcoming VAT return',
              blockers: client.vat.blockers,
            })),
        ).slice(0, 12),
        corporateTax: sortBookkeeperQueue(
          clients
            .filter(client => client.serviceScope.includes('corporate_tax') && client.corporateTax.status !== 'filed' && client.corporateTax.status !== 'on_track')
            .map(client => ({
              companyId: client.companyId,
              companyName: client.companyName,
              priority: client.corporateTax.status as BookkeeperPriority,
              ownerNames: ownerNames(client),
              dueDate: client.corporateTax.dueDate,
              daysTilDue: client.corporateTax.daysTilDue,
              metric: client.corporateTax.taxPayable !== null ? `AED ${Math.round(client.corporateTax.taxPayable).toLocaleString('en-AE')} payable` : 'CT readiness',
              action: client.corporateTax.blockers[0] ?? 'Review corporate tax readiness',
              blockers: client.corporateTax.blockers,
            })),
        ).slice(0, 12),
        bookkeeping: sortBookkeeperQueue(
          clients
            .filter(client => client.serviceScope.includes('bookkeeping') && client.bookkeeping.status !== 'on_track')
            .map(client => ({
              companyId: client.companyId,
              companyName: client.companyName,
              priority: client.bookkeeping.status,
              ownerNames: ownerNames(client),
              dueDate: client.vat.dueDate,
              daysTilDue: client.vat.daysTilDue,
              metric: `${client.bookkeeping.closeProgress}% close-ready`,
              action: client.bookkeeping.blockers[0] ?? 'Finish monthly close',
              blockers: client.bookkeeping.blockers,
            })),
        ).slice(0, 12),
        accounting: sortBookkeeperQueue(
          clients
            .filter(client => client.serviceScope.includes('accounting') && client.accounting.status !== 'on_track')
            .map(client => ({
              companyId: client.companyId,
              companyName: client.companyName,
              priority: client.accounting.status,
              ownerNames: ownerNames(client),
              dueDate: null,
              daysTilDue: null,
              metric: client.accounting.discrepancy > 0 ? `AED ${client.accounting.discrepancy.toLocaleString('en-AE')} variance` : 'Review required',
              action: client.accounting.blockers[0] ?? 'Post journal activity',
              blockers: client.accounting.blockers,
            })),
        ).slice(0, 12),
      };

      const workloadMap = new Map<string, {
        staffId: string | null;
        name: string;
        email: string | null;
        clientCount: number;
        critical: number;
        attention: number;
        vatDue28Days: number;
        corporateTaxDue90Days: number;
        bookkeepingBlocked: number;
        closeProgressTotal: number;
      }>();

      for (const client of clients) {
        const owners = client.assignedStaff.length > 0
          ? client.assignedStaff
          : [{ id: null, name: 'Unassigned', email: null, role: 'unassigned' }];

        for (const owner of owners) {
          const key = owner.id ?? 'unassigned';
          const entry = workloadMap.get(key) ?? {
            staffId: owner.id,
            name: owner.name,
            email: owner.email,
            clientCount: 0,
            critical: 0,
            attention: 0,
            vatDue28Days: 0,
            corporateTaxDue90Days: 0,
            bookkeepingBlocked: 0,
            closeProgressTotal: 0,
          };

          entry.clientCount += 1;
          if (client.priority === 'critical') entry.critical += 1;
          if (client.priority === 'attention') entry.attention += 1;
          if (
            client.serviceScope.includes('vat')
            && client.vat.status !== 'filed'
            && client.vat.daysTilDue !== null
            && client.vat.daysTilDue <= 28
          ) {
            entry.vatDue28Days += 1;
          }
          if (
            client.serviceScope.includes('corporate_tax')
            && client.corporateTax.status !== 'filed'
            && client.corporateTax.daysTilDue !== null
            && client.corporateTax.daysTilDue <= 90
          ) {
            entry.corporateTaxDue90Days += 1;
          }
          if (client.serviceScope.includes('bookkeeping') && client.bookkeeping.status !== 'on_track') entry.bookkeepingBlocked += 1;
          entry.closeProgressTotal += client.bookkeeping.closeProgress;
          workloadMap.set(key, entry);
        }
      }

      const workloadOwners = Array.from(workloadMap.values())
        .map(({ closeProgressTotal, ...owner }) => ({
          ...owner,
          averageCloseProgress: owner.clientCount > 0 ? Math.round(closeProgressTotal / owner.clientCount) : 0,
        }))
        .sort((a, b) => {
          const riskDelta = (b.critical + b.attention) - (a.critical + a.attention);
          if (riskDelta !== 0) return riskDelta;
          return b.clientCount - a.clientCount;
        });

      const sortedClients = clients.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
      const serviceMatrix = CLIENT_SERVICE_OPTIONS.map(option => {
        const serviceClients = clients.filter(client => client.serviceScope.includes(option.code));
        return {
          code: option.code,
          label: option.label,
          shortLabel: option.shortLabel,
          clientCount: serviceClients.length,
          critical: serviceClients.filter(client => client.priority === 'critical').length,
          attention: serviceClients.filter(client => client.priority === 'attention').length,
        };
      });

      res.json({
        generatedAt: now.toISOString(),
        summary,
        serviceMatrix,
        vatCohorts,
        queues,
        workload: {
          owners: workloadOwners,
          unassignedClients: workloadOwners.find(owner => owner.staffId === null)?.clientCount ?? 0,
          overloadedStaff: workloadOwners.filter(owner => owner.staffId !== null && (owner.critical >= 3 || owner.clientCount >= 15)).length,
        },
        clients: sortedClients,
      });
    })
  );

  // ─── GET /api/firm/health ─────────────────────────────────────────────────
  router.get(
    '/firm/health',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientList: {
        id: string;
        name: string;
        trnVatNumber: string | null;
        createdAt: Date;
      }[];
      if (accessibleIds === null) {
        clientList = await db
          .select({
            id: companies.id,
            name: companies.name,
            trnVatNumber: companies.trnVatNumber,
            createdAt: companies.createdAt,
          })
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`));
      } else if (accessibleIds.length === 0) {
        return res.json(emptyHealthPayload());
      } else {
        clientList = await db
          .select({
            id: companies.id,
            name: companies.name,
            trnVatNumber: companies.trnVatNumber,
            createdAt: companies.createdAt,
          })
          .from(companies)
          .where(
            and(
              eq(companies.companyType, 'client'),
              inArray(companies.id, accessibleIds),
              sql`${companies.deletedAt} IS NULL`,
            ),
          );
      }

      const clientIds = clientList.map((c: { id: string }) => c.id);
      if (clientIds.length === 0) return res.json(emptyHealthPayload());

      const now = new Date();

      // Latest VAT return per company (subquery join)
      const latestVatSub = db
        .select({
          companyId: vatReturns.companyId,
          maxPeriodEnd: max(vatReturns.periodEnd).as('max_period_end'),
        })
        .from(vatReturns)
        .where(inArray(vatReturns.companyId, clientIds))
        .groupBy(vatReturns.companyId)
        .as('latest_vat');

      const vatRows = await db
        .select({
          companyId: vatReturns.companyId,
          status: vatReturns.status,
          dueDate: vatReturns.dueDate,
          periodEnd: vatReturns.periodEnd,
          submittedAt: vatReturns.submittedAt,
          updatedAt: vatReturns.updatedAt,
        })
        .from(vatReturns)
        .innerJoin(
          latestVatSub,
          and(
            eq(vatReturns.companyId, latestVatSub.companyId),
            eq(vatReturns.periodEnd, latestVatSub.maxPeriodEnd)
          )
        );

      type LastFiledVatRow = { companyId: string; lastFiledDate: Date | null };
      const lastFiledVatRows: LastFiledVatRow[] = await db
        .select({
          companyId: vatReturns.companyId,
          lastFiledDate: sql<Date | null>`max(coalesce(${vatReturns.submittedAt}, ${vatReturns.updatedAt}))`,
        })
        .from(vatReturns)
        .where(
          and(
            inArray(vatReturns.companyId, clientIds),
            or(eq(vatReturns.status, 'filed'), eq(vatReturns.status, 'submitted')),
          ),
        )
        .groupBy(vatReturns.companyId) as LastFiledVatRow[];

      // AR health per company: total open AR plus overdue count/value.
      type ArBucketRow = {
        companyId: string;
        totalOutstanding: string | null;
        overdueAmount: string | null;
        overdueCount: string | null;
      };
      const arRows: ArBucketRow[] = await db
        .select({
          companyId: invoices.companyId,
          totalOutstanding: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') then ${invoices.total} else 0 end)`,
          overdueAmount: sql<string>`sum(case when ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now} then ${invoices.total} else 0 end)`,
          overdueCount: sql<string>`count(*) filter (where ${invoices.status} in ('sent', 'partial') and ${invoices.dueDate} < ${now})`,
        })
        .from(invoices)
        .where(inArray(invoices.companyId, clientIds))
        .groupBy(invoices.companyId) as ArBucketRow[];

      // Bank reconciliation health per company.
      type BankRow = {
        companyId: string;
        total: number;
        unreconciled: string | null;
        lastBankDate: Date | null;
        lastReconciledDate: Date | null;
      };
      const bankRows: BankRow[] = await db
        .select({
          companyId: bankTransactions.companyId,
          total: count(),
          unreconciled: sql<string>`sum(case when ${bankTransactions.isReconciled} then 0 else 1 end)`,
          lastBankDate: max(bankTransactions.transactionDate),
          lastReconciledDate: sql<Date | null>`max(case when ${bankTransactions.isReconciled} then ${bankTransactions.transactionDate} else null end)`,
        })
        .from(bankTransactions)
        .where(inArray(bankTransactions.companyId, clientIds))
        .groupBy(bankTransactions.companyId) as BankRow[];

      type TrialBalanceRow = {
        companyId: string;
        totalDebit: string | null;
        totalCredit: string | null;
        lastJournalActivity: Date | null;
      };
      const trialBalanceRows: TrialBalanceRow[] = await db
        .select({
          companyId: journalEntries.companyId,
          totalDebit: sum(journalLines.debit),
          totalCredit: sum(journalLines.credit),
          lastJournalActivity: sql<Date | null>`max(coalesce(${journalEntries.updatedAt}, ${journalEntries.postedAt}, ${journalEntries.createdAt}))`,
        })
        .from(journalEntries)
        .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
        .where(and(inArray(journalEntries.companyId, clientIds), eq(journalEntries.status, 'posted')))
        .groupBy(journalEntries.companyId) as TrialBalanceRow[];

      type InvoiceActivityRow = { companyId: string; lastInvoiceActivity: Date | null };
      const invoiceActivityRows: InvoiceActivityRow[] = await db
        .select({ companyId: invoices.companyId, lastInvoiceActivity: max(invoices.createdAt) })
        .from(invoices)
        .where(inArray(invoices.companyId, clientIds))
        .groupBy(invoices.companyId) as InvoiceActivityRow[];

      type ReceiptActivityRow = { companyId: string; lastReceiptActivity: Date | null };
      const receiptActivityRows: ReceiptActivityRow[] = await db
        .select({ companyId: receipts.companyId, lastReceiptActivity: max(receipts.createdAt) })
        .from(receipts)
        .where(inArray(receipts.companyId, clientIds))
        .groupBy(receipts.companyId) as ReceiptActivityRow[];

      // Build lookup maps
      type VatRow = {
        companyId: string;
        status: string;
        dueDate: Date;
        periodEnd: Date;
        submittedAt: Date | null;
        updatedAt: Date | null;
      };
      const vatMap = new Map<string, VatRow>(vatRows.map((r: VatRow) => [r.companyId, r]));
      const lastFiledVatMap = new Map<string, LastFiledVatRow>(
        lastFiledVatRows.map((r: LastFiledVatRow) => [r.companyId, r]),
      );
      const arMap = new Map<string, ArBucketRow>(arRows.map((r: ArBucketRow) => [r.companyId, r]));
      const bankMap = new Map<string, BankRow>(bankRows.map((r: BankRow) => [r.companyId, r]));
      const trialBalanceMap = new Map<string, TrialBalanceRow>(
        trialBalanceRows.map((r: TrialBalanceRow) => [r.companyId, r]),
      );
      const invoiceActivityMap = new Map<string, InvoiceActivityRow>(
        invoiceActivityRows.map((r: InvoiceActivityRow) => [r.companyId, r]),
      );
      const receiptActivityMap = new Map<string, ReceiptActivityRow>(
        receiptActivityRows.map((r: ReceiptActivityRow) => [r.companyId, r]),
      );

      const clients = clientList.map((company) => {
        const vat = vatMap.get(company.id) ?? null;
        const lastFiledVat = lastFiledVatMap.get(company.id)?.lastFiledDate ?? null;
        const vatStatus = vatHealthFromReturn(vat, now);
        const vatHealth = vatStatusToHealth(vatStatus);

        const ar = arMap.get(company.id);
        const totalOutstanding = Number(ar?.totalOutstanding ?? 0);
        const overdueAmount = Number(ar?.overdueAmount ?? 0);
        const overdueCount = Number(ar?.overdueCount ?? 0);
        const arStatus: HealthStatus =
          overdueAmount > 0 ? 'critical' : totalOutstanding > 0 ? 'attention' : 'healthy';

        const bank = bankMap.get(company.id);
        const unreconciledCount = Number(bank?.unreconciled ?? 0);
        const bankRecStatus: HealthStatus =
          unreconciledCount > 10 ? 'critical' : unreconciledCount > 0 ? 'attention' : 'healthy';

        const trialBalance = trialBalanceMap.get(company.id);
        const totalDebit = Number(trialBalance?.totalDebit ?? 0);
        const totalCredit = Number(trialBalance?.totalCredit ?? 0);
        const discrepancy = Math.round(Math.abs(totalDebit - totalCredit) * 100) / 100;
        const trialBalanceStatus: HealthStatus = discrepancy > 0.01 ? 'critical' : 'healthy';

        const lastActivity = mostRecentDate(
          bank?.lastBankDate,
          trialBalance?.lastJournalActivity,
          invoiceActivityMap.get(company.id)?.lastInvoiceActivity,
          receiptActivityMap.get(company.id)?.lastReceiptActivity,
          vat?.updatedAt,
          company.createdAt,
        );

        return {
          companyId: company.id,
          companyName: company.name,
          trn: company.trnVatNumber,
          vatStatus: {
            nextDueDate: vat?.dueDate ?? null,
            daysTilDue: daysUntil(vat?.dueDate, now),
            lastFiledDate: lastFiledVat,
            status: vatStatus,
          },
          arHealth: {
            totalOutstanding,
            overdueAmount,
            overdueCount,
            status: arStatus,
          },
          bankRecStatus: {
            lastRecDate: bank?.lastReconciledDate ?? null,
            daysSinceRec: daysSince(bank?.lastReconciledDate, now),
            unreconciledCount,
            status: bankRecStatus,
          },
          trialBalanceStatus: {
            balanced: discrepancy <= 0.01,
            discrepancy,
            status: trialBalanceStatus,
          },
          lastActivity,
          overallHealth: maxHealthStatus(vatHealth, arStatus, bankRecStatus, trialBalanceStatus),
        };
      });

      const summary = clients.reduce(
        (acc, client) => {
          acc.totalClients += 1;
          acc[client.overallHealth] += 1;
          return acc;
        },
        { totalClients: 0, healthy: 0, attention: 0, critical: 0 },
      );

      res.json({ clients, summary });
    })
  );

  // ─── GET /api/firm/health/deadlines ──────────────────────────────────────
  router.get(
    '/firm/health/deadlines',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      if (accessibleIds !== null && accessibleIds.length === 0) {
        return res.json({ deadlines: [] });
      }

      const now = new Date();
      const ninetyDaysOut = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      const whereClause = and(
        ne(vatReturns.status, 'filed'),
        ne(vatReturns.status, 'submitted'),
        lte(vatReturns.dueDate, ninetyDaysOut),
        ...(accessibleIds !== null ? [inArray(vatReturns.companyId, accessibleIds)] : [])
      );

      type DeadlineRow = {
        companyId: string;
        companyName: string;
        vatReturnId: string;
        type: 'vat';
        status: DeadlineStatus;
        dueDate: Date;
        periodEnd: Date;
        daysTilDue: number;
      };

      const rows = await db
        .select({
          companyId: vatReturns.companyId,
          companyName: companies.name,
          vatReturnId: vatReturns.id,
          dueDate: vatReturns.dueDate,
          periodEnd: vatReturns.periodEnd,
        })
        .from(vatReturns)
        .innerJoin(companies, eq(companies.id, vatReturns.companyId))
        .where(and(whereClause, eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`))
        .orderBy(vatReturns.dueDate);

      const deadlines: DeadlineRow[] = rows.map(
        (r: {
          companyId: string;
          companyName: string;
          vatReturnId: string;
          dueDate: Date;
          periodEnd: Date;
        }) => {
          const daysTilDue = daysUntil(r.dueDate, now) ?? 0;
          return {
            companyId: r.companyId,
            companyName: r.companyName,
            vatReturnId: r.vatReturnId,
            type: 'vat',
            status: deadlineStatus(daysTilDue),
            dueDate: r.dueDate,
            periodEnd: r.periodEnd,
            daysTilDue,
          };
        }
      );

      res.json({ deadlines });
    })
  );

  // ─── POST /api/firm/clients/:companyId/switch ──────────────────────────────
  // Switch the firm staff member's active workspace to this client's company.
  // The frontend persists the selection client-side; this endpoint validates
  // access and returns the company so the UI can update immediately.
  router.post(
    '/firm/clients/:companyId/switch',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ message: 'Access denied to this client' });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'view',
        entityType: 'company',
        entityId: companyId,
        description: `NRA staff switched into ${company.name}`,
      });

      res.json({ company });
    })
  );

  // ─── DELETE /api/firm/clients/:companyId ───────────────────────────────────
  // Soft-delete a client (FTA 5-year retention rules require we never hard-
  // delete). The company is hidden from listings via deletedAt.
  router.delete(
    '/firm/clients/:companyId',
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { id: userId, firmRole } = (req as any).user;

      // Only firm_owner may archive a client.
      if (firmRole !== 'firm_owner') {
        return res.status(403).json({ message: 'Only firm owners may archive clients' });
      }

      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: 'Client not found' });
      }
      if (company.companyType !== 'client') {
        return res.status(400).json({ message: 'Company is not an NRA client' });
      }

      await db
        .update(companies)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(companies.id, companyId));

      await storage.createActivityLog({
        userId,
        companyId,
        action: 'delete',
        entityType: 'company',
        entityId: companyId,
        description: `NRA firm archived client: ${company.name}`,
      });

      res.json({ success: true, archivedAt: new Date().toISOString() });
    })
  );

  // ─── POST /api/firm/clients/import ─────────────────────────────────────────
  // Bulk-create clients from a parsed CSV/Excel payload. Each row becomes a
  // company entity (companyType=client) plus a seeded chart of accounts. Rows
  // with missing names or duplicate company names are returned as errors so
  // the user can correct and resubmit. Supports two input forms:
  //   - { rows: [{...}, {...}] }      already-parsed JSON rows
  //   - { fileData: <base64 CSV/XLSX> } raw file (server-parsed)
  router.post(
    '/firm/clients/import',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;

      // firm_admin is allowed to import (their imports are auto-assigned to them);
      // firm_owner can import freely.
      if (firmRole !== 'firm_owner' && firmRole !== 'firm_admin') {
        return res.status(403).json({ message: 'Firm role required' });
      }

      // Accept either pre-parsed rows or a base64-encoded file.
      let rows: Record<string, any>[];
      if (req.body?.fileData) {
        try {
          const buffer = Buffer.from(req.body.fileData, 'base64');
          rows = (await parseSpreadsheet(buffer, req.body.fileName)).rows as Record<string, any>[];
        } catch (err: any) {
          return res.status(400).json({ message: `Could not parse file: ${err.message}` });
        }
      } else {
        const parsed = importPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.errors });
        }
        rows = parsed.data.rows;
      }

      if (!rows || rows.length === 0) {
        return res.status(400).json({ message: 'No rows to import' });
      }
      if (rows.length > 500) {
        return res.status(400).json({ message: 'Imports limited to 500 rows per call' });
      }

      const results = {
        created: [] as { id: string; name: string }[],
        errors: [] as { row: number; name: string; error: string }[],
      };

      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const mapped = mapImportRow(raw);
        if ('error' in mapped) {
          results.errors.push({ row: i + 1, name: '', error: mapped.error });
          continue;
        }

        const validated = validateImportedClient(mapped);
        if (!validated.ok) {
          results.errors.push({
            row: i + 1,
            name: mapped.name,
            error: validated.error,
          });
          continue;
        }

        try {
          const existing = await storage.getCompanyByName(validated.value.name);
          if (existing) {
            results.errors.push({
              row: i + 1,
              name: validated.value.name,
              error: 'A company with this name already exists',
            });
            continue;
          }

          const company = await storage.createCompany({
            name: validated.value.name,
            baseCurrency: 'AED',
            locale: 'en',
            companyType: 'client',
            trnVatNumber: validated.value.trnVatNumber || undefined,
            industry: validated.value.industry || undefined,
            legalStructure: validated.value.legalStructure || undefined,
            contactEmail: validated.value.contactEmail || undefined,
            contactPhone: validated.value.contactPhone || undefined,
            businessAddress: validated.value.businessAddress || undefined,
            emirate: validated.value.emirate || 'dubai',
            vatFilingFrequency: validated.value.vatFilingFrequency || 'quarterly',
            vatPeriodStartMonth: validated.value.vatPeriodStartMonth,
            fiscalYearStartMonth: validated.value.fiscalYearStartMonth,
            corporateTaxId: validated.value.corporateTaxId || undefined,
            registrationNumber: validated.value.registrationNumber || undefined,
            websiteUrl: validated.value.websiteUrl || undefined,
          });

          await upsertClientServicePlan(
            company.id,
            userId,
            validated.value.serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES,
          );

          await seedChartOfAccounts(company.id);

          // firm_admin who runs the import becomes auto-assigned so they can
          // continue to manage what they imported.
          if (firmRole === 'firm_admin') {
            await db
              .insert(companyUsers)
              .values({ companyId: company.id, userId, role: 'accountant' })
              .onConflictDoNothing();
          }

          await storage.createActivityLog({
            userId,
            companyId: company.id,
            action: 'create',
            entityType: 'company',
            entityId: company.id,
            description: `Bulk-imported NRA client: ${company.name}`,
          });

          results.created.push({ id: company.id, name: company.name });
        } catch (err: any) {
          results.errors.push({
            row: i + 1,
            name: validated.value.name,
            error: err.message ?? 'Unknown error',
          });
        }
      }

      res.json({
        message: `Imported ${results.created.length} clients (${results.errors.length} errors)`,
        ...results,
      });
    })
  );

  // ─── GET /api/firm/overview ────────────────────────────────────────────────
  // Top-level summary cards for the firm dashboard: total clients, VAT
  // returns due in next 30 days, total overdue receivables, attention count.
  router.get(
    '/firm/overview',
    asyncHandler(async (req: Request, res: Response) => {
      const { id: userId, firmRole } = (req as any).user;
      const accessibleIds = await getAccessibleCompanyIds(userId, firmRole ?? '');

      let clientIds: string[];
      if (accessibleIds === null) {
        const all = await db
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.companyType, 'client'), sql`${companies.deletedAt} IS NULL`));
        clientIds = all.map((c: { id: string }) => c.id);
      } else {
        clientIds = accessibleIds;
      }

      if (clientIds.length === 0) {
        return res.json({
          totalClients: 0,
          vatDueThisMonth: 0,
          overdueAr: 0,
          needsAttention: 0,
          missingDocuments: 0,
        });
      }

      const now = new Date();
      const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const [vatDueRow, arRow, missingDocsRow] = await Promise.all([
        db
          .select({ cnt: count() })
          .from(vatReturns)
          .where(
            and(
              inArray(vatReturns.companyId, clientIds),
              ne(vatReturns.status, 'filed'),
              ne(vatReturns.status, 'submitted'),
              lte(vatReturns.dueDate, monthAhead),
            ),
          )
          .then((r: { cnt: number }[]) => r[0]),
        db
          .select({ total: sum(invoices.total) })
          .from(invoices)
          .where(
            and(
              inArray(invoices.companyId, clientIds),
              or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
              lt(invoices.dueDate, now),
            ),
          )
          .then((r: { total: string | null }[]) => r[0]),
        // Clients without ANY invoices yet — proxy for "missing docs"
        db
          .select({ companyId: invoices.companyId })
          .from(invoices)
          .where(inArray(invoices.companyId, clientIds))
          .groupBy(invoices.companyId)
          .then((rows: { companyId: string }[]) => rows.map(r => r.companyId)),
      ]);

      const clientsWithInvoices = new Set(missingDocsRow as string[]);
      const missingDocuments = clientIds.filter(id => !clientsWithInvoices.has(id)).length;

      const overdueAr = Number(arRow?.total ?? 0);
      const vatDueThisMonth = Number(vatDueRow?.cnt ?? 0);

      // "Needs attention" combines overdue VAT + clients with overdue AR
      const overdueArCompanies = await db
        .select({ companyId: invoices.companyId })
        .from(invoices)
        .where(
          and(
            inArray(invoices.companyId, clientIds),
            or(eq(invoices.status, 'sent'), eq(invoices.status, 'partial')),
            lt(invoices.dueDate, now),
          ),
        )
        .groupBy(invoices.companyId);

      const overdueVatCompanies = await db
        .select({ companyId: vatReturns.companyId })
        .from(vatReturns)
        .where(
          and(
            inArray(vatReturns.companyId, clientIds),
            ne(vatReturns.status, 'filed'),
            ne(vatReturns.status, 'submitted'),
            lt(vatReturns.dueDate, now),
          ),
        )
        .groupBy(vatReturns.companyId);

      const attention = new Set<string>();
      for (const r of overdueArCompanies as { companyId: string }[]) attention.add(r.companyId);
      for (const r of overdueVatCompanies as { companyId: string }[]) attention.add(r.companyId);

      res.json({
        totalClients: clientIds.length,
        vatDueThisMonth,
        overdueAr,
        needsAttention: attention.size,
        missingDocuments,
      });
    })
  );

  app.use('/api', router);
  logger.info('Firm routes registered at /api/firm/*');
}
