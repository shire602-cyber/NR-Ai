/**
 * VAT Return Autopilot — Phase 3.
 *
 * Auto-calculates UAE FTA VAT 201 returns from existing accounting data:
 *   • Output VAT (sales) from invoices
 *   • Input VAT (purchases) from receipts and journal entries
 *   • Period detection from company VAT filing frequency
 *   • Reconciliation against journal entries to flag discrepancies
 *   • Manual adjustments with audit trail
 *
 * The bulk of the file is intentionally written as pure functions that take
 * primitive inputs (dates, numbers) so they can be unit-tested without a DB.
 * The DB-touching `calculateVatReturn` and `listPeriodsForCompany` orchestrate
 * those pure helpers using `pool.query` (matching the rest of the codebase).
 */

import { randomUUID } from 'node:crypto';
import { pool } from '../db';
import { UAE_VAT_RATE } from '../constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VatFrequency = 'monthly' | 'quarterly';
export type VatPeriodStatus = 'draft' | 'ready' | 'submitted' | 'accepted';

export interface VatPeriod {
  start: Date;
  end: Date;
  dueDate: Date;
  frequency: VatFrequency;
}

export interface DeadlineStatus {
  daysUntilDue: number;       // negative = overdue
  level: 'ok' | 'warning' | 'critical' | 'overdue';
  isOverdue: boolean;
}

export interface VatBoxBreakdown {
  // Output VAT side
  standardRatedSales: number;
  standardRatedVat: number;
  zeroRatedSales: number;
  exemptSales: number;
  reverseChargeAmount: number;
  reverseChargeVat: number;
  totalOutputVat: number;
  // Input VAT side
  totalExpenses: number;
  inputVatGross: number;          // before partial-exemption apportionment
  inputVatRecoverable: number;    // after apportionment
  inputVatIrrecoverable: number;
  reverseChargeVatRecoverable: number;
  totalInputVat: number;
  // Net
  netVatPayable: number;
}

export interface ReconciliationResult {
  outputVatLedger: number;
  outputVatCalculated: number;
  outputVatDelta: number;
  inputVatLedger: number;
  inputVatCalculated: number;
  inputVatDelta: number;
  hasDiscrepancy: boolean;
  toleranceAed: number;
}

export interface VatAutopilotCalculation {
  companyId: string;
  period: VatPeriod;
  boxes: VatBoxBreakdown;
  reconciliation: ReconciliationResult;
  invoicesProcessed: number;
  receiptsProcessed: number;
  partialExemption: {
    exemptSupplyRatio: number;
    recoverableRatio: number;
  };
  /** Boxes object suitable for spreading into a VAT 201 form preview */
  vat201: Vat201BoxValues;
}

export interface Vat201BoxValues {
  // Standard-rated sales by emirate (only the company's emirate is populated)
  box1aAbuDhabiAmount: number; box1aAbuDhabiVat: number;
  box1bDubaiAmount: number; box1bDubaiVat: number;
  box1cSharjahAmount: number; box1cSharjahVat: number;
  box1dAjmanAmount: number; box1dAjmanVat: number;
  box1eUmmAlQuwainAmount: number; box1eUmmAlQuwainVat: number;
  box1fRasAlKhaimahAmount: number; box1fRasAlKhaimahVat: number;
  box1gFujairahAmount: number; box1gFujairahVat: number;
  box3ReverseChargeAmount: number; box3ReverseChargeVat: number;
  box4ZeroRatedAmount: number;
  box5ExemptAmount: number;
  box8TotalAmount: number; box8TotalVat: number;
  box9ExpensesAmount: number; box9ExpensesVat: number;
  box10ReverseChargeAmount: number; box10ReverseChargeVat: number;
  box11TotalAmount: number; box11TotalVat: number;
  box12TotalDueTax: number;
  box13RecoverableTax: number;
  box14PayableTax: number;
}

export interface VatPeriodSummary {
  id: string | null;
  companyId: string;
  periodStart: string;       // ISO date
  periodEnd: string;
  dueDate: string;
  frequency: VatFrequency;
  status: VatPeriodStatus;
  outputVat: number;
  inputVat: number;
  netVatPayable: number;
  calculatedAt: string | null;
  deadline: DeadlineStatus;
}

export interface DueDateView {
  companyId: string;
  companyName: string;
  trnVatNumber: string | null;
  periodEnd: Date;
  dueDate: Date;
  status: VatPeriodStatus;
  daysUntilDue: number;
  level: DeadlineStatus['level'];
}

// ─── Pure helpers (testable without a DB) ────────────────────────────────────

const QUARTER_LENGTH_MONTHS = 3;
const FILING_DAYS_AFTER_PERIOD_END = 28;

/**
 * Round to 2 decimals — VAT amounts are always reported to AED cents.
 * Centralised so we don't accumulate floating-point drift across box totals.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the FTA-mandated due date for a VAT return.
 * Per FTA Decree-Law No. 8 of 2017, the deadline is the 28th day of the month
 * following the period end. We implement that as periodEnd + 28 days at UTC
 * midnight to stay timezone-agnostic.
 */
export function computeDueDate(periodEnd: Date): Date {
  const due = new Date(Date.UTC(
    periodEnd.getUTCFullYear(),
    periodEnd.getUTCMonth(),
    periodEnd.getUTCDate(),
  ));
  due.setUTCDate(due.getUTCDate() + FILING_DAYS_AFTER_PERIOD_END);
  return due;
}

/**
 * Detect the VAT period that contains `referenceDate` for a company filing on
 * `frequency`. `periodStartMonth` is the calendar month (1-12) that the
 * registrant's stagger begins on — FTA assigns each registrant a stagger so
 * Q1 may run Jan-Mar, Feb-Apr, or Mar-May.
 *
 * Period boundaries are computed in UTC: `start` is the first instant of the
 * starting month, `end` is the last instant (23:59:59.999) of the closing
 * month, so that `inv.date <= end` correctly includes invoices issued on the
 * last day of the period.
 */
export function detectPeriod(
  frequency: VatFrequency,
  periodStartMonth: number,
  referenceDate: Date = new Date(),
): VatPeriod {
  const startMonth0 = ((periodStartMonth - 1) % 12 + 12) % 12; // 0-indexed, robust to negatives
  const refYear = referenceDate.getUTCFullYear();
  const refMonth0 = referenceDate.getUTCMonth();

  let periodStartYear: number;
  let periodStartMonth0: number;
  let lengthMonths: number;

  if (frequency === 'monthly') {
    periodStartYear = refYear;
    periodStartMonth0 = refMonth0;
    lengthMonths = 1;
  } else {
    // Find which quarter, anchored at startMonth0, the reference date falls in.
    const monthsSinceAnchor = ((refMonth0 - startMonth0) % 12 + 12) % 12;
    const quarterIndex = Math.floor(monthsSinceAnchor / QUARTER_LENGTH_MONTHS);
    periodStartMonth0 = (startMonth0 + quarterIndex * QUARTER_LENGTH_MONTHS) % 12;
    // Year may roll back when the anchor month is later in the year than ref.
    periodStartYear = refYear - (periodStartMonth0 > refMonth0 ? 1 : 0);
    lengthMonths = QUARTER_LENGTH_MONTHS;
  }

  const start = new Date(Date.UTC(periodStartYear, periodStartMonth0, 1, 0, 0, 0, 0));
  const endMonthIndex = periodStartMonth0 + lengthMonths;
  // last day of the closing month at 23:59:59.999 UTC
  const end = new Date(Date.UTC(periodStartYear, endMonthIndex, 0, 23, 59, 59, 999));
  return {
    start,
    end,
    dueDate: computeDueDate(end),
    frequency,
  };
}

/**
 * Enumerate the N most recent VAT periods ending on or before `referenceDate`
 * (inclusive). Used to populate the periods list — we don't store every past
 * period in the DB, just generate them on demand and overlay any saved status.
 */
export function listRecentPeriods(
  frequency: VatFrequency,
  periodStartMonth: number,
  count: number,
  referenceDate: Date = new Date(),
): VatPeriod[] {
  const periods: VatPeriod[] = [];
  const stepMonths = frequency === 'monthly' ? 1 : QUARTER_LENGTH_MONTHS;
  let cursor = referenceDate;
  for (let i = 0; i < count; i++) {
    const period = detectPeriod(frequency, periodStartMonth, cursor);
    periods.push(period);
    // Step `cursor` back by stepMonths so the next iteration falls inside the
    // previous period — using the start - 1 day avoids edge cases at boundaries.
    cursor = new Date(period.start.getTime() - 24 * 60 * 60 * 1000);
  }
  return periods;
}

/**
 * Convert a due-date into a deadline status flag for the UI:
 *   • overdue:  past the due date
 *   • critical: 3 days or fewer remaining
 *   • warning:  4-7 days remaining
 *   • ok:       more than 7 days remaining
 */
export function deadlineStatus(dueDate: Date, now: Date = new Date()): DeadlineStatus {
  const ms = dueDate.getTime() - now.getTime();
  const daysUntilDue = Math.ceil(ms / (24 * 60 * 60 * 1000));
  let level: DeadlineStatus['level'];
  if (daysUntilDue < 0) level = 'overdue';
  else if (daysUntilDue <= 3) level = 'critical';
  else if (daysUntilDue <= 7) level = 'warning';
  else level = 'ok';
  return { daysUntilDue, level, isOverdue: daysUntilDue < 0 };
}

/**
 * Convert a foreign-currency amount to AED using a stored exchange rate.
 * The convention across the codebase is `rate` = AED-per-1-foreign-unit, so
 * AED = amount * rate.
 */
export function convertToAed(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return round2(amount * rate);
}

interface InvoiceLineForVat {
  quantity: number;
  unitPrice: number;
  vatRate: number | null;
  vatSupplyType?: 'standard_rated' | 'zero_rated' | 'exempt' | 'out_of_scope' | null;
}

/**
 * Aggregate invoice lines into the FTA supply-type buckets used by the VAT 201
 * form. Pure — accepts already-fetched line data.
 *
 * `out_of_scope` supplies (e.g. supplies made outside the UAE, transactions
 * between designated-zone entities) are excluded from all VAT 201 boxes per
 * FTA rules — they're tracked separately so callers can verify the count but
 * never roll into Box 1/4/5.
 */
export function aggregateInvoiceLines(lines: InvoiceLineForVat[]): {
  standardRatedAmount: number;
  standardRatedVat: number;
  zeroRatedAmount: number;
  exemptAmount: number;
  outOfScopeAmount: number;
} {
  let standardRatedAmount = 0;
  let standardRatedVat = 0;
  let zeroRatedAmount = 0;
  let exemptAmount = 0;
  let outOfScopeAmount = 0;
  for (const line of lines) {
    const lineAmount = (line.quantity || 0) * (line.unitPrice || 0);
    const rate = line.vatRate ?? UAE_VAT_RATE;
    const supply = line.vatSupplyType || 'standard_rated';
    // Explicit supply type wins over rate-based inference. An exempt supply
    // with rate 0 must land in the exempt bucket, not zero-rated — they map
    // to different boxes on the FTA 201 form.
    if (supply === 'out_of_scope') {
      outOfScopeAmount += lineAmount;
    } else if (supply === 'exempt') {
      exemptAmount += lineAmount;
    } else if (supply === 'zero_rated' || rate === 0) {
      zeroRatedAmount += lineAmount;
    } else {
      standardRatedAmount += lineAmount;
      standardRatedVat += lineAmount * rate;
    }
  }
  return {
    standardRatedAmount: round2(standardRatedAmount),
    standardRatedVat: round2(standardRatedVat),
    zeroRatedAmount: round2(zeroRatedAmount),
    exemptAmount: round2(exemptAmount),
    outOfScopeAmount: round2(outOfScopeAmount),
  };
}

/**
 * Apply FTA Article 55 partial-exemption apportionment to an input VAT figure.
 * `exemptRatio` is the fraction of supplies that are exempt (0..1). Returns a
 * pair of {recoverable, irrecoverable} that sum to the input.
 */
export function applyPartialExemption(inputVatGross: number, exemptRatio: number): {
  recoverable: number;
  irrecoverable: number;
  recoverableRatio: number;
} {
  const clampedExempt = Math.min(1, Math.max(0, exemptRatio));
  const recoverableRatio = 1 - clampedExempt;
  const recoverable = round2(inputVatGross * recoverableRatio);
  const irrecoverable = round2(inputVatGross - recoverable);
  return { recoverable, irrecoverable, recoverableRatio };
}

/**
 * Roll the per-component figures up into the full VAT 201 box layout.
 * The company's registered emirate determines which Box 1[a-g] row receives
 * the standard-rated sales — exports/zero-rated and exempt have their own
 * boxes regardless of emirate.
 */
export function buildVat201Boxes(
  components: {
    standardRatedAmount: number;
    standardRatedVat: number;
    zeroRatedAmount: number;
    exemptAmount: number;
    reverseChargeAmount: number;
    reverseChargeVat: number;
    reverseChargeVatRecoverable: number;
    totalExpenses: number;
    inputVatRecoverable: number;
  },
  emirate: string,
): Vat201BoxValues {
  const boxes: Vat201BoxValues = {
    box1aAbuDhabiAmount: 0, box1aAbuDhabiVat: 0,
    box1bDubaiAmount: 0, box1bDubaiVat: 0,
    box1cSharjahAmount: 0, box1cSharjahVat: 0,
    box1dAjmanAmount: 0, box1dAjmanVat: 0,
    box1eUmmAlQuwainAmount: 0, box1eUmmAlQuwainVat: 0,
    box1fRasAlKhaimahAmount: 0, box1fRasAlKhaimahVat: 0,
    box1gFujairahAmount: 0, box1gFujairahVat: 0,
    box3ReverseChargeAmount: round2(components.reverseChargeAmount),
    box3ReverseChargeVat: round2(components.reverseChargeVat),
    box4ZeroRatedAmount: round2(components.zeroRatedAmount),
    box5ExemptAmount: round2(components.exemptAmount),
    box8TotalAmount: 0, box8TotalVat: 0,
    box9ExpensesAmount: round2(components.totalExpenses),
    box9ExpensesVat: round2(components.inputVatRecoverable),
    box10ReverseChargeAmount: round2(components.reverseChargeAmount),
    box10ReverseChargeVat: round2(components.reverseChargeVatRecoverable),
    box11TotalAmount: 0, box11TotalVat: 0,
    box12TotalDueTax: 0,
    box13RecoverableTax: 0,
    box14PayableTax: 0,
  };

  const stdAmt = round2(components.standardRatedAmount);
  const stdVat = round2(components.standardRatedVat);
  switch (emirate) {
    case 'abu_dhabi':
      boxes.box1aAbuDhabiAmount = stdAmt;
      boxes.box1aAbuDhabiVat = stdVat;
      break;
    case 'sharjah':
      boxes.box1cSharjahAmount = stdAmt;
      boxes.box1cSharjahVat = stdVat;
      break;
    case 'ajman':
      boxes.box1dAjmanAmount = stdAmt;
      boxes.box1dAjmanVat = stdVat;
      break;
    case 'umm_al_quwain':
      boxes.box1eUmmAlQuwainAmount = stdAmt;
      boxes.box1eUmmAlQuwainVat = stdVat;
      break;
    case 'ras_al_khaimah':
      boxes.box1fRasAlKhaimahAmount = stdAmt;
      boxes.box1fRasAlKhaimahVat = stdVat;
      break;
    case 'fujairah':
      boxes.box1gFujairahAmount = stdAmt;
      boxes.box1gFujairahVat = stdVat;
      break;
    case 'dubai':
    default:
      boxes.box1bDubaiAmount = stdAmt;
      boxes.box1bDubaiVat = stdVat;
      break;
  }

  // Box 8 totals output side; Box 11 totals input side; Boxes 12-14 net it out.
  boxes.box8TotalAmount = round2(stdAmt + components.zeroRatedAmount + components.exemptAmount + components.reverseChargeAmount);
  boxes.box8TotalVat = round2(stdVat + components.reverseChargeVat);
  boxes.box11TotalAmount = round2(components.totalExpenses + components.reverseChargeAmount);
  boxes.box11TotalVat = round2(components.inputVatRecoverable + components.reverseChargeVatRecoverable);
  boxes.box12TotalDueTax = boxes.box8TotalVat;
  boxes.box13RecoverableTax = boxes.box11TotalVat;
  boxes.box14PayableTax = round2(boxes.box12TotalDueTax - boxes.box13RecoverableTax);
  return boxes;
}

/**
 * Cross-check calculated VAT against ledger balances. The ledger is the source
 * of truth: if calculated output VAT differs from the credit balance on output
 * VAT accounts (or input VAT differs from the debit balance on input VAT
 * accounts) we flag a discrepancy so the user can investigate before filing.
 *
 * Tolerance defaults to 0.01 AED to absorb rounding-only differences.
 */
export function reconcile(
  calculated: { outputVat: number; inputVat: number },
  ledger: { outputVat: number; inputVat: number },
  toleranceAed = 0.01,
): ReconciliationResult {
  const outputVatDelta = round2(calculated.outputVat - ledger.outputVat);
  const inputVatDelta = round2(calculated.inputVat - ledger.inputVat);
  return {
    outputVatLedger: round2(ledger.outputVat),
    outputVatCalculated: round2(calculated.outputVat),
    outputVatDelta,
    inputVatLedger: round2(ledger.inputVat),
    inputVatCalculated: round2(calculated.inputVat),
    inputVatDelta,
    hasDiscrepancy: Math.abs(outputVatDelta) > toleranceAed || Math.abs(inputVatDelta) > toleranceAed,
    toleranceAed,
  };
}

/**
 * Apply a list of saved adjustments on top of an auto-calculated boxes object.
 * Returns a new boxes object — pure.
 */
export interface SavedAdjustment {
  id: string;
  box: keyof Vat201BoxValues;
  amount: number;
  reason: string;
  userId: string;
  createdAt: string;
}

/**
 * Allow-list of valid VAT 201 box keys. Used both by the routes layer (to
 * validate user-supplied adjustments target an actual box) and by
 * `applyAdjustments` to reject inherited Object.prototype keys
 * (`__proto__`, `constructor`, `toString`...) that would otherwise pass a
 * naive `if (adj.box in next)` check.
 */
export const VAT201_BOX_KEYS: ReadonlyArray<keyof Vat201BoxValues> = [
  'box1aAbuDhabiAmount', 'box1aAbuDhabiVat',
  'box1bDubaiAmount', 'box1bDubaiVat',
  'box1cSharjahAmount', 'box1cSharjahVat',
  'box1dAjmanAmount', 'box1dAjmanVat',
  'box1eUmmAlQuwainAmount', 'box1eUmmAlQuwainVat',
  'box1fRasAlKhaimahAmount', 'box1fRasAlKhaimahVat',
  'box1gFujairahAmount', 'box1gFujairahVat',
  'box3ReverseChargeAmount', 'box3ReverseChargeVat',
  'box4ZeroRatedAmount',
  'box5ExemptAmount',
  'box8TotalAmount', 'box8TotalVat',
  'box9ExpensesAmount', 'box9ExpensesVat',
  'box10ReverseChargeAmount', 'box10ReverseChargeVat',
  'box11TotalAmount', 'box11TotalVat',
  'box12TotalDueTax',
  'box13RecoverableTax',
  'box14PayableTax',
];

const VAT201_BOX_KEY_SET: ReadonlySet<string> = new Set(VAT201_BOX_KEYS);

export function isValidVat201BoxKey(value: unknown): value is keyof Vat201BoxValues {
  return typeof value === 'string' && VAT201_BOX_KEY_SET.has(value);
}

export function applyAdjustments(boxes: Vat201BoxValues, adjustments: SavedAdjustment[]): Vat201BoxValues {
  const next: Vat201BoxValues = { ...boxes };
  for (const adj of adjustments) {
    // Strict allow-list — `box in next` would also match inherited prototype
    // keys (`__proto__`, `constructor`, `toString`...) which historic data may
    // contain if it bypassed the route validation.
    if (!isValidVat201BoxKey(adj.box)) continue;
    if (!Number.isFinite(adj.amount)) continue;
    next[adj.box] = round2((next[adj.box] ?? 0) + adj.amount);
  }
  // Re-derive totals after adjustment so Box 8/11/12/13/14 stay consistent.
  next.box8TotalVat = round2(
    next.box1aAbuDhabiVat + next.box1bDubaiVat + next.box1cSharjahVat +
    next.box1dAjmanVat + next.box1eUmmAlQuwainVat + next.box1fRasAlKhaimahVat +
    next.box1gFujairahVat + next.box3ReverseChargeVat,
  );
  next.box8TotalAmount = round2(
    next.box1aAbuDhabiAmount + next.box1bDubaiAmount + next.box1cSharjahAmount +
    next.box1dAjmanAmount + next.box1eUmmAlQuwainAmount + next.box1fRasAlKhaimahAmount +
    next.box1gFujairahAmount + next.box4ZeroRatedAmount + next.box5ExemptAmount +
    next.box3ReverseChargeAmount,
  );
  next.box11TotalAmount = round2(next.box9ExpensesAmount + next.box10ReverseChargeAmount);
  next.box11TotalVat = round2(next.box9ExpensesVat + next.box10ReverseChargeVat);
  next.box12TotalDueTax = next.box8TotalVat;
  next.box13RecoverableTax = next.box11TotalVat;
  next.box14PayableTax = round2(next.box12TotalDueTax - next.box13RecoverableTax);
  return next;
}

// ─── DB orchestration ────────────────────────────────────────────────────────

interface CompanyVatConfig {
  id: string;
  emirate: string;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;        // 'Monthly' | 'Quarterly' | 'Annually'
  vatPeriodStartMonth: number;
  vatAutoCalculate: boolean;
  exemptSupplyRatio: number;
}

async function loadCompanyConfig(companyId: string): Promise<CompanyVatConfig | null> {
  const res = await pool.query(
    `SELECT id, COALESCE(emirate, 'dubai') AS emirate, trn_vat_number,
            vat_filing_frequency,
            COALESCE(vat_period_start_month, 1) AS vat_period_start_month,
            COALESCE(vat_auto_calculate, true) AS vat_auto_calculate,
            COALESCE(exempt_supply_ratio, 0) AS exempt_supply_ratio
     FROM companies
     WHERE id = $1`,
    [companyId],
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0] as Record<string, unknown>;
  return {
    id: String(r.id),
    emirate: String(r.emirate),
    trnVatNumber: (r.trn_vat_number as string | null) ?? null,
    vatFilingFrequency: (r.vat_filing_frequency as string | null) ?? null,
    vatPeriodStartMonth: Number(r.vat_period_start_month) || 1,
    vatAutoCalculate: Boolean(r.vat_auto_calculate),
    exemptSupplyRatio: Number(r.exempt_supply_ratio) || 0,
  };
}

export function frequencyFromCompany(value: string | null | undefined): VatFrequency {
  return value === 'Monthly' ? 'monthly' : 'quarterly';
}

/**
 * Calculate the VAT 201 return for a company over the given period.
 * If no period is supplied, detect the current one from company config.
 *
 * Throws if the company is not found or has no TRN.
 */
export async function calculateVatReturn(
  companyId: string,
  period?: VatPeriod,
  now: Date = new Date(),
): Promise<VatAutopilotCalculation> {
  const company = await loadCompanyConfig(companyId);
  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }
  if (!company.trnVatNumber) {
    throw new Error('Company must have a TRN/VAT number to calculate a VAT return');
  }

  const frequency = frequencyFromCompany(company.vatFilingFrequency);
  const resolvedPeriod = period ?? detectPeriod(frequency, company.vatPeriodStartMonth, now);

  // ── Sales side ────────────────────────────────────────────────────────────
  // Pull invoice lines for the period in a single query. We exclude draft,
  // void, and cancelled invoices because they create no VAT obligation.
  const invoiceLineRes = await pool.query(
    `SELECT il.quantity::numeric AS quantity,
            il.unit_price::numeric AS unit_price,
            il.vat_rate::numeric AS vat_rate,
            il.vat_supply_type AS vat_supply_type,
            i.id AS invoice_id
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
     WHERE i.company_id = $1
       AND i.date >= $2 AND i.date <= $3
       AND i.status NOT IN ('void','draft','cancelled')`,
    [companyId, resolvedPeriod.start, resolvedPeriod.end],
  );

  const invoiceIdSet = new Set<string>();
  const lines: InvoiceLineForVat[] = (invoiceLineRes.rows as Array<Record<string, unknown>>).map(row => {
    invoiceIdSet.add(String(row.invoice_id));
    return {
      quantity: Number(row.quantity) || 0,
      unitPrice: Number(row.unit_price) || 0,
      vatRate: row.vat_rate === null ? null : Number(row.vat_rate),
      vatSupplyType: row.vat_supply_type as InvoiceLineForVat['vatSupplyType'],
    };
  });
  const sales = aggregateInvoiceLines(lines);

  // ── Purchases side ────────────────────────────────────────────────────────
  // Posted receipts only — drafts cannot support input VAT recovery.
  const receiptRes = await pool.query(
    `SELECT id,
            COALESCE(amount, 0)::numeric AS amount,
            COALESCE(vat_amount, 0)::numeric AS vat_amount,
            reverse_charge,
            currency,
            COALESCE(exchange_rate, 1)::numeric AS exchange_rate
     FROM receipts
     WHERE company_id = $1
       AND posted = true
       AND COALESCE(date, created_at) >= $2
       AND COALESCE(date, created_at) <= $3`,
    [companyId, resolvedPeriod.start, resolvedPeriod.end],
  );

  let totalExpenses = 0;
  let inputVatGross = 0;
  let receiptReverseChargeAmount = 0;
  let receiptReverseChargeVat = 0;
  for (const row of receiptRes.rows as Array<Record<string, unknown>>) {
    const amount = Number(row.amount) || 0;
    const vat = Number(row.vat_amount) || 0;
    const rate = Number(row.exchange_rate) || 1;
    const currency = String(row.currency || 'AED');
    // Convert to AED if the receipt is in foreign currency. Receipts already
    // store base_currency_amount but only on insertion — for safety we
    // recompute when the source currency isn't AED.
    const aedAmount = currency === 'AED' ? amount : convertToAed(amount, rate);
    const aedVat = currency === 'AED' ? vat : convertToAed(vat, rate);
    if (row.reverse_charge) {
      receiptReverseChargeAmount += aedAmount;
      receiptReverseChargeVat += aedVat;
    } else {
      totalExpenses += aedAmount;
      inputVatGross += aedVat;
    }
  }

  // Reverse-charge bills come from the bill-pay schema which isn't always
  // installed in dev — only swallow the missing-table case, surface anything
  // else (a real query failure must not silently mask reverse-charge VAT).
  let billReverseChargeAmount = 0;
  let billReverseChargeVat = 0;
  try {
    const billRes = await pool.query(
      `SELECT COALESCE(SUM(subtotal), 0) AS amount,
              COALESCE(SUM(vat_amount), 0) AS vat
       FROM vendor_bills
       WHERE company_id = $1
         AND reverse_charge = true
         AND bill_date >= $2 AND bill_date <= $3
         AND status NOT IN ('void','cancelled','draft')`,
      [companyId, resolvedPeriod.start, resolvedPeriod.end],
    );
    billReverseChargeAmount = Number(billRes.rows[0]?.amount || 0);
    billReverseChargeVat = Number(billRes.rows[0]?.vat || 0);
  } catch (err) {
    // PG SQLSTATE 42P01 = undefined_table. Anything else is a real error.
    if ((err as { code?: string })?.code !== '42P01') throw err;
  }

  const reverseChargeAmount = receiptReverseChargeAmount + billReverseChargeAmount;
  const reverseChargeVat = receiptReverseChargeVat + billReverseChargeVat;

  const partialExemption = applyPartialExemption(inputVatGross, company.exemptSupplyRatio);
  const reverseChargePartial = applyPartialExemption(reverseChargeVat, company.exemptSupplyRatio);

  const totalOutputVat = round2(sales.standardRatedVat + reverseChargeVat);
  const totalInputVat = round2(partialExemption.recoverable + reverseChargePartial.recoverable);

  const boxes: VatBoxBreakdown = {
    standardRatedSales: sales.standardRatedAmount,
    standardRatedVat: sales.standardRatedVat,
    zeroRatedSales: sales.zeroRatedAmount,
    exemptSales: sales.exemptAmount,
    reverseChargeAmount: round2(reverseChargeAmount),
    reverseChargeVat: round2(reverseChargeVat),
    totalOutputVat,
    totalExpenses: round2(totalExpenses),
    inputVatGross: round2(inputVatGross),
    inputVatRecoverable: partialExemption.recoverable,
    inputVatIrrecoverable: partialExemption.irrecoverable,
    reverseChargeVatRecoverable: reverseChargePartial.recoverable,
    totalInputVat,
    netVatPayable: round2(totalOutputVat - totalInputVat),
  };

  // ── Reconciliation against the journal ───────────────────────────────────
  const ledgerRes = await pool.query(
    `SELECT a.vat_type, COALESCE(SUM(jl.credit), 0) AS credit_total,
                          COALESCE(SUM(jl.debit), 0) AS debit_total
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = $1
       AND je.status = 'posted'
       AND je.date >= $2 AND je.date <= $3
       AND a.is_vat_account = true
     GROUP BY a.vat_type`,
    [companyId, resolvedPeriod.start, resolvedPeriod.end],
  );
  let outputLedger = 0;
  let inputLedger = 0;
  for (const row of ledgerRes.rows as Array<Record<string, unknown>>) {
    const vatType = String(row.vat_type || '');
    const credit = Number(row.credit_total) || 0;
    const debit = Number(row.debit_total) || 0;
    if (vatType === 'output') outputLedger += credit - debit;
    else if (vatType === 'input') inputLedger += debit - credit;
  }

  const reconciliation = reconcile(
    { outputVat: totalOutputVat, inputVat: totalInputVat },
    { outputVat: outputLedger, inputVat: inputLedger },
  );

  const vat201 = buildVat201Boxes(
    {
      standardRatedAmount: sales.standardRatedAmount,
      standardRatedVat: sales.standardRatedVat,
      zeroRatedAmount: sales.zeroRatedAmount,
      exemptAmount: sales.exemptAmount,
      reverseChargeAmount: boxes.reverseChargeAmount,
      reverseChargeVat: boxes.reverseChargeVat,
      reverseChargeVatRecoverable: boxes.reverseChargeVatRecoverable,
      totalExpenses: boxes.totalExpenses,
      inputVatRecoverable: boxes.inputVatRecoverable,
    },
    company.emirate,
  );

  return {
    companyId,
    period: resolvedPeriod,
    boxes,
    reconciliation,
    invoicesProcessed: invoiceIdSet.size,
    receiptsProcessed: receiptRes.rows.length,
    partialExemption: {
      exemptSupplyRatio: company.exemptSupplyRatio,
      recoverableRatio: partialExemption.recoverableRatio,
    },
    vat201,
  };
}

/**
 * Persist the latest auto-calculated snapshot to vat_return_periods so the
 * dashboard can show last-calculated totals without re-running aggregation.
 * Upserts on (company_id, period_start, period_end).
 */
export async function upsertCalculatedPeriod(
  calc: VatAutopilotCalculation,
): Promise<string> {
  const res = await pool.query(
    `INSERT INTO vat_return_periods
       (company_id, period_start, period_end, due_date, frequency,
        output_vat, input_vat, net_vat_payable, calculated_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (company_id, period_start, period_end)
     DO UPDATE SET output_vat = EXCLUDED.output_vat,
                   input_vat = EXCLUDED.input_vat,
                   net_vat_payable = EXCLUDED.net_vat_payable,
                   calculated_at = now(),
                   updated_at = now()
     RETURNING id`,
    [
      calc.companyId,
      calc.period.start,
      calc.period.end,
      calc.period.dueDate,
      calc.period.frequency,
      calc.boxes.totalOutputVat,
      calc.boxes.totalInputVat,
      calc.boxes.netVatPayable,
    ],
  );
  return String(res.rows[0].id);
}

/**
 * List all VAT periods for a company. Recent periods that haven't been
 * persisted yet are generated synthetically so the UI can show a continuous
 * history even on a brand-new account.
 */
export async function listPeriodsForCompany(
  companyId: string,
  now: Date = new Date(),
  recentCount = 8,
): Promise<VatPeriodSummary[]> {
  const company = await loadCompanyConfig(companyId);
  if (!company) return [];
  const frequency = frequencyFromCompany(company.vatFilingFrequency);
  const synthetic = listRecentPeriods(frequency, company.vatPeriodStartMonth, recentCount, now);

  const stored = await pool.query(
    `SELECT id, period_start, period_end, due_date, frequency, status,
            output_vat::numeric AS output_vat,
            input_vat::numeric AS input_vat,
            net_vat_payable::numeric AS net_vat_payable,
            calculated_at
     FROM vat_return_periods
     WHERE company_id = $1
     ORDER BY period_end DESC
     LIMIT $2`,
    [companyId, recentCount * 2],
  );

  interface StoredPeriodRow {
    id: string;
    period_start: string | Date;
    period_end: string | Date;
    due_date: string | Date;
    frequency: string;
    status: string;
    output_vat: string | number;
    input_vat: string | number;
    net_vat_payable: string | number;
    calculated_at: string | Date | null;
  }

  const storedByKey = new Map<string, StoredPeriodRow>();
  for (const row of stored.rows as StoredPeriodRow[]) {
    const key = `${new Date(row.period_start).toISOString()}::${new Date(row.period_end).toISOString()}`;
    storedByKey.set(key, row);
  }

  const summaries: VatPeriodSummary[] = synthetic.map(p => {
    const key = `${p.start.toISOString()}::${p.end.toISOString()}`;
    const row = storedByKey.get(key);
    if (row) storedByKey.delete(key);
    return {
      id: row ? String(row.id) : null,
      companyId,
      periodStart: p.start.toISOString(),
      periodEnd: p.end.toISOString(),
      dueDate: p.dueDate.toISOString(),
      frequency,
      status: (row?.status as VatPeriodStatus) || 'draft',
      outputVat: Number(row?.output_vat) || 0,
      inputVat: Number(row?.input_vat) || 0,
      netVatPayable: Number(row?.net_vat_payable) || 0,
      calculatedAt: row?.calculated_at ? new Date(row.calculated_at).toISOString() : null,
      deadline: deadlineStatus(p.dueDate, now),
    };
  });

  // Add any stored periods that didn't match a synthetic slot (older history).
  for (const row of storedByKey.values()) {
    const due = new Date(row.due_date);
    summaries.push({
      id: String(row.id),
      companyId,
      periodStart: new Date(row.period_start).toISOString(),
      periodEnd: new Date(row.period_end).toISOString(),
      dueDate: due.toISOString(),
      frequency: (row.frequency as VatFrequency) || frequency,
      status: row.status as VatPeriodStatus,
      outputVat: Number(row.output_vat) || 0,
      inputVat: Number(row.input_vat) || 0,
      netVatPayable: Number(row.net_vat_payable) || 0,
      calculatedAt: row.calculated_at ? new Date(row.calculated_at).toISOString() : null,
      deadline: deadlineStatus(due, now),
    });
  }

  summaries.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return summaries;
}

/**
 * Add a manual adjustment to an open period. Adjustments are append-only —
 * they form an audit trail visible in the period record.
 *
 * `companyId` is required and the UPDATE filters on it as a defense-in-depth
 * boundary in case a caller forgets to verify period ownership at the route.
 */
export async function addAdjustment(input: {
  periodId: string;
  companyId: string;
  box: string;
  amount: number;
  reason: string;
  userId: string;
}): Promise<SavedAdjustment> {
  // Reject NaN / Infinity — `typeof NaN === 'number'` so the route-level
  // typeof check isn't sufficient; persisting them corrupts the audit trail.
  if (!Number.isFinite(input.amount)) {
    throw new Error('Adjustment amount must be a finite number');
  }
  if (!isValidVat201BoxKey(input.box)) {
    throw new Error(`Unknown VAT 201 box key: ${input.box}`);
  }
  const adjustment: SavedAdjustment = {
    id: cryptoRandomId(),
    box: input.box,
    amount: round2(input.amount),
    reason: input.reason,
    userId: input.userId,
    createdAt: new Date().toISOString(),
  };
  const res = await pool.query(
    `UPDATE vat_return_periods
     SET adjustments = COALESCE(adjustments, '[]'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1
       AND company_id = $2
       AND status IN ('draft','ready')
     RETURNING id`,
    [input.periodId, input.companyId, JSON.stringify(adjustment)],
  );
  if (res.rows.length === 0) {
    throw new Error('Period not found or no longer editable');
  }
  return adjustment;
}

/**
 * Update the lifecycle status of a period. Status transitions are forward-only
 * and may not skip stages:
 *   draft → ready → submitted → accepted
 * Same-status no-ops are allowed (e.g. re-marking submitted to attach an FTA
 * reference number) so the UI doesn't have to special-case them.
 *
 * `companyId` is required so the SQL filter rejects cross-tenant attempts even
 * if the caller forgot to verify ownership at the route.
 */
const STATUS_RANK: Record<VatPeriodStatus, number> = {
  draft: 0, ready: 1, submitted: 2, accepted: 3,
};

export async function updatePeriodStatus(input: {
  periodId: string;
  companyId: string;
  newStatus: VatPeriodStatus;
  userId: string;
  ftaReferenceNumber?: string;
}): Promise<VatPeriodSummary | null> {
  const cur = await pool.query(
    `SELECT id, company_id, status FROM vat_return_periods
     WHERE id = $1 AND company_id = $2`,
    [input.periodId, input.companyId],
  );
  if (cur.rows.length === 0) return null;
  const currentStatus = cur.rows[0].status as VatPeriodStatus;
  const cur_rank = STATUS_RANK[currentStatus];
  const new_rank = STATUS_RANK[input.newStatus];
  // Forward-only, single-step (or same-status no-op). Reject backwards moves
  // and skips like draft→submitted or ready→accepted.
  if (new_rank < cur_rank || new_rank > cur_rank + 1) {
    throw new Error(`Cannot transition VAT period from '${currentStatus}' to '${input.newStatus}'`);
  }
  const setSubmitted = input.newStatus === 'submitted' || input.newStatus === 'accepted';
  await pool.query(
    `UPDATE vat_return_periods
     SET status = $2,
         submitted_at = CASE WHEN $3::boolean AND submitted_at IS NULL THEN now() ELSE submitted_at END,
         submitted_by = CASE WHEN $3::boolean AND submitted_by IS NULL THEN $4::uuid ELSE submitted_by END,
         fta_reference_number = COALESCE($5, fta_reference_number),
         updated_at = now()
     WHERE id = $1 AND company_id = $6`,
    [
      input.periodId,
      input.newStatus,
      setSubmitted,
      input.userId,
      input.ftaReferenceNumber ?? null,
      input.companyId,
    ],
  );
  // Return refreshed summary
  const companyId = String(cur.rows[0].company_id);
  const summaries = await listPeriodsForCompany(companyId);
  return summaries.find(s => s.id === input.periodId) || null;
}

/**
 * Firm-wide due-date view. Returns all upcoming and recently-due VAT periods
 * across the supplied company IDs.
 */
export async function listDueDates(
  companyIds: string[],
  now: Date = new Date(),
): Promise<DueDateView[]> {
  if (companyIds.length === 0) return [];
  const companyRes = await pool.query(
    `SELECT id, name, trn_vat_number,
            COALESCE(vat_filing_frequency, 'Quarterly') AS vat_filing_frequency,
            COALESCE(vat_period_start_month, 1) AS vat_period_start_month
     FROM companies
     WHERE id = ANY($1::uuid[])`,
    [companyIds],
  );
  const periodRes = await pool.query(
    `SELECT id, company_id, period_end, due_date, status
     FROM vat_return_periods
     WHERE company_id = ANY($1::uuid[])
       AND status IN ('draft','ready')`,
    [companyIds],
  );
  const storedByCompany = new Map<string, any>();
  for (const row of periodRes.rows) {
    const key = String(row.company_id);
    const existing = storedByCompany.get(key);
    if (!existing || new Date(row.due_date) < new Date(existing.due_date)) {
      storedByCompany.set(key, row);
    }
  }

  const out: DueDateView[] = [];
  for (const c of companyRes.rows as Array<Record<string, unknown>>) {
    const cid = String(c.id);
    const stored = storedByCompany.get(cid);
    let periodEnd: Date;
    let dueDate: Date;
    let status: VatPeriodStatus = 'draft';
    if (stored) {
      periodEnd = new Date(stored.period_end);
      dueDate = new Date(stored.due_date);
      status = stored.status as VatPeriodStatus;
    } else {
      const freq = frequencyFromCompany(String(c.vat_filing_frequency));
      const period = detectPeriod(freq, Number(c.vat_period_start_month), now);
      periodEnd = period.end;
      dueDate = period.dueDate;
    }
    const dl = deadlineStatus(dueDate, now);
    out.push({
      companyId: cid,
      companyName: String(c.name),
      trnVatNumber: (c.trn_vat_number as string | null) ?? null,
      periodEnd,
      dueDate,
      status,
      daysUntilDue: dl.daysUntilDue,
      level: dl.level,
    });
  }
  out.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return out;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function cryptoRandomId(): string {
  return randomUUID();
}
