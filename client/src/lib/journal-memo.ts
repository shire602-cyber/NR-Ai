// System-generated journal memos are written by the server in English. Entries posted after
// migration 0131 also carry `memoKey` + `memoParams` (shared/journal-memo.ts): in Arabic mode the
// UI renders them straight from the catalog (`journal.memo.<key>`). Older rows have no key, so the
// UI rebuilds the known shapes by matching the English text (shapes generated from the shared
// template registry, then the hand-written shapes below) and keeps the document number / party
// name from the server text. Memos typed by a person, and any shape not listed, are unchanged.
import { formatMessage } from "@/lib/i18n";
import {
  JOURNAL_LINE_TEMPLATES,
  JOURNAL_MEMO_TEMPLATES,
  isJournalMemoKey,
  journalMemoCatalogKey,
} from "@shared/journal-memo";

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
  // Sweep: AI bank categorisation memos (server/services/autonomous-gl.service.ts).
  {
    pattern: /^AI Draft \(review required\): (.*)$/,
    key: "journal.memo.aiDraft",
    params: ["party"],
  },
  { pattern: /^AI GL \(reviewed\): (.*)$/, key: "journal.memo.aiReviewed", params: ["party"] },
  // Step 1 / F9: system memos of inventory, capitalisation, expense claims, credit-note reversals
  // and payment-gateway fees (server/services/inventory, fixed-assets, expense-claims.routes,
  // invoice-posting, payments). The reversal shape must match before the generic credit note.
  {
    pattern: /^Credit Note (\S+) - reversal of Invoice (\S+)$/,
    key: "journal.memo.creditNoteReversal",
    params: ["ref", "invoice"],
  },
  {
    pattern: /^Inventory purchase - (.*)$/,
    key: "journal.memo.inventoryPurchase",
    params: ["ref"],
  },
  { pattern: /^Inventory sale - (.*)$/, key: "journal.memo.inventorySale", params: ["ref"] },
  {
    pattern: /^Inventory adjustment - (.*)$/,
    key: "journal.memo.inventoryAdjustment",
    params: ["ref"],
  },
  { pattern: /^Inventory opening - (.*)$/, key: "journal.memo.inventoryOpening", params: ["ref"] },
  {
    pattern: /^Inventory write-down reversal - (.*?): (.*)$/,
    key: "journal.memo.inventoryWriteDownReversal",
    params: ["ref", "reason"],
  },
  {
    pattern: /^Inventory write-down - (.*?): (.*)$/,
    key: "journal.memo.inventoryWriteDown",
    params: ["ref", "reason"],
  },
  {
    pattern: /^Inventory reversal adjustment - (.*)$/,
    key: "journal.memo.inventoryReversalAdjustment",
    params: ["ref"],
  },
  { pattern: /^Capitalization: (.*)$/, key: "journal.memo.capitalization", params: ["ref"] },
  {
    pattern: /^Expense claim (\S+) approved$/,
    key: "journal.memo.expenseClaimApproved",
    params: ["ref"],
  },
  {
    pattern: /^Expense claim (\S+) reimbursed$/,
    key: "journal.memo.expenseClaimReimbursed",
    params: ["ref"],
  },
  {
    pattern: /^Payment gateway fee \((\w+)\) for link \S+$/,
    key: "journal.memo.gatewayFee",
    params: ["provider"],
  },
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
  bank_reconciliation: "journal.memo.method.bank_reconciliation",
  bank_transfer: "journal.memo.method.bank_transfer",
  credit_card: "journal.memo.method.credit_card",
  wire: "journal.memo.method.wire",
  customer_deposit: "journal.memo.method.customer_deposit",
  credit_note: "journal.memo.method.credit_note",
  rule: "journal.memo.method.rule",
  keyword: "journal.memo.method.keyword",
  statistical: "journal.memo.method.statistical",
  openai: "journal.memo.method.openai",
};

const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A matcher for one registry template: literal text, `{name}` -> lazy capture. */
function shapeFromTemplate(catalogKey: string, template: string): MemoShape {
  const params: string[] = [];
  const source = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (!m) return escapeRegExp(part);
      params.push(m[1]);
      return "(.*?)";
    })
    .join("");
  return { pattern: new RegExp(`^${source}$`), key: catalogKey, params };
}

const literalLength = (template: string) => template.replace(/\{\w+\}/g, "").length;

// Generated shapes first, most specific (longest literal text) first, so "Depreciation: X (3/2026,
// catch-up)" wins over the generic "Depreciation: X"; the hand-written shapes stay as a fallback.
const GENERATED_SHAPES: MemoShape[] = [
  ...Object.entries(JOURNAL_MEMO_TEMPLATES).map(([k, tpl]) => ({
    tpl: tpl as string,
    shape: shapeFromTemplate(journalMemoCatalogKey(k), tpl),
  })),
  ...Object.entries(JOURNAL_LINE_TEMPLATES).map(([k, tpl]) => ({
    tpl: tpl as string,
    shape: shapeFromTemplate(`journal.memo.line.${k}`, tpl),
  })),
]
  .sort((a, b) => literalLength(b.tpl) - literalLength(a.tpl))
  .map((x) => x.shape);

const ALL_SHAPES: MemoShape[] = [...GENERATED_SHAPES, ...SHAPES];

function localizeValues(t: Translations, values: Record<string, string>): Record<string, string> {
  if (values.method) {
    const methodKey = METHOD_KEYS[values.method.toLowerCase()];
    values.method = (methodKey && t[methodKey]) || values.method;
  }
  return values;
}

/** The stored key + params of an entry, when the server wrote them. */
export interface JournalMemoSource {
  memo?: string | null;
  memoKey?: string | null;
  memoParams?: Record<string, string> | null;
}

export function localizeJournalMemo(
  t: Translations,
  memo: string | null | undefined,
  locale: string,
  source?: JournalMemoSource | null
): string {
  const text = memo ?? "";
  if (locale !== "ar" || !text) return text;
  // Render from the stored key when the shown text is the entry's own memo (a line description
  // that differs from the memo goes through the pattern matcher below).
  if (source?.memoKey && isJournalMemoKey(source.memoKey) && (source.memo ?? text) === text) {
    const template = t[journalMemoCatalogKey(source.memoKey)];
    if (template) {
      return formatMessage(template, localizeValues(t, { ...(source.memoParams ?? {}) }));
    }
  }
  for (const shape of ALL_SHAPES) {
    const match = text.match(shape.pattern);
    const template = t[shape.key];
    if (!match || !template) continue;
    const values: Record<string, string> = {};
    shape.params.forEach((name, i) => {
      values[name] = (match[i + 1] ?? "").trim();
    });
    return formatMessage(template, localizeValues(t, values));
  }
  return text;
}
