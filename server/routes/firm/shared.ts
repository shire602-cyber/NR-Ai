// Shared firm route helpers: client access/stats, health and bookkeeper scoring, service plans and request schemas.
// Split from firm.routes.ts (R20-09); shared by its route handler modules.
import { ASSIGNMENT_ROLES } from "../../services/firm/staff.service";
import {
  type ClientServiceCode,
  type ClientServicePlan,
  DEFAULT_CLIENT_SERVICE_CODES,
  engagementTypeForServices,
  normalizeClientServices,
} from "@shared/client-services";
import type { Request, Response } from "express";
import {
  type VatCohort,
  vatCohortFromPeriodStart,
  zOptionalClientTrn,
} from "../../services/firm-clients.service";
import { and, count, desc, eq, inArray, max, or, sum } from "drizzle-orm";
import {
  bankTransactions,
  companyUsers,
  engagements,
  invoices,
  receipts,
  users,
  vatReturns,
} from "../../../shared/schema";
import { canAccessFirmClient } from "../../services/firm/scope";
import { createDefaultAccountsForCompany } from "../../defaultChartOfAccounts";
import { db } from "../../db";
import { firmContextOf } from "../../middleware/rbac";
import { storage } from "../../storage";
import { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Is the client in the caller's firm and visible to this staff member? (R15-12/13) */
export async function canAccessClient(
  _req: Request,
  res: Response,
  companyId: string
): Promise<boolean> {
  return canAccessFirmClient(firmContextOf(res), companyId);
}

export async function seedChartOfAccounts(companyId: string): Promise<void> {
  const hasAccounts = await storage.companyHasAccounts(companyId);
  if (hasAccounts) return;
  const defaultAccounts = createDefaultAccountsForCompany(companyId);
  await storage.createBulkAccounts(defaultAccounts);
}

export async function getClientStats(companyId: string) {
  const [invoiceStats, arStats, lastReceipt, lastBankTx, latestVatReturn, staffRows] =
    await Promise.all([
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
            or(eq(invoices.status, "sent"), eq(invoices.status, "partial"))
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

export type HealthStatus = "healthy" | "attention" | "critical";

export type VatHealthStatus = "on-track" | "due-soon" | "overdue";

export type DeadlineStatus = "upcoming" | "due-soon" | "overdue";

export type BookkeeperPriority = "on_track" | "attention" | "critical";

export type BookkeeperInterventionLevel = "low" | "medium" | "high";

export type BookkeeperQueueItem = {
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

export function daysUntil(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysSince(date: Date | string | null | undefined, now: Date): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function mostRecentDate(...dates: Array<Date | string | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of dates) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

export function maxHealthStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("attention")) return "attention";
  return "healthy";
}

export function vatHealthFromReturn(
  vat: { status: string; dueDate: Date | string | null } | null | undefined,
  now: Date
): VatHealthStatus {
  if (!vat) return "on-track";
  if (vat.status === "filed" || vat.status === "submitted") return "on-track";
  const dueIn = daysUntil(vat.dueDate, now);
  if (dueIn === null) return "on-track";
  if (dueIn < 0) return "overdue";
  if (dueIn <= 14) return "due-soon";
  return "on-track";
}

export function vatStatusToHealth(status: VatHealthStatus): HealthStatus {
  if (status === "overdue") return "critical";
  if (status === "due-soon") return "attention";
  return "healthy";
}

export function deadlineStatus(daysTilDue: number): DeadlineStatus {
  if (daysTilDue < 0) return "overdue";
  if (daysTilDue <= 14) return "due-soon";
  return "upcoming";
}

export function emptyHealthPayload() {
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

export function priorityRank(priority: BookkeeperPriority): number {
  if (priority === "critical") return 3;
  if (priority === "attention") return 2;
  return 1;
}

export function maxPriority(...priorities: BookkeeperPriority[]): BookkeeperPriority {
  return priorities.reduce(
    (current, next) => (priorityRank(next) > priorityRank(current) ? next : current),
    "on_track" as BookkeeperPriority
  );
}

export function priorityFromDueDays(
  daysTilDue: number | null,
  attentionWindowDays: number,
  criticalWindowDays = 0
): BookkeeperPriority {
  if (daysTilDue === null) return "on_track";
  if (daysTilDue < criticalWindowDays) return "critical";
  if (daysTilDue <= attentionWindowDays) return "attention";
  return "on_track";
}

export function shortIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function sortBookkeeperQueue<
  T extends Pick<BookkeeperQueueItem, "priority" | "daysTilDue" | "companyName">,
>(items: T[]): T[] {
  return items.sort((a, b) => {
    const priorityDelta = priorityRank(b.priority) - priorityRank(a.priority);
    if (priorityDelta !== 0) return priorityDelta;
    const aDue = a.daysTilDue ?? 99999;
    const bDue = b.daysTilDue ?? 99999;
    if (aDue !== bDue) return aDue - bDue;
    return a.companyName.localeCompare(b.companyName);
  });
}

export function scoreDeadlinePressure(
  daysTilDue: number | null,
  overdue: number,
  week: number,
  month: number,
  quarter = 0
): number {
  if (daysTilDue === null) return 0;
  if (daysTilDue <= 0) return overdue;
  if (daysTilDue <= 7) return week;
  if (daysTilDue <= 28) return month;
  if (daysTilDue <= 90) return quarter;
  return 0;
}

export function dueLabel(daysTilDue: number | null): string {
  if (daysTilDue === null) return "no date";
  if (daysTilDue < 0) return `${Math.abs(daysTilDue)}d overdue`;
  if (daysTilDue === 0) return "due today";
  return `${daysTilDue}d left`;
}

export function interventionLevel(score: number): BookkeeperInterventionLevel {
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function buildBookkeeperIntervention(input: {
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
  let score = input.priority === "critical" ? 24 : input.priority === "attention" ? 12 : 0;
  score += scoreDeadlinePressure(input.vatDaysTilDue, 24, 18, 10);
  score += scoreDeadlinePressure(input.ctDaysTilDue, 18, 14, 8, 4);
  score += input.assignedStaffCount === 0 ? 12 : 0;
  score += input.noOperatingDocs ? 18 : 0;
  score += Math.min(16, input.overdueInvoiceCount * 4);
  score += Math.min(14, input.unreconciledBankCount * 2);
  score += Math.min(12, input.unpostedReceiptCount * 3);
  score += Math.min(8, input.missingCustomerTrnCount * 2);
  score += input.closeProgress < 50 ? 12 : input.closeProgress < 75 ? 6 : 0;
  score +=
    input.daysSinceActivity !== null && input.daysSinceActivity > 60
      ? 12
      : input.daysSinceActivity !== null && input.daysSinceActivity > 30
        ? 6
        : 0;
  score += input.discrepancy > 0.01 ? 14 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons: string[] = [];
  if (input.vatDaysTilDue !== null && input.vatDaysTilDue <= 28)
    reasons.push(`VAT ${dueLabel(input.vatDaysTilDue)}`);
  if (input.ctDaysTilDue !== null && input.ctDaysTilDue <= 90)
    reasons.push(`CT ${dueLabel(input.ctDaysTilDue)}`);
  if (input.assignedStaffCount === 0) reasons.push("No owner assigned");
  if (input.noOperatingDocs) reasons.push("No source documents loaded");
  if (input.overdueInvoiceCount > 0) reasons.push(`${input.overdueInvoiceCount} overdue invoices`);
  if (input.unreconciledBankCount > 0)
    reasons.push(`${input.unreconciledBankCount} unreconciled bank lines`);
  if (input.unpostedReceiptCount > 0)
    reasons.push(`${input.unpostedReceiptCount} unposted receipts`);
  if (input.missingCustomerTrnCount > 0)
    reasons.push(`${input.missingCustomerTrnCount} invoice TRN gaps`);
  if (input.daysSinceActivity !== null && input.daysSinceActivity > 30)
    reasons.push(`${input.daysSinceActivity}d since activity`);
  if (input.discrepancy > 0.01) reasons.push("Trial balance variance");
  if (reasons.length === 0) reasons.push("No active intervention signals");

  const nearestDeadline = [
    { label: "VAT", daysTilDue: input.vatDaysTilDue },
    { label: "CT", daysTilDue: input.ctDaysTilDue },
  ]
    .filter((item): item is { label: string; daysTilDue: number } => item.daysTilDue !== null)
    .sort((a, b) => a.daysTilDue - b.daysTilDue)[0];

  const title =
    input.assignedStaffCount === 0 && score >= 35
      ? "Owner assignment needed"
      : input.vatDaysTilDue !== null && input.vatDaysTilDue <= 7 && input.vatBlockers.length > 0
        ? "VAT filing at risk"
        : input.ctDaysTilDue !== null && input.ctDaysTilDue <= 30 && input.ctBlockers.length > 0
          ? "Corporate tax at risk"
          : input.noOperatingDocs || input.closeProgress < 50
            ? "Source-document intervention"
            : input.openAr > 0 && input.overdueInvoiceCount > 0
              ? "Payment collection drag"
              : input.discrepancy > 0.01
                ? "Accounting review required"
                : input.nextBestAction;

  const ownerAction =
    input.assignedStaffCount === 0
      ? "Assign an owner"
      : input.vatDaysTilDue !== null && input.vatDaysTilDue <= 0
        ? "Escalate VAT filing"
        : input.ctDaysTilDue !== null && input.ctDaysTilDue <= 30
          ? "Lock CT preparation plan"
          : input.noOperatingDocs
            ? "Request missing source documents"
            : input.overdueInvoiceCount > 0
              ? "Start payment chase"
              : input.unreconciledBankCount > 0 || input.unpostedReceiptCount > 0
                ? "Clear close blockers"
                : input.discrepancy > 0.01
                  ? "Review trial balance"
                  : input.nextBestAction;

  return {
    score,
    level: interventionLevel(score),
    title,
    reasons: reasons.slice(0, 5),
    ownerAction,
    deadlineLabel: nearestDeadline
      ? `${nearestDeadline.label} ${dueLabel(nearestDeadline.daysTilDue)}`
      : "No deadline pressure",
    exposureAed: Math.round(Math.max(0, input.openAr)),
  };
}

export const STANDARD_VAT_COHORTS = [
  vatCohortFromPeriodStart(1, "quarterly"),
  vatCohortFromPeriodStart(2, "quarterly"),
  vatCohortFromPeriodStart(3, "quarterly"),
] as VatCohort[];

export function emptyBookkeeperDashboard() {
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
    vatCohorts: STANDARD_VAT_COHORTS.map((cohort) => ({
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

export type EngagementSummaryRow = {
  id: string;
  companyId: string;
  engagementType: string;
  status: string;
  monthlyFee: unknown;
  billingCycle: string | null;
  servicesIncluded: string | null;
};

export function moneyToNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function servicePlanFromEngagement(
  row: EngagementSummaryRow | undefined
): ClientServicePlan {
  if (!row) {
    return {
      engagementId: null,
      engagementType: "full_service",
      servicesIncluded: [...DEFAULT_CLIENT_SERVICE_CODES],
      source: "default",
      status: "active",
      monthlyFee: null,
      billingCycle: "monthly",
    };
  }

  const servicesIncluded = normalizeClientServices(row.servicesIncluded);
  return {
    engagementId: row.id,
    engagementType: row.engagementType || engagementTypeForServices(servicesIncluded),
    servicesIncluded,
    source: "engagement",
    status: row.status || "active",
    monthlyFee: moneyToNumber(row.monthlyFee),
    billingCycle: row.billingCycle ?? "monthly",
  };
}

export async function loadActiveServicePlans(
  companyIds: string[]
): Promise<Map<string, ClientServicePlan>> {
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
    .where(and(inArray(engagements.companyId, companyIds), eq(engagements.status, "active")))
    .orderBy(desc(engagements.updatedAt), desc(engagements.createdAt))) as EngagementSummaryRow[];

  for (const row of rows) {
    if (!planMap.has(row.companyId)) {
      planMap.set(row.companyId, servicePlanFromEngagement(row));
    }
  }

  return planMap;
}

export async function upsertClientServicePlan(
  companyId: string,
  userId: string,
  services: readonly ClientServiceCode[]
): Promise<ClientServicePlan> {
  const normalizedServices = normalizeClientServices(services);
  const servicePayload = JSON.stringify(normalizedServices);
  const engagementType = engagementTypeForServices(normalizedServices);

  const [existing] = await db
    .select()
    .from(engagements)
    .where(and(eq(engagements.companyId, companyId), eq(engagements.status, "active")))
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
      status: "active",
      startDate: new Date(),
      billingCycle: "monthly",
      servicesIncluded: servicePayload,
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    })
    .returning();

  return servicePlanFromEngagement(created as EngagementSummaryRow);
}

// ─── Route registration ───────────────────────────────────────────────────────

export const clientServiceSchema = z.enum(["vat", "bookkeeping", "corporate_tax", "accounting"]);

export const optionalVatPeriodStartMonthSchema = z.preprocess((value) => {
  if (value == null || value === "" || value === "auto") return undefined;
  return value;
}, z.coerce.number().int().min(1).max(12).optional());

export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // R15-05: UAE TRN is 15 digits (format check only; no FTA lookup API exists).
  trnVatNumber: zOptionalClientTrn,
  legalStructure: z.string().optional(),
  industry: z.string().optional(),
  registrationNumber: z.string().optional(),
  businessAddress: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  websiteUrl: z.string().optional(),
  emirate: z.string().optional(),
  vatFilingFrequency: z.string().optional(),
  vatPeriodStartMonth: optionalVatPeriodStartMonthSchema,
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
  taxRegistrationType: z.string().optional(),
  corporateTaxId: z.string().optional(),
  serviceScope: z.array(clientServiceSchema).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const assignStaffSchema = z.object({
  staffUserId: z.string().uuid(),
  action: z.enum(["assign", "unassign"]),
  role: z.enum(ASSIGNMENT_ROLES).default("accountant"),
});

export const importPayloadSchema = z.object({
  rows: z.array(z.record(z.any())).min(1).max(500),
});
