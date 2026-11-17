/**
 * The VAT engine (W4-E, R07-03). The ONE implementation of the UAE VAT 201 return: vat.routes
 * generate, VAT autopilot, the reports vat-summary / vat-return handlers and the firm VAT
 * workspace all call `computeVat201` and nothing else.
 *
 * Sources (all converted to AED at the document's own rate, integer fils, one rounding per
 * document and bucket):
 *   - issued invoices, debit notes and credit notes (invoice_lines.net_amount + vat_supply_type
 *     via classifySupply; Box 1 by the invoice's place-of-supply emirate — never a default)
 *   - approved vendor bills (lines' supply type; reverse charge; imports from customs VAT;
 *     designated zone; partial recovery %) and vendor debit notes
 *   - posted receipts (recoverable / blocked split recorded at posting, receipt_vat_treatments)
 *   - bad-debt relief claims and their reversals
 *   - return adjustments (tourist refunds, import adjustments, corrections / voluntary disclosure)
 *   - manual VAT journal lines: lines on VAT control accounts whose entry did not come from one
 *     of the documents above, included as adjustments with their source.
 * Partial-exemption apportionment (company.exempt_supply_ratio, Art. 55) reduces recoverable
 * input VAT. VAT groups aggregate members and eliminate intra-group supplies (TRN match).
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { DomainError } from "../errors";
import { invoiceLines, invoices, type Invoice, type InvoiceLine } from "../../shared/schema";
import { toFils } from "../../shared/money";
import { classifySupply, type Vat201Family } from "../../shared/vat-classification";
import { totalsForStoredDocument } from "../services/invoice-posting.service";
import { ledgerLines } from "../reporting";
import { loadBaseCurrency } from "../ledger";
import { has, resolve } from "../platform/service-registry";
import type { FxToVatFilingCurrency } from "../services/fx";
import {
  addDelta,
  boxesToAed,
  deriveTotals,
  emptyBoxes,
  familyNeedsEmirate,
  inputEffect,
  normaliseEmirate,
  outputEffect,
  purchaseDelta,
  purchaseKindFor,
  recoverableShare,
  salesDelta,
  toBaseFils,
  EMIRATE_BOX_PREFIX,
  type BoxDelta,
  type Emirate,
  type Vat201Aed,
  type Vat201Fils,
  type Vat201Key,
} from "./vat-boxes";
import { frequencyOf, vatDueDate, type VatFrequency } from "./vat-periods";
import { computePartialExemption, type PartialExemptionResult } from "./partial-exemption";
import {
  buildReconciliation,
  categoryForSource,
  type ReconCategory,
  type VatReconciliation,
} from "./vat-reconciliation";

export const VAT_ENGINE_VERSION = "w4e-1";

export type VatSourceType =
  | "invoice"
  | "credit_note"
  | "debit_note"
  | "bill"
  | "vendor_debit_note"
  | "receipt"
  | "fixed_asset_disposal"
  | "fixed_asset_acquisition"
  | "bad_debt_relief"
  | "bad_debt_relief_reversal"
  | "return_adjustment"
  | "partial_exemption"
  | "bank_line_entry"
  | "journal";

export interface VatContribution {
  sourceType: VatSourceType;
  sourceId: string;
  reference: string | null;
  date: string;
  counterparty: string | null;
  counterpartyTrn: string | null;
  emirate: Emirate | null;
  family: Vat201Family | "purchase" | "adjustment";
  /** Box deltas in fils. */
  boxes: BoxDelta;
  /** Reconciliation bucket. */
  category: ReconCategory;
  /** Whether this contribution is expected in the GL (false: return-only adjustment). */
  inLedger: boolean;
  /** Journal entry source when the contribution comes from the GL. */
  ledgerSource?: string;
  memo?: string | null;
  /** Box deltas in the functional currency when the return was converted into AED. */
  baseBoxes?: BoxDelta;
  /** A1 (C6): direct attribution of the input VAT (default residual). */
  attribution?: InputVatAttribution;
}

/** Exec. Reg. Art. 55: input VAT wholly for taxable / wholly for exempt supplies, or residual. */
export type InputVatAttribution = "taxable" | "exempt" | "residual";

export interface VatIssue {
  code:
    | "EMIRATE_MISSING"
    | "NO_EXCHANGE_RATE"
    | "COMPANY_EMIRATE_MISSING"
    | "INVALID_TRN"
    | "NO_TRN";
  message: string;
  documentType?: string;
  documentId?: string;
  reference?: string | null;
}

export interface VatCompanyConfig {
  id: string;
  name: string;
  trn: string | null;
  emirate: Emirate | null;
  frequency: VatFrequency;
  startMonth: number;
  exemptSupplyRatio: number;
  /** A1 (C6): partial exemption switched on for the company. */
  partialExemptionEnabled: boolean;
  /** Functional currency; the return is always filed in AED (fx.toVatFilingCurrency). */
  baseCurrency: string;
}

export interface VatFilingCurrency {
  baseCurrency: string;
  filingCurrency: "AED";
  /** True when the boxes were converted from the functional currency into AED. */
  converted: boolean;
  /** Rates used, by document date (AED per base unit). */
  rates: Array<{ date: string; rate: string }>;
}

export interface VatComputation {
  engineVersion: string;
  companyId: string;
  company: VatCompanyConfig;
  period: { from: string; to: string; dueDate: string };
  boxesFils: Vat201Fils;
  boxes: Vat201Aed;
  contributions: VatContribution[];
  excluded: {
    outOfScopeFils: number;
    outOfScope: Array<{
      sourceType: string;
      sourceId: string;
      reference: string | null;
      netFils: number;
    }>;
    intraGroup: Array<{ sourceType: string; sourceId: string; reference: string | null }>;
  };
  issues: VatIssue[];
  complete: boolean;
  partialExemption: Partial<PartialExemptionResult> & {
    exemptSupplyRatio: number;
    recoverableRatio: number;
    grossInputVatFils: number;
    apportionedFils: number;
    /** Irrecoverable input VAT already posted to the GL (Dr 5160 / Cr 1050) for the period. */
    postedFils?: number;
    unpostedFils?: number;
  };
  counts: Record<string, number>;
  reconciliation: VatReconciliation;
  group: null | { groupId: string; name: string; groupTrn: string; memberIds: string[] };
  /** S1 (W5-C, R14-19): currency of the boxes; reconciliation stays in the functional currency. */
  currency: VatFilingCurrency;
}

export interface ComputeVatInput {
  companyId: string;
  from: string;
  to: string;
  /** Reports: collect blocking issues instead of throwing 422. */
  allowIncomplete?: boolean;
  /** Representative member: aggregate the VAT group's members. Default true when grouped. */
  includeGroup?: boolean;
}

// ─── Company config ──────────────────────────────────────────────────────

export async function loadVatCompany(companyId: string): Promise<VatCompanyConfig> {
  const { rows } = await pool.query(
    `SELECT id, name, emirate, trn_vat_number, vat_filing_frequency,
            COALESCE(vat_period_start_month, 1) AS start_month,
            COALESCE(exempt_supply_ratio, 0) AS exempt_ratio, company_type,
            COALESCE(partial_exemption_enabled, false) AS partial_exemption_enabled,
            COALESCE(NULLIF(base_currency, ''), 'AED') AS base_currency
       FROM companies WHERE id = $1`,
    [companyId]
  );
  const r = rows[0];
  if (!r) throw new DomainError("COMPANY_NOT_FOUND", 404);
  let startMonth = Number(r.start_month) || 1;
  try {
    const { resolveNrClientVatPeriodStartMonth } = await import("../services/firm-clients.service");
    startMonth = resolveNrClientVatPeriodStartMonth(
      String(r.name),
      startMonth,
      (r.company_type as string | null) ?? null
    );
  } catch {
    // firm module unavailable: keep the stored month
  }
  return {
    id: r.id,
    name: r.name,
    trn: r.trn_vat_number ?? null,
    emirate: normaliseEmirate(r.emirate),
    frequency: frequencyOf(r.vat_filing_frequency),
    startMonth,
    // A1: the column is selected as exempt_ratio (reading exempt_supply_ratio was always 0).
    exemptSupplyRatio: Math.min(1, Math.max(0, Number(r.exempt_ratio) || 0)),
    partialExemptionEnabled: r.partial_exemption_enabled === true,
    baseCurrency: String(r.base_currency || VAT_FILING_CURRENCY).toUpperCase(),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

const fils = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

const isoOf = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10);

/**
 * The document's rate into the company's functional (base) currency: "1" for a document in the
 * base currency (S1: not hard-coded AED, so a USD company's AED invoice uses its stored rate).
 */
function rateText(currency: unknown, rate: unknown, base = "AED"): string | null {
  const cur = String(currency || base).toUpperCase();
  if (cur === base) return "1";
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(rate);
}

const DOC_SOURCES = new Set([
  "invoice",
  "bill",
  "bill_reversal",
  "receipt",
  "vendor_debit_note",
  "vat_bad_debt_relief",
  "fixed_asset",
  "vat_partial_exemption",
]);

// ─── main ────────────────────────────────────────────────────────────────

export async function computeVat201(input: ComputeVatInput): Promise<VatComputation> {
  const company = await loadVatCompany(input.companyId);
  const group = await loadVatGroupForRepresentative(input.companyId);
  if (group && input.includeGroup !== false) {
    return computeGroup(input, company, group);
  }
  const single = await computeSingle(input, company, new Set());
  if (!input.allowIncomplete && single.issues.length > 0) throwBlocking(single.issues);
  return single;
}

function throwBlocking(issues: VatIssue[]): never {
  const first = issues[0];
  const emirate = issues.filter((i) => i.code === "EMIRATE_MISSING");
  if (emirate.length > 0) {
    throw new DomainError(
      "EMIRATE_MISSING",
      422,
      {
        documents: emirate.map((i) => ({
          documentType: i.documentType,
          documentId: i.documentId,
          reference: i.reference,
        })),
      },
      `Box 1 needs the emirate of supply for every standard-rated supply. Set it on: ${emirate
        .map((i) => i.reference || i.documentId)
        .join(", ")}`
    );
  }
  throw new DomainError(first.code, 422, { issues }, first.message);
}

async function computeSingle(
  input: ComputeVatInput,
  company: VatCompanyConfig,
  eliminateTrns: Set<string>
): Promise<VatComputation> {
  const { companyId, from, to } = input;
  const boxes = emptyBoxes();
  const contributions: VatContribution[] = [];
  const issues: VatIssue[] = [];
  const excluded: VatComputation["excluded"] = {
    outOfScopeFils: 0,
    outOfScope: [],
    intraGroup: [],
  };
  const counts: Record<string, number> = {
    invoices: 0,
    creditNotes: 0,
    debitNotes: 0,
    bills: 0,
    vendorDebitNotes: 0,
    receipts: 0,
    fixedAssetDisposals: 0,
    badDebtRelief: 0,
    returnAdjustments: 0,
    journalAdjustments: 0,
  };
  const push = (c: VatContribution) => {
    contributions.push(c);
    addDelta(boxes, c.boxes);
  };

  await collectInvoices(companyId, from, to, eliminateTrns, push, issues, excluded, counts);
  await collectBills(companyId, from, to, eliminateTrns, push, excluded, counts);
  await collectVendorDebitNotes(companyId, from, to, push, counts);
  await collectReceipts(companyId, from, to, eliminateTrns, push, counts);
  await collectFixedAssetDisposals(companyId, from, to, company, push, issues, counts);
  await collectFixedAssetAcquisitions(companyId, from, to, push, counts);
  await collectBadDebtRelief(companyId, from, to, push, counts);
  await collectReturnAdjustments(companyId, from, to, company, push, issues, counts);
  const bankEntries = await collectBankLineEntries(
    companyId,
    from,
    to,
    company,
    push,
    issues,
    counts
  );
  const vatAccounts = await loadVatAccounts(companyId);
  const gl = await collectLedger(companyId, from, to, vatAccounts, bankEntries);
  for (const j of gl.manual) {
    const delta: BoxDelta = {};
    if (j.outputFils !== 0) {
      if (!company.emirate) {
        issues.push({
          code: "COMPANY_EMIRATE_MISSING",
          message:
            "Set the company's emirate: manual output-VAT journal adjustments are reported in its Box 1 adjustment column.",
          documentType: "journal",
          documentId: j.entryId,
          reference: j.entryNumber,
        });
      } else {
        delta[`${EMIRATE_BOX_PREFIX[company.emirate]}Adj` as Vat201Key] = j.outputFils;
      }
    }
    if (j.inputFils !== 0) delta.box9ExpensesAdj = j.inputFils;
    counts.journalAdjustments += 1;
    push({
      sourceType: "journal",
      sourceId: j.entryId,
      reference: j.entryNumber,
      date: j.date,
      counterparty: null,
      counterpartyTrn: null,
      emirate: company.emirate,
      family: "adjustment",
      boxes: delta,
      category: categoryForSource(j.source),
      inLedger: true,
      ledgerSource: j.source,
      memo: j.memo,
    });
  }

  // A1 (C6, Exec. Reg. Art. 55): direct attribution first, then the residual input VAT is
  // apportioned by the period's standard-method ratio. The irrecoverable part is a GL cost
  // (posted when the return is made ready / submitted), so the contribution is in the ledger.
  const pe = computePartialExemption(boxes, contributions, {
    enabled: company.partialExemptionEnabled || company.exemptSupplyRatio > 0,
    fallbackExemptRatio: company.exemptSupplyRatio,
  });
  const grossInputVatFils = pe.grossInputVatFils;
  const apportionedFils = pe.apportionedFils;
  const postedPartialExemptionFils = -(gl.byCategory.get("partial_exemption")?.input ?? 0);
  if (apportionedFils !== 0) {
    push({
      sourceType: "partial_exemption",
      sourceId: companyId,
      reference: `Art. 55 ${pe.method} method: ${(pe.recoverableRatio * 100).toFixed(2)}% of residual input VAT recoverable`,
      date: to,
      counterparty: null,
      counterpartyTrn: null,
      emirate: null,
      family: "adjustment",
      boxes: pe.delta,
      category: "partial_exemption",
      inLedger: true,
      ledgerSource: "vat_partial_exemption",
    });
  }

  // The VAT-to-GL reconciliation compares like with like: functional currency.
  const reconciliation = buildReconciliation({
    boxes: deriveTotals(boxes),
    contributions,
    ledgerByCategory: gl.byCategory,
    hasVatAccounts: vatAccounts.length > 0,
  });
  // S1 (W5-C, R14-19): the return is filed in AED whatever the functional currency.
  const currency = await convertToFilingCurrency(companyId, company, contributions, issues);
  const filed = emptyBoxes();
  for (const c of contributions) addDelta(filed, c.boxes);
  const boxesFils = deriveTotals(currency.converted ? filed : boxes);

  const result: VatComputation = {
    engineVersion: VAT_ENGINE_VERSION,
    companyId,
    company,
    period: { from, to, dueDate: vatDueDate(to) },
    currency,
    boxesFils,
    boxes: boxesToAed(boxesFils),
    contributions,
    excluded,
    issues,
    complete: issues.length === 0,
    partialExemption: {
      ...pe,
      exemptSupplyRatio: pe.exemptSupplyRatio,
      recoverableRatio: pe.recoverableRatio,
      grossInputVatFils,
      apportionedFils,
      postedFils: postedPartialExemptionFils,
      unpostedFils: apportionedFils - postedPartialExemptionFils,
    },
    counts,
    reconciliation,
    group: null,
  };
  ledgerByDate.set(result, gl.byCategoryDate);
  return result;
}

/** Internal: each single computation's VAT GL balances by (category, date), for group FX (S8). */
const ledgerByDate = new WeakMap<VatComputation, LedgerVat["byCategoryDate"]>();

// ─── Filing currency (S1, W5-C follow-up) ────────────────────────────────

const VAT_FILING_CURRENCY = "AED";

async function resolveToAed(): Promise<FxToVatFilingCurrency> {
  if (!has("fx.toVatFilingCurrency")) {
    const fx = await import("../services/fx");
    fx.registerFxServices();
  }
  return resolve<FxToVatFilingCurrency>("fx.toVatFilingCurrency");
}

/**
 * Convert every contribution's box deltas from the functional currency into AED at the document
 * date through `fx.toVatFilingCurrency` (identity for an AED company). Each delta is converted on
 * its own (integer fils, the FX service's rounding). A date without a rate is a blocking
 * NO_EXCHANGE_RATE issue; the contribution keeps its functional-currency figures.
 */
async function convertToFilingCurrency(
  companyId: string,
  company: VatCompanyConfig,
  contributions: VatContribution[],
  issues: VatIssue[]
): Promise<VatFilingCurrency> {
  const out: VatFilingCurrency = {
    baseCurrency: company.baseCurrency,
    filingCurrency: VAT_FILING_CURRENCY,
    converted: false,
    rates: [],
  };
  if (company.baseCurrency === VAT_FILING_CURRENCY || contributions.length === 0) return out;
  const toAed = await resolveToAed();
  const rates = new Map<string, string>();
  const missing = new Set<string>();
  for (const c of contributions) {
    if (missing.has(c.date)) continue;
    const converted: BoxDelta = {};
    try {
      for (const [key, value] of Object.entries(c.boxes) as Array<[Vat201Key, number]>) {
        if (!value) continue;
        const r = await toAed(companyId, value, c.date);
        converted[key] = r.fils;
        rates.set(c.date, r.rate);
      }
    } catch (err) {
      if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") {
        missing.add(c.date);
        issues.push({
          code: "NO_EXCHANGE_RATE",
          message: `No ${company.baseCurrency}→AED rate on or before ${c.date}: the VAT return is filed in AED`,
          documentType: c.sourceType,
          documentId: c.sourceId,
          reference: c.reference,
        });
        continue;
      }
      throw err;
    }
    c.baseBoxes = c.boxes;
    c.boxes = converted;
  }
  out.converted = true;
  out.rates = [...rates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rate]) => ({ date, rate }));
  return out;
}

// ─── Sales: invoices, debit notes, credit notes ──────────────────────────

async function collectInvoices(
  companyId: string,
  from: string,
  to: string,
  eliminateTrns: Set<string>,
  push: (c: VatContribution) => void,
  issues: VatIssue[],
  excluded: VatComputation["excluded"],
  counts: Record<string, number>
) {
  const baseCurrency = await loadBaseCurrency(companyId);
  const docs: Invoice[] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        gte(sql`(${invoices.date})::date`, sql`${from}::date`),
        lte(sql`(${invoices.date})::date`, sql`${to}::date`),
        sql`${invoices.status} NOT IN ('draft','void','cancelled')`
      )
    );
  if (docs.length === 0) return;
  const lines: InvoiceLine[] = await db
    .select()
    .from(invoiceLines)
    .where(
      inArray(
        invoiceLines.invoiceId,
        docs.map((d) => d.id)
      )
    );
  const byInvoice = new Map<string, InvoiceLine[]>();
  for (const l of lines) {
    const list = byInvoice.get(l.invoiceId) ?? [];
    list.push(l);
    byInvoice.set(l.invoiceId, list);
  }

  for (const inv of docs) {
    const type: VatSourceType =
      inv.invoiceType === "credit_note"
        ? "credit_note"
        : inv.invoiceType === "debit_note"
          ? "debit_note"
          : "invoice";
    if (inv.customerTrn && eliminateTrns.has(inv.customerTrn.trim())) {
      excluded.intraGroup.push({ sourceType: type, sourceId: inv.id, reference: inv.number });
      continue;
    }
    const docLines = byInvoice.get(inv.id) ?? [];
    if (docLines.length === 0) continue;
    if (type === "credit_note") counts.creditNotes += 1;
    else if (type === "debit_note") counts.debitNotes += 1;
    else counts.invoices += 1;

    const rate = rateText(inv.currency, inv.exchangeRate, baseCurrency);
    if (!rate) {
      issues.push({
        code: "NO_EXCHANGE_RATE",
        message: `Invoice ${inv.number} is in ${inv.currency} with no exchange rate`,
        documentType: type,
        documentId: inv.id,
        reference: inv.number,
      });
      continue;
    }
    const totals = totalsForStoredDocument(inv, docLines);
    const sign = type === "credit_note" ? -1 : 1;
    // Net per VAT 201 family, in document fils. invoice_lines.net_amount (after line and
    // allocated document discount, W3-A) wins over the recomputed net.
    const netByFamily = new Map<Vat201Family, number>();
    totals.lines.forEach((lt, i) => {
      const stored = docLines[i]?.netAmount;
      // S1 (R07-15): a profit-margin scheme line reports only its VAT-exclusive margin in Box 1.
      const net =
        lt.marginFils !== null
          ? Math.abs(lt.marginFils)
          : stored !== null && stored !== undefined
            ? Math.abs(fils(stored))
            : Math.abs(lt.netFils);
      const fam = classifySupply({
        supplyType: docLines[i]?.vatSupplyType,
        vatRate: docLines[i]?.vatRate,
        reverseCharge: inv.reverseCharge,
      }).vat201Family;
      netByFamily.set(fam, (netByFamily.get(fam) ?? 0) + net);
    });
    const emirate = normaliseEmirate(inv.placeOfSupplyEmirate);
    const needsEmirate = [...netByFamily.keys()].some(
      (f) => familyNeedsEmirate(f) && (netByFamily.get(f) ?? 0) !== 0
    );
    if (needsEmirate && !emirate) {
      issues.push({
        code: "EMIRATE_MISSING",
        message: `${inv.number}: place-of-supply emirate is missing`,
        documentType: type,
        documentId: inv.id,
        reference: inv.number,
      });
      continue;
    }
    const vatBase = toBaseFils(totals.vatFils, rate);
    for (const [family, netDoc] of netByFamily) {
      const netBase = toBaseFils(netDoc, rate);
      if (family === "out_of_scope") {
        excluded.outOfScopeFils += sign * netBase;
        excluded.outOfScope.push({
          sourceType: type,
          sourceId: inv.id,
          reference: inv.number,
          netFils: sign * netBase,
        });
        continue;
      }
      const vat = family === "standard" ? vatBase : 0;
      const delta = salesDelta(family, emirate, sign * netBase, sign * vat);
      push({
        sourceType: type,
        sourceId: inv.id,
        reference: inv.number,
        date: isoOf(inv.date),
        counterparty: inv.customerName,
        counterpartyTrn: inv.customerTrn ?? null,
        emirate: familyNeedsEmirate(family) ? emirate : null,
        family,
        boxes: delta,
        category: "sales",
        inLedger: true,
      });
    }
  }
}

// ─── Purchases: bills, vendor debit notes ────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return !!rows[0]?.t;
}

function attributionOf(v: unknown): InputVatAttribution {
  return v === "taxable" || v === "exempt" ? v : "residual";
}

/**
 * Box 6 amount of an import bill (base fils): customs value + duty from the declaration when
 * recorded; otherwise the value implied by the import VAT customs assessed (VAT / 5%); the
 * invoice net only when neither is known.
 */
function importValueFils(
  b: { customs_value?: unknown; customs_duty_amount?: unknown },
  subtotalBase: number,
  vatBase: number
): number {
  const customs = fils(b.customs_value);
  if (customs > 0) return customs + fils(b.customs_duty_amount);
  if (vatBase > 0) return vatBase * 20;
  return subtotalBase;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function collectBills(
  companyId: string,
  from: string,
  to: string,
  eliminateTrns: Set<string>,
  push: (c: VatContribution) => void,
  excluded: VatComputation["excluded"],
  counts: Record<string, number>
) {
  const baseCurrency = await loadBaseCurrency(companyId);
  if (!(await tableExists("vendor_bills"))) return;
  const a1Columns = (await columnExists("vendor_bills", "customs_value"))
    ? ", customs_value, customs_duty_amount, input_vat_attribution"
    : "";
  const { rows: bills } = await pool.query(
    `SELECT id, vendor_name, vendor_trn, bill_number, bill_date, currency, exchange_rate,
            subtotal, vat_amount, reverse_charge, COALESCE(is_import, false) AS is_import,
            COALESCE(designated_zone, false) AS designated_zone,
            COALESCE(recoverable_vat_percent, 100) AS recoverable_pct,
            recoverable_vat_base ${a1Columns}
       FROM vendor_bills
      WHERE company_id = $1
        AND bill_date::date >= $2::date AND bill_date::date <= $3::date
        AND status NOT IN ('draft','pending','void','cancelled','rejected')`,
    [companyId, from, to]
  );
  if (bills.length === 0) return;
  const { rows: lines } = await pool.query(
    `SELECT bill_id, amount, COALESCE(vat_amount, 0) AS vat_amount,
            COALESCE(vat_supply_type, 'standard_rated') AS vat_supply_type,
            COALESCE(reverse_charge, false) AS reverse_charge
       FROM bill_line_items WHERE bill_id = ANY($1::uuid[])`,
    [bills.map((b: { id: string }) => b.id)]
  );
  const byBill = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byBill.get(l.bill_id) ?? [];
    list.push(l);
    byBill.set(l.bill_id, list);
  }
  for (const b of bills) {
    const ref = b.bill_number || String(b.id).slice(0, 8);
    if (b.vendor_trn && eliminateTrns.has(String(b.vendor_trn).trim())) {
      excluded.intraGroup.push({ sourceType: "bill", sourceId: b.id, reference: ref });
      continue;
    }
    counts.bills += 1;
    const rate = rateText(b.currency, b.exchange_rate, baseCurrency) ?? "1";
    const pct = Number(b.recoverable_pct);
    const vatDoc = fils(b.vat_amount);
    const vatBase = toBaseFils(vatDoc, rate);
    // S2 (R05-28): bill posting stores the recoverable input VAT after the vat-recovery category
    // rules (blocked entertainment / personal-use vehicle VAT); it wins over the bill percentage.
    const ruleRecoverable =
      b.recoverable_vat_base === null || b.recoverable_vat_base === undefined
        ? null
        : Math.min(vatBase, Math.max(0, fils(b.recoverable_vat_base)));
    const recoverableTotal = ruleRecoverable ?? recoverableShare(vatBase, pct);
    /** Recoverable part of `partVat` (a slice of vatBase), consistent with recoverableTotal. */
    const recoverableOf = (partVat: number) =>
      ruleRecoverable === null
        ? recoverableShare(partVat, pct)
        : vatBase === 0
          ? 0
          : Math.round((ruleRecoverable * partVat) / vatBase);
    const base = {
      sourceType: "bill" as const,
      sourceId: b.id,
      reference: ref,
      date: isoOf(b.bill_date),
      counterparty: b.vendor_name ?? null,
      counterpartyTrn: b.vendor_trn ?? null,
      emirate: null,
      family: "purchase" as const,
      category: "purchases" as const,
      inLedger: true,
      attribution: attributionOf(b.input_vat_attribution),
    };
    const subtotalBase = toBaseFils(fils(b.subtotal), rate);
    if (b.is_import) {
      // A1 (M7): Box 6 reports the value on which customs assessed import VAT (FDL 8/2017
      // Art. 38: customs value + duty), not the supplier's invoice net.
      push({
        ...base,
        boxes: purchaseDelta(
          "import",
          importValueFils(b, subtotalBase, vatBase),
          vatBase,
          recoverableTotal
        ),
      });
      continue;
    }
    if (b.reverse_charge) {
      push({
        ...base,
        boxes: purchaseDelta("reverse_charge", subtotalBase, vatBase, recoverableTotal),
      });
      continue;
    }
    const billLines = byBill.get(b.id) ?? [];
    const lineVatSum = billLines.reduce(
      (s: number, l: { vat_amount: unknown }) => s + fils(l.vat_amount),
      0
    );
    if (billLines.length === 0 || (lineVatSum === 0 && vatDoc > 0)) {
      // Legacy bill with no line-level VAT: the whole subtotal carries the bill VAT.
      const kind = purchaseKindFor({ vatFils: vatDoc, designatedZone: b.designated_zone });
      push({ ...base, boxes: purchaseDelta(kind, subtotalBase, vatBase, recoverableTotal) });
      continue;
    }
    // Line-level: reverse-charge lines -> Box 3/10, VAT-bearing standard lines -> Box 9.
    let rcNet = 0;
    let rcVat = 0;
    let stdNet = 0;
    let stdVat = 0;
    for (const l of billLines) {
      const lv = fils(l.vat_amount);
      const kind = purchaseKindFor({
        supplyType: l.vat_supply_type,
        vatFils: lv,
        reverseCharge: l.reverse_charge,
        designatedZone: b.designated_zone,
      });
      if (kind === "reverse_charge") {
        rcNet += fils(l.amount);
        rcVat += lv;
      } else if (kind === "standard") {
        stdNet += fils(l.amount);
        stdVat += lv;
      }
    }
    const rcVatBase = toBaseFils(rcVat, rate);
    const stdVatBase = vatBase - rcVatBase;
    if (rcNet !== 0 || rcVat !== 0) {
      push({
        ...base,
        boxes: purchaseDelta(
          "reverse_charge",
          toBaseFils(rcNet, rate),
          rcVatBase,
          recoverableOf(rcVatBase)
        ),
      });
    }
    if (stdNet !== 0 || stdVat !== 0) {
      // Recoverable split mirrors bill posting: % of the whole bill VAT, less the RC share.
      const stdRecoverable = recoverableTotal - recoverableOf(rcVatBase);
      push({
        ...base,
        boxes: purchaseDelta("standard", toBaseFils(stdNet, rate), stdVatBase, stdRecoverable),
      });
    }
  }
}

async function collectVendorDebitNotes(
  companyId: string,
  from: string,
  to: string,
  push: (c: VatContribution) => void,
  counts: Record<string, number>
) {
  const baseCurrency = await loadBaseCurrency(companyId);
  if (!(await tableExists("vendor_debit_notes"))) return;
  const hasTreatment = await columnExists("vendor_debit_notes", "vat_treatment");
  const { rows } = await pool.query(
    `SELECT n.id, n.vendor_name, n.debit_note_number, n.note_date, n.currency, n.exchange_rate,
            n.subtotal, n.vat_amount
            ${hasTreatment ? ", n.vat_treatment, n.recoverable_vat_amount, b.input_vat_attribution" : ""}
       FROM vendor_debit_notes n
       ${hasTreatment ? "LEFT JOIN vendor_bills b ON b.id = n.bill_id AND b.company_id = n.company_id" : ""}
      WHERE n.company_id = $1 AND n.status <> 'void'
        AND n.note_date::date >= $2::date AND n.note_date::date <= $3::date`,
    [companyId, from, to]
  );
  for (const n of rows) {
    const rate = rateText(n.currency, n.exchange_rate, baseCurrency) ?? "1";
    const vat = toBaseFils(fils(n.vat_amount), rate);
    if (vat === 0) continue;
    const net = toBaseFils(fils(n.subtotal), rate);
    // A1 (C2): the note mirrors its bill. Legacy rows (no treatment) reversed the full VAT.
    const recoverable =
      n.recoverable_vat_amount === null || n.recoverable_vat_amount === undefined
        ? vat
        : Math.min(vat, toBaseFils(fils(n.recoverable_vat_amount), rate));
    const kind = n.vat_treatment === "reverse_charge" ? "reverse_charge" : "standard";
    const boxes = purchaseDelta(kind, -net, -vat, -recoverable);
    if (kind === "standard" && recoverable === 0) continue; // blocked VAT: never in Box 9
    counts.vendorDebitNotes += 1;
    push({
      sourceType: "vendor_debit_note",
      sourceId: n.id,
      reference: n.debit_note_number,
      date: isoOf(n.note_date),
      counterparty: n.vendor_name ?? null,
      counterpartyTrn: null,
      emirate: null,
      family: "purchase",
      boxes,
      category: "purchases",
      inLedger: true,
      attribution: attributionOf(n.input_vat_attribution),
    });
  }
}

// ─── Receipts ────────────────────────────────────────────────────────────

async function collectReceipts(
  companyId: string,
  from: string,
  to: string,
  eliminateTrns: Set<string>,
  push: (c: VatContribution) => void,
  counts: Record<string, number>
) {
  const baseCurrency = await loadBaseCurrency(companyId);
  const hasTreatments = await tableExists("receipt_vat_treatments");
  const { rows } = await pool.query(
    `SELECT r.id, r.merchant, r.supplier_trn, COALESCE(r.date, r.created_at) AS d, r.amount,
            r.vat_amount, r.currency, r.exchange_rate, r.reverse_charge, r.lines
            ${hasTreatments ? ", t.supply_type AS t_supply, t.vat_base AS t_vat, t.recoverable_vat AS t_rec, t.net_base AS t_net, t.receipt_id AS t_id" : ""}
       FROM receipts r
       ${hasTreatments ? "LEFT JOIN receipt_vat_treatments t ON t.receipt_id = r.id" : ""}
      WHERE r.company_id = $1 AND r.posted = true
        AND COALESCE(r.date, r.created_at)::date >= $2::date
        AND COALESCE(r.date, r.created_at)::date <= $3::date`,
    [companyId, from, to]
  );
  for (const r of rows) {
    if (r.supplier_trn && eliminateTrns.has(String(r.supplier_trn).trim())) continue;
    const rate = rateText(r.currency, r.exchange_rate, baseCurrency) ?? "1";
    const split: Array<{ amount: unknown; vatAmount?: unknown }> =
      Array.isArray(r.lines) && r.lines.length > 0
        ? r.lines
        : [{ amount: r.amount, vatAmount: r.vat_amount }];
    // Mirror receipt posting: each component converted on its own.
    let netBase = 0;
    let vatBase = 0;
    for (const c of split) {
      netBase += toBaseFils(fils(c.amount), rate);
      vatBase += toBaseFils(fils(c.vatAmount ?? 0), rate);
    }
    let recoverable = vatBase;
    let supplyType: string = "standard_rated";
    if (r.t_id) {
      vatBase = fils(r.t_vat);
      recoverable = fils(r.t_rec);
      netBase = fils(r.t_net) || netBase;
      supplyType = r.t_supply || supplyType;
    }
    const kind = purchaseKindFor({
      supplyType,
      vatFils: vatBase,
      reverseCharge: r.reverse_charge,
    });
    if (kind === "not_reportable") continue;
    counts.receipts += 1;
    push({
      sourceType: "receipt",
      sourceId: r.id,
      reference: r.merchant ?? null,
      date: isoOf(r.d),
      counterparty: r.merchant ?? null,
      counterpartyTrn: r.supplier_trn ?? null,
      emirate: null,
      family: "purchase",
      boxes: purchaseDelta(kind, netBase, vatBase, recoverable),
      category: "receipts",
      inLedger: true,
    });
  }
}

// ─── Fixed-asset disposals (W4-B dispose → source 'fixed_asset') ─────────

/**
 * A disposal for consideration is a supply by the business (W4-B disposeAsset posts Cr 2020
 * output VAT with journal source 'fixed_asset'). Reported at the disposal's recorded treatment:
 * standard-rated in the company's own emirate (the asset is supplied from its establishment),
 * zero-rated in Box 4, exempt in Box 5, out-of-scope nowhere. Disposals whose journal was
 * reversed are skipped; the GL side of 'fixed_asset' entries is reconciled under
 * "fixed_asset_disposals" (depreciation/capitalisation lines never touch VAT accounts).
 */
async function collectFixedAssetDisposals(
  companyId: string,
  from: string,
  to: string,
  company: VatCompanyConfig,
  push: (c: VatContribution) => void,
  issues: VatIssue[],
  counts: Record<string, number>
) {
  const { rows } = await pool.query(
    `SELECT fa.id, fa.asset_name, fa.asset_number, fa.buyer_name,
            to_char(fa.disposal_date, 'YYYY-MM-DD') AS d, fa.disposal_amount, fa.disposal_vat,
            fa.disposal_vat_treatment, fa.disposal_entry_id
       FROM fixed_assets fa
       JOIN journal_entries je ON je.id = fa.disposal_entry_id AND je.company_id = fa.company_id
      WHERE fa.company_id = $1 AND fa.status = 'disposed'
        AND fa.disposal_date >= $2::date AND fa.disposal_date <= $3::date
        AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL`,
    [companyId, from, to]
  );
  for (const r of rows) {
    const netFils = fils(r.disposal_amount);
    const vatFils = fils(r.disposal_vat);
    if (netFils === 0 && vatFils === 0) continue;
    const treatment: string = r.disposal_vat_treatment ?? (vatFils > 0 ? "standard" : "");
    const family: Vat201Family | null =
      treatment === "standard"
        ? "standard"
        : treatment === "zero_rated"
          ? "zero_rated"
          : treatment === "exempt"
            ? "exempt"
            : null;
    if (!family) continue; // out of scope (or legacy row without a treatment and no VAT)
    if (familyNeedsEmirate(family) && !company.emirate) {
      issues.push({
        code: "COMPANY_EMIRATE_MISSING",
        message:
          "Set the company's emirate: fixed-asset disposals are reported in the Box 1 row of the emirate the asset is supplied from.",
        documentType: "fixed_asset_disposal",
        documentId: r.id,
        reference: r.asset_number ?? r.asset_name ?? null,
      });
      continue;
    }
    counts.fixedAssetDisposals += 1;
    push({
      sourceType: "fixed_asset_disposal",
      sourceId: r.id,
      reference: r.asset_number ?? r.asset_name ?? null,
      date: r.d,
      counterparty: r.buyer_name ?? null,
      counterpartyTrn: null,
      emirate: familyNeedsEmirate(family) ? company.emirate : null,
      family,
      boxes: salesDelta(family, company.emirate, netFils, family === "standard" ? vatFils : 0),
      category: "fixed_asset_disposals",
      inLedger: true,
      ledgerSource: "fixed_asset",
    });
  }
}

/**
 * X4 (J3): recoverable input VAT paid with a capitalised fixed asset (fixed_assets.acquisition_vat,
 * Dr 1050 on the capitalisation entry) -> Box 9 standard-rated expenses, dated on the
 * capitalisation entry. Reversed capitalisations drop out.
 */
async function collectFixedAssetAcquisitions(
  companyId: string,
  from: string,
  to: string,
  push: (c: VatContribution) => void,
  counts: Record<string, number>
) {
  const { rows } = await pool.query(
    `SELECT fa.id, fa.asset_name, fa.asset_number, fa.purchase_cost, fa.acquisition_vat,
            to_char(je.date, 'YYYY-MM-DD') AS d
       FROM fixed_assets fa
       JOIN journal_entries je ON je.id = fa.capitalization_entry_id AND je.company_id = fa.company_id
      WHERE fa.company_id = $1 AND COALESCE(fa.acquisition_vat, 0) > 0
        AND je.date >= $2::date AND je.date <= $3::date
        AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL`,
    [companyId, from, to]
  );
  for (const r of rows) {
    const vatFils = fils(r.acquisition_vat);
    if (vatFils <= 0) continue;
    counts.fixedAssetAcquisitions = (counts.fixedAssetAcquisitions ?? 0) + 1;
    push({
      sourceType: "fixed_asset_acquisition",
      sourceId: r.id,
      reference: r.asset_number ?? r.asset_name ?? null,
      date: r.d,
      counterparty: null,
      counterpartyTrn: null,
      emirate: null,
      family: "purchase",
      boxes: { box9ExpensesAmount: fils(r.purchase_cost), box9ExpensesVat: vatFils },
      category: "fixed_asset_disposals",
      inLedger: true,
      ledgerSource: "fixed_asset",
    });
  }
}

// ─── Bad-debt relief, return adjustments ─────────────────────────────────

async function collectBadDebtRelief(
  companyId: string,
  from: string,
  to: string,
  push: (c: VatContribution) => void,
  counts: Record<string, number>
) {
  if (!(await tableExists("bad_debt_relief_claims"))) return;
  const { rows } = await pool.query(
    `SELECT c.id, c.invoice_id, c.claim_date::text AS claim_date, c.reversed_at::text AS reversed_at,
            c.emirate, c.vat_amount, c.taxable_amount, c.status, i.number, i.customer_name, i.customer_trn
       FROM bad_debt_relief_claims c JOIN invoices i ON i.id = c.invoice_id
      WHERE c.company_id = $1
        AND ((c.claim_date >= $2::date AND c.claim_date <= $3::date)
          OR (c.reversed_at IS NOT NULL AND c.reversed_at >= $2::date AND c.reversed_at <= $3::date))`,
    [companyId, from, to]
  );
  for (const c of rows) {
    const emirate = normaliseEmirate(c.emirate);
    if (!emirate) continue;
    const key = `${EMIRATE_BOX_PREFIX[emirate]}Adj` as Vat201Key;
    const vat = fils(c.vat_amount);
    const common = {
      reference: c.number,
      counterparty: c.customer_name ?? null,
      counterpartyTrn: c.customer_trn ?? null,
      emirate,
      family: "adjustment" as const,
      category: "bad_debt_relief" as const,
      inLedger: true,
    };
    if (c.claim_date >= from && c.claim_date <= to) {
      counts.badDebtRelief += 1;
      push({
        ...common,
        sourceType: "bad_debt_relief",
        sourceId: c.id,
        date: c.claim_date,
        boxes: { [key]: -vat },
      });
    }
    if (c.reversed_at && c.reversed_at >= from && c.reversed_at <= to) {
      push({
        ...common,
        sourceType: "bad_debt_relief_reversal",
        sourceId: c.id,
        date: c.reversed_at,
        boxes: { [key]: vat },
      });
    }
  }
}

export const RETURN_ADJUSTMENT_KINDS = [
  "tourist_refund",
  "import_adjustment",
  "output_correction",
  "input_correction",
  "voluntary_disclosure_output",
  "voluntary_disclosure_input",
] as const;
export type ReturnAdjustmentKind = (typeof RETURN_ADJUSTMENT_KINDS)[number];

/** Box mapping of a return adjustment (fils). Pure. */
export function returnAdjustmentDelta(
  kind: ReturnAdjustmentKind,
  emirate: Emirate | null,
  amountFils: number,
  vatFils: number
): BoxDelta {
  switch (kind) {
    case "tourist_refund":
      // Box 2 sits on the output side and reduces output tax: stored negative.
      return {
        box2TouristRefundAmount: -Math.abs(amountFils),
        box2TouristRefundVat: -Math.abs(vatFils),
      };
    case "import_adjustment":
      return { box7ImportsAdjAmount: amountFils, box7ImportsAdjVat: vatFils };
    case "output_correction":
    case "voluntary_disclosure_output": {
      if (!emirate)
        throw new DomainError(
          "EMIRATE_REQUIRED",
          422,
          undefined,
          "Output corrections need an emirate"
        );
      return { [`${EMIRATE_BOX_PREFIX[emirate]}Adj`]: vatFils } as BoxDelta;
    }
    case "input_correction":
    case "voluntary_disclosure_input":
      return { box9ExpensesAdj: vatFils };
  }
}

async function collectReturnAdjustments(
  companyId: string,
  from: string,
  to: string,
  company: VatCompanyConfig,
  push: (c: VatContribution) => void,
  issues: VatIssue[],
  counts: Record<string, number>
) {
  if (!(await tableExists("vat_return_adjustments"))) return;
  const { rows } = await pool.query(
    `SELECT id, kind, emirate, amount, vat_amount, reason, reference, period_end::text AS period_end
       FROM vat_return_adjustments
      WHERE company_id = $1 AND period_start = $2::date AND period_end = $3::date
      ORDER BY created_at`,
    [companyId, from, to]
  );
  for (const a of rows) {
    const emirate = normaliseEmirate(a.emirate) ?? company.emirate;
    let delta: BoxDelta;
    try {
      delta = returnAdjustmentDelta(a.kind, emirate, fils(a.amount), fils(a.vat_amount));
    } catch {
      issues.push({
        code: "COMPANY_EMIRATE_MISSING",
        message: `Adjustment ${a.reference || a.id} needs an emirate`,
        documentType: "return_adjustment",
        documentId: a.id,
        reference: a.reference,
      });
      continue;
    }
    counts.returnAdjustments += 1;
    push({
      sourceType: "return_adjustment",
      sourceId: a.id,
      reference: a.reference ?? a.kind,
      date: a.period_end,
      counterparty: null,
      counterpartyTrn: null,
      emirate,
      family: "adjustment",
      boxes: delta,
      category: "return_adjustments",
      inLedger: false,
      memo: a.reason,
    });
  }
}

// ─── Entries created from bank lines (A1: H7, M8) ────────────────────────

/**
 * An entry created from a bank statement line with a VAT treatment is an ordinary supply or
 * purchase, not an adjustment (FTA VAT 201 guide: the Adjustment column is for corrections and
 * bad-debt relief). Standard-rated outflow -> Box 9 amount + VAT; standard-rated inflow -> Box 1
 * of the company's emirate; zero-rated inflow -> Box 4; exempt inflow -> Box 5 (which also feeds
 * the partial-exemption ratio). Returns the journal entries reported here so the ledger pass does
 * not report them again as manual VAT journals. Unmatched (reversed) entries drop out.
 */
async function collectBankLineEntries(
  companyId: string,
  from: string,
  to: string,
  company: VatCompanyConfig,
  push: (c: VatContribution) => void,
  issues: VatIssue[],
  counts: Record<string, number>
): Promise<Set<string>> {
  const reported = new Set<string>();
  if (!(await columnExists("bank_transaction_matches", "vat_treatment"))) return reported;
  const { rows } = await pool.query(
    `SELECT m.journal_entry_id, m.vat_treatment, m.vat_net_amount, m.vat_amount,
            to_char(je.date, 'YYYY-MM-DD') AS d, je.entry_number, je.memo, bt.description
       FROM bank_transaction_matches m
       JOIN journal_entries je ON je.id = m.journal_entry_id AND je.company_id = m.company_id
       LEFT JOIN bank_transactions bt ON bt.id = m.bank_transaction_id
      WHERE m.company_id = $1 AND m.vat_treatment IS NOT NULL AND m.status <> 'reversed'
        AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
        AND je.date >= $2::date AND je.date <= $3::date`,
    [companyId, from, to]
  );
  for (const r of rows) {
    reported.add(r.journal_entry_id);
    const net = fils(r.vat_net_amount);
    const vat = fils(r.vat_amount);
    let boxes: BoxDelta;
    let family: VatContribution["family"] = "purchase";
    let emirate: Emirate | null = null;
    if (net > 0) {
      const fam: Vat201Family | null =
        r.vat_treatment === "standard"
          ? "standard"
          : r.vat_treatment === "zero_rated"
            ? "zero_rated"
            : r.vat_treatment === "exempt"
              ? "exempt"
              : null;
      if (!fam) continue;
      if (familyNeedsEmirate(fam) && !company.emirate) {
        issues.push({
          code: "COMPANY_EMIRATE_MISSING",
          message:
            "Set the company's emirate: standard-rated income recorded from a bank line is reported in the Box 1 row of that emirate.",
          documentType: "bank_line_entry",
          documentId: r.journal_entry_id,
          reference: r.entry_number ?? null,
        });
        continue;
      }
      family = fam;
      emirate = familyNeedsEmirate(fam) ? company.emirate : null;
      boxes = salesDelta(fam, company.emirate, net, fam === "standard" ? vat : 0);
    } else {
      if (r.vat_treatment !== "standard" || vat === 0) continue; // zero-rated / exempt purchase
      boxes = purchaseDelta("standard", -net, vat, vat);
    }
    counts.bankLineEntries = (counts.bankLineEntries ?? 0) + 1;
    push({
      sourceType: "bank_line_entry",
      sourceId: r.journal_entry_id,
      reference: r.entry_number ?? null,
      date: r.d,
      counterparty: r.description ?? null,
      counterpartyTrn: null,
      emirate,
      family,
      boxes,
      category: categoryForSource("bank_reconciliation"),
      inLedger: true,
      ledgerSource: "bank_reconciliation",
      memo: r.memo ?? null,
    });
  }
  return reported;
}

// ─── Ledger ──────────────────────────────────────────────────────────────

export interface VatAccount {
  id: string;
  code: string;
  vatType: "input" | "output";
}

export async function loadVatAccounts(companyId: string): Promise<VatAccount[]> {
  const { rows } = await pool.query(
    `SELECT id, code, vat_type FROM accounts
      WHERE company_id = $1
        AND ((is_vat_account = true AND vat_type IN ('input','output')) OR code IN ('1050','2020'))`,
    [companyId]
  );
  return rows.map((r: { id: string; code: string; vat_type: string | null }) => ({
    id: r.id,
    code: r.code,
    vatType: (r.vat_type === "input" || r.vat_type === "output"
      ? r.vat_type
      : r.code === "1050"
        ? "input"
        : "output") as "input" | "output",
  }));
}

interface ManualJournal {
  entryId: string;
  entryNumber: string;
  date: string;
  source: string;
  memo: string | null;
  outputFils: number;
  inputFils: number;
}

async function collectLedger(
  companyId: string,
  from: string,
  to: string,
  vatAccounts: VatAccount[],
  /** Entries already reported from their document (bank-line entries with a VAT treatment). */
  documentEntries: ReadonlySet<string> = new Set()
): Promise<LedgerVat> {
  const byCategory = new Map<ReconCategory, { output: number; input: number }>();
  const byCategoryDate: LedgerVat["byCategoryDate"] = [];
  const dated = new Map<string, LedgerVat["byCategoryDate"][number]>();
  const manual = new Map<string, ManualJournal>();
  if (vatAccounts.length === 0) return { byCategory, byCategoryDate, manual: [] };
  const typeOf = new Map(vatAccounts.map((a) => [a.id, a.vatType]));
  const lines = await ledgerLines(companyId, {
    from,
    to,
    accountIds: vatAccounts.map((a) => a.id),
  });
  // Reversal entries carry the original entry id: resolve them to the original's source.
  const reversalIds = [
    ...new Set(lines.filter((l) => l.source === "reversal" && l.sourceId).map((l) => l.sourceId!)),
  ];
  const originalSource = new Map<string, string>();
  if (reversalIds.length) {
    const { rows } = await pool.query(
      `SELECT id, source FROM journal_entries WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, reversalIds]
    );
    for (const r of rows) originalSource.set(r.id, r.source);
  }
  // Entries linked from receipts are receipt postings whatever their source tag says.
  const entryIds = [...new Set(lines.map((l) => l.entryId))];
  const receiptEntries = new Set<string>();
  if (entryIds.length) {
    const { rows } = await pool.query(
      `SELECT journal_entry_id FROM receipts WHERE company_id = $1 AND journal_entry_id = ANY($2::uuid[])`,
      [companyId, entryIds]
    );
    for (const r of rows) receiptEntries.add(r.journal_entry_id);
  }
  for (const l of lines) {
    let source = l.source || "manual";
    if (source === "reversal" && l.sourceId) source = originalSource.get(l.sourceId) ?? source;
    if (receiptEntries.has(l.entryId)) source = "receipt";
    const t = typeOf.get(l.accountId);
    const out = t === "output" ? l.credit - l.debit : 0;
    const inp = t === "input" ? l.debit - l.credit : 0;
    const cat = categoryForSource(source);
    const agg = byCategory.get(cat) ?? { output: 0, input: 0 };
    agg.output += out;
    agg.input += inp;
    byCategory.set(cat, agg);
    const dkey = `${cat}|${l.entryId}`;
    const d = dated.get(dkey) ?? { category: cat, date: l.date, output: 0, input: 0 };
    d.output += out;
    d.input += inp;
    dated.set(dkey, d);
    if (!DOC_SOURCES.has(source) && !documentEntries.has(l.entryId)) {
      const m = manual.get(l.entryId) ?? {
        entryId: l.entryId,
        entryNumber: l.entryNumber,
        date: l.date,
        source,
        memo: l.memo,
        outputFils: 0,
        inputFils: 0,
      };
      m.outputFils += out;
      m.inputFils += inp;
      manual.set(l.entryId, m);
    }
  }
  for (const d of dated.values()) if (d.output !== 0 || d.input !== 0) byCategoryDate.push(d);
  return {
    byCategory,
    byCategoryDate,
    manual: [...manual.values()].filter((m) => m.outputFils !== 0 || m.inputFils !== 0),
  };
}

interface LedgerVat {
  byCategory: Map<ReconCategory, { output: number; input: number }>;
  /** Same balances split per journal entry (with its date), so a non-AED member converts each
   * entry at its date exactly as its document contribution is converted (S8). */
  byCategoryDate: Array<{ category: ReconCategory; date: string; output: number; input: number }>;
  manual: ManualJournal[];
}

// ─── VAT groups ──────────────────────────────────────────────────────────

interface VatGroupInfo {
  groupId: string;
  name: string;
  groupTrn: string;
  memberIds: string[];
}

export async function loadVatGroupForRepresentative(
  companyId: string
): Promise<VatGroupInfo | null> {
  if (!(await tableExists("vat_groups"))) return null;
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.group_trn,
            COALESCE(array_agg(m.company_id) FILTER (WHERE m.company_id IS NOT NULL), '{}') AS members
       FROM vat_groups g LEFT JOIN vat_group_members m ON m.group_id = g.id
      WHERE g.representative_company_id = $1
      GROUP BY g.id`,
    [companyId]
  );
  if (!rows[0]) return null;
  const members = new Set<string>(rows[0].members ?? []);
  members.add(companyId);
  return {
    groupId: rows[0].id,
    name: rows[0].name,
    groupTrn: rows[0].group_trn,
    memberIds: [...members],
  };
}

async function computeGroup(
  input: ComputeVatInput,
  company: VatCompanyConfig,
  group: VatGroupInfo
): Promise<VatComputation> {
  const { rows } = await pool.query(
    `SELECT id, trn_vat_number FROM companies WHERE id = ANY($1::uuid[])`,
    [group.memberIds]
  );
  const trns = new Set<string>([group.groupTrn]);
  for (const r of rows as Array<{ trn_vat_number: string | null }>)
    if (r.trn_vat_number) trns.add(String(r.trn_vat_number).trim());
  const parts: VatComputation[] = [];
  for (const memberId of group.memberIds) {
    const memberCompany = memberId === company.id ? company : await loadVatCompany(memberId);
    parts.push(await computeSingle({ ...input, companyId: memberId }, memberCompany, trns));
  }
  const boxes = emptyBoxes();
  const contributions: VatContribution[] = [];
  const issues: VatIssue[] = [];
  const excluded: VatComputation["excluded"] = {
    outOfScopeFils: 0,
    outOfScope: [],
    intraGroup: [],
  };
  const counts: Record<string, number> = {};
  for (const p of parts) {
    for (const c of p.contributions) {
      contributions.push(c);
      addDelta(boxes, c.boxes);
    }
    issues.push(...p.issues);
    excluded.outOfScopeFils += p.excluded.outOfScopeFils;
    excluded.outOfScope.push(...p.excluded.outOfScope);
    excluded.intraGroup.push(...p.excluded.intraGroup);
    for (const [k, v] of Object.entries(p.counts)) counts[k] = (counts[k] ?? 0) + v;
  }
  // S8: member boxes are filed in AED, so a non-AED member's VAT GL balances are converted to
  // AED the same way (fx.toVatFilingCurrency at the entry date) before the group reconciliation.
  const ledgers: Array<Map<ReconCategory, { output: number; input: number }>> = [];
  for (const p of parts) ledgers.push(await groupMemberLedgerInAed(p, issues));
  if (!input.allowIncomplete && issues.length > 0) throwBlocking(issues);
  const boxesFils = deriveTotals(boxes);
  const recon = parts.map((p) => p.reconciliation);
  const reconciliation = buildReconciliation({
    boxes: boxesFils,
    contributions,
    ledgerByCategory: mergeLedgerMaps(ledgers),
    hasVatAccounts: recon.some((r) => r.hasVatAccounts),
  });
  return {
    ...parts.find((p) => p.companyId === company.id)!,
    company: { ...company, trn: group.groupTrn },
    boxesFils,
    boxes: boxesToAed(boxesFils),
    contributions,
    excluded,
    issues,
    complete: issues.length === 0,
    counts,
    reconciliation,
    partialExemption: {
      exemptSupplyRatio: company.exemptSupplyRatio,
      recoverableRatio: 1 - company.exemptSupplyRatio,
      grossInputVatFils: parts.reduce((s, p) => s + p.partialExemption.grossInputVatFils, 0),
      apportionedFils: parts.reduce((s, p) => s + p.partialExemption.apportionedFils, 0),
    },
    group,
  };
}

/** A member's VAT GL balances by category, in its functional currency (AED members) or AED. */
async function groupMemberLedgerInAed(
  part: VatComputation,
  issues: VatIssue[]
): Promise<Map<ReconCategory, { output: number; input: number }>> {
  const m = new Map<ReconCategory, { output: number; input: number }>();
  if (part.company.baseCurrency === VAT_FILING_CURRENCY) {
    for (const row of part.reconciliation.byCategory) {
      m.set(row.category, { output: row.ledgerOutputFils, input: row.ledgerInputFils });
    }
    return m;
  }
  const toAed = await resolveToAed();
  const missing = new Set<string>();
  for (const row of ledgerByDate.get(part) ?? []) {
    if (missing.has(row.date)) continue;
    try {
      const output = row.output ? (await toAed(part.companyId, row.output, row.date)).fils : 0;
      const input = row.input ? (await toAed(part.companyId, row.input, row.date)).fils : 0;
      const agg = m.get(row.category) ?? { output: 0, input: 0 };
      agg.output += output;
      agg.input += input;
      m.set(row.category, agg);
    } catch (err) {
      if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") {
        missing.add(row.date);
        if (!issues.some((i) => i.code === "NO_EXCHANGE_RATE" && i.documentId === part.companyId)) {
          issues.push({
            code: "NO_EXCHANGE_RATE",
            message: `No ${part.company.baseCurrency}→AED rate on or before ${row.date} for VAT group member ${part.company.name}: its VAT ledger cannot be reconciled in AED`,
            documentType: "vat_group_member",
            documentId: part.companyId,
            reference: part.company.name,
          });
        }
        continue;
      }
      throw err;
    }
  }
  return m;
}

function mergeLedgerMaps(
  maps: Array<Map<ReconCategory, { output: number; input: number }>>
): Map<ReconCategory, { output: number; input: number }> {
  const m = new Map<ReconCategory, { output: number; input: number }>();
  for (const map of maps) {
    for (const [category, row] of map) {
      const agg = m.get(category) ?? { output: 0, input: 0 };
      agg.output += row.output;
      agg.input += row.input;
      m.set(category, agg);
    }
  }
  return m;
}

// ─── Convenience views ───────────────────────────────────────────────────

export function outputVatFils(c: VatComputation): number {
  return c.boxesFils.box12TotalDueTax;
}
export function inputVatFils(c: VatComputation): number {
  return c.boxesFils.box13RecoverableTax;
}

export { outputEffect, inputEffect };
