/** Shape of GET /api/companies/:companyId/dashboard/stats (server/services/dashboard-stats.service.ts). */
export interface DashboardPeriodSummary {
  from: string | null;
  to: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  margin: number | null;
}

export interface DashboardOverdueDocument {
  documentId: string;
  number: string | null;
  name: string;
  dueDate: string;
  daysPastDue: number;
  open: number;
}

export interface DashboardStats {
  asOf: string;
  period: {
    preset: "month" | "quarter" | "ytd" | "custom";
    from: string;
    to: string;
    label: string;
  };
  revenue: number;
  expenses: number;
  netProfit: number;
  margin: number | null;
  current: DashboardPeriodSummary;
  prior: DashboardPeriodSummary;
  priorYear: DashboardPeriodSummary;
  changes: {
    vsPrior: { revenue: number | null; expenses: number | null; netProfit: number | null };
    vsPriorYear: { revenue: number | null; expenses: number | null; netProfit: number | null };
  };
  outstanding: number;
  outstandingPayables: number;
  cashPosition: number;
  monthlyBurnRate: number;
  cashRunway: number | null;
  dso: number | null;
  dpo: number | null;
  arAging: Record<"current" | "days0to30" | "days31to60" | "days61to90" | "days90plus", number>;
  apAging: Record<"current" | "days0to30" | "days31to60" | "days61to90" | "days90plus", number>;
  cashInOut: Array<{
    period: string;
    inflow: number;
    outflow: number;
    net: number;
    endingBalance: number;
  }>;
  bankVsGl: {
    glCashTotal: number;
    statementTotal: number;
    accounts: Array<{
      bankAccountId: string;
      name: string;
      /** X6a: amounts are in the bank account's own currency. */
      currency?: string;
      /** X6a: false when no statement is imported (no statement balance, no difference). */
      hasStatement?: boolean;
      statementBalance: number | null;
      glBalance: number | null;
      difference: number | null;
    }>;
  };
  topOverdue: { receivables: DashboardOverdueDocument[]; payables: DashboardOverdueDocument[] };
  vat: { source: "ledger"; outputVat: number; inputVat: number; netPayable: number };
  corporateTax: {
    source: "ledger";
    periodFrom: string;
    periodTo: string;
    revenue: number;
    expenses: number;
    taxableIncome: number;
    estimatedLiability: number;
  };
  links: Record<
    | "revenue"
    | "expenses"
    | "netProfit"
    | "outstanding"
    | "overdue"
    | "payables"
    | "cash"
    | "vat"
    | "corporateTax"
    | "journal",
    string
  >;
}

export interface BudgetVsActualRow {
  budgetId: string;
  lineId: string;
  accountId: string;
  accountName: string;
  accountNameAr?: string | null;
  accountType: string | null;
  budgeted: number;
  actual: number;
  variance: number;
  variancePercent: number;
  favourable: boolean;
}
