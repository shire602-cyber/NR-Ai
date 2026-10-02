// The dashboard numbers (Phase 8 D4, docs/KPI_DEFINITIONS.md): one period, five ageing buckets for receivables and
// payables, an overdue figure and the next VAT payment. Pure helpers so the Dashboard, the AI CFO and the smart
// assistant read the same keys and a missing or odd value never renders NaN.

export const DASHBOARD_PERIODS = ["month", "ytd"] as const;
export type DashboardPeriodKind = (typeof DASHBOARD_PERIODS)[number];

export const AGEING_BUCKET_KEYS = [
  "current",
  "days1to30",
  "days31to60",
  "days61to90",
  "days90plus",
] as const;
export type AgeingBucketKey = (typeof AGEING_BUCKET_KEYS)[number];
export type AgeingBuckets = Record<AgeingBucketKey, number>;

export interface VatDueNext {
  amount: number | null;
  periodEnd: string | null;
  dueDate: string | null;
  reason?: "NO_TRN" | "EMIRATE_NOT_SET" | "UNAVAILABLE";
}

export interface DashboardStats {
  period?: { kind: DashboardPeriodKind | "custom"; from: string; to: string };
  revenue?: number;
  expenses?: number;
  netProfit?: number;
  outstanding?: number;
  overdueReceivables?: number;
  receivablesMissingDueDate?: number;
  payablesOutstanding?: number;
  cashPosition?: number;
  monthlyBurnRate?: number;
  cashRunway?: number | null;
  arAging?: Partial<Record<string, number>>;
  apAging?: Partial<Record<string, number>>;
  revenueGrowth?: number | null;
  expenseGrowth?: number | null;
  totalInvoices?: number;
  totalEntries?: number;
  vatDueNext?: VatDueNext | null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The five buckets as numbers; a missing key (an older response) is 0, never undefined or NaN. */
export function normalizeBuckets(
  raw: Partial<Record<string, number>> | null | undefined
): AgeingBuckets {
  return {
    current: num(raw?.current),
    days1to30: num(raw?.days1to30),
    days31to60: num(raw?.days31to60),
    days61to90: num(raw?.days61to90),
    days90plus: num(raw?.days90plus),
  };
}

export const bucketTotal = (b: AgeingBuckets): number =>
  AGEING_BUCKET_KEYS.reduce((sum, k) => sum + b[k], 0);

/** Everything due before today: all buckets but `current`. */
export const overdueOfBuckets = (b: AgeingBuckets): number =>
  b.days1to30 + b.days31to60 + b.days61to90 + b.days90plus;

export type VatDueView =
  | { kind: "amount"; amount: number; periodEnd: string; dueDate: string }
  | { kind: "none"; reason: "NO_TRN" | "EMIRATE_NOT_SET" | "UNAVAILABLE" };

export function vatDueView(raw: VatDueNext | null | undefined): VatDueView {
  if (
    raw &&
    typeof raw.amount === "number" &&
    Number.isFinite(raw.amount) &&
    raw.dueDate &&
    raw.periodEnd
  ) {
    return { kind: "amount", amount: raw.amount, periodEnd: raw.periodEnd, dueDate: raw.dueDate };
  }
  const reason =
    raw?.reason === "NO_TRN" || raw?.reason === "EMIRATE_NOT_SET" ? raw.reason : "UNAVAILABLE";
  return { kind: "none", reason };
}

/** Whole days from `today` to `day` (both YYYY-MM-DD): negative once past. */
export function daysUntil(day: string, today: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  );
}

export const dashboardStatsPath = (companyId: string, period: DashboardPeriodKind): string =>
  `/api/companies/${companyId}/dashboard/stats?period=${period}`;

/** Profit as a percent of revenue; null (shown as a dash) when there is no revenue to measure it against. */
export function marginPercent(profit: number, revenue: number | null | undefined): number | null {
  return typeof revenue === "number" && Number.isFinite(revenue) && revenue > 0
    ? (profit / revenue) * 100
    : null;
}
