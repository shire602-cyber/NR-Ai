/**
 * Live computation of a VAT 201 return from the books for a period.
 *
 * Extracted from POST /api/companies/:companyId/vat-returns/generate so the same
 * arithmetic drives (a) generating a return, (b) drift detection on a filed
 * return (does the live books figure still equal the filed snapshot?) and
 * (c) building an amendment. Pure read: it never writes.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../errors";
import { companies, invoiceLines as invoiceLinesTable, invoices as invoicesTable, receipts as receiptsTable } from "../../shared/schema";
import { round2 } from "./financial-statements";
import { aggregateReturnSalesLines } from "./vat-sales-lines";
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

  // Calculate VAT from invoices and receipts
  const invoices: any[] = await ex.select().from(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  const receipts: any[] = await ex.select().from(receiptsTable).where(eq(receiptsTable.companyId, companyId));

  const startDate = new Date(periodStart);
  // periodEnd is a calendar date — include the entire final day so
  // invoices timestamped during it aren't dropped from the return.
  const endDate = new Date(periodEnd);
  if (typeof periodEnd === "string" && !periodEnd.includes("T")) {
    endDate.setUTCHours(23, 59, 59, 999);
  }

  // Filter invoices for the period — drafts must be excluded too because
  // they have not been issued and therefore create no VAT obligation.
  const periodInvoices = invoices.filter((inv) => {
    const invDate = new Date(inv.date);
    return (
      invDate >= startDate &&
      invDate <= endDate &&
      inv.status !== "void" &&
      inv.status !== "draft" &&
      inv.status !== "cancelled" &&
      // Pre-go-live receivables entered as opening balances are not this period's supplies.
      !(inv as any).isOpeningBalance
    );
  });

  // Fetch all invoice lines for categorization by VAT supply type — single
  // batched fetch instead of one per invoice.
  let standardRatedAmount = 0;
  let standardRatedVat = 0;
  let zeroRatedAmount = 0;
  let exemptAmount = 0;

  const periodInvoiceIds = periodInvoices.map((i) => i.id);
  const periodLines: any[] =
    periodInvoiceIds.length === 0
      ? []
      : await ex.select().from(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, periodInvoiceIds));
  // FTA reporting is AED — convert foreign-currency invoice lines at the
  // invoice's stored transaction-date rate.
  const rateByInvoiceId = new Map(
    periodInvoices.map((i) => [
      i.id,
      Number((i as any).exchangeRate) > 0 ? Number((i as any).exchangeRate) : 1,
    ])
  );
  // Placement of every line is decided by the shared classifyVatLineForReturn
  // rule (also used by the autopilot and the firm workpaper pull), so the
  // three engines cannot disagree: 0% out-of-scope lines land in no box.
  const salesTotals = aggregateReturnSalesLines(periodLines as any[], rateByInvoiceId);
  standardRatedAmount = salesTotals.standardRatedAmount;
  standardRatedVat = salesTotals.standardRatedVat;
  zeroRatedAmount = salesTotals.zeroRatedAmount;
  exemptAmount = salesTotals.exemptAmount;

  // Credit notes are canonical invoice rows (`invoice_type = 'credit_note'`)
  // with negative invoice lines after A-B11, so the invoice loop above
  // captures them exactly once and applies the invoice exchange rate.

  // Calculate input tax from receipts — only posted receipts can be
  // claimed for input VAT recovery on a VAT return.
  const periodReceipts = receipts.filter((rec) => {
    if (!rec.posted) return false;
    const recDate = new Date(rec.date || rec.createdAt);
    return recDate >= startDate && recDate <= endDate;
  });

  // Split receipts: reverse-charge are reported in Boxes 3 (output) and 10
  // (input side, subject to partial-exemption recovery), ordinary receipts
  // feed Box 9.
  const ordinaryReceipts = periodReceipts.filter((r) => !r.reverseCharge);
  const reverseChargeReceipts = periodReceipts.filter((r) => r.reverseCharge);

  // FTA reporting is in AED. A receipt stores its DOCUMENT-currency amount
  // plus the transaction-date rate, so both the expense base and the input
  // VAT must be converted before they reach Boxes 9/10/11 — exactly as the
  // invoice lines above and the vendor bills below already do.
  //
  // Without this, a USD 1,000 receipt (VAT USD 50) at 3.6725 reported AED
  // 1,000 of expenses and AED 50 of recoverable input VAT instead of AED
  // 3,672.50 and AED 183.63 — the business under-claims and OVERPAYS the
  // FTA. For AED receipts the rate is 1, so this is a no-op.
  const recRate = (rec: { exchangeRate?: number | string | null }): number => {
    const r = Number(rec.exchangeRate);
    return Number.isFinite(r) && r > 0 ? r : 1;
  };

  let totalExpenses = ordinaryReceipts.reduce(
    (sum, rec) => sum + (rec.amount || 0) * recRate(rec),
    0
  );
  let inputTaxGross = ordinaryReceipts.reduce(
    (sum, rec) => sum + (rec.vatAmount || 0) * recRate(rec),
    0
  );

  let reverseChargeAmount = reverseChargeReceipts.reduce(
    (sum, rec) => sum + (rec.amount || 0) * recRate(rec),
    0
  );
  let reverseChargeVatGross = reverseChargeReceipts.reduce(
    (sum, rec) => sum + (rec.vatAmount || 0) * recRate(rec),
    0
  );

  // Vendor bills — pulled direct from vendor_bills since the bill module
  // isn't in Drizzle yet. Reverse-charge bills feed Boxes 3/10; ordinary
  // approved bills carry recoverable input VAT into Box 9 alongside
  // posted receipts. Pending bills are excluded: input VAT is only
  // claimable once the bill is approved (matching when it posts to GL).
  try {
    const fromDay = startDate.toISOString().slice(0, 10);
    const toDay = endDate.toISOString().slice(0, 10);
    const billRes = rowsOf(
      await ex.execute(sql`
        SELECT
          COALESCE(SUM(subtotal * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = true), 0) AS rc_amount,
          COALESCE(SUM(vat_amount * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = true), 0) AS rc_vat,
          COALESCE(SUM(subtotal * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = false), 0) AS std_amount,
          COALESCE(SUM(vat_amount * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = false), 0) AS std_vat
        FROM vendor_bills
        WHERE company_id = ${companyId}
          AND bill_date >= ${fromDay}::date
          AND bill_date <= ${toDay}::date
          AND status NOT IN ('void','cancelled','draft','pending')
          AND COALESCE(is_opening_balance, false) = false`)
    );
    // Compare calendar dates, not timestamps — casting the JS Date to
    // timestamptz shifts period boundaries in non-UTC server timezones.
    reverseChargeAmount += Number(billRes[0]?.rc_amount || 0);
    reverseChargeVatGross += Number(billRes[0]?.rc_vat || 0);
    totalExpenses += Number(billRes[0]?.std_amount || 0);
    inputTaxGross += Number(billRes[0]?.std_vat || 0);
  } catch (err) {
    // Bill-pay schema may not be installed in dev — fail open, log via parent.
    // (Inside a caller's transaction a failed statement aborts it: propagate.)
    if (args.executor) throw err;
  }

  // Expense claims — TD5 (found by blind-accountant audit): approval posts
  // net→expense and VAT→input VAT (1050) to the GL, but the return never
  // read them, so box 9/13 under-claimed recoverable input VAT and the GL
  // could never reconcile to the filed return. Approved/paid claims with
  // item dates inside the period now feed Box 9 exactly like bills.
  // Entertainment-category items are excluded from VAT recovery
  // (Art. 53 blocked input tax) to mirror the posting service.
  try {
    const fromDay = startDate.toISOString().slice(0, 10);
    const toDay = endDate.toISOString().slice(0, 10);
    const claimRes = rowsOf(
      await ex.execute(sql`
        SELECT
          COALESCE(SUM(i.amount), 0) AS claim_amount,
          COALESCE(SUM(i.vat_amount) FILTER (WHERE LOWER(COALESCE(i.category,'')) NOT LIKE '%entertain%'), 0) AS claim_vat
        FROM expense_claim_items i
        JOIN expense_claims c ON c.id = i.claim_id
        WHERE c.company_id = ${companyId}
          AND c.status IN ('approved','paid')
          AND i.expense_date >= ${fromDay}::date
          AND i.expense_date <= ${toDay}::date`)
    );
    totalExpenses += Number(claimRes[0]?.claim_amount || 0);
    inputTaxGross += Number(claimRes[0]?.claim_vat || 0);
  } catch (err) {
    // Expense-claims schema may not be installed — fail open like bills.
    if (args.executor) throw err;
  }

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

  // Assign standard rated sales to company's emirate
  switch (companyEmirate) {
    case "abu_dhabi":
      emirateBreakdown.box1aAbuDhabiAmount = standardRatedAmount;
      emirateBreakdown.box1aAbuDhabiVat = standardRatedVat;
      break;
    case "sharjah":
      emirateBreakdown.box1cSharjahAmount = standardRatedAmount;
      emirateBreakdown.box1cSharjahVat = standardRatedVat;
      break;
    case "ajman":
      emirateBreakdown.box1dAjmanAmount = standardRatedAmount;
      emirateBreakdown.box1dAjmanVat = standardRatedVat;
      break;
    case "umm_al_quwain":
      emirateBreakdown.box1eUmmAlQuwainAmount = standardRatedAmount;
      emirateBreakdown.box1eUmmAlQuwainVat = standardRatedVat;
      break;
    case "ras_al_khaimah":
      emirateBreakdown.box1fRasAlKhaimahAmount = standardRatedAmount;
      emirateBreakdown.box1fRasAlKhaimahVat = standardRatedVat;
      break;
    case "fujairah":
      emirateBreakdown.box1gFujairahAmount = standardRatedAmount;
      emirateBreakdown.box1gFujairahVat = standardRatedVat;
      break;
    case "dubai":
    default:
      emirateBreakdown.box1bDubaiAmount = standardRatedAmount;
      emirateBreakdown.box1bDubaiVat = standardRatedVat;
      break;
  }

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
  });

  const metadata = {
    invoicesProcessed: periodInvoices.length,
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
    netVatPayable: round2(totalOutputVat - totalInputVat),
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
