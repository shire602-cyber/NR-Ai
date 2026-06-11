/**
 * Corporate-tax workpaper grid helpers — shared between the client editor
 * and the server's .xlsx import so the two can never drift (same pattern as
 * shared/vat-workpaper-grid.ts).
 */

export type CtWorkpaperRowType = "revenue" | "expense";

export interface CtWorkpaperRow {
  id: string;
  label: string;
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
  const exemptionThreshold = input.exemptionThreshold ?? 375000;
  const taxRate = input.taxRate ?? 0.09;
  const taxableIncome = input.totalRevenue - input.totalExpenses - (input.totalDeductions ?? 0);
  const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
  const taxPayable = Math.round(taxableAmount * taxRate * 100) / 100;
  return {
    taxableIncome: Math.round(taxableIncome * 100) / 100,
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    taxPayable,
    exemptionThreshold,
    taxRate,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Full taxable-profit bridge (Federal Decree-Law 47 of 2022)
// ───────────────────────────────────────────────────────────────────────────

/** Art. 21 + Ministerial Decision 73/2023: relief available while revenue ≤ AED 3M. */
export const CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP = 3_000_000;
/** Art. 37(2): carried-forward losses offset at most 75% of taxable income. */
export const CT_LOSS_OFFSET_LIMIT = 0.75;
/** Cabinet Decision 116/2022: 0% band on the first AED 375,000. */
export const CT_ZERO_RATE_BAND = 375_000;

export type CtAdjustmentDirection = "add" | "deduct";

export const CT_ADJUSTMENT_CATEGORIES = {
  entertainment_50: {
    label: "Client entertainment (50% disallowed)",
    direction: "add" as CtAdjustmentDirection,
  },
  fines_penalties: { label: "Fines and penalties", direction: "add" as CtAdjustmentDirection },
  non_approved_donations: {
    label: "Donations to non-approved entities",
    direction: "add" as CtAdjustmentDirection,
  },
  related_party_excess: {
    label: "Related-party payments above arm's length",
    direction: "add" as CtAdjustmentDirection,
  },
  owner_drawings: {
    label: "Owner drawings / non-business expenses",
    direction: "add" as CtAdjustmentDirection,
  },
  other_addback: { label: "Other add-back", direction: "add" as CtAdjustmentDirection },
  exempt_income: {
    label: "Exempt income (participation/foreign PE)",
    direction: "deduct" as CtAdjustmentDirection,
  },
  unrealized_gains: {
    label: "Unrealised gains (realisation basis election)",
    direction: "deduct" as CtAdjustmentDirection,
  },
  other_deduction: { label: "Other deduction", direction: "deduct" as CtAdjustmentDirection },
} as const;

export type CtAdjustmentCategory = keyof typeof CT_ADJUSTMENT_CATEGORIES;

export interface CtBridgeAdjustment {
  id: string;
  category: CtAdjustmentCategory;
  label?: string;
  /** Positive AED amount; `direction` (or the category default) decides sign. */
  amount: number;
  direction?: CtAdjustmentDirection;
  notes?: string;
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
  exemptionThreshold?: number;
  taxRate?: number;
}

export interface CtBridgeLine {
  key: string;
  label: string;
  amount: number;
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
  };
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

export function adjustmentDirection(adj: CtBridgeAdjustment): CtAdjustmentDirection {
  return adj.direction ?? CT_ADJUSTMENT_CATEGORIES[adj.category]?.direction ?? "add";
}

export function adjustmentLabel(adj: CtBridgeAdjustment): string {
  return adj.label || CT_ADJUSTMENT_CATEGORIES[adj.category]?.label || adj.category;
}

/**
 * Full UAE CT computation: accounting profit → disallowable add-backs →
 * deductions → small business relief → loss carryforward (75% cap) →
 * 0%/9% bands. Deterministic and DB-free so the same fixture always
 * produces the same schedule.
 */
export function computeCtComputation(input: CtComputationInput): CtComputationResult {
  const exemptionThreshold = input.exemptionThreshold ?? CT_ZERO_RATE_BAND;
  const taxRate = input.taxRate ?? 0.09;
  const adjustments = input.adjustments ?? [];
  const lossBroughtForward = Math.max(0, input.lossBroughtForward ?? 0);

  const accountingProfit = round2(input.totalRevenue - input.totalExpenses);

  let totalAddBacks = 0;
  let totalDeductions = Math.max(0, input.totalDeductions ?? 0);
  for (const adj of adjustments) {
    const amount = Math.abs(Number(adj.amount) || 0);
    if (adjustmentDirection(adj) === "add") totalAddBacks += amount;
    else totalDeductions += amount;
  }
  totalAddBacks = round2(totalAddBacks);
  totalDeductions = round2(totalDeductions);

  const adjustedTaxableIncome = round2(accountingProfit + totalAddBacks - totalDeductions);

  // Small business relief: elected AND revenue within the cap → treated as
  // having no taxable income for the period. Losses neither relieve nor
  // accrue while the relief is claimed (MD 73/2023 Art. 5).
  const sbrElected = input.smallBusinessReliefElected === true;
  const sbrEligible = input.totalRevenue <= CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP;
  const sbrApplied = sbrElected && sbrEligible;

  let lossReliefApplied = 0;
  let taxableIncome: number;
  let lossCarriedForward: number;

  if (sbrApplied) {
    taxableIncome = 0;
    lossCarriedForward = round2(lossBroughtForward);
  } else if (adjustedTaxableIncome <= 0) {
    // A loss year: nothing taxable, the loss joins the carryforward pool.
    taxableIncome = 0;
    lossCarriedForward = round2(lossBroughtForward + Math.abs(adjustedTaxableIncome));
  } else {
    lossReliefApplied = round2(
      Math.min(lossBroughtForward, adjustedTaxableIncome * CT_LOSS_OFFSET_LIMIT)
    );
    taxableIncome = round2(adjustedTaxableIncome - lossReliefApplied);
    lossCarriedForward = round2(lossBroughtForward - lossReliefApplied);
  }

  const taxableAmount = sbrApplied ? 0 : round2(Math.max(0, taxableIncome - exemptionThreshold));
  const taxPayable = round2(taxableAmount * taxRate);

  const bridge: CtBridgeLine[] = [
    { key: "revenue", label: "Total revenue", amount: round2(input.totalRevenue) },
    { key: "expenses", label: "Total expenses", amount: round2(-input.totalExpenses) },
    { key: "accounting_profit", label: "Accounting profit / (loss)", amount: accountingProfit },
  ];
  for (const adj of adjustments) {
    const amount = Math.abs(Number(adj.amount) || 0);
    bridge.push({
      key: `adj_${adj.category}_${adj.id}`,
      label: adjustmentLabel(adj),
      amount: round2(adjustmentDirection(adj) === "add" ? amount : -amount),
    });
  }
  if ((input.totalDeductions ?? 0) > 0) {
    bridge.push({
      key: "legacy_deductions",
      label: "Other deductions",
      amount: round2(-(input.totalDeductions ?? 0)),
    });
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
  bridge.push(
    { key: "taxable_income", label: "Taxable income", amount: taxableIncome },
    {
      key: "zero_band",
      label: `0% band (first AED ${exemptionThreshold.toLocaleString("en-US")})`,
      amount: round2(-Math.min(taxableIncome, exemptionThreshold)),
    },
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
    },
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
