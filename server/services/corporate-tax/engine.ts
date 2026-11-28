/**
 * Corporate-tax computation engine (W4-A: R08-06..R08-08, R08-14..R08-19).
 *
 * One function, `computeReturnState`, turns a stored return plus optional
 * preparer overrides into the full liability and the workpaper fields to
 * persist. Create, compute, PATCH, pull-from-books and import all call it, so
 * ledger rows, manual adjustments, losses and elections can never diverge.
 */
import { DomainError } from "../../errors";
import {
  CT_STANDARD_RATE,
  CT_TAG_ADJUSTMENT,
  CT_ZERO_RATE_BAND,
  CtInputError,
  computeCtComputation,
  computeCtTotals,
  transferPricingFlags,
  type CtBridgeAdjustment,
  type CtComputationResult,
  type CtWorkpaperRow,
} from "../../../shared/ct-workpaper";
import { ctAdjustmentsSchema } from "../../../shared/validators/corporate-tax";
import type { CorporateTaxReturn } from "../../../shared/schema";
import { loadAccounts } from "../../reporting/ledger-query";
import type { DeferredTaxNote } from "../ct-workpaper-export.service";
import { ctFilingDeadline } from "./deadlines";
import {
  getCtProfile,
  getPriorCtFacts,
  readCtBooks,
  relatedPartyRegisterTotal,
  type CtBooksSnapshot,
} from "./repository";

/** UAE calendar date of a stored timestamp. */
export function uaeIsoDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Date(date.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

export interface CtLedgerTags {
  interestExpense: number;
  interestIncome: number;
  relatedPartyActivity: number;
  qfzpQualifyingIncome: number;
  qfzpNonQualifyingIncome: number;
  hasQfzpTags: boolean;
  corporateTaxExpenseExcluded: number;
}

export interface CtElections {
  smallBusinessReliefElected: boolean;
  depreciationAmortisation?: number;
  netInterestExpenseOverride?: number;
  qfzpQualifyingRevenue?: number;
  qfzpNonQualifyingRevenue?: number;
  qfzpNonQualifyingTaxableIncome?: number;
}

/** The workpaper JSON as persisted on corporate_tax_returns.workpaper. */
export interface CtWorkpaperState {
  source?: "manual_workpaper" | "journal_calculation";
  rows?: CtWorkpaperRow[];
  totalRevenue?: number;
  totalExpenses?: number;
  profitOrLoss?: number;
  preparedAt?: string;
  adjustments?: CtBridgeAdjustment[];
  ledgerAdjustments?: CtBridgeAdjustment[];
  ledgerTags?: CtLedgerTags;
  elections?: CtElections;
  computation?: CtComputationResult;
  transferPricing?: ReturnType<typeof transferPricingFlags> & { mneGroupRevenue: number | null };
  deferredTax?: DeferredTaxNote;
  filingDeadline?: string;
  computedAt?: string;
  [key: string]: unknown;
}

export function workpaperOf(ctReturn: Pick<CorporateTaxReturn, "workpaper">): CtWorkpaperState {
  const wp = ctReturn.workpaper;
  return wp && typeof wp === "object" && !Array.isArray(wp) ? (wp as CtWorkpaperState) : {};
}

/** Supply Arabic names for book rows saved before names were captured in the snapshot. */
export async function withLegacyWorkpaperNames(
  companyId: string,
  returns: CorporateTaxReturn[]
): Promise<CorporateTaxReturn[]> {
  const needsName = (row: CtWorkpaperRow) =>
    row.nameAr === undefined && row.id.startsWith("books-");
  const legacy = returns.filter((ctReturn) => {
    const wp = workpaperOf(ctReturn);
    return wp.source === "journal_calculation" && wp.rows?.some(needsName);
  });
  if (legacy.length === 0) return returns;

  const accounts = await loadAccounts(companyId);
  const names = new Map(accounts.map((account) => [`books-${account.id}`, account.nameAr?.trim()]));
  const workpapers = new Map(
    legacy.map((ctReturn) => {
      const wp = workpaperOf(ctReturn);
      const rows = wp.rows?.map((row) =>
        needsName(row) ? { ...row, nameAr: names.get(row.id) || null } : row
      );
      return [ctReturn.id, { ...wp, rows }] as const;
    })
  );
  return returns.map((ctReturn) => {
    const workpaper = workpapers.get(ctReturn.id);
    return workpaper ? { ...ctReturn, workpaper } : ctReturn;
  });
}

/** Validate stored or supplied adjustments with the shared schema (R08-06). */
export function parseAdjustments(raw: unknown, field = "adjustments"): CtBridgeAdjustment[] {
  if (raw === undefined || raw === null) return [];
  const parsed = ctAdjustmentsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError(
      "CT_ADJUSTMENTS_INVALID",
      400,
      { field, issues: parsed.error.issues.slice(0, 10) },
      "Adjustments must use a known category and a non-negative numeric amount"
    );
  }
  return parsed.data.map((a) => ({ ...a, source: a.source ?? "manual" })) as CtBridgeAdjustment[];
}

/** Ledger-derived adjustments from tagged accounts (entertainment, fines, donations, exempt income). */
export function ledgerAdjustmentsFromBooks(books: CtBooksSnapshot): CtBridgeAdjustment[] {
  const out: CtBridgeAdjustment[] = [];
  for (const row of books.rows) {
    if (!row.taxTag) continue;
    const category = CT_TAG_ADJUSTMENT[row.taxTag];
    const amount = row.taggedAmount ?? row.amount;
    if (!category || amount <= 0) continue;
    out.push({
      id: `ledger-${row.accountId}`,
      category,
      amount,
      label: `${row.label} (${row.notes.replace("Posted net for ", "")})`,
      source: "ledger",
      accountId: row.accountId,
    });
  }
  // WQ3 (9.16): journal lines with their own CT treatment. Non-deductible lines add back their
  // disallowed share (already applied, so "other_addback" at 100%); exempt income is deducted.
  for (const t of books.lineTreatments ?? []) {
    if (t.adjustmentFils <= 0) continue;
    const amount = Math.round(t.adjustmentFils) / 100;
    if (t.treatment === "non_deductible") {
      out.push({
        id: `ledger-line-${t.accountId}-nd-${t.pct}`,
        category: "other_addback",
        amount,
        label: `${t.accountName} (${t.accountCode}): journal lines ${t.pct}% non-deductible`.slice(
          0,
          200
        ),
        source: "ledger",
        accountId: t.accountId,
      });
    } else if (t.treatment === "exempt_income") {
      out.push({
        id: `ledger-line-${t.accountId}-exempt`,
        category: "exempt_income",
        amount,
        label: `${t.accountName} (${t.accountCode}): journal lines marked exempt income`.slice(
          0,
          200
        ),
        source: "ledger",
        accountId: t.accountId,
      });
    }
  }
  return out;
}

export function ledgerTagsFromBooks(books: CtBooksSnapshot): CtLedgerTags {
  return { ...books.tags };
}

export interface ComputeOverrides {
  adjustments?: CtBridgeAdjustment[];
  smallBusinessReliefElected?: boolean;
  interest?: { netInterestExpense?: number; depreciationAmortisation?: number };
  qfzp?: {
    qualifyingRevenue?: number;
    nonQualifyingRevenue?: number;
    nonQualifyingTaxableIncome?: number;
  };
  /** Replace the figures (pull-from-books / import / PATCH). */
  totals?: { totalRevenue: number; totalExpenses: number };
  rows?: CtWorkpaperRow[];
  source?: "manual_workpaper" | "journal_calculation";
  books?: CtBooksSnapshot;
  totalDeductions?: number;
  periodStart?: string;
  periodEnd?: string;
}

export interface ComputedReturnState {
  computation: CtComputationResult;
  update: Partial<CorporateTaxReturn>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Deferred-tax note (R08-19): temporary differences at 9%, never posted. */
export function deferredTaxNote(
  computation: CtComputationResult,
  adjustments: CtBridgeAdjustment[]
): DeferredTaxNote {
  const rate = CT_STANDARD_RATE;
  const items: DeferredTaxNote["items"] = [];
  const unrealised = adjustments
    .filter((a) => a.category === "unrealized_gains")
    .reduce((s, a) => s + a.amount, 0);
  if (unrealised > 0) {
    items.push({
      key: "unrealised_gains",
      label: "Unrealised gains deferred under the realisation basis",
      labelAr: "أرباح غير محققة مؤجلة وفق أساس التحقق",
      amount: r2(unrealised),
      kind: "liability",
      deferredTax: r2(-unrealised * rate),
    });
  }
  if (computation.lossCarriedForward > 0) {
    items.push({
      key: "tax_losses",
      label: "Unused tax losses carried forward",
      labelAr: "خسائر ضريبية غير مستخدمة مرحلة",
      amount: computation.lossCarriedForward,
      kind: "asset",
      deferredTax: r2(computation.lossCarriedForward * rate),
    });
  }
  const interestCf = computation.interestLimitation?.carriedForwardOut ?? 0;
  if (interestCf > 0) {
    items.push({
      key: "interest_carried_forward",
      label: "Disallowed net interest carried forward",
      labelAr: "صافي الفوائد غير المسموح بها المرحلة",
      amount: interestCf,
      kind: "asset",
      deferredTax: r2(interestCf * rate),
    });
  }
  return { items, net: r2(items.reduce((s, i) => s + i.deferredTax, 0)), rate };
}

/**
 * Recompute a return from its stored state plus overrides. Manual
 * adjustments, elections and losses are preserved unless overridden; ledger
 * rows and ledger-derived adjustments are replaced only when new books are
 * supplied (R08-08).
 */
export async function computeReturnState(
  ctReturn: CorporateTaxReturn,
  overrides: ComputeOverrides = {}
): Promise<ComputedReturnState> {
  const wp = workpaperOf(ctReturn);
  const periodStart = overrides.periodStart ?? uaeIsoDate(ctReturn.taxPeriodStart);
  const periodEnd = overrides.periodEnd ?? uaeIsoDate(ctReturn.taxPeriodEnd);

  const adjustments =
    overrides.adjustments ?? parseAdjustments(wp.adjustments, "stored adjustments");
  const books = overrides.books;
  const ledgerAdjustments = books
    ? ledgerAdjustmentsFromBooks(books)
    : parseAdjustments(wp.ledgerAdjustments, "stored ledgerAdjustments");
  const ledgerTags: CtLedgerTags | undefined = books ? ledgerTagsFromBooks(books) : wp.ledgerTags;

  const previousElections: CtElections = wp.elections ?? {
    smallBusinessReliefElected: ctReturn.smallBusinessRelief === true,
  };
  const elections: CtElections = {
    ...previousElections,
    smallBusinessReliefElected:
      overrides.smallBusinessReliefElected ?? previousElections.smallBusinessReliefElected,
  };
  if (overrides.interest?.depreciationAmortisation !== undefined) {
    elections.depreciationAmortisation = overrides.interest.depreciationAmortisation;
  }
  if (overrides.interest?.netInterestExpense !== undefined) {
    elections.netInterestExpenseOverride = overrides.interest.netInterestExpense;
  }
  if (overrides.qfzp?.qualifyingRevenue !== undefined) {
    elections.qfzpQualifyingRevenue = overrides.qfzp.qualifyingRevenue;
  }
  if (overrides.qfzp?.nonQualifyingRevenue !== undefined) {
    elections.qfzpNonQualifyingRevenue = overrides.qfzp.nonQualifyingRevenue;
  }
  if (overrides.qfzp?.nonQualifyingTaxableIncome !== undefined) {
    elections.qfzpNonQualifyingTaxableIncome = overrides.qfzp.nonQualifyingTaxableIncome;
  }

  const rows = overrides.rows ?? wp.rows;
  const totals = overrides.totals ?? {
    totalRevenue: Number(ctReturn.totalRevenue) || 0,
    totalExpenses: Number(ctReturn.totalExpenses) || 0,
  };
  const totalDeductions = overrides.totalDeductions ?? (Number(ctReturn.totalDeductions) || 0);

  const [prior, profile] = await Promise.all([
    getPriorCtFacts(ctReturn.companyId, periodStart, ctReturn.id),
    getCtProfile(ctReturn.companyId),
  ]);

  const netInterest =
    elections.netInterestExpenseOverride ??
    (ledgerTags ? r2(ledgerTags.interestExpense - ledgerTags.interestIncome) : 0);

  let qfzp = null;
  if (profile.isQfzp) {
    const qualifying =
      elections.qfzpQualifyingRevenue ??
      (ledgerTags?.hasQfzpTags ? ledgerTags.qfzpQualifyingIncome : 0);
    const nonQualifying =
      elections.qfzpNonQualifyingRevenue ??
      // Untagged revenue is treated as non-qualifying until classified.
      r2(Math.max(0, totals.totalRevenue - qualifying));
    qfzp = {
      elected: true,
      qualifyingRevenue: qualifying,
      nonQualifyingRevenue: nonQualifying,
      nonQualifyingTaxableIncome: elections.qfzpNonQualifyingTaxableIncome,
    };
  }

  let computation: CtComputationResult;
  try {
    computation = computeCtComputation({
      totalRevenue: totals.totalRevenue,
      totalExpenses: totals.totalExpenses,
      totalDeductions,
      adjustments: [...ledgerAdjustments, ...adjustments],
      lossBroughtForward: prior.lossBroughtForward,
      smallBusinessReliefElected: elections.smallBusinessReliefElected,
      priorPeriodsExceededRevenueCap: prior.priorPeriodsExceededRevenueCap,
      taxPeriodEnd: periodEnd,
      interest:
        netInterest !== 0 || prior.interestCarriedForward > 0
          ? {
              netInterestExpense: netInterest,
              depreciationAmortisation: elections.depreciationAmortisation ?? 0,
              carriedForwardIn: prior.interestCarriedForward,
            }
          : null,
      qfzp,
      exemptionThreshold: CT_ZERO_RATE_BAND,
      taxRate: CT_STANDARD_RATE,
    });
  } catch (err) {
    if (err instanceof CtInputError) throw new DomainError(err.code, 400, undefined, err.message);
    throw err;
  }

  const registerTotal = await relatedPartyRegisterTotal(
    ctReturn.companyId,
    Number(periodEnd.slice(0, 4))
  );
  const tp = transferPricingFlags({
    relatedPartyTransactionsTotal: registerTotal + (ledgerTags?.relatedPartyActivity ?? 0),
    revenue: totals.totalRevenue,
    mneGroupRevenue: profile.mneGroupRevenue,
  });

  const now = new Date().toISOString();
  const workpaper: CtWorkpaperState = {
    ...wp,
    ...(rows ? { rows, ...computeCtTotals(rows) } : {}),
    ...(overrides.source ? { source: overrides.source, preparedAt: now } : {}),
    adjustments,
    ledgerAdjustments,
    ...(ledgerTags ? { ledgerTags } : {}),
    elections,
    computation,
    transferPricing: { ...tp, mneGroupRevenue: profile.mneGroupRevenue },
    deferredTax: deferredTaxNote(computation, [...ledgerAdjustments, ...adjustments]),
    filingDeadline: ctFilingDeadline(periodEnd),
    adviserReviewPending: profile.adviserReviewPending,
    computedAt: now,
  };
  // Totals always mirror the figures the computation used.
  workpaper.totalRevenue = r2(totals.totalRevenue);
  workpaper.totalExpenses = r2(totals.totalExpenses);
  workpaper.profitOrLoss = r2(totals.totalRevenue - totals.totalExpenses);

  const update: Partial<CorporateTaxReturn> = {
    totalRevenue: r2(totals.totalRevenue),
    totalExpenses: r2(totals.totalExpenses),
    totalDeductions,
    taxableIncome: computation.taxableIncome,
    taxPayable: computation.taxPayable,
    exemptionThreshold: computation.exemptionThreshold,
    taxRate: CT_STANDARD_RATE,
    lossBroughtForward: computation.lossBroughtForward,
    lossCarriedForward: computation.lossCarriedForward,
    interestCarriedForward: computation.interestLimitation?.carriedForwardOut ?? 0,
    smallBusinessRelief: computation.smallBusinessRelief.applied,
    workpaper,
  };
  return { computation, update };
}

/** Books snapshot → figures + rows for the workpaper (pull-from-books). */
export async function booksOverrides(
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<Pick<ComputeOverrides, "books" | "rows" | "totals" | "source">> {
  const books = await readCtBooks(companyId, periodStart, periodEnd);
  const rows: CtWorkpaperRow[] = books.rows.map((r) => ({
    id: r.id,
    type: r.type,
    label: r.label,
    nameAr: r.nameAr,
    amount: r.amount,
    notes: r.notes,
  }));
  const t = computeCtTotals(rows);
  return {
    books,
    rows,
    totals: { totalRevenue: t.totalRevenue, totalExpenses: t.totalExpenses },
    source: "journal_calculation",
  };
}
