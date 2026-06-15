import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../db";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { sendEmail } from "./email.service";
import { clientCommunications } from "../../shared/schema";
import type { Account, Invoice, InvoicePayment, JournalLine, Receipt } from "../../shared/schema";

const log = createLogger("report-pack-schedules");

export const reportPackIds = [
  "owner-command-pack",
  "freelancer-control-pack",
  "accountant-close-pack",
] as const;
export const reportPackCadences = ["weekly", "monthly", "quarterly"] as const;
export const reportPackChannels = ["email", "whatsapp", "both"] as const;

export type ReportPackId = (typeof reportPackIds)[number];
export type ReportPackCadence = (typeof reportPackCadences)[number];
export type ReportPackChannel = (typeof reportPackChannels)[number];
export type ReportPackDeliveryChannel = "email" | "whatsapp";
export type ReportPackDeliveryStatus = "sent" | "queued" | "failed";
export type ReportPackRecommendationPriority = "high" | "medium" | "low";

export type ReportPackSchedule = {
  packId: ReportPackId;
  enabled: boolean;
  cadence: ReportPackCadence;
  channel: ReportPackChannel;
  recipients: string[];
  includeComparison: boolean;
  nextRunDate: string | null;
  updatedAt: string | null;
  lastPreparedAt: string | null;
  lastPreparedBy: string | null;
  isDue?: boolean;
  daysUntilRun?: number | null;
};

export type ReportPackRunResult = {
  id: string;
  packId: ReportPackId;
  preparedAt: string;
  notificationCount: number;
  deliveryCount: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
  channel: ReportPackChannel;
  recipients: string[];
  reportNames: string[];
  automationActions: string[];
  snapshotMetrics: ReportPackSnapshotMetric[];
  recommendations: ReportPackRecommendation[];
  nextRunDate: string | null;
  deliveries: ReportPackDeliveryResult[];
};

export type ReportPackDeliveryResult = {
  recipient: string;
  channel: ReportPackDeliveryChannel;
  status: ReportPackDeliveryStatus;
  communicationId?: string;
  error?: string;
};

export type ReportPackManifest = {
  title: string;
  persona: "owner" | "freelancer" | "accountant";
  summary: string;
  reportNames: string[];
  automationActions: string[];
};

export type ReportPackSnapshotMetric = {
  key: string;
  label: string;
  value: number | string;
  type: "currency" | "number" | "percent" | "text";
  description: string;
  tone?: "positive" | "warning" | "danger" | "neutral";
};

export type ReportPackRecommendation = {
  id: string;
  title: string;
  description: string;
  priority: ReportPackRecommendationPriority;
  actionLabel: string;
  actionUrl: string;
  sourceMetricKey?: string;
};

export type ReportPackRunArtifact = {
  id: string;
  packId: ReportPackId;
  packTitle: string;
  persona: ReportPackManifest["persona"];
  preparedAt: string;
  preparedBy: string | null;
  cadence: ReportPackCadence;
  channel: ReportPackChannel;
  recipients: string[];
  includeComparison: boolean;
  reportNames: string[];
  automationActions: string[];
  snapshotMetrics: ReportPackSnapshotMetric[];
  recommendations: ReportPackRecommendation[];
  nextRunDate: string | null;
  notificationCount: number;
  deliveryCount: number;
  sentCount: number;
  queuedCount: number;
  failedCount: number;
};

export type ReportPackDeliveryHistoryItem = {
  id: string;
  runId: string | null;
  packId: ReportPackId | null;
  packTitle: string;
  channel: ReportPackDeliveryChannel;
  status: ReportPackDeliveryStatus | string;
  recipient: string;
  subject: string | null;
  sentAt: Date;
  preparedAt: string | null;
  cadence: string | null;
  includeComparison: boolean | null;
  provider: string | null;
  error: string | null;
};

export const reportPackTitles: Record<ReportPackId, string> = {
  "owner-command-pack": "Owner Command Pack",
  "freelancer-control-pack": "Freelancer Control Pack",
  "accountant-close-pack": "Accountant Close Pack",
};

export const reportPackManifests: Record<ReportPackId, ReportPackManifest> = {
  "owner-command-pack": {
    title: reportPackTitles["owner-command-pack"],
    persona: "owner",
    summary: "Cash, profit, receivables, taxes, and spend in one repeatable pack.",
    reportNames: [
      "Profit & Loss",
      "Balance Sheet",
      "Cash Flow Statement",
      "Invoice Status",
      "A/R Aging",
      "A/P Aging",
      "Expenses by Category",
      "VAT Summary",
      "Corporate Tax Estimate",
      "Period Comparison",
      "Budget vs Actual",
      "Inventory Valuation",
      "Cash Flow Forecast",
    ],
    automationActions: ["Chase payments", "Forecast cash", "Review VAT"],
  },
  "freelancer-control-pack": {
    title: reportPackTitles["freelancer-control-pack"],
    persona: "freelancer",
    summary: "Client income, unpaid invoices, expense leakage, and tax set-aside.",
    reportNames: [
      "Profit & Loss",
      "Cash Flow Statement",
      "Invoice Status",
      "Customer Balance Summary",
      "Revenue by Customer",
      "Expenses by Category",
      "VAT Summary",
      "Period Comparison",
    ],
    automationActions: ["Send reminders", "Capture receipts", "Set recurring work"],
  },
  "accountant-close-pack": {
    title: reportPackTitles["accountant-close-pack"],
    persona: "accountant",
    summary: "Close-ready financials, ledgers, tax workpapers, assets, and review queues.",
    reportNames: [
      "Trial Balance",
      "General Ledger",
      "Profit & Loss",
      "Balance Sheet",
      "VAT Return",
      "Corporate Tax Estimate",
      "Customer Balance Summary",
      "Vendor Balance Summary",
      "A/P Aging",
      "Budget vs Actual",
      "Inventory Valuation",
      "Fixed Asset Register",
      "Depreciation Schedule",
      "FX Gains and Losses",
      "Month-End Close Status",
      "Audit Trail",
    ],
    automationActions: ["Close month", "Chase documents", "Review anomalies"],
  },
};

export const reportPackScheduleSchema = z.object({
  enabled: z.boolean(),
  cadence: z.enum(reportPackCadences),
  channel: z.enum(reportPackChannels),
  recipients: z.array(z.string().trim().min(1).max(254)).max(10).default([]),
  includeComparison: z.boolean().default(true),
  nextRunDate: z.string().datetime().nullable().optional(),
});

export type ReportPackScheduleInput = z.infer<typeof reportPackScheduleSchema>;

export function classifyReportPackRecipient(recipient: string): {
  kind: "email" | "phone" | "invalid";
  value: string;
} {
  const value = recipient.trim();
  if (!value) return { kind: "invalid", value };

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    return { kind: "email", value: value.toLowerCase() };
  }

  const digits = value.replace(/\D/gu, "");
  if (digits.length >= 7) {
    return { kind: "phone", value };
  }

  return { kind: "invalid", value };
}

export function compatibleReportPackRecipientCount(
  channel: ReportPackChannel,
  recipients: string[]
): number {
  return recipients.filter((recipient) => {
    const classified = classifyReportPackRecipient(recipient);
    if (channel === "email") return classified.kind === "email";
    if (channel === "whatsapp") return classified.kind === "phone";
    return classified.kind === "email" || classified.kind === "phone";
  }).length;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentChange(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0;
  return roundMoney(((current - previous) / Math.abs(previous)) * 100);
}

function isReportableInvoice(inv: Invoice): boolean {
  return inv.status !== "draft" && inv.status !== "void" && inv.status !== "cancelled";
}

function invoiceBaseAmount(inv: Invoice, field: "subtotal" | "vatAmount" | "total"): number {
  return (inv[field] ?? 0) * (inv.exchangeRate ?? 1);
}

function receiptBaseAmount(receipt: Receipt, field: "amount" | "vatAmount"): number {
  return (receipt[field] ?? 0) * (receipt.exchangeRate ?? 1);
}

function dateInRange(date: Date | string | null | undefined, from: Date, to: Date): boolean {
  if (!date) return false;
  const parsed = date instanceof Date ? date : new Date(date);
  return !Number.isNaN(parsed.getTime()) && parsed >= from && parsed <= to;
}

function monthWindows(asOf: Date): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
} {
  const currentStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const currentEnd = asOf;
  const previousStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1));
  const previousEnd = new Date(currentStart.getTime() - 1);
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function metric(
  key: string,
  label: string,
  value: number | string,
  type: ReportPackSnapshotMetric["type"],
  description: string,
  tone: ReportPackSnapshotMetric["tone"] = "neutral"
): ReportPackSnapshotMetric {
  return { key, label, value, type, description, tone };
}

function sumInvoiceRevenue(invoices: Invoice[], from: Date, to: Date): number {
  return roundMoney(
    invoices
      .filter((inv) => isReportableInvoice(inv) && dateInRange(inv.date, from, to))
      .reduce((sum, inv) => sum + invoiceBaseAmount(inv, "subtotal"), 0)
  );
}

function sumPostedReceiptExpenses(receipts: Receipt[], from: Date, to: Date): number {
  return roundMoney(
    receipts
      .filter(
        (receipt) => receipt.posted && dateInRange(receipt.date ?? receipt.createdAt, from, to)
      )
      .reduce((sum, receipt) => sum + receiptBaseAmount(receipt, "amount"), 0)
  );
}

function invoiceOpenAmount(inv: Invoice, paidAmount: number): number {
  if (inv.status === "paid") return 0;
  return Math.max(0, (inv.total ?? 0) - paidAmount);
}

async function buildReportPackSnapshotMetrics(
  companyId: string,
  packId: ReportPackId,
  asOf: Date
): Promise<ReportPackSnapshotMetric[]> {
  const { currentStart, currentEnd, previousStart, previousEnd } = monthWindows(asOf);
  const [invoices, receipts, payments, accounts, entries] = await Promise.all([
    storage.getInvoicesByCompanyId(companyId),
    storage.getReceiptsByCompanyId(companyId),
    storage.getInvoicePaymentsByCompanyId(companyId),
    storage.getAccountsByCompanyId(companyId),
    storage.getJournalEntriesByCompanyId(companyId),
  ]);

  const reportableInvoices = invoices.filter(isReportableInvoice);
  const paymentsByInvoice = new Map<string, number>();
  for (const payment of payments as InvoicePayment[]) {
    paymentsByInvoice.set(
      payment.invoiceId,
      roundMoney((paymentsByInvoice.get(payment.invoiceId) ?? 0) + (payment.amount ?? 0))
    );
  }

  const revenue = sumInvoiceRevenue(reportableInvoices, currentStart, currentEnd);
  const previousRevenue = sumInvoiceRevenue(reportableInvoices, previousStart, previousEnd);
  const expenses = sumPostedReceiptExpenses(receipts, currentStart, currentEnd);
  const previousExpenses = sumPostedReceiptExpenses(receipts, previousStart, previousEnd);
  const netProfit = roundMoney(revenue - expenses);
  const revenueChange = percentChange(revenue, previousRevenue);
  const expenseChange = percentChange(expenses, previousExpenses);

  let openReceivables = 0;
  let overdueReceivables = 0;
  let overdueInvoiceCount = 0;
  const customerNames = new Set<string>();
  for (const inv of reportableInvoices) {
    customerNames.add(inv.customerName);
    const paidAmount = paymentsByInvoice.get(inv.id) ?? (inv.status === "paid" ? inv.total : 0);
    const openAmount = invoiceOpenAmount(inv, paidAmount);
    openReceivables += openAmount;
    const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
    if (openAmount > 0 && dueDate && dueDate < asOf) {
      overdueReceivables += openAmount;
      overdueInvoiceCount += 1;
    }
  }
  openReceivables = roundMoney(openReceivables);
  overdueReceivables = roundMoney(overdueReceivables);

  const outputVat = roundMoney(
    reportableInvoices
      .filter((inv) => dateInRange(inv.date, currentStart, currentEnd))
      .reduce((sum, inv) => sum + invoiceBaseAmount(inv, "vatAmount"), 0)
  );
  const inputVat = roundMoney(
    receipts
      .filter(
        (receipt) =>
          receipt.posted && dateInRange(receipt.date ?? receipt.createdAt, currentStart, currentEnd)
      )
      .reduce((sum, receipt) => sum + receiptBaseAmount(receipt, "vatAmount"), 0)
  );
  const netVat = roundMoney(outputVat - inputVat);
  const unpostedReceipts = receipts.filter((receipt) => !receipt.posted).length;
  const postedEntriesThisMonth = entries.filter(
    (entry) => entry.status === "posted" && dateInRange(entry.date, currentStart, currentEnd)
  ).length;

  let trialBalanceDifference = 0;
  const postedEntryIds = entries
    .filter((entry) => entry.status === "posted" && new Date(entry.date) <= asOf)
    .map((entry) => entry.id);
  if (postedEntryIds.length > 0) {
    const lines: JournalLine[] = await storage.getJournalLinesByEntryIds(postedEntryIds);
    const totalDebits = lines.reduce((sum, line) => sum + (line.debit ?? 0), 0);
    const totalCredits = lines.reduce((sum, line) => sum + (line.credit ?? 0), 0);
    trialBalanceDifference = roundMoney(Math.abs(totalDebits - totalCredits));
  }

  const activeAccountCount = (accounts as Account[]).filter((account) => account.isActive).length;
  const allMetrics: Record<string, ReportPackSnapshotMetric> = {
    revenue: metric(
      "revenue",
      "Revenue MTD",
      revenue,
      "currency",
      "Invoice subtotal revenue for the current month.",
      revenue >= previousRevenue ? "positive" : "warning"
    ),
    revenueChange: metric(
      "revenueChange",
      "Revenue change",
      revenueChange,
      "percent",
      "Current month revenue compared with the previous month.",
      revenueChange >= 0 ? "positive" : "warning"
    ),
    expenses: metric(
      "expenses",
      "Expenses MTD",
      expenses,
      "currency",
      "Posted receipt expense subtotal for the current month.",
      expenses <= previousExpenses ? "positive" : "warning"
    ),
    expenseChange: metric(
      "expenseChange",
      "Expense change",
      expenseChange,
      "percent",
      "Current month posted expenses compared with the previous month.",
      expenseChange <= 0 ? "positive" : "warning"
    ),
    netProfit: metric(
      "netProfit",
      "Net profit MTD",
      netProfit,
      "currency",
      "Revenue less posted expenses for the current month.",
      netProfit >= 0 ? "positive" : "warning"
    ),
    openReceivables: metric(
      "openReceivables",
      "Open receivables",
      openReceivables,
      "currency",
      "Invoice balance still open across reportable invoices.",
      openReceivables > 0 ? "warning" : "positive"
    ),
    overdueReceivables: metric(
      "overdueReceivables",
      "Overdue receivables",
      overdueReceivables,
      "currency",
      `${overdueInvoiceCount} overdue invoice${overdueInvoiceCount === 1 ? "" : "s"} need follow-up.`,
      overdueReceivables > 0 ? "danger" : "positive"
    ),
    netVat: metric(
      "netVat",
      "VAT position MTD",
      netVat,
      "currency",
      "Output VAT less recoverable input VAT for current-month activity.",
      netVat > 0 ? "warning" : "neutral"
    ),
    unpostedReceipts: metric(
      "unpostedReceipts",
      "Receipt posting queue",
      unpostedReceipts,
      "number",
      "Receipts not yet posted to the ledger.",
      unpostedReceipts > 0 ? "warning" : "positive"
    ),
    postedEntriesThisMonth: metric(
      "postedEntriesThisMonth",
      "Posted entries MTD",
      postedEntriesThisMonth,
      "number",
      "Posted journal entries in the current month.",
      "neutral"
    ),
    trialBalanceDifference: metric(
      "trialBalanceDifference",
      "Trial balance difference",
      trialBalanceDifference,
      "currency",
      "Absolute debit/credit difference across posted journal lines.",
      trialBalanceDifference > 0.01 ? "danger" : "positive"
    ),
    customerCount: metric(
      "customerCount",
      "Active customers",
      customerNames.size,
      "number",
      "Unique customers with reportable invoices.",
      "neutral"
    ),
    activeAccountCount: metric(
      "activeAccountCount",
      "Active accounts",
      activeAccountCount,
      "number",
      "Active chart-of-account records available for reporting.",
      "neutral"
    ),
  };

  const packMetricKeys: Record<ReportPackId, string[]> = {
    "owner-command-pack": [
      "revenue",
      "netProfit",
      "openReceivables",
      "overdueReceivables",
      "netVat",
      "revenueChange",
    ],
    "freelancer-control-pack": [
      "revenue",
      "customerCount",
      "openReceivables",
      "overdueReceivables",
      "expenses",
      "netVat",
    ],
    "accountant-close-pack": [
      "trialBalanceDifference",
      "postedEntriesThisMonth",
      "unpostedReceipts",
      "netVat",
      "activeAccountCount",
      "openReceivables",
    ],
  };

  return packMetricKeys[packId].map((key) => allMetrics[key]).filter(Boolean);
}

const recommendationPriorityWeight: Record<ReportPackRecommendationPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const recommendationCurrencyFormatter = new Intl.NumberFormat("en-AE", {
  style: "currency",
  currency: "AED",
  maximumFractionDigits: 0,
});

function snapshotMetricNumber(
  snapshotMetrics: ReportPackSnapshotMetric[],
  key: string
): number | null {
  const metric = snapshotMetrics.find((item) => item.key === key);
  if (!metric) return null;
  if (typeof metric.value === "number") return metric.value;

  const parsed = Number(metric.value.replace(/[^0-9.-]+/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRecommendationAmount(value: number): string {
  return recommendationCurrencyFormatter.format(Math.abs(roundMoney(value)));
}

function buildReportPackRecommendations(
  packId: ReportPackId,
  snapshotMetrics: ReportPackSnapshotMetric[]
): ReportPackRecommendation[] {
  const manifest = reportPackManifests[packId];
  const recommendations: ReportPackRecommendation[] = [];
  const add = (recommendation: ReportPackRecommendation) => {
    if (!recommendations.some((item) => item.id === recommendation.id)) {
      recommendations.push(recommendation);
    }
  };

  const overdueReceivables = snapshotMetricNumber(snapshotMetrics, "overdueReceivables") ?? 0;
  if (overdueReceivables > 0) {
    add({
      id: "chase-overdue-receivables",
      title: "Chase overdue invoices",
      description: `${formatRecommendationAmount(overdueReceivables)} is overdue. Send reminders before the next report pack run.`,
      priority: "high",
      actionLabel: "Open payment chasing",
      actionUrl: "/payment-chasing",
      sourceMetricKey: "overdueReceivables",
    });
  }

  const trialBalanceDifference =
    snapshotMetricNumber(snapshotMetrics, "trialBalanceDifference") ?? 0;
  if (trialBalanceDifference > 0.01) {
    add({
      id: "investigate-trial-balance-difference",
      title: "Investigate trial balance difference",
      description: `${formatRecommendationAmount(trialBalanceDifference)} is out of balance across posted journal lines.`,
      priority: "high",
      actionLabel: "Open Reports",
      actionUrl: "/reports",
      sourceMetricKey: "trialBalanceDifference",
    });
  }

  const unpostedReceipts = snapshotMetricNumber(snapshotMetrics, "unpostedReceipts") ?? 0;
  if (unpostedReceipts > 0) {
    add({
      id: "post-receipt-queue",
      title: "Post receipt queue",
      description: `${Math.trunc(unpostedReceipts)} receipt${unpostedReceipts === 1 ? "" : "s"} still need ledger posting.`,
      priority: packId === "owner-command-pack" ? "medium" : "high",
      actionLabel: "Open receipt autopilot",
      actionUrl: "/receipt-autopilot",
      sourceMetricKey: "unpostedReceipts",
    });
  }

  const netVat = snapshotMetricNumber(snapshotMetrics, "netVat") ?? 0;
  if (netVat > 0) {
    add({
      id: "review-vat-position",
      title: "Review VAT position",
      description: `${formatRecommendationAmount(netVat)} net VAT is visible in this pack. Check readiness before filing.`,
      priority: "medium",
      actionLabel: "Open VAT autopilot",
      actionUrl: "/vat-autopilot",
      sourceMetricKey: "netVat",
    });
  }

  const netProfit = snapshotMetricNumber(snapshotMetrics, "netProfit");
  if (netProfit !== null && netProfit < 0) {
    add({
      id: "review-margin-and-spend",
      title: "Review margin and spend",
      description: `Month-to-date profit is negative by ${formatRecommendationAmount(netProfit)}.`,
      priority: "medium",
      actionLabel: "Open Reports",
      actionUrl: "/reports",
      sourceMetricKey: "netProfit",
    });
  }

  const openReceivables = snapshotMetricNumber(snapshotMetrics, "openReceivables") ?? 0;
  if (openReceivables > overdueReceivables) {
    add({
      id: "review-open-receivables",
      title: "Review open receivables",
      description: `${formatRecommendationAmount(openReceivables)} remains open across reportable invoices.`,
      priority: "medium",
      actionLabel: "Open payment chasing",
      actionUrl: "/payment-chasing",
      sourceMetricKey: "openReceivables",
    });
  }

  if (recommendations.length === 0) {
    add({
      id: `review-${packId}`,
      title: `Review ${manifest.title}`,
      description:
        "No urgent exceptions were found in this run. Review the pack and keep the schedule active.",
      priority: "low",
      actionLabel: "Open Reports",
      actionUrl: "/reports",
    });
  }

  return recommendations.sort(
    (a, b) => recommendationPriorityWeight[b.priority] - recommendationPriorityWeight[a.priority]
  );
}

export function reportPackScheduleKey(companyId: string): string {
  return `report_pack_schedules.${companyId}`;
}

export function reportPackRunHistoryKey(companyId: string): string {
  return `report_pack_runs.${companyId}`;
}

function companyIdFromReportPackScheduleKey(key: string): string | null {
  const prefix = "report_pack_schedules.";
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function defaultReportPackSchedule(packId: ReportPackId): ReportPackSchedule {
  return {
    packId,
    enabled: false,
    cadence: packId === "owner-command-pack" ? "weekly" : "monthly",
    channel: "email",
    recipients: [],
    includeComparison: true,
    nextRunDate: null,
    updatedAt: null,
    lastPreparedAt: null,
    lastPreparedBy: null,
  };
}

export function defaultReportPackSchedules(): Record<ReportPackId, ReportPackSchedule> {
  return reportPackIds.reduce(
    (acc, packId) => {
      acc[packId] = defaultReportPackSchedule(packId);
      return acc;
    },
    {} as Record<ReportPackId, ReportPackSchedule>
  );
}

export function parseReportPackSchedules(
  value: string | undefined
): Record<ReportPackId, ReportPackSchedule> {
  const schedules = defaultReportPackSchedules();
  if (!value) return schedules;

  try {
    const parsed = JSON.parse(value) as Partial<Record<ReportPackId, Partial<ReportPackSchedule>>>;
    for (const packId of reportPackIds) {
      const schedule = parsed[packId];
      if (!schedule) continue;
      schedules[packId] = {
        ...schedules[packId],
        ...schedule,
        packId,
        recipients: Array.isArray(schedule.recipients) ? schedule.recipients.filter(Boolean) : [],
        nextRunDate: schedule.nextRunDate ?? null,
        updatedAt: schedule.updatedAt ?? null,
        lastPreparedAt: schedule.lastPreparedAt ?? null,
        lastPreparedBy: schedule.lastPreparedBy ?? null,
      };
    }
  } catch {
    return schedules;
  }

  return schedules;
}

export function nextReportPackRunDate(cadence: ReportPackCadence, fromDate = new Date()): string {
  const next = new Date(fromDate);

  if (cadence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (cadence === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setMonth(next.getMonth() + 3);
  }

  next.setHours(8, 0, 0, 0);
  if (next <= fromDate) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

export function withReportPackRunState(schedule: ReportPackSchedule): ReportPackSchedule {
  if (!schedule.enabled || !schedule.nextRunDate) {
    return { ...schedule, isDue: false, daysUntilRun: null };
  }

  const nextRun = new Date(schedule.nextRunDate);
  if (Number.isNaN(nextRun.getTime())) {
    return { ...schedule, isDue: false, daysUntilRun: null };
  }

  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();
  return {
    ...schedule,
    isDue: diffMs <= 0,
    daysUntilRun: Math.max(0, Math.ceil(diffMs / 86_400_000)),
  };
}

async function persistReportPackSchedules(
  companyId: string,
  schedules: Record<ReportPackId, ReportPackSchedule>
) {
  const key = reportPackScheduleKey(companyId);
  const existing = await storage.getAdminSettingByKey(key);
  const value = JSON.stringify(schedules);
  if (existing) {
    await storage.updateAdminSetting(key, value);
  } else {
    await storage.createAdminSetting({
      key,
      value,
      category: "reports",
      description: "Per-company report pack delivery schedules",
    });
  }
}

function buildReportPackRunId(packId: ReportPackId, preparedAt: string): string {
  return `${packId}.${preparedAt.replace(/\D/gu, "")}`;
}

function parseReportPackSnapshotMetrics(value: unknown): ReportPackSnapshotMetric[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((snapshot): snapshot is Record<string, unknown> => {
      return Boolean(snapshot) && typeof snapshot === "object" && !Array.isArray(snapshot);
    })
    .map((snapshot) => ({
      key: typeof snapshot.key === "string" ? snapshot.key : "metric",
      label: typeof snapshot.label === "string" ? snapshot.label : "Metric",
      value:
        typeof snapshot.value === "number" || typeof snapshot.value === "string"
          ? snapshot.value
          : "",
      type:
        snapshot.type === "currency" ||
        snapshot.type === "number" ||
        snapshot.type === "percent" ||
        snapshot.type === "text"
          ? snapshot.type
          : "text",
      description: typeof snapshot.description === "string" ? snapshot.description : "",
      tone:
        snapshot.tone === "positive" ||
        snapshot.tone === "warning" ||
        snapshot.tone === "danger" ||
        snapshot.tone === "neutral"
          ? snapshot.tone
          : "neutral",
    }));
}

function parseReportPackRecommendations(value: unknown): ReportPackRecommendation[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((recommendation): recommendation is Record<string, unknown> => {
      return (
        Boolean(recommendation) &&
        typeof recommendation === "object" &&
        !Array.isArray(recommendation)
      );
    })
    .map(
      (recommendation): ReportPackRecommendation => ({
        id: typeof recommendation.id === "string" ? recommendation.id : "recommendation",
        title:
          typeof recommendation.title === "string" ? recommendation.title : "Review report pack",
        description:
          typeof recommendation.description === "string" ? recommendation.description : "",
        priority:
          recommendation.priority === "high" ||
          recommendation.priority === "medium" ||
          recommendation.priority === "low"
            ? recommendation.priority
            : "low",
        actionLabel:
          typeof recommendation.actionLabel === "string"
            ? recommendation.actionLabel
            : "Open Reports",
        actionUrl:
          typeof recommendation.actionUrl === "string" ? recommendation.actionUrl : "/reports",
        sourceMetricKey:
          typeof recommendation.sourceMetricKey === "string"
            ? recommendation.sourceMetricKey
            : undefined,
      })
    )
    .filter((recommendation) => recommendation.title.trim() && recommendation.actionUrl.trim());
}

function parseReportPackRunHistory(value: string | undefined): ReportPackRunArtifact[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (run): run is Partial<ReportPackRunArtifact> => Boolean(run) && typeof run === "object"
      )
      .map((run) => {
        const packId = reportPackIds.includes(run.packId as ReportPackId)
          ? (run.packId as ReportPackId)
          : "owner-command-pack";
        const manifest = reportPackManifests[packId];
        const snapshotMetrics = parseReportPackSnapshotMetrics(run.snapshotMetrics);

        return {
          id:
            typeof run.id === "string"
              ? run.id
              : buildReportPackRunId(packId, String(run.preparedAt ?? "")),
          packId,
          packTitle: typeof run.packTitle === "string" ? run.packTitle : manifest.title,
          persona: manifest.persona,
          preparedAt:
            typeof run.preparedAt === "string" ? run.preparedAt : new Date(0).toISOString(),
          preparedBy: typeof run.preparedBy === "string" ? run.preparedBy : null,
          cadence: reportPackCadences.includes(run.cadence as ReportPackCadence)
            ? (run.cadence as ReportPackCadence)
            : "monthly",
          channel: reportPackChannels.includes(run.channel as ReportPackChannel)
            ? (run.channel as ReportPackChannel)
            : "email",
          recipients: Array.isArray(run.recipients)
            ? run.recipients.filter(
                (recipient): recipient is string => typeof recipient === "string"
              )
            : [],
          includeComparison: run.includeComparison !== false,
          reportNames: Array.isArray(run.reportNames)
            ? run.reportNames.filter((report): report is string => typeof report === "string")
            : manifest.reportNames,
          automationActions: Array.isArray(run.automationActions)
            ? run.automationActions.filter((action): action is string => typeof action === "string")
            : manifest.automationActions,
          snapshotMetrics,
          recommendations: parseReportPackRecommendations(run.recommendations),
          nextRunDate: typeof run.nextRunDate === "string" ? run.nextRunDate : null,
          notificationCount: Number(run.notificationCount) || 0,
          deliveryCount: Number(run.deliveryCount) || 0,
          sentCount: Number(run.sentCount) || 0,
          queuedCount: Number(run.queuedCount) || 0,
          failedCount: Number(run.failedCount) || 0,
        };
      });
  } catch {
    return [];
  }
}

async function persistReportPackRunArtifact(companyId: string, artifact: ReportPackRunArtifact) {
  const key = reportPackRunHistoryKey(companyId);
  const existing = await storage.getAdminSettingByKey(key);
  const history = parseReportPackRunHistory(existing?.value);
  const value = JSON.stringify(
    [artifact, ...history.filter((run) => run.id !== artifact.id)].slice(0, 50)
  );

  if (existing) {
    await storage.updateAdminSetting(key, value);
  } else {
    await storage.createAdminSetting({
      key,
      value,
      category: "reports",
      description: "Per-company prepared report pack run history",
    });
  }
}

export async function getReportPackSchedules(companyId: string): Promise<ReportPackSchedule[]> {
  const setting = await storage.getAdminSettingByKey(reportPackScheduleKey(companyId));
  const schedules = parseReportPackSchedules(setting?.value);
  return reportPackIds.map((packId) => withReportPackRunState(schedules[packId]));
}

export async function getReportPackRunHistory(
  companyId: string,
  limit = 25
): Promise<ReportPackRunArtifact[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 25, 1), 100);
  const setting = await storage.getAdminSettingByKey(reportPackRunHistoryKey(companyId));
  return parseReportPackRunHistory(setting?.value).slice(0, boundedLimit);
}

export async function getReportPackRunArtifact(
  companyId: string,
  runId: string
): Promise<ReportPackRunArtifact | undefined> {
  const setting = await storage.getAdminSettingByKey(reportPackRunHistoryKey(companyId));
  return parseReportPackRunHistory(setting?.value).find((run) => run.id === runId);
}

function reportPackRunFilename(run: ReportPackRunArtifact): string {
  const date = run.preparedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const pack = run.packId.replace(/[^a-z0-9]+/giu, "-");
  return `${pack}-run-${date}.xlsx`;
}

function addRunSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  columns: Array<{ header: string; key: string; width?: number }>,
  rows: Record<string, unknown>[]
) {
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 20,
  }));
  worksheet.getRow(1).font = { bold: true };
  rows.forEach((row) => worksheet.addRow(row));
  worksheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
}

export async function buildReportPackRunWorkbook(
  companyId: string,
  runId: string
): Promise<{ buffer: Buffer; filename: string } | undefined> {
  const run = await getReportPackRunArtifact(companyId, runId);
  if (!run) return undefined;

  const company = await storage.getCompany(companyId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NR-Ai";
  workbook.lastModifiedBy = "NR-Ai";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.title = `${run.packTitle} Run`;
  workbook.company = company?.name ?? "NR-Ai";

  addRunSheet(
    workbook,
    "Summary",
    [
      { header: "Field", key: "field", width: 26 },
      { header: "Value", key: "value", width: 72 },
    ],
    [
      { field: "Company", value: company?.name ?? companyId },
      { field: "Pack", value: run.packTitle },
      { field: "Persona", value: run.persona },
      { field: "Prepared at", value: run.preparedAt },
      { field: "Cadence", value: run.cadence },
      { field: "Channel", value: run.channel },
      { field: "Includes comparisons", value: run.includeComparison ? "Yes" : "No" },
      { field: "Next run", value: run.nextRunDate ?? "Not scheduled" },
      { field: "Notifications", value: run.notificationCount },
      { field: "Deliveries", value: run.deliveryCount },
      { field: "Sent", value: run.sentCount },
      { field: "Queued", value: run.queuedCount },
      { field: "Failed", value: run.failedCount },
    ]
  );

  addRunSheet(
    workbook,
    "Snapshot",
    [
      { header: "Metric", key: "label", width: 28 },
      { header: "Value", key: "value", width: 18 },
      { header: "Type", key: "type", width: 14 },
      { header: "Tone", key: "tone", width: 14 },
      { header: "Description", key: "description", width: 72 },
    ],
    run.snapshotMetrics.map((snapshot) => ({
      label: snapshot.label,
      value: snapshot.value,
      type: snapshot.type,
      tone: snapshot.tone ?? "neutral",
      description: snapshot.description,
    }))
  );

  addRunSheet(
    workbook,
    "Recommendations",
    [
      { header: "Priority", key: "priority", width: 14 },
      { header: "Recommendation", key: "title", width: 34 },
      { header: "Action", key: "actionLabel", width: 28 },
      { header: "Description", key: "description", width: 72 },
      { header: "Source Metric", key: "sourceMetricKey", width: 22 },
      { header: "URL", key: "actionUrl", width: 28 },
    ],
    run.recommendations.map((recommendation) => ({
      priority: recommendation.priority,
      title: recommendation.title,
      actionLabel: recommendation.actionLabel,
      description: recommendation.description,
      sourceMetricKey: recommendation.sourceMetricKey ?? "",
      actionUrl: recommendation.actionUrl,
    }))
  );

  addRunSheet(
    workbook,
    "Included Reports",
    [
      { header: "#", key: "index", width: 8 },
      { header: "Report", key: "report", width: 42 },
    ],
    run.reportNames.map((report, index) => ({ index: index + 1, report }))
  );

  addRunSheet(
    workbook,
    "Automation Actions",
    [
      { header: "#", key: "index", width: 8 },
      { header: "Action", key: "action", width: 42 },
    ],
    run.automationActions.map((action, index) => ({ index: index + 1, action }))
  );

  addRunSheet(
    workbook,
    "Recipients",
    [
      { header: "#", key: "index", width: 8 },
      { header: "Recipient", key: "recipient", width: 42 },
    ],
    run.recipients.map((recipient, index) => ({ index: index + 1, recipient }))
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    filename: reportPackRunFilename(run),
  };
}

function parseReportPackCommunicationMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function deliveryChannelFromCommunication(value: string): ReportPackDeliveryChannel {
  return value === "whatsapp" ? "whatsapp" : "email";
}

export async function getReportPackDeliveryHistory(
  companyId: string,
  limit = 50
): Promise<ReportPackDeliveryHistoryItem[]> {
  type ReportPackCommunicationHistoryRow = {
    id: string;
    channel: string;
    recipientEmail: string | null;
    recipientPhone: string | null;
    subject: string | null;
    status: string;
    metadata: string | null;
    sentAt: Date;
  };

  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const rows: ReportPackCommunicationHistoryRow[] = await db
    .select({
      id: clientCommunications.id,
      channel: clientCommunications.channel,
      recipientEmail: clientCommunications.recipientEmail,
      recipientPhone: clientCommunications.recipientPhone,
      subject: clientCommunications.subject,
      status: clientCommunications.status,
      metadata: clientCommunications.metadata,
      sentAt: clientCommunications.sentAt,
    })
    .from(clientCommunications)
    .where(
      and(
        eq(clientCommunications.companyId, companyId),
        eq(clientCommunications.templateType, "report_pack")
      )
    )
    .orderBy(desc(clientCommunications.sentAt))
    .limit(boundedLimit);

  return rows.map((row) => {
    const metadata = parseReportPackCommunicationMetadata(row.metadata);
    const metadataPackId = metadataString(metadata, "packId");
    const packId = reportPackIds.includes(metadataPackId as ReportPackId)
      ? (metadataPackId as ReportPackId)
      : null;

    return {
      id: row.id,
      runId: metadataString(metadata, "runId"),
      packId,
      packTitle: packId ? reportPackTitles[packId] : "Report Pack",
      channel: deliveryChannelFromCommunication(row.channel),
      status: row.status,
      recipient: row.recipientEmail ?? row.recipientPhone ?? "Unknown recipient",
      subject: row.subject,
      sentAt: row.sentAt,
      preparedAt: metadataString(metadata, "preparedAt"),
      cadence: metadataString(metadata, "cadence"),
      includeComparison: metadataBoolean(metadata, "includeComparison"),
      provider: metadataString(metadata, "provider"),
      error: metadataString(metadata, "error"),
    };
  });
}

export async function saveReportPackSchedule(
  companyId: string,
  packId: ReportPackId,
  input: ReportPackScheduleInput,
  now = new Date()
): Promise<{ schedule: ReportPackSchedule; schedules: ReportPackSchedule[] }> {
  const setting = await storage.getAdminSettingByKey(reportPackScheduleKey(companyId));
  const schedules = parseReportPackSchedules(setting?.value);
  const previous = schedules[packId];
  const shouldCalculateNextRun =
    input.enabled &&
    (!input.nextRunDate ||
      !previous.enabled ||
      previous.cadence !== input.cadence ||
      !previous.nextRunDate ||
      new Date(previous.nextRunDate).getTime() <= now.getTime());

  const schedule: ReportPackSchedule = {
    ...previous,
    ...input,
    packId,
    nextRunDate: input.enabled
      ? shouldCalculateNextRun
        ? nextReportPackRunDate(input.cadence, now)
        : previous.nextRunDate
      : null,
    updatedAt: now.toISOString(),
  };

  schedules[packId] = schedule;
  await persistReportPackSchedules(companyId, schedules);

  return {
    schedule: withReportPackRunState(schedule),
    schedules: reportPackIds.map((id) => withReportPackRunState(schedules[id])),
  };
}

export async function prepareReportPackSchedule(
  companyId: string,
  packId: ReportPackId,
  preparedBy: string | null = null,
  now = new Date()
): Promise<{
  run: ReportPackRunResult;
  schedule: ReportPackSchedule;
  schedules: ReportPackSchedule[];
}> {
  const setting = await storage.getAdminSettingByKey(reportPackScheduleKey(companyId));
  const schedules = parseReportPackSchedules(setting?.value);
  const preparedAt = now.toISOString();
  const runId = buildReportPackRunId(packId, preparedAt);
  const currentSchedule = schedules[packId];
  const schedule: ReportPackSchedule = {
    ...currentSchedule,
    nextRunDate: currentSchedule.enabled
      ? nextReportPackRunDate(currentSchedule.cadence, now)
      : currentSchedule.nextRunDate,
    updatedAt: preparedAt,
    lastPreparedAt: preparedAt,
    lastPreparedBy: preparedBy,
  };
  schedules[packId] = schedule;
  await persistReportPackSchedules(companyId, schedules);

  const deliveries = await deliverPreparedReportPack(
    companyId,
    packId,
    schedule,
    preparedBy,
    preparedAt,
    runId
  );
  const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);
  let notificationCount = 0;
  for (const companyUser of companyUsers) {
    try {
      await storage.createNotification({
        userId: companyUser.userId,
        companyId,
        type: "system",
        title: `${reportPackTitles[packId]} prepared`,
        message: `${reportPackTitles[packId]} is ready to review in Reports. Delivery channel: ${schedule.channel}.`,
        priority: "normal",
        relatedEntityType: "report_pack",
        actionUrl: "/reports",
        isRead: false,
        isDismissed: false,
      });
      notificationCount += 1;
    } catch (err) {
      log.error(
        { err, companyId, userId: companyUser.userId, packId },
        "Failed to notify prepared report pack"
      );
    }
  }

  const manifest = reportPackManifests[packId];
  let snapshotMetrics: ReportPackSnapshotMetric[] = [];
  try {
    snapshotMetrics = await buildReportPackSnapshotMetrics(companyId, packId, now);
  } catch (err) {
    log.error({ err, companyId, packId, runId }, "Failed to build report pack snapshot metrics");
  }
  const recommendations = buildReportPackRecommendations(packId, snapshotMetrics);

  const run: ReportPackRunResult = {
    id: runId,
    packId,
    preparedAt,
    notificationCount,
    deliveryCount: deliveries.length,
    sentCount: deliveries.filter((delivery) => delivery.status === "sent").length,
    queuedCount: deliveries.filter((delivery) => delivery.status === "queued").length,
    failedCount: deliveries.filter((delivery) => delivery.status === "failed").length,
    channel: schedule.channel,
    recipients: schedule.recipients,
    reportNames: manifest.reportNames,
    automationActions: manifest.automationActions,
    snapshotMetrics,
    recommendations,
    nextRunDate: schedule.nextRunDate,
    deliveries,
  };

  try {
    await persistReportPackRunArtifact(companyId, {
      id: run.id,
      packId,
      packTitle: manifest.title,
      persona: manifest.persona,
      preparedAt,
      preparedBy,
      cadence: schedule.cadence,
      channel: schedule.channel,
      recipients: schedule.recipients,
      includeComparison: schedule.includeComparison,
      reportNames: manifest.reportNames,
      automationActions: manifest.automationActions,
      snapshotMetrics,
      recommendations,
      nextRunDate: schedule.nextRunDate,
      notificationCount,
      deliveryCount: run.deliveryCount,
      sentCount: run.sentCount,
      queuedCount: run.queuedCount,
      failedCount: run.failedCount,
    });
  } catch (err) {
    log.error({ err, companyId, packId, runId }, "Failed to persist report pack run artifact");
  }

  return {
    run,
    schedule: withReportPackRunState(schedule),
    schedules: reportPackIds.map((id) => withReportPackRunState(schedules[id])),
  };
}

function reportPackSubject(companyName: string, packId: ReportPackId): string {
  return `${reportPackTitles[packId]} prepared for ${companyName}`;
}

function reportPackMessage(
  companyName: string,
  packId: ReportPackId,
  schedule: ReportPackSchedule,
  preparedAt: string
): string {
  const manifest = reportPackManifests[packId];
  const preparedDate = new Date(preparedAt).toLocaleString("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const nextRun = schedule.nextRunDate
    ? new Date(schedule.nextRunDate).toLocaleDateString("en-AE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not scheduled";

  return [
    `${reportPackTitles[packId]} is ready for ${companyName}.`,
    "",
    `Prepared: ${preparedDate}`,
    `Cadence: ${schedule.cadence}`,
    `Includes comparisons: ${schedule.includeComparison ? "Yes" : "No"}`,
    `Next scheduled run: ${nextRun}`,
    "",
    "Included reports:",
    ...manifest.reportNames.map((report) => `- ${report}`),
    "",
    "Automation actions:",
    ...manifest.automationActions.map((action) => `- ${action}`),
    "",
    "Open NR-Ai Reports to review the pack, export the workbook, and act on the automation queue.",
    "/reports",
  ].join("\n");
}

function deliveryTargetsForRecipient(
  scheduleChannel: ReportPackChannel,
  recipient: string
): Array<{ channel: ReportPackDeliveryChannel; recipient: string }> {
  const classified = classifyReportPackRecipient(recipient);
  if (classified.kind === "email" && (scheduleChannel === "email" || scheduleChannel === "both")) {
    return [{ channel: "email", recipient: classified.value }];
  }
  if (
    classified.kind === "phone" &&
    (scheduleChannel === "whatsapp" || scheduleChannel === "both")
  ) {
    return [{ channel: "whatsapp", recipient: classified.value }];
  }
  return [];
}

async function recordReportPackCommunication(input: {
  companyId: string;
  userId: string | null;
  channel: ReportPackDeliveryChannel;
  recipient: string;
  subject?: string;
  body: string;
  status: ReportPackDeliveryStatus;
  metadata: Record<string, unknown>;
}): Promise<string | undefined> {
  const [communication] = await db
    .insert(clientCommunications)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      channel: input.channel,
      direction: "outbound",
      recipientEmail: input.channel === "email" ? input.recipient : null,
      recipientPhone: input.channel === "whatsapp" ? input.recipient : null,
      subject: input.subject ?? null,
      body: input.body,
      status: input.status,
      templateType: "report_pack",
      metadata: JSON.stringify(input.metadata),
      sentAt: new Date(),
    })
    .returning({ id: clientCommunications.id });

  return communication?.id;
}

async function deliverPreparedReportPack(
  companyId: string,
  packId: ReportPackId,
  schedule: ReportPackSchedule,
  preparedBy: string | null,
  preparedAt: string,
  runId: string
): Promise<ReportPackDeliveryResult[]> {
  if (schedule.recipients.length === 0) return [];

  const company = await storage.getCompany(companyId);
  const companyName = company?.name ?? "your company";
  const subject = reportPackSubject(companyName, packId);
  const body = reportPackMessage(companyName, packId, schedule, preparedAt);
  const deliveries: ReportPackDeliveryResult[] = [];

  for (const recipient of schedule.recipients) {
    const targets = deliveryTargetsForRecipient(schedule.channel, recipient);
    for (const target of targets) {
      if (target.channel === "email") {
        const result = await sendEmail(target.recipient, subject, body, {
          fromName: companyName,
        });
        const status: ReportPackDeliveryStatus = result.sent ? "sent" : "failed";
        const communicationId = await recordReportPackCommunication({
          companyId,
          userId: preparedBy,
          channel: "email",
          recipient: target.recipient,
          subject,
          body,
          status,
          metadata: {
            packId,
            runId,
            preparedAt,
            reportNames: reportPackManifests[packId].reportNames,
            automationActions: reportPackManifests[packId].automationActions,
            cadence: schedule.cadence,
            scheduleChannel: schedule.channel,
            includeComparison: schedule.includeComparison,
            provider: result.provider ?? null,
            error: result.error ?? null,
          },
        });
        deliveries.push({
          recipient: target.recipient,
          channel: "email",
          status,
          communicationId,
          ...(result.error ? { error: result.error } : {}),
        });
      } else {
        const communicationId = await recordReportPackCommunication({
          companyId,
          userId: preparedBy,
          channel: "whatsapp",
          recipient: target.recipient,
          body,
          status: "queued",
          metadata: {
            packId,
            runId,
            preparedAt,
            reportNames: reportPackManifests[packId].reportNames,
            automationActions: reportPackManifests[packId].automationActions,
            cadence: schedule.cadence,
            scheduleChannel: schedule.channel,
            includeComparison: schedule.includeComparison,
            deliveryMode: "manual_whatsapp",
          },
        });
        deliveries.push({
          recipient: target.recipient,
          channel: "whatsapp",
          status: "queued",
          communicationId,
        });
      }
    }
  }

  return deliveries;
}

function isReportPackDue(schedule: ReportPackSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  if (!schedule.nextRunDate) return true;
  const nextRun = new Date(schedule.nextRunDate);
  if (Number.isNaN(nextRun.getTime())) return true;
  return nextRun <= now;
}

export async function scanDueReportPacks(now = new Date()): Promise<{
  checkedSettings: number;
  preparedPacks: number;
  notificationsCreated: number;
}> {
  const settings = await storage.getAdminSettings();
  let checkedSettings = 0;
  let preparedPacks = 0;
  let notificationsCreated = 0;

  for (const setting of settings) {
    const companyId = companyIdFromReportPackScheduleKey(setting.key);
    if (!companyId) continue;
    checkedSettings += 1;

    const schedules = parseReportPackSchedules(setting.value);
    for (const packId of reportPackIds) {
      const schedule = schedules[packId];
      if (!isReportPackDue(schedule, now)) continue;

      try {
        const result = await prepareReportPackSchedule(companyId, packId, null, now);
        preparedPacks += 1;
        notificationsCreated += result.run.notificationCount;
      } catch (err) {
        log.error({ err, companyId, packId }, "Failed to prepare due report pack");
      }
    }
  }

  return { checkedSettings, preparedPacks, notificationsCreated };
}
