import {
  activeVatReturnFilter,
  effectiveVatFilingStatus,
  vatFilingVersionOrder,
} from "../../tax/vat-filing-filter";
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
import { and, count, desc, eq, inArray, max, sum } from "drizzle-orm";
import {
  bankTransactions,
  engagements,
  firmStaffAssignments,
  invoices,
  receipts,
  users,
  vatReturns,
} from "../../../shared/schema";
import {
  canAccessFirmClient,
  isFirmClient,
  resolveFirmContext,
  type FirmContext,
} from "../../services/firm/scope";
import { createDefaultAccountsForCompany } from "../../defaultChartOfAccounts";
import { db, type AppDatabase } from "../../db";
import { firmContextOf } from "../../middleware/rbac";
import { firmReceivablesAed } from "../../services/firm/receivables.service";
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

/**
 * Refuse a client the caller cannot access. A company outside the caller's
 * firm (another firm's client, a self-signup SaaS customer, an archived or
 * unlinked company) is another tenant's row: 404, never 403 (platform rules,
 * tenancy). A client of the caller's own firm that this staff member is not
 * assigned to is a permission refusal: 403.
 */
export async function denyClientAccess(res: Response, companyId: string): Promise<Response> {
  // Routes behind requireFirmRole() do not attach the firm context; resolve it from the caller.
  const attached = res.locals.firmContext as FirmContext | undefined;
  const ctx = attached ?? (res.req?.user ? await resolveFirmContext(res.req.user) : null);
  if (ctx && (await isFirmClient(ctx, companyId))) {
    return res.status(403).json({ message: "Access denied to this client" });
  }
  return res.status(404).json({ message: "Client not found", code: "CLIENT_NOT_FOUND" });
}

export async function seedChartOfAccounts(
  companyId: string,
  exec: Pick<AppDatabase, "select" | "insert">
): Promise<void> {
  const hasAccounts = await storage.companyHasAccounts(companyId, exec);
  if (hasAccounts) return;
  const defaultAccounts = createDefaultAccountsForCompany(companyId);
  await storage.createBulkAccounts(defaultAccounts, exec);
}

import { isVatFilingRecorded } from "../../../shared/vat-filing-status";

export interface ClientStats {
  invoiceCount: number;
  invoiceTotal: number;
  /** Open A/R in AED from the settlement rule (partial payments, credit notes, FX respected). */
  outstandingAr: number;
  overdueAr: number;
  lastReceiptDate: Date | null;
  lastBankActivityDate: Date | null;
  vatStatus: { status: string; dueDate: Date; periodEnd: Date; filingRecorded: boolean } | null;
  assignedStaff: Array<{ id: string; name: string; email: string; role: string }>;
}

export interface AssignedStaffRow {
  companyId: string;
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Staff assigned to each client, from firm_staff_assignments (the table staff.service writes).
 * One query for all companies.
 */
export async function assignedStaffByCompany(
  companyIds: string[]
): Promise<Map<string, AssignedStaffRow[]>> {
  const out = new Map<string, AssignedStaffRow[]>();
  if (companyIds.length === 0) return out;
  const rows = (await db
    .select({
      companyId: firmStaffAssignments.companyId,
      id: users.id,
      name: users.name,
      email: users.email,
      role: firmStaffAssignments.role,
    })
    .from(firmStaffAssignments)
    .innerJoin(users, eq(users.id, firmStaffAssignments.userId))
    .where(inArray(firmStaffAssignments.companyId, companyIds))
    .orderBy(firmStaffAssignments.assignedAt)) as AssignedStaffRow[];
  for (const row of rows) {
    const list = out.get(row.companyId) ?? [];
    list.push(row);
    out.set(row.companyId, list);
  }
  return out;
}

/** Per-client stats for many clients in a fixed number of grouped queries (no per-client queries). */
export async function getClientStatsBatch(companyIds: string[]): Promise<Map<string, ClientStats>> {
  const out = new Map<string, ClientStats>();
  if (companyIds.length === 0) return out;
  const [invoiceRows, receiptRows, bankRows, vatRows, staff, receivables] = await Promise.all([
    db
      .select({ companyId: invoices.companyId, cnt: count(), total: sum(invoices.total) })
      .from(invoices)
      .where(inArray(invoices.companyId, companyIds))
      .groupBy(invoices.companyId) as Promise<
      { companyId: string; cnt: number; total: string | null }[]
    >,
    db
      .select({ companyId: receipts.companyId, lastDate: max(receipts.createdAt) })
      .from(receipts)
      .where(inArray(receipts.companyId, companyIds))
      .groupBy(receipts.companyId) as Promise<{ companyId: string; lastDate: Date | null }[]>,
    db
      .select({
        companyId: bankTransactions.companyId,
        lastDate: max(bankTransactions.transactionDate),
      })
      .from(bankTransactions)
      .where(inArray(bankTransactions.companyId, companyIds))
      .groupBy(bankTransactions.companyId) as Promise<
      { companyId: string; lastDate: Date | null }[]
    >,
    db
      .selectDistinctOn([vatReturns.companyId], {
        companyId: vatReturns.companyId,
        status: effectiveVatFilingStatus,
        reference: vatReturns.ftaReferenceNumber,
        dueDate: vatReturns.dueDate,
        periodEnd: vatReturns.periodEnd,
      })
      .from(vatReturns)
      .where(and(inArray(vatReturns.companyId, companyIds), activeVatReturnFilter))
      .orderBy(
        vatReturns.companyId,
        desc(vatReturns.periodEnd),
        ...vatFilingVersionOrder
      ) as Promise<
      {
        companyId: string;
        status: string;
        reference: string | null;
        dueDate: Date;
        periodEnd: Date;
      }[]
    >,
    assignedStaffByCompany(companyIds),
    firmReceivablesAed(companyIds),
  ]);
  const inv = new Map(invoiceRows.map((r) => [r.companyId, r]));
  const rec = new Map(receiptRows.map((r) => [r.companyId, r.lastDate]));
  const bank = new Map(bankRows.map((r) => [r.companyId, r.lastDate]));
  const vat = new Map(vatRows.map((r) => [r.companyId, r]));
  for (const id of companyIds) {
    const i = inv.get(id);
    const v = vat.get(id);
    const ar = receivables.get(id);
    out.set(id, {
      invoiceCount: Number(i?.cnt ?? 0),
      invoiceTotal: Number(i?.total ?? 0),
      outstandingAr: ar?.open ?? 0,
      overdueAr: ar?.overdue ?? 0,
      lastReceiptDate: rec.get(id) ?? null,
      lastBankActivityDate: bank.get(id) ?? null,
      vatStatus: v
        ? {
            status: v.status,
            dueDate: v.dueDate,
            periodEnd: v.periodEnd,
            filingRecorded: isVatFilingRecorded(v.status, v.reference),
          }
        : null,
      assignedStaff: (staff.get(id) ?? []).map(({ companyId: _c, ...s }) => s),
    });
  }
  return out;
}

export async function getClientStats(companyId: string): Promise<ClientStats> {
  const stats = await getClientStatsBatch([companyId]);
  return stats.get(companyId)!;
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
  vat:
    | { status: string; ftaReferenceNumber?: string | null; dueDate: Date | string | null }
    | null
    | undefined,
  now: Date
): VatHealthStatus {
  if (!vat) return "on-track";
  if (isVatFilingRecorded(vat.status, vat.ftaReferenceNumber)) return "on-track";
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
  services: readonly ClientServiceCode[],
  exec: Pick<AppDatabase, "select" | "insert" | "update"> = db
): Promise<ClientServicePlan> {
  const normalizedServices = normalizeClientServices(services);
  const servicePayload = JSON.stringify(normalizedServices);
  const engagementType = engagementTypeForServices(normalizedServices);

  const [existing] = await exec
    .select()
    .from(engagements)
    .where(and(eq(engagements.companyId, companyId), eq(engagements.status, "active")))
    .orderBy(desc(engagements.updatedAt), desc(engagements.createdAt))
    .limit(1);

  if (existing) {
    const [updated] = await exec
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

  const [created] = await exec
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
  staffUserId: z.string().guid(),
  action: z.enum(["assign", "unassign"]),
  role: z.enum(ASSIGNMENT_ROLES).default("accountant"),
});

export const importPayloadSchema = z.object({
  rows: z.array(z.record(z.string(), z.any())).min(1).max(500),
});

/** POST /firm/clients/import body: pre-parsed rows, or a base64 CSV/XLSX the server parses. */
export const firmClientsImportBody = z
  .object({
    rows: z.array(z.record(z.string(), z.any())).max(500).optional(),
    fileData: z.string().optional(),
    fileName: z.string().max(255).optional(),
  })
  .strict();
export type FirmClientsImportBody = z.output<typeof firmClientsImportBody>;
