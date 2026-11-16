/**
 * FTA Audit File (FAF) export (W5-A, R12-08a).
 *
 * Builds the FAF text layout for a period from posted data only:
 *   - Company information (name, TRN, period, creation date, product/FAF version)
 *   - Purchase listing  — VAT-engine purchase contributions (bills, receipts, vendor debit
 *     notes) with supplier TRN and the stored VAT classification as the tax code
 *   - Supply listing    — VAT-engine sales contributions (invoices, credit/debit notes,
 *     fixed-asset disposals) with customer TRN and tax code
 *   - General-ledger listing — every posted journal line in the period (server/reporting)
 *   - Footer totals per section
 *
 * Field layout and section markers are documented in docs/faf-export.md (with the source).
 * The file is generated for upload/inspection — it is NOT transmitted to the FTA.
 */
import { computeVat201, type VatContribution } from "../tax/vat-engine";
import { generalLedger, loadAccounts } from "../reporting";
import { pool } from "../db";

export const FAF_VERSION = "FAFv1.0.0";
export const FAF_PRODUCT = "Muhasib.ai";
export const FAF_LABEL = "Generated for upload/inspection — not transmitted to FTA";
/**
 * S5 (EXTERNAL): the section markers and field names follow the FTA FAF User Guide
 * (2017/2018 editions). The current FTA edition could not be retrieved from this environment
 * (tax.gov.ae unreachable), so the layout is not yet re-verified; every file says so.
 */
export const FAF_SPEC_NOTICE =
  "Layout follows the FTA FAF User Guide (2017/2018 editions); verify against the current FTA specification before submitting to an auditor.";

export type FafTaxCode = "SR" | "ZR" | "EX" | "RC" | "IM" | "OA";

export interface FafPurchaseRecord {
  supplierName: string;
  supplierTrn: string;
  invoiceDate: string;
  invoiceNo: string;
  permitNo: string;
  transactionId: string;
  lineNo: number;
  productDescription: string;
  purchaseValueFils: number;
  vatValueFils: number;
  taxCode: FafTaxCode;
  fcyCode: string;
}

export interface FafSupplyRecord {
  customerName: string;
  customerTrn: string;
  invoiceDate: string;
  invoiceNo: string;
  permitNo: string;
  transactionId: string;
  lineNo: number;
  productDescription: string;
  supplyValueFils: number;
  vatValueFils: number;
  taxCode: FafTaxCode;
  country: string;
  fcyCode: string;
}

export interface FafGlRecord {
  transactionDate: string;
  accountId: string;
  accountName: string;
  transactionDescription: string;
  name: string;
  transactionId: string;
  sourceDocumentId: string;
  sourceType: string;
  debitFils: number;
  creditFils: number;
  balanceFils: number;
}

export interface FafFile {
  label: string;
  /** Spec-verification banner (FAF_SPEC_NOTICE). */
  specNotice?: string;
  company: {
    name: string;
    trn: string;
    taxAgencyName: string;
    taxAgentName: string;
    periodStart: string;
    periodEnd: string;
    fafCreationDate: string;
    productVersion: string;
    fafVersion: string;
  };
  purchases: FafPurchaseRecord[];
  supplies: FafSupplyRecord[];
  generalLedger: FafGlRecord[];
  totals: {
    purchaseTotalFils: number;
    purchaseVatTotalFils: number;
    purchaseCount: number;
    supplyTotalFils: number;
    supplyVatTotalFils: number;
    supplyCount: number;
    glDebitTotalFils: number;
    glCreditTotalFils: number;
    glCount: number;
    glCurrency: string;
  };
  /** Ties the listings to the VAT 201 computed for the same period. */
  reconciliation: {
    vat201OutputVatFils: number;
    vat201RecoverableVatFils: number;
    listedSupplyVatFils: number;
    listedPurchaseVatFils: number;
    adjustmentsOutputVatFils: number;
    adjustmentsRecoverableVatFils: number;
    supplyVatDifferenceFils: number;
    purchaseVatDifferenceFils: number;
    vatComplete: boolean;
  };
}

const SUPPLY_SOURCES = new Set(["invoice", "credit_note", "debit_note", "fixed_asset_disposal"]);
const PURCHASE_SOURCES = new Set(["bill", "receipt", "vendor_debit_note"]);

const n = (v: number | undefined) => v ?? 0;

function box1(c: VatContribution, suffix: "Amount" | "Vat" | "Adj"): number {
  let total = 0;
  for (const [k, v] of Object.entries(c.boxes)) {
    if (/^box1[a-g]/.test(k) && k.endsWith(suffix)) total += v ?? 0;
  }
  return total;
}

/** Output VAT a contribution adds to Box 1 / Box 2 (sales side). */
function supplyVat(c: VatContribution): number {
  return box1(c, "Vat") + box1(c, "Adj") + n(c.boxes.box2TouristRefundVat);
}

function supplyValue(c: VatContribution): number {
  return (
    box1(c, "Amount") +
    n(c.boxes.box2TouristRefundAmount) +
    n(c.boxes.box4ZeroRatedAmount) +
    n(c.boxes.box5ExemptAmount)
  );
}

function supplyCode(c: VatContribution): FafTaxCode {
  if (c.family === "zero_rated") return "ZR";
  if (c.family === "exempt") return "EX";
  if (c.family === "reverse_charge") return "RC";
  return "SR";
}

function purchaseVat(c: VatContribution): number {
  return n(c.boxes.box9ExpensesVat) + n(c.boxes.box9ExpensesAdj) + n(c.boxes.box10ReverseChargeVat);
}

function purchaseValue(c: VatContribution): number {
  return (
    n(c.boxes.box9ExpensesAmount) ||
    n(c.boxes.box3ReverseChargeAmount) ||
    n(c.boxes.box6ImportsAmount) ||
    n(c.boxes.box10ReverseChargeAmount)
  );
}

function purchaseCode(c: VatContribution): FafTaxCode {
  if (n(c.boxes.box6ImportsAmount) || n(c.boxes.box6ImportsVat)) return "IM";
  if (n(c.boxes.box3ReverseChargeAmount) || n(c.boxes.box10ReverseChargeAmount)) return "RC";
  if (purchaseVat(c) !== 0) return "SR";
  return "ZR";
}

const OUTPUT_KEYS_RE = /^(box1[a-g].*(Vat|Adj)|box2TouristRefundVat)$/;

function sumKeys(c: VatContribution, re: RegExp): number {
  return Object.entries(c.boxes).reduce((s, [k, v]) => (re.test(k) ? s + (v ?? 0) : s), 0);
}

const toFils = (aed: number) => Math.round(aed * 100);

export async function buildFaf(input: {
  companyId: string;
  from: string;
  to: string;
  now?: Date;
}): Promise<FafFile> {
  const { companyId, from, to } = input;
  const [{ rows: companyRows }, vat, gl, accounts] = await Promise.all([
    pool.query(`SELECT name, legal_name, trn_vat_number FROM companies WHERE id = $1`, [companyId]),
    computeVat201({ companyId, from, to, allowIncomplete: true, includeGroup: false }),
    generalLedger({ companyId, from, to }),
    loadAccounts(companyId),
  ]);
  const company = companyRows[0] ?? {};
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const supplies: FafSupplyRecord[] = [];
  const purchases: FafPurchaseRecord[] = [];
  let adjustmentsOutput = 0;
  let adjustmentsRecoverable = 0;
  for (const c of vat.contributions) {
    if (SUPPLY_SOURCES.has(c.sourceType) && c.family !== "purchase" && c.family !== "adjustment") {
      supplies.push({
        customerName: c.counterparty ?? "",
        customerTrn: c.counterpartyTrn ?? "",
        invoiceDate: c.date,
        invoiceNo: c.reference ?? "",
        permitNo: "",
        transactionId: c.sourceId,
        lineNo: 1,
        productDescription: c.memo ?? c.sourceType.replace(/_/g, " "),
        supplyValueFils: supplyValue(c),
        vatValueFils: supplyVat(c),
        taxCode: supplyCode(c),
        country: "AE",
        fcyCode: "AED",
      });
      continue;
    }
    if (PURCHASE_SOURCES.has(c.sourceType) && c.family === "purchase") {
      purchases.push({
        supplierName: c.counterparty ?? "",
        supplierTrn: c.counterpartyTrn ?? "",
        invoiceDate: c.date,
        invoiceNo: c.reference ?? "",
        permitNo: "",
        transactionId: c.sourceId,
        lineNo: 1,
        productDescription: c.memo ?? c.sourceType.replace(/_/g, " "),
        purchaseValueFils: purchaseValue(c),
        vatValueFils: purchaseVat(c),
        taxCode: purchaseCode(c),
        fcyCode: "AED",
      });
      // Reverse-charge / import output VAT is self-accounted on the purchase.
      adjustmentsOutput += sumKeys(c, OUTPUT_KEYS_RE);
      continue;
    }
    adjustmentsOutput += sumKeys(c, OUTPUT_KEYS_RE);
    adjustmentsRecoverable += purchaseVat(c);
  }

  const glRecords: FafGlRecord[] = [];
  for (const account of gl.accounts) {
    const meta = accountById.get(account.accountId);
    for (const line of account.lines) {
      glRecords.push({
        transactionDate: line.date,
        accountId: account.accountCode,
        accountName: meta?.nameEn ?? account.accountName,
        transactionDescription: line.description ?? line.memo ?? "",
        name: "",
        transactionId: line.entryNumber,
        sourceDocumentId: line.entryId,
        sourceType: line.source,
        debitFils: toFils(line.debit),
        creditFils: toFils(line.credit),
        balanceFils: toFils(line.balance),
      });
    }
  }
  glRecords.sort((a, b) =>
    a.transactionDate === b.transactionDate
      ? a.transactionId.localeCompare(b.transactionId)
      : a.transactionDate.localeCompare(b.transactionDate)
  );

  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
  const listedSupplyVat = sum(supplies, (r) => r.vatValueFils);
  const listedPurchaseVat = sum(purchases, (r) => r.vatValueFils);
  // Output VAT on the return excluding reverse-charge/import self-accounting (Box 3/6/7).
  const vat201Output = sumKeys(
    { boxes: vat.boxesFils } as unknown as VatContribution,
    OUTPUT_KEYS_RE
  );
  const vat201Recoverable =
    vat.boxesFils.box9ExpensesVat +
    vat.boxesFils.box9ExpensesAdj +
    vat.boxesFils.box10ReverseChargeVat;
  const creation = (input.now ?? new Date()).toISOString().slice(0, 10);

  return {
    label: FAF_LABEL,
    specNotice: FAF_SPEC_NOTICE,
    company: {
      name: company.legal_name || company.name || "",
      trn: company.trn_vat_number ?? "",
      taxAgencyName: "",
      taxAgentName: "",
      periodStart: from,
      periodEnd: to,
      fafCreationDate: creation,
      productVersion: FAF_PRODUCT,
      fafVersion: FAF_VERSION,
    },
    purchases,
    supplies,
    generalLedger: glRecords,
    totals: {
      purchaseTotalFils: sum(purchases, (r) => r.purchaseValueFils),
      purchaseVatTotalFils: listedPurchaseVat,
      purchaseCount: purchases.length,
      supplyTotalFils: sum(supplies, (r) => r.supplyValueFils),
      supplyVatTotalFils: listedSupplyVat,
      supplyCount: supplies.length,
      glDebitTotalFils: sum(glRecords, (r) => r.debitFils),
      glCreditTotalFils: sum(glRecords, (r) => r.creditFils),
      glCount: glRecords.length,
      glCurrency: "AED",
    },
    reconciliation: {
      vat201OutputVatFils: vat201Output,
      vat201RecoverableVatFils: vat201Recoverable,
      listedSupplyVatFils: listedSupplyVat,
      listedPurchaseVatFils: listedPurchaseVat,
      adjustmentsOutputVatFils: adjustmentsOutput,
      adjustmentsRecoverableVatFils: adjustmentsRecoverable,
      supplyVatDifferenceFils: vat201Output - listedSupplyVat - adjustmentsOutput,
      purchaseVatDifferenceFils: vat201Recoverable - listedPurchaseVat - adjustmentsRecoverable,
      vatComplete: vat.complete,
    },
  };
}

// ─── Text layout ─────────────────────────────────────────────────────────────

function cell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money = (fils: number) => (fils / 100).toFixed(2);

function line(values: Array<string | number>): string {
  return values.map(cell).join(",");
}

/**
 * FAF text: comma-separated, one section per block delimited by the FTA section markers
 * (CompInfoStart … CompInfoEnd, PurcDataStart … PurcDataEnd, SuppDataStart … SuppDataEnd,
 * GLDataStart … GLDataEnd). Amounts in AED with two decimals. CRLF line endings.
 */
export function renderFafText(faf: FafFile): string {
  const out: string[] = [];
  const c = faf.company;
  out.push("CompInfoStart");
  out.push(
    line([
      "CompanyName",
      "TaxablePersonNameEn",
      "TRN",
      "TaxAgencyName",
      "TaxAgentName",
      "PeriodStart",
      "PeriodEnd",
      "FAFCreationDate",
      "ProductVersion",
      "FAFVersion",
    ])
  );
  out.push(
    line([
      c.name,
      c.name,
      c.trn,
      c.taxAgencyName,
      c.taxAgentName,
      c.periodStart,
      c.periodEnd,
      c.fafCreationDate,
      c.productVersion,
      c.fafVersion,
    ])
  );
  out.push("CompInfoEnd");

  out.push("PurcDataStart");
  out.push(
    line([
      "SupplierName",
      "SupplierTRN",
      "InvoiceDate",
      "InvoiceNo",
      "PermitNo",
      "TransactionID",
      "LineNo",
      "ProductDescription",
      "PurchaseValueAED",
      "VATValueAED",
      "TaxCode",
      "FCYCode",
      "PurchaseFCY",
      "VATFCY",
    ])
  );
  for (const p of faf.purchases) {
    out.push(
      line([
        p.supplierName,
        p.supplierTrn,
        p.invoiceDate,
        p.invoiceNo,
        p.permitNo,
        p.transactionId,
        p.lineNo,
        p.productDescription,
        money(p.purchaseValueFils),
        money(p.vatValueFils),
        p.taxCode,
        p.fcyCode,
        money(p.purchaseValueFils),
        money(p.vatValueFils),
      ])
    );
  }
  out.push(line(["PurchaseTotalAED", "VATTotalAED", "TransactionCountTotal"]));
  out.push(
    line([
      money(faf.totals.purchaseTotalFils),
      money(faf.totals.purchaseVatTotalFils),
      faf.totals.purchaseCount,
    ])
  );
  out.push("PurcDataEnd");

  out.push("SuppDataStart");
  out.push(
    line([
      "CustomerName",
      "CustomerTRN",
      "InvoiceDate",
      "InvoiceNo",
      "PermitNo",
      "TransactionID",
      "LineNo",
      "ProductDescription",
      "SupplyValueAED",
      "VATValueAED",
      "TaxCode",
      "Country",
      "FCYCode",
      "SupplyFCY",
      "VATFCY",
    ])
  );
  for (const s of faf.supplies) {
    out.push(
      line([
        s.customerName,
        s.customerTrn,
        s.invoiceDate,
        s.invoiceNo,
        s.permitNo,
        s.transactionId,
        s.lineNo,
        s.productDescription,
        money(s.supplyValueFils),
        money(s.vatValueFils),
        s.taxCode,
        s.country,
        s.fcyCode,
        money(s.supplyValueFils),
        money(s.vatValueFils),
      ])
    );
  }
  out.push(line(["SupplyTotalAED", "VATTotalAED", "TransactionCountTotal"]));
  out.push(
    line([
      money(faf.totals.supplyTotalFils),
      money(faf.totals.supplyVatTotalFils),
      faf.totals.supplyCount,
    ])
  );
  out.push("SuppDataEnd");

  out.push("GLDataStart");
  out.push(
    line([
      "TransactionDate",
      "AccountID",
      "AccountName",
      "TransactionDescription",
      "Name",
      "TransactionID",
      "SourceDocumentID",
      "SourceType",
      "Debit",
      "Credit",
      "Balance",
    ])
  );
  for (const g of faf.generalLedger) {
    out.push(
      line([
        g.transactionDate,
        g.accountId,
        g.accountName,
        g.transactionDescription,
        g.name,
        g.transactionId,
        g.sourceDocumentId,
        g.sourceType,
        money(g.debitFils),
        money(g.creditFils),
        money(g.balanceFils),
      ])
    );
  }
  out.push(line(["TotalDebit", "TotalCredit", "TransactionCountTotal", "GLTCurrency"]));
  out.push(
    line([
      money(faf.totals.glDebitTotalFils),
      money(faf.totals.glCreditTotalFils),
      faf.totals.glCount,
      faf.totals.glCurrency,
    ])
  );
  out.push("GLDataEnd");
  return out.join("\r\n") + "\r\n";
}
