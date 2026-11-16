// Additional types for the frontend and report shapes.
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import { z } from "zod";
import type { Account, JournalEntry, JournalLine } from "./ledger";
import type { Invoice, InvoiceLine } from "./sales";
import type { InvoicePayment } from "./payments";

// ===========================
// Additional Types for Frontend
// ===========================

// Complete invoice with lines and payments
export interface InvoiceWithLines extends Invoice {
  lines: InvoiceLine[];
  payments?: InvoicePayment[];
}

// Complete journal entry with lines
export interface JournalEntryWithLines extends JournalEntry {
  lines: (JournalLine & { account: Account })[];
}

// AI Categorization Request/Response
export const categorizationRequestSchema = z.object({
  companyId: z.string().uuid(),
  description: z.string().min(1),
  amount: z.number(),
  currency: z.string().default("AED"),
});

export type CategorizationRequest = z.infer<typeof categorizationRequestSchema>;

export interface CategorizationResponse {
  suggestedAccountCode: string;
  suggestedAccountName: string;
  confidence: number;
  reason: string;
}

// Financial Reports Types
export interface ProfitLossReport {
  revenue: { accountCode: string; accountName: string; amount: number }[];
  expenses: { accountCode: string; accountName: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export interface BalanceSheetReport {
  assets: { accountCode: string; accountName: string; amount: number }[];
  liabilities: { accountCode: string; accountName: string; amount: number }[];
  equity: { accountCode: string; accountName: string; amount: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface VATSummaryReport {
  period: string;
  salesSubtotal: number;
  salesVAT: number;
  purchasesSubtotal: number;
  purchasesVAT: number;
  netVATPayable: number;
}

export interface UnrealizedFxGainLoss {
  entityType: "invoice" | "payable";
  entityId: string;
  entityNumber: string;
  counterparty: string;
  currency: string;
  foreignAmount: number;
  transactionRate: number; // Rate when transaction was recorded
  currentRate: number; // Latest known rate
  bookValueAed: number; // Value at transaction rate
  currentValueAed: number; // Value at current rate
  unrealizedGainLoss: number; // Positive = gain, negative = loss
}

export interface FxGainsLossesReport {
  asOf: string;
  baseCurrency: string;
  receivables: UnrealizedFxGainLoss[];
  payables: UnrealizedFxGainLoss[];
  totalUnrealizedGain: number;
  totalUnrealizedLoss: number;
  netUnrealizedGainLoss: number;
}
