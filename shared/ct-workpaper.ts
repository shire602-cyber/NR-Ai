/**
 * Corporate-tax workpaper grid helpers — shared between the client editor
 * and the server's .xlsx import so the two can never drift (same pattern as
 * shared/vat-workpaper-grid.ts).
 */

export type CtWorkpaperRowType = "revenue" | "expense";

export interface CtWorkpaperRow {
  id: string;
  label: string;
  nameAr?: string | null;
  type: CtWorkpaperRowType;
  amount: number;
  notes?: string;
}

export interface CtWorkpaperTotals {
  totalRevenue: number;
  totalExpenses: number;
  profitOrLoss: number;
}

function compactKey(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseDelimitedLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function moneyFromCell(value: string | undefined): number {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function normalizeCtRowType(value: string | undefined): CtWorkpaperRowType {
  const normalized = compactKey(value);
  if (
    normalized.includes("revenue") ||
    normalized.includes("income") ||
    normalized.includes("sales") ||
    normalized === "rev"
  ) {
    return "revenue";
  }
  return "expense";
}

const HEADER_ALIASES: Record<string, string[]> = {
  type: ["type", "row type", "category"],
  label: ["label", "description", "item", "line item", "account", "name"],
  amount: ["amount", "amount aed", "value", "total"],
  notes: ["notes", "memo", "remarks", "comment"],
};

function headerIndex(headerCells: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = new Set(HEADER_ALIASES[field].map(compactKey));
  return headerCells.findIndex((cell) => aliases.has(compactKey(cell)));
}

function hasRecognisedHeader(cells: string[]): boolean {
  return (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).some(
    (key) => headerIndex(cells, key) >= 0
  );
}

function pickCell(
  cells: string[],
  headerCells: string[] | null,
  field: keyof typeof HEADER_ALIASES,
  fallbackIndex: number
): string | undefined {
  if (headerCells) {
    const index = headerIndex(headerCells, field);
    return index >= 0 ? cells[index] : undefined;
  }
  return cells[fallbackIndex];
}

/**
 * Parses tab-delimited (Excel paste) or CSV rows into workpaper rows.
 * Column order without headers: type, label, amount, notes.
 */
export function parseCtPasteRows(text: string): CtWorkpaperRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = parseDelimitedLine(lines[0]);
  const headerCells = hasRecognisedHeader(firstCells) ? firstCells : null;
  const rows = headerCells ? lines.slice(1) : lines;

  return rows
    .map((line, index) => {
      const cells = parseDelimitedLine(line);
      const label = pickCell(cells, headerCells, "label", 1) ?? "";
      const amount = moneyFromCell(pickCell(cells, headerCells, "amount", 2));
      return {
        id: `import-${Date.now()}-${index}`,
        type: normalizeCtRowType(pickCell(cells, headerCells, "type", 0)),
        label: label || `Imported row ${index + 1}`,
        amount,
        notes: pickCell(cells, headerCells, "notes", 3) || undefined,
      };
    })
    .filter((row) => row.label.trim().length > 0 && row.amount !== 0);
}

export function computeCtTotals(
  rows: Array<Pick<CtWorkpaperRow, "type" | "amount">>
): CtWorkpaperTotals {
  const totalRevenue = rows
    .filter((row) => row.type === "revenue")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const totalExpenses = rows
    .filter((row) => row.type === "expense")
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    profitOrLoss: Math.round((totalRevenue - totalExpenses) * 100) / 100,
  };
}

/** UAE corporate tax computation from workpaper totals. */
export function computeCtLiability(input: {
  totalRevenue: number;
  totalExpenses: number;
  totalDeductions?: number;
  exemptionThreshold?: number;
  taxRate?: number;
}): {
  taxableIncome: number;
  taxableAmount: number;
  taxPayable: number;
  exemptionThreshold: number;
  taxRate: number;
} {
  // A-B7: single source of truth. Delegate to the full FTA computation so every
  // corporate-tax path (preview, xlsx import, export, filing) applies the same
  // rules — the AED 375,000 zero-rate band and, when supplied, add-backs, small
  // business relief and the 75% loss-relief cap. For the simple inputs accepted
  // here the result is identical to the former standalone formula (no
  // adjustments, no loss, no relief), with taxable income floored at zero in a
  // loss period (carried forward) rather than reported negative.
  const r = computeCtComputation({
    totalRevenue: input.totalRevenue,
    totalExpenses: input.totalExpenses,
    totalDeductions: input.totalDeductions,
    exemptionThreshold: input.exemptionThreshold,
    taxRate: input.taxRate,
  });
  return {
    taxableIncome: r.taxableIncome,
    taxableAmount: r.taxableAmount,
    taxPayable: r.taxPayable,
    exemptionThreshold: r.exemptionThreshold,
    taxRate: r.taxRate,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Full taxable-profit bridge (Federal Decree-Law 47 of 2022)
// Every rule below names its legal source; docs/corporate-tax-rules.md is the
// reviewed index. The module is flagged "adviser review pending" in the UI
// until a company records an adviser confirmation.
// ───────────────────────────────────────────────────────────────────────────

/** Art. 21 + Ministerial Decision 73/2023: relief available while revenue ≤ AED 3M. */
export const CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP = 3_000_000;
/** MD 73/2023 Art. 6: relief only for tax periods ending on or before 31 Dec 2026 (R08-14). */
export const CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END = "2026-12-31";
/** Art. 37(2): carried-forward losses offset at most 75% of taxable income. */
export const CT_LOSS_OFFSET_LIMIT = 0.75;
/** Cabinet Decision 116/2022: 0% band on the first AED 375,000. */
export const CT_ZERO_RATE_BAND = 375_000;
/** Art. 3(1)(b): standard rate above the band. Never client-set. */
export const CT_STANDARD_RATE = 0.09;
/** Art. 30 + MD 126/2023: net interest capped at 30% of tax-EBITDA ... */
export const CT_INTEREST_EBITDA_SHARE = 0.3;
/** ... or the AED 12,000,000 safe harbour, whichever is greater. */
export const CT_INTEREST_SAFE_HARBOUR = 12_000_000;
/** Cabinet Decision 100/2023 Art. 3 + MD 265/2023: QFZP de minimis (5% / AED 5M). */
export const CT_QFZP_DE_MINIMIS_SHARE = 0.05;
export const CT_QFZP_DE_MINIMIS_CAP = 5_000_000;
/** MD 97/2023: TP disclosure form when related-party transactions exceed AED 40M. */
export const CT_TP_DISCLOSURE_THRESHOLD = 40_000_000;
/** MD 97/2023 Art. 3: Master/Local File when revenue ≥ AED 200M ... */
export const CT_TP_LOCAL_FILE_REVENUE_THRESHOLD = 200_000_000;
/** ... or the person is in an MNE group with consolidated revenue ≥ AED 3.15bn. */
export const CT_TP_MNE_GROUP_REVENUE_THRESHOLD = 3_150_000_000;

export type CtAdjustmentDirection = "add" | "deduct";

interface CtAdjustmentCategoryDef {
  label: string;
  labelAr: string;
  direction: CtAdjustmentDirection;
  /** Share of the entered amount that is added back / deducted (R08-07). */
  rate: number;
  source: string;
}

export const CT_ADJUSTMENT_CATEGORIES = {
  entertainment_50: {
    label: "Client entertainment (50% disallowed)",
    labelAr: "ضيافة العملاء (50٪ غير قابلة للخصم)",
    direction: "add",
    rate: 0.5,
    source: "FDL 47/2022 Art. 32",
  },
  fines_penalties: {
    label: "Fines and penalties",
    labelAr: "الغرامات والجزاءات",
    direction: "add",
    rate: 1,
    source: "FDL 47/2022 Art. 33(4)",
  },
  non_approved_donations: {
    label: "Donations to non-approved entities",
    labelAr: "تبرعات لجهات غير معتمدة",
    direction: "add",
    rate: 1,
    source: "FDL 47/2022 Art. 33(3)",
  },
  related_party_excess: {
    label: "Related-party payments above arm's length",
    labelAr: "مدفوعات لأطراف ذات علاقة تتجاوز السعر المحايد",
    direction: "add",
    rate: 1,
    source: "FDL 47/2022 Art. 34-36",
  },
  owner_drawings: {
    label: "Owner drawings / non-business expenses",
    labelAr: "مسحوبات المالك / مصروفات غير تجارية",
    direction: "add",
    rate: 1,
    source: "FDL 47/2022 Art. 28",
  },
  other_addback: {
    label: "Other add-back",
    labelAr: "إضافة أخرى",
    direction: "add",
    rate: 1,
    source: "FDL 47/2022 Art. 20",
  },
  exempt_income: {
    label: "Exempt income (participation/foreign PE)",
    labelAr: "دخل معفى (المشاركة / منشأة دائمة أجنبية)",
    direction: "deduct",
    rate: 1,
    source: "FDL 47/2022 Art. 22-24",
  },
  unrealized_gains: {
    label: "Unrealised gains (realisation basis election)",
    labelAr: "أرباح غير محققة (اختيار أساس التحقق)",
    direction: "deduct",
    rate: 1,
    source: "FDL 47/2022 Art. 20(3)",
  },
  other_deduction: {
    label: "Other deduction",
    labelAr: "خصم آخر",
    direction: "deduct",
    rate: 1,
    source: "FDL 47/2022 Art. 20",
  },
} as const satisfies Record<string, CtAdjustmentCategoryDef>;

export type CtAdjustmentCategory = keyof typeof CT_ADJUSTMENT_CATEGORIES;
export const CT_ADJUSTMENT_CATEGORY_KEYS = Object.keys(
  CT_ADJUSTMENT_CATEGORIES
) as CtAdjustmentCategory[];

export function isCtAdjustmentCategory(value: unknown): value is CtAdjustmentCategory {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CT_ADJUSTMENT_CATEGORIES, value)
  );
}

/**
 * Account tax tags (accounts.tax_tag) that drive automatic adjustments when
 * the workpaper is pulled from the books (R08-18).
 */
export const CT_ACCOUNT_TAX_TAGS = [
  "entertainment",
  "fines_penalties",
  "donations_non_qualifying",
  "related_party",
  "exempt_income",
  "interest",
  "qfzp_qualifying_income",
  "qfzp_non_qualifying_income",
  "corporate_tax_expense",
  "corporate_tax_payable",
] as const;
export type CtAccountTaxTag = (typeof CT_ACCOUNT_TAX_TAGS)[number];

/** Tag → adjustment category for the account-driven add-backs/deductions. */
export const CT_TAG_ADJUSTMENT: Partial<Record<CtAccountTaxTag, CtAdjustmentCategory>> = {
  entertainment: "entertainment_50",
  fines_penalties: "fines_penalties",
  donations_non_qualifying: "non_approved_donations",
  exempt_income: "exempt_income",
};

export interface CtBridgeAdjustment {
  id: string;
  category: CtAdjustmentCategory;
  label?: string;
  /** Non-negative AED amount as entered; the category fixes sign and share. */
  amount: number;
  notes?: string;
  /** "manual" (preparer) or "ledger" (derived from a tagged account). */
  source?: "manual" | "ledger";
  accountId?: string;
}

export interface CtInterestInput {
  /** Interest expense less interest income for the period (may be negative). */
  netInterestExpense: number;
  /** Depreciation and amortisation deducted in arriving at taxable income. */
  depreciationAmortisation?: number;
  /** Disallowed net interest carried forward from earlier periods. */
  carriedForwardIn?: number;
}

export interface CtQfzpInput {
  /** The company is a Qualifying Free Zone Person for the period. */
  elected: boolean;
  qualifyingRevenue: number;
  nonQualifyingRevenue: number;
  /** Optional preparer allocation; defaults to a revenue-proportional split. */
  nonQualifyingTaxableIncome?: number;
}

export interface CtComputationInput {
  totalRevenue: number;
  totalExpenses: number;
  /** Legacy flat deduction kept for back-compat with older returns. */
  totalDeductions?: number;
  adjustments?: CtBridgeAdjustment[];
  /** Positive pool of unused prior-period tax losses. */
  lossBroughtForward?: number;
  smallBusinessReliefElected?: boolean;
  /**
   * A-B16: Small Business Relief (MD 73/2023) requires revenue NOT to exceed
   * the AED 3M cap in the current period AND in every prior period.
   */
  priorPeriodsExceededRevenueCap?: boolean;
  /** Tax period end (YYYY-MM-DD); drives the SBR sunset (R08-14). */
  taxPeriodEnd?: string;
  interest?: CtInterestInput | null;
  qfzp?: CtQfzpInput | null;
  exemptionThreshold?: number;
  taxRate?: number;
}

export interface CtBridgeLine {
  key: string;
  label: string;
  amount: number;
}

export interface CtInterestLimitationResult {
  netInterestExpense: number;
  depreciationAmortisation: number;
  taxEbitda: number;
  ebitdaCap: number;
  safeHarbour: number;
  capacity: number;
  disallowed: number;
  carriedForwardIn: number;
  carriedForwardUtilised: number;
  carriedForwardOut: number;
  source: string;
}

export interface CtQfzpResult {
  elected: boolean;
  qualifyingRevenue: number;
  nonQualifyingRevenue: number;
  totalRevenue: number;
  nonQualifyingShare: number;
  deMinimisPassed: boolean;
  /** True when the de minimis test fails: status lost, standard regime applies. */
  statusLost: boolean;
  qualifyingTaxableIncome: number;
  nonQualifyingTaxableIncome: number;
  consequence: string;
  consequenceAr: string;
  source: string;
}

export interface CtComputationResult {
  accountingProfit: number;
  totalAddBacks: number;
  totalDeductions: number;
  adjustedTaxableIncome: number;
  smallBusinessRelief: {
    elected: boolean;
    eligible: boolean;
    applied: boolean;
    revenueCap: number;
    /** Why relief is not available, when it is not. */
    ineligibleReason?: "revenue_cap" | "prior_period_cap" | "sunset" | "qfzp";
  };
  interestLimitation: CtInterestLimitationResult | null;
  qfzp: CtQfzpResult | null;
  lossBroughtForward: number;
  lossReliefApplied: number;
  lossCarriedForward: number;
  taxableIncome: number;
  taxableAmount: number;
  taxPayable: number;
  exemptionThreshold: number;
  taxRate: number;
  /** Ordered schedule for the UI and the Excel computation sheet. */
  bridge: CtBridgeLine[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function adjustmentDirection(
  adj: Pick<CtBridgeAdjustment, "category">
): CtAdjustmentDirection {
  return CT_ADJUSTMENT_CATEGORIES[adj.category]?.direction ?? "add";
}

export function adjustmentLabel(adj: Pick<CtBridgeAdjustment, "category" | "label">): string {
  return adj.label || CT_ADJUSTMENT_CATEGORIES[adj.category]?.label || adj.category;
}

/**
 * Signed effect of one adjustment on taxable income: the category fixes the
 * sign and the disallowed share (entertainment: 50% of the amount entered).
 * Unknown categories and non-numeric / negative amounts are rejected (R08-06).
 */
export function adjustmentEffect(adj: Pick<CtBridgeAdjustment, "category" | "amount">): number {
  const def = CT_ADJUSTMENT_CATEGORIES[adj.category];
  if (!def)
    throw new CtInputError(
      "CT_ADJUSTMENT_CATEGORY_INVALID",
      `Unknown category ${String(adj.category)}`
    );
  const amount = typeof adj.amount === "number" ? adj.amount : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new CtInputError(
      "CT_ADJUSTMENT_AMOUNT_INVALID",
      "Adjustment amount must be a non-negative number"
    );
  }
  const effect = round2(amount * def.rate);
  return def.direction === "add" ? effect : -effect;
}

export class CtInputError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CtInputError";
  }
}

/** Is Small Business Relief still available for a period ending on `periodEnd`? */
export function sbrAvailableForPeriodEnd(periodEnd: string | undefined): boolean {
  if (!periodEnd) return true;
  return periodEnd.slice(0, 10) <= CT_SMALL_BUSINESS_RELIEF_LAST_PERIOD_END;
}

/** Art. 30 general interest deduction limitation (R08-16). Pure. */
export function computeInterestLimitation(
  taxableIncomeBeforeInterest: number,
  input: CtInterestInput
): CtInterestLimitationResult {
  const netInterestExpense = round2(input.netInterestExpense || 0);
  const depreciationAmortisation = round2(Math.max(0, input.depreciationAmortisation ?? 0));
  const carriedForwardIn = round2(Math.max(0, input.carriedForwardIn ?? 0));
  // Tax-EBITDA adds back net interest and D&A to taxable income (MD 126/2023 Art. 4).
  const taxEbitda = round2(
    taxableIncomeBeforeInterest + Math.max(0, netInterestExpense) + depreciationAmortisation
  );
  const ebitdaCap = round2(Math.max(0, taxEbitda) * CT_INTEREST_EBITDA_SHARE);
  const capacity = Math.max(ebitdaCap, CT_INTEREST_SAFE_HARBOUR);
  const current = Math.max(0, netInterestExpense);
  const disallowed = round2(Math.max(0, current - capacity));
  const spare = Math.max(0, capacity - current);
  const carriedForwardUtilised = round2(Math.min(carriedForwardIn, spare));
  const carriedForwardOut = round2(carriedForwardIn - carriedForwardUtilised + disallowed);
  return {
    netInterestExpense,
    depreciationAmortisation,
    taxEbitda,
    ebitdaCap,
    safeHarbour: CT_INTEREST_SAFE_HARBOUR,
    capacity,
    disallowed,
    carriedForwardIn,
    carriedForwardUtilised,
    carriedForwardOut,
    source: "FDL 47/2022 Art. 30; MD 126/2023",
  };
}

/** QFZP de minimis test (R08-15): non-qualifying ≤ 5% of revenue AND ≤ AED 5M. */
export function qfzpDeMinimis(
  qualifyingRevenue: number,
  nonQualifyingRevenue: number
): { totalRevenue: number; nonQualifyingShare: number; passed: boolean } {
  const q = Math.max(0, qualifyingRevenue || 0);
  const n = Math.max(0, nonQualifyingRevenue || 0);
  const total = round2(q + n);
  const share = total > 0 ? n / total : 0;
  const passed = n <= total * CT_QFZP_DE_MINIMIS_SHARE && n <= CT_QFZP_DE_MINIMIS_CAP;
  return { totalRevenue: total, nonQualifyingShare: Math.round(share * 10000) / 10000, passed };
}

/** Transfer-pricing disclosure flags at the published thresholds (R08-17). */
export function transferPricingFlags(input: {
  relatedPartyTransactionsTotal: number;
  revenue: number;
  mneGroupRevenue?: number | null;
}): {
  disclosureFormRequired: boolean;
  masterLocalFileRequired: boolean;
  relatedPartyTransactionsTotal: number;
  reasons: string[];
  source: string;
} {
  const reasons: string[] = [];
  const total = round2(Math.max(0, input.relatedPartyTransactionsTotal || 0));
  const disclosureFormRequired = total > CT_TP_DISCLOSURE_THRESHOLD;
  if (disclosureFormRequired) reasons.push("related_party_transactions_above_40m");
  const revenueHit = (input.revenue || 0) >= CT_TP_LOCAL_FILE_REVENUE_THRESHOLD;
  const groupHit = (input.mneGroupRevenue ?? 0) >= CT_TP_MNE_GROUP_REVENUE_THRESHOLD;
  if (revenueHit) reasons.push("revenue_at_or_above_200m");
  if (groupHit) reasons.push("mne_group_revenue_at_or_above_3_15bn");
  return {
    disclosureFormRequired,
    masterLocalFileRequired: revenueHit || groupHit,
    relatedPartyTransactionsTotal: total,
    reasons,
    source: "FDL 47/2022 Art. 34-36, 55; MD 97/2023",
  };
}

/**
 * Full UAE CT computation: accounting profit → disallowable add-backs →
 * deductions → interest limitation → small business relief → loss
 * carryforward (75% cap) → QFZP split or 0%/9% bands. Deterministic and
 * DB-free so the same fixture always produces the same schedule.
 */
export function computeCtComputation(input: CtComputationInput): CtComputationResult {
  const qfzpInput = input.qfzp?.elected ? input.qfzp : null;
  const exemptionThreshold = input.exemptionThreshold ?? CT_ZERO_RATE_BAND;
  const taxRate = input.taxRate ?? CT_STANDARD_RATE;
  const adjustments = input.adjustments ?? [];
  const lossBroughtForward = Math.max(0, input.lossBroughtForward ?? 0);

  const accountingProfit = round2(input.totalRevenue - input.totalExpenses);

  let totalAddBacks = 0;
  let totalDeductions = Math.max(0, input.totalDeductions ?? 0);
  const effects = adjustments.map((adj) => adjustmentEffect(adj));
  for (const effect of effects) {
    if (effect >= 0) totalAddBacks += effect;
    else totalDeductions += -effect;
  }
  totalAddBacks = round2(totalAddBacks);
  totalDeductions = round2(totalDeductions);

  const beforeInterest = round2(accountingProfit + totalAddBacks - totalDeductions);
  const interestLimitation =
    input.interest &&
    (input.interest.netInterestExpense !== 0 || (input.interest.carriedForwardIn ?? 0) > 0)
      ? computeInterestLimitation(beforeInterest, input.interest)
      : null;
  const adjustedTaxableIncome = interestLimitation
    ? round2(
        beforeInterest + interestLimitation.disallowed - interestLimitation.carriedForwardUtilised
      )
    : beforeInterest;

  // Small business relief: elected AND revenue within the cap AND the period
  // ends on or before 31 Dec 2026 AND the person is not a QFZP.
  const sbrElected = input.smallBusinessReliefElected === true;
  let ineligibleReason: CtComputationResult["smallBusinessRelief"]["ineligibleReason"];
  if (input.totalRevenue > CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP) ineligibleReason = "revenue_cap";
  else if (input.priorPeriodsExceededRevenueCap === true) ineligibleReason = "prior_period_cap";
  else if (!sbrAvailableForPeriodEnd(input.taxPeriodEnd)) ineligibleReason = "sunset";
  else if (qfzpInput) ineligibleReason = "qfzp";
  const sbrEligible = ineligibleReason === undefined;
  const sbrApplied = sbrElected && sbrEligible;

  let lossReliefApplied = 0;
  let taxableIncome: number;
  let lossCarriedForward: number;

  if (sbrApplied) {
    taxableIncome = 0;
    lossCarriedForward = round2(lossBroughtForward);
  } else if (adjustedTaxableIncome <= 0) {
    taxableIncome = 0;
    lossCarriedForward = round2(lossBroughtForward + Math.abs(adjustedTaxableIncome));
  } else {
    lossReliefApplied = round2(
      Math.min(lossBroughtForward, adjustedTaxableIncome * CT_LOSS_OFFSET_LIMIT)
    );
    taxableIncome = round2(adjustedTaxableIncome - lossReliefApplied);
    lossCarriedForward = round2(lossBroughtForward - lossReliefApplied);
  }

  let qfzp: CtQfzpResult | null = null;
  let taxableAmount: number;
  let bandApplied = true;
  if (qfzpInput) {
    const dm = qfzpDeMinimis(qfzpInput.qualifyingRevenue, qfzpInput.nonQualifyingRevenue);
    const nonQualShare =
      dm.totalRevenue > 0 ? Math.max(0, qfzpInput.nonQualifyingRevenue) / dm.totalRevenue : 0;
    const nonQualTaxable = dm.passed
      ? round2(
          Math.min(
            taxableIncome,
            Math.max(0, qfzpInput.nonQualifyingTaxableIncome ?? taxableIncome * nonQualShare)
          )
        )
      : taxableIncome;
    qfzp = {
      elected: true,
      qualifyingRevenue: round2(Math.max(0, qfzpInput.qualifyingRevenue)),
      nonQualifyingRevenue: round2(Math.max(0, qfzpInput.nonQualifyingRevenue)),
      totalRevenue: dm.totalRevenue,
      nonQualifyingShare: dm.nonQualifyingShare,
      deMinimisPassed: dm.passed,
      statusLost: !dm.passed,
      qualifyingTaxableIncome: dm.passed ? round2(taxableIncome - nonQualTaxable) : 0,
      nonQualifyingTaxableIncome: nonQualTaxable,
      consequence: dm.passed
        ? "De minimis met: 0% on qualifying income, 9% on non-qualifying income (no AED 375,000 band)."
        : "De minimis failed: QFZP status is lost for this period and the following four tax periods; all taxable income is taxed under the standard 9% regime.",
      consequenceAr: dm.passed
        ? "تم استيفاء الحد الأدنى: 0٪ على الدخل المؤهل و9٪ على الدخل غير المؤهل (دون شريحة 375,000 درهم)."
        : "لم يتم استيفاء الحد الأدنى: تُفقد صفة الشخص المؤهل في المنطقة الحرة لهذه الفترة والفترات الضريبية الأربع التالية، ويخضع كامل الدخل الخاضع للضريبة للنظام القياسي بنسبة 9٪.",
      source: "FDL 47/2022 Art. 18-19; Cabinet Decision 100/2023; MD 265/2023",
    };
    if (dm.passed) {
      bandApplied = false;
      taxableAmount = nonQualTaxable;
    } else {
      taxableAmount = round2(Math.max(0, taxableIncome - exemptionThreshold));
    }
  } else {
    taxableAmount = sbrApplied ? 0 : round2(Math.max(0, taxableIncome - exemptionThreshold));
  }
  const taxPayable = round2(taxableAmount * taxRate);

  const bridge: CtBridgeLine[] = [
    { key: "revenue", label: "Total revenue", amount: round2(input.totalRevenue) },
    { key: "expenses", label: "Total expenses", amount: round2(-input.totalExpenses) },
    { key: "accounting_profit", label: "Accounting profit / (loss)", amount: accountingProfit },
  ];
  adjustments.forEach((adj, i) => {
    bridge.push({
      key: `adj_${adj.category}_${adj.id}`,
      label: adjustmentLabel(adj),
      amount: effects[i],
    });
  });
  if ((input.totalDeductions ?? 0) > 0) {
    bridge.push({
      key: "legacy_deductions",
      label: "Other deductions",
      amount: round2(-(input.totalDeductions ?? 0)),
    });
  }
  if (interestLimitation) {
    if (interestLimitation.disallowed > 0) {
      bridge.push({
        key: "interest_disallowed",
        label: "Net interest above the deduction limit (Art. 30)",
        amount: interestLimitation.disallowed,
      });
    }
    if (interestLimitation.carriedForwardUtilised > 0) {
      bridge.push({
        key: "interest_carried_forward_utilised",
        label: "Disallowed interest brought forward and now deducted",
        amount: -interestLimitation.carriedForwardUtilised,
      });
    }
  }
  bridge.push({
    key: "adjusted_taxable_income",
    label: "Taxable income before loss relief",
    amount: adjustedTaxableIncome,
  });
  if (sbrApplied) {
    bridge.push({
      key: "small_business_relief",
      label: "Small business relief (Art. 21) — taxable income treated as nil",
      amount: -adjustedTaxableIncome,
    });
  } else if (lossReliefApplied > 0) {
    bridge.push({
      key: "loss_relief",
      label: `Tax losses utilised (max ${CT_LOSS_OFFSET_LIMIT * 100}% of taxable income)`,
      amount: -lossReliefApplied,
    });
  }
  bridge.push({ key: "taxable_income", label: "Taxable income", amount: taxableIncome });
  if (qfzp && !bandApplied) {
    bridge.push({
      key: "qfzp_qualifying_income",
      label: "Qualifying income taxed at 0% (QFZP)",
      amount: round2(-qfzp.qualifyingTaxableIncome),
    });
  } else {
    bridge.push({
      key: "zero_band",
      label: `0% band (first AED ${exemptionThreshold.toLocaleString("en-US")})`,
      amount: round2(-Math.min(taxableIncome, exemptionThreshold)),
    });
  }
  bridge.push(
    { key: "taxable_amount", label: "Income taxed at 9%", amount: taxableAmount },
    { key: "tax_payable", label: "Corporate tax payable", amount: taxPayable }
  );

  return {
    accountingProfit,
    totalAddBacks,
    totalDeductions,
    adjustedTaxableIncome,
    smallBusinessRelief: {
      elected: sbrElected,
      eligible: sbrEligible,
      applied: sbrApplied,
      revenueCap: CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
      ...(ineligibleReason ? { ineligibleReason } : {}),
    },
    interestLimitation,
    qfzp,
    lossBroughtForward: round2(lossBroughtForward),
    lossReliefApplied,
    lossCarriedForward,
    taxableIncome,
    taxableAmount,
    taxPayable,
    exemptionThreshold,
    taxRate,
    bridge,
  };
}
