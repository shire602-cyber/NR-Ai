// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { type VatRowCategory } from "@/lib/vat-workpaper-grid";
import type { Company } from "@shared/schema";
import { type ClientServiceCode, type ClientServicePlan } from "@shared/client-services";

export interface ClientStats {
  invoiceCount: number;
  invoiceTotal: number;
  outstandingAr: number;
  overdueAr?: number;
  lastReceiptDate: string | null;
  lastBankActivityDate: string | null;
  vatStatus: {
    status: string;
    dueDate: string;
    periodEnd: string;
  } | null;
  assignedStaff: { id: string; name: string; email: string; role: string }[];
}

export type ClientWithStats = Company &
  ClientStats & {
    serviceScope?: ClientServiceCode[];
    servicePlan?: ClientServicePlan;
  };

export interface FirmOverview {
  totalClients: number;
  vatDueThisMonth: number;
  overdueAr: number;
  needsAttention: number;
  missingDocuments: number;
}

export type BookkeeperPriority = "on_track" | "attention" | "critical";
export type BookkeeperInterventionLevel = "low" | "medium" | "high";

export interface BookkeeperClient {
  companyId: string;
  companyName: string;
  trn: string | null;
  serviceScope: ClientServiceCode[];
  servicePlan?: ClientServicePlan;
  assignedStaff: { id: string; name: string; email: string; role: string }[];
  priority: BookkeeperPriority;
  nextBestAction: string;
  intervention?: {
    score: number;
    level: BookkeeperInterventionLevel;
    title: string;
    reasons: string[];
    ownerAction: string;
    deadlineLabel: string;
    exposureAed: number;
  };
  lastActivity: string | null;
  vat: {
    cohortKey: string;
    cohortLabel: string;
    closeMonths: number[];
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    payableTax: number | null;
    blockers: string[];
  };
  corporateTax: {
    periodStart: string | null;
    periodEnd: string | null;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    taxPayable: number | null;
    blockers: string[];
  };
  bookkeeping: {
    closeProgress: number;
    status: BookkeeperPriority;
    blockers: string[];
    openAr: number;
    overdueInvoiceCount: number;
    missingCustomerTrnCount: number;
    unpostedReceiptCount: number;
    unreconciledBankCount: number;
    daysSinceActivity: number | null;
  };
  accounting: {
    status: BookkeeperPriority;
    trialBalanceBalanced: boolean;
    discrepancy: number;
    blockers: string[];
  };
}

export interface BookkeeperVatCohort {
  key: string;
  label: string;
  closeMonths: number[];
  closeMonthLabels: string[];
  clientCount: number;
  dueSoon: number;
  blocked: number;
  ready: number;
  clients: {
    companyId: string;
    companyName: string;
    priority: BookkeeperPriority;
    dueDate: string | null;
    daysTilDue: number | null;
    status: BookkeeperPriority | "filed";
    blockers: string[];
    nextBestAction: string;
  }[];
}

export type BookkeeperQueueKey = "vat" | "corporateTax" | "bookkeeping" | "accounting";

export interface BookkeeperQueueItem {
  companyId: string;
  companyName: string;
  priority: BookkeeperPriority;
  ownerNames: string[];
  dueDate: string | null;
  daysTilDue: number | null;
  metric: string;
  action: string;
  blockers: string[];
}

export interface BookkeeperWorkloadOwner {
  staffId: string | null;
  name: string;
  email: string | null;
  clientCount: number;
  critical: number;
  attention: number;
  vatDue28Days: number;
  corporateTaxDue90Days: number;
  bookkeepingBlocked: number;
  averageCloseProgress: number;
}

export interface BookkeeperDashboard {
  generatedAt: string;
  summary: {
    totalClients: number;
    critical: number;
    attention: number;
    onTrack: number;
    vatDue28Days: number;
    corporateTaxDue90Days: number;
    bookkeepingBlocked: number;
    interventionHigh?: number;
    interventionMedium?: number;
  };
  serviceMatrix?: Array<{
    code: ClientServiceCode;
    label: string;
    shortLabel: string;
    clientCount: number;
    critical: number;
    attention: number;
  }>;
  vatCohorts: BookkeeperVatCohort[];
  queues?: Record<BookkeeperQueueKey, BookkeeperQueueItem[]>;
  workload?: {
    owners: BookkeeperWorkloadOwner[];
    unassignedClients: number;
    overloadedStaff: number;
  };
  clients: BookkeeperClient[];
}

export type GrowthOpportunityStatus = "open" | "accepted" | "snoozed" | "dismissed" | "completed";

export interface GrowthOpportunity {
  id: string;
  companyId: string;
  companyName: string | null;
  opportunityType: string;
  sourceSignal: string;
  title: string;
  reason: string;
  estimatedValue: number;
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  status: GrowthOpportunityStatus;
  ownerUserId: string | null;
  dueDate: string | null;
  snoozedUntil: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthDashboard {
  summary: {
    estimated: number;
    accepted: number;
    completed: number;
    missed: number;
    openCount: number;
  };
  opportunities: GrowthOpportunity[];
}

export interface VatWorkpaperSummary {
  id: string;
  companyId: string;
  companyName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  generatedVatReturnId: string | null;
  totalsSnapshot: Record<string, number>;
  updatedAt: string;
}

export interface VatWorkpaperRow {
  id: string;
  rowCategory: VatRowCategory;
  vat201Box: string;
  invoiceNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyTrn: string | null;
  emirate: string | null;
  taxableAmount: number;
  vatAmount: number;
  adjustmentAmount: number;
  grossAmount: number;
  status: "draft" | "approved" | "excluded";
  sourceMethod: "manual" | "ocr" | "import" | "generated";
  notes: string | null;
  auditReason: string | null;
  journalEntryId: string | null;
}

export const POSTABLE_VAT_CATEGORIES = [
  "standard_sale",
  "zero_rated_sale",
  "exempt_sale",
  "standard_expense",
  "reverse_charge_input",
  "import",
];

export interface VatWorkpaperAttachment {
  id: string;
  rowId: string | null;
  fileName: string;
  mimeType: string;
  filePath: string | null;
  extractedText: string | null;
  createdAt: string;
}

export interface VatWorkpaperDetail {
  workpaper: VatWorkpaperSummary;
  company: { id: string; name: string; trnVatNumber: string | null } | null;
  rows: VatWorkpaperRow[];
  attachments: VatWorkpaperAttachment[];
  totals: Record<string, number>;
}
