/**
 * Live computation of a VAT 201 return from the books for a period.
 *
 * Extracted from POST /api/companies/:companyId/vat-returns/generate so the same
 * arithmetic drives (a) generating a return, (b) drift detection on a filed
 * return (does the live books figure still equal the filed snapshot?) and
 * (c) building an amendment. Pure read: it never writes.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";
import { companies } from "../../shared/schema";
import { round2 } from "./financial-statements";
import { aggregateReturnSalesLines } from "./vat-sales-lines";
import { EMIRATE_BOX_PREFIX, supplyEmirate, type VatEmirate } from "./vat-emirate";
import { loadPeriodSalesDocuments } from "./vat-period-documents.service";
import {
  loadPeriodBills,
  loadPeriodExpenseClaimItems,
  loadPeriodReceipts,
  loadPeriodVendorCredits,
  totalPurchases,
  journalPurchaseRows,
  type PurchaseDocRow,
} from "./vat-period-purchases.service";
import { loadVatJournalAdjustments } from "./vat-adjustments.service";
import { journalLinesForReturn } from "./vat-adjustments";
import { buildGeneratedVatReturnValues } from "./vat-return-payload.service";

export async function computeVatReturnForPeriod(args: {
  companyId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  /**
   * Run every read on this transaction's connection (filing recomputes the return inside its
   * transaction, after taking the month locks, and must not wait for a second pooled connection).
   */
  executor?: any;
}) {
  const { companyId, userId, periodStart, periodEnd } = args;
  const ex: any = args.executor ?? db;
  const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
  // Get company information for emirate and VAT registration
  const [company] = await ex
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)));
  if (!company) {
    throw new AppError({ message: "Company not found", statusCode: 404, code: "COMPANY_NOT_FOUND" });
  }

  // Validate VAT registration
  if (!company.trnVatNumber) {
    throw new AppError({
      message:
        "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.",
      statusCode: 400,
      code: "NO_TRN",
    });
  }

  // H1 — never guess the emirate. Box 1a–1g attributes supplies to a
  // specific emirate; defaulting to Dubai silently files a Sharjah (or Abu
  // Dhabi, or RAK) company's entire turnover under the wrong box. If the
  // company has not stated its emirate, refuse rather than guess.
  if (!company.emirate) {
    throw new AppError({
      message:
        "Set your company's emirate before generating a VAT return. Box 1 of the VAT 201 " +
        "attributes supplies by emirate and must not be guessed.",
      statusCode: 422,
      code: "EMIRATE_NOT_SET",
    });
  }
  const companyEmirate = company.emirate;

  const startDate = new Date(periodStart);
  // periodEnd is a calendar date — include the entire final day so
  // invoices timestamped during it aren't dropped from the return.
  const endDate = new Date(periodEnd);
  if (typeof periodEnd === "string" && !periodEnd.includes("T")) {
    endDate.setUTCHours(23, 59, 59, 999);
  }

  // Sales documents by the ONE shared void rule (vat-document-effect.ts): an invoice cancelled in
  // a LATER period is still a supply of its own period; its cancellation is a negative line in the
  // period of the void. Drafts and opening-balance receivables (already in the opening balances)
  // are not this period's supplies. FTA reporting is AED, so lines convert at the invoice's stored
  // transaction-date rate.
  let standardRatedAmount = 0;
  let standardRatedVat = 0;
  let zeroRatedAmount = 0;
  let exemptAmount = 0;

  const sales = await loadPeriodSalesDocuments(ex, companyId, periodStart, periodEnd);
  const periodInvoices = sales.invoices;
  // Placement of every line is decided by the shared classifyVatLineForReturn
  // rule (also used by the autopilot and the firm workpaper pull), so the
  // three engines cannot disagree: 0% out-of-scope lines land in no box.
  const salesTotals = aggregateReturnSalesLines(sales.lines as any[], sales.rateByInvoiceId, sales.emirateByInvoiceId, companyEmirate);
  standardRatedAmount = salesTotals.standardRatedAmount;
  standardRatedVat = salesTotals.standardRatedVat;
  zeroRatedAmount = salesTotals.zeroRatedAmount;
  exemptAmount = salesTotals.exemptAmount;

  // Taxable sales recorded by manual journal (Cr revenue + Cr 2020, no document): reported as a supply in box 1 of the
  // company's emirate, amount and VAT, once. Their 2020 line is not also an adjustment (vat-adjustments.ts).
  const journalAdjustments = await loadVatJournalAdjustments(ex, companyId, periodStart, periodEnd, companyEmirate);
  standardRatedAmount += journalAdjustments.salesAmount;
  standardRatedVat += journalAdjustments.salesVat;
  const journalLines = journalLinesForReturn(journalAdjustments);

  // Credit notes are canonical invoice rows (`invoice_type = 'credit_note'`)
  // with negative invoice lines after A-B11, so the invoice loop above
  // captures them exactly once and applies the invoice exchange rate.

  // Purchase documents of the period: posted receipts, approved bills, approved vendor credits (negative) and
  // approved / paid expense claims. The loaders live in vat-period-purchases.service.ts so the VAT Audit: Purchases
  // Detail report reads the very same rows. Reverse-charge documents feed Boxes 3 (output) and 10 (input side,
  // subject to partial-exemption recovery); ordinary ones feed Box 9. Amounts are AED: the rate booked on each
  // document (a USD 1,000 receipt with VAT USD 50 at 3.6725 is AED 3,672.50 and AED 183.63).
  const receiptRows = await loadPeriodReceipts(ex, companyId, startDate, endDate);
  const periodReceipts = receiptRows;
  const fromDay = startDate.toISOString().slice(0, 10);
  const toDay = endDate.toISOString().slice(0, 10);
  // Bills, vendor credits and expense claims: the bill-pay / claims schema may not be installed in dev, so fail
  // open (inside a caller's transaction a failed statement aborts it: propagate).
  const tolerant = async (load: () => Promise<PurchaseDocRow[]>): Promise<PurchaseDocRow[]> => {
    try {
      return await load();
    } catch (err) {
      if (args.executor) throw err;
      return [];
    }
  };
  const billRows = await tolerant(() => loadPeriodBills(ex, companyId, fromDay, toDay));
  const creditRows = await tolerant(() => loadPeriodVendorCredits(ex, companyId, fromDay, toDay));
  const claimRows = await tolerant(() => loadPeriodExpenseClaimItems(ex, companyId, fromDay, toDay));
  const purchaseTotals = totalPurchases([
    ...receiptRows,
    ...billRows,
    ...creditRows,
    ...claimRows,
    // purchases recorded by manual journal (Dr expense + Dr 1050): net in box 9 amount, VAT in box 9 VAT, once
    ...journalPurchaseRows(journalAdjustments.purchases),
  ]);

  let totalExpenses = purchaseTotals.totalExpenses;
  let inputTaxGross = purchaseTotals.inputTaxGross;
  let reverseChargeAmount = purchaseTotals.reverseChargeAmount;
  let reverseChargeVatGross = purchaseTotals.reverseChargeVatGross;

  // Summing float line amounts leaves binary noise (3428.3300000000017);
  // settle every accumulator to fils before deriving boxes from them.
  standardRatedAmount = round2(standardRatedAmount);
  standardRatedVat = round2(standardRatedVat);
  zeroRatedAmount = round2(zeroRatedAmount);
  exemptAmount = round2(exemptAmount);
  totalExpenses = round2(totalExpenses);
  inputTaxGross = round2(inputTaxGross);
  reverseChargeAmount = round2(reverseChargeAmount);
  reverseChargeVatGross = round2(reverseChargeVatGross);

  // Partial-exemption apportionment (FTA Article 55). When a company makes
  // both taxable and exempt supplies, only the taxable portion of input VAT
  // is recoverable. Output VAT (including reverse-charge output in Box 3) is
  // unaffected — only the input/recovery side is reduced.
  const exemptRatio = Math.min(1, Math.max(0, Number(company.exemptSupplyRatio || 0)));
  const recoverableRatio = 1 - exemptRatio;
  const inputTax = Math.round(inputTaxGross * recoverableRatio * 100) / 100;
  const irrecoverableInputTax = Math.round((inputTaxGross - inputTax) * 100) / 100;
  const reverseChargeVat = reverseChargeVatGross; // output side
  const reverseChargeVatRecoverable =
    Math.round(reverseChargeVatGross * recoverableRatio * 100) / 100;

  // Due date is 28 days after period end (FTA requirement)
  const dueDate = new Date(endDate);
  dueDate.setDate(dueDate.getDate() + 28);

  // Determine VAT stagger from company settings or default to quarterly
  const vatStagger = company.vatFilingFrequency === "Monthly" ? "monthly" : "quarterly";

  // Initialize emirate breakdown - all to company's registered emirate
  const emirateBreakdown = {
    box1aAbuDhabiAmount: 0,
    box1aAbuDhabiVat: 0,
    box1aAbuDhabiAdj: 0,
    box1bDubaiAmount: 0,
    box1bDubaiVat: 0,
    box1bDubaiAdj: 0,
    box1cSharjahAmount: 0,
    box1cSharjahVat: 0,
    box1cSharjahAdj: 0,
    box1dAjmanAmount: 0,
    box1dAjmanVat: 0,
    box1dAjmanAdj: 0,
    box1eUmmAlQuwainAmount: 0,
    box1eUmmAlQuwainVat: 0,
    box1eUmmAlQuwainAdj: 0,
    box1fRasAlKhaimahAmount: 0,
    box1fRasAlKhaimahVat: 0,
    box1fRasAlKhaimahAdj: 0,
    box1gFujairahAmount: 0,
    box1gFujairahVat: 0,
    box1gFujairahAdj: 0,
  };

  // Box 1 is split by the emirate of each supply: the document's own emirate (invoices.emirate), else the company's.
  // The rows add up to the standard-rated totals (document-level rounding, vat-sales-lines.ts).
  for (const [emirate, figures] of Object.entries(salesTotals.standardByEmirate)) {
    const prefix = EMIRATE_BOX_PREFIX[emirate as VatEmirate];
    (emirateBreakdown as Record<string, number>)[`${prefix}Amount`] = figures!.amount;
    (emirateBreakdown as Record<string, number>)[`${prefix}Vat`] = figures!.vat;
  }
  // Taxable sales recorded by manual journal have no document, hence no emirate of their own: they are the company's.
  if (journalAdjustments.salesAmount !== 0 || journalAdjustments.salesVat !== 0) {
    const prefix = EMIRATE_BOX_PREFIX[supplyEmirate(null, companyEmirate)];
    const row = emirateBreakdown as Record<string, number>;
    row[`${prefix}Amount`] = round2((row[`${prefix}Amount`] ?? 0) + journalAdjustments.salesAmount);
    row[`${prefix}Vat`] = round2((row[`${prefix}Vat`] ?? 0) + journalAdjustments.salesVat);
  }

  // Manual journals to the VAT accounts dated in the period are VAT adjustments (shared with the
  // autopilot and the firm workpaper): output side in the adjustment column of the company's own
  // emirate, input side in box 9, both flowing into boxes 8/11 adjustment and boxes 12-14.
  (emirateBreakdown as Record<string, number>)[journalAdjustments.outputBox] = journalAdjustments.outputAdjustment;

  // Calculate totals. Reverse charge feeds Box 3 (output, full) and Box 10
  // (input, partial-exemption-reduced). Standard input tax (Box 9) is also
  // partial-exemption reduced via `inputTax`.
  const totalOutputAmount = round2(
    standardRatedAmount + zeroRatedAmount + exemptAmount + reverseChargeAmount
  );
  const totalOutputVat = round2(standardRatedVat + reverseChargeVat);
  const totalInputAmount = round2(totalExpenses + reverseChargeAmount);
  const totalInputVat = round2(inputTax + reverseChargeVatRecoverable);

  const returnValues = buildGeneratedVatReturnValues({
    companyId,
    userId,
    periodStart: startDate,
    periodEnd: endDate,
    dueDate,
    vatStagger,
    emirateBreakdown,
    zeroRatedAmount,
    exemptAmount,
    reverseChargeAmount,
    reverseChargeVat,
    reverseChargeVatRecoverable,
    totalExpenses,
    inputTax,
    totalOutputAmount,
    totalOutputVat,
    totalInputAmount,
    totalInputVat,
    outputAdjustment: journalAdjustments.outputAdjustment,
    inputAdjustment: journalAdjustments.inputAdjustment,
    vatAdjustments: journalLines,
  });

  const metadata = {
    invoicesProcessed: periodInvoices.length,
    journalSalesProcessed: journalAdjustments.sales.length,
    receiptsProcessed: periodReceipts.length,
    companyEmirate,
    trnNumber: company.trnVatNumber,
    standardRatedSales: standardRatedAmount,
    zeroRatedSales: zeroRatedAmount,
    exemptSales: exemptAmount,
    reverseChargeAmount,
    reverseChargeVat,
    reverseChargeVatRecoverable,
    totalInputVat,
    netVatPayable: round2(returnValues.box12TotalDueTax - returnValues.box13RecoverableTax),
    // Manual journals to the VAT accounts in the period, reported as adjustments on the return
    // (journal number and description, so the accountant can see what each one is).
    vatAdjustments: journalLines,
    outputAdjustment: journalAdjustments.outputAdjustment,
    inputAdjustment: journalAdjustments.inputAdjustment,
    // Input VAT the return does not recover by design (standard input plus the reverse-charge
    // input): what the filing entry expects to find in the ledger beyond box 13.
    expectedIrrecoverableInputVat: round2(irrecoverableInputTax + (reverseChargeVat - reverseChargeVatRecoverable)),
    partialExemption: {
      exemptSupplyRatio: exemptRatio,
      recoverableRatio,
      grossInputVat: inputTaxGross,
      recoverableInputVat: inputTax,
      irrecoverableInputVat: irrecoverableInputTax,
    },
  };
  return { returnValues, metadata, startDate, endDate, periodInvoicesCount: periodInvoices.length };
}
