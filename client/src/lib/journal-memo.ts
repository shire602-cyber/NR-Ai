// System-generated journal memos are written by the server in English (invoice posting, payments,
// bills, receipts). In Arabic mode the UI rebuilds the known shapes from catalog templates and
// keeps the document number / party name from the server text. Memos typed by a person, and any
// shape not listed here, are shown unchanged.
import { formatMessage } from "@/lib/i18n";

type Translations = Record<string, string>;

interface MemoShape {
  /** Matches the English server text; capture groups feed the template placeholders in order. */
  pattern: RegExp;
  key: string;
  params: string[];
}

// Not UI copy: these are matched, never displayed.
const SHAPES: MemoShape[] = [
  {
    pattern: /^Sales Invoice (\S+) - (.*)$/,
    key: "journal.memo.salesInvoice",
    params: ["ref", "party"],
  },
  { pattern: /^Debit Note (\S+) - (.*)$/, key: "journal.memo.debitNote", params: ["ref", "party"] },
  {
    pattern: /^Payment received for Invoice (\S+) - (\w+)$/,
    key: "journal.memo.paymentReceived",
    params: ["ref", "method"],
  },
  {
    pattern: /^Cost of goods sold - Invoice (\S+)$/,
    key: "journal.memo.cogs",
    params: ["ref"],
  },
  {
    pattern: /^Vendor Bill (\S+) - (.*)$/,
    key: "journal.memo.vendorBill",
    params: ["ref", "party"],
  },
  {
    pattern: /^Payment - Bill (\S+) - (.*)$/,
    key: "journal.memo.billPayment",
    params: ["ref", "party"],
  },
  { pattern: /^Receipt: (.*)$/, key: "journal.memo.receipt", params: ["party"] },
  {
    pattern: /^Credit note (\S+) - (.*)$/i,
    key: "journal.memo.creditNote",
    params: ["ref", "party"],
  },
  { pattern: /^Depreciation: (.*)$/, key: "journal.memo.depreciation", params: ["party"] },
  {
    pattern: /^Year-end close FY (.*)$/,
    key: "journal.memo.yearEndClose",
    params: ["ref"],
  },
  // X6b: inventory, payroll and bill posting descriptions (also used as line descriptions).
  { pattern: /^Opening stock - (.*)$/, key: "journal.memo.openingStock", params: ["ref"] },
  { pattern: /^Opening stock$/, key: "journal.memo.openingStockLine", params: [] },
  {
    pattern: /^Opening stock valuation - (.*)$/,
    key: "journal.memo.openingStockValuation",
    params: ["ref"],
  },
  {
    pattern: /^Opening stock valuation backfill$/,
    key: "journal.memo.openingStockBackfill",
    params: [],
  },
  {
    pattern: /^Opening stock valuation$/,
    key: "journal.memo.openingStockValuationLine",
    params: [],
  },
  {
    pattern: /^Payroll (\S+) - (\d+) employee\(s\)$/,
    key: "journal.memo.payrollRun",
    params: ["label", "n"],
  },
  {
    pattern: /^Salary payment - payroll (\S+)$/,
    key: "journal.memo.salaryPayment",
    params: ["label"],
  },
  {
    pattern: /^End-of-service settlement payment - (.*)$/,
    key: "journal.memo.eosSettlementPayment",
    params: ["party"],
  },
  {
    pattern: /^End-of-service settlement - (.*)$/,
    key: "journal.memo.eosSettlement",
    params: ["party"],
  },
  {
    pattern: /^Salaries & wages - payroll (\S+)(.*)$/,
    key: "journal.memo.payrollSalaries",
    params: ["label", "rest"],
  },
  {
    pattern: /^Employer pension contribution \(GPSSA\) - payroll (\S+)(.*)$/,
    key: "journal.memo.payrollEmployerPension",
    params: ["label", "rest"],
  },
  {
    pattern: /^End-of-service gratuity accrual - payroll (\S+)(.*)$/,
    key: "journal.memo.payrollGratuityAccrual",
    params: ["label", "rest"],
  },
  {
    pattern: /^Net salaries payable - payroll (\S+)$/,
    key: "journal.memo.payrollNetPayable",
    params: ["label"],
  },
  {
    pattern: /^Pension payable to GPSSA \(employee \+ employer\) - payroll (\S+)$/,
    key: "journal.memo.payrollPensionPayable",
    params: ["label"],
  },
  {
    pattern: /^Payroll deductions payable - payroll (\S+)$/,
    key: "journal.memo.payrollDeductionsPayable",
    params: ["label"],
  },
  {
    pattern: /^End-of-service gratuity provision - payroll (\S+)$/,
    key: "journal.memo.payrollGratuityProvision",
    params: ["label"],
  },
  { pattern: /^Input VAT - Bill (\S+)$/, key: "journal.memo.billInputVat", params: ["ref"] },
  {
    pattern: /^Reverse-charge output VAT - Bill (\S+)$/,
    key: "journal.memo.billReverseChargeVat",
    params: ["ref"],
  },
  {
    pattern: /^Settle A\/P - Bill (\S+) - (.*)$/,
    key: "journal.memo.billSettleAp",
    params: ["ref", "party"],
  },
  {
    pattern: /^Payment to (.*) - Bill (\S+)$/,
    key: "journal.memo.billPaymentTo",
    params: ["party", "ref"],
  },
  { pattern: /^Realised FX loss - Bill (\S+)$/, key: "journal.memo.billFxLoss", params: ["ref"] },
  { pattern: /^Realised FX gain - Bill (\S+)$/, key: "journal.memo.billFxGain", params: ["ref"] },
  { pattern: /^Bill (\S+) - (.*)$/, key: "journal.memo.billLine", params: ["ref", "party"] },
];

const METHOD_KEYS: Record<string, string> = {
  bank: "journal.memo.method.bank",
  cash: "journal.memo.method.cash",
  cheque: "journal.memo.method.cheque",
  online: "journal.memo.method.online",
  card: "journal.memo.method.card",
};

export function localizeJournalMemo(
  t: Translations,
  memo: string | null | undefined,
  locale: string
): string {
  const text = memo ?? "";
  if (locale !== "ar" || !text) return text;
  for (const shape of SHAPES) {
    const match = text.match(shape.pattern);
    const template = t[shape.key];
    if (!match || !template) continue;
    const values: Record<string, string> = {};
    shape.params.forEach((name, i) => {
      values[name] = (match[i + 1] ?? "").trim();
    });
    if (values.method) {
      const methodKey = METHOD_KEYS[values.method.toLowerCase()];
      values.method = (methodKey && t[methodKey]) || values.method;
    }
    return formatMessage(template, values);
  }
  return text;
}
