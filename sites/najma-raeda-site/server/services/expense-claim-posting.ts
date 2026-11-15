// Pure logic for posting an approved expense claim to the general ledger
// (audit finding S-H6 — approval previously changed status but posted NO GL
// entry, so company expenses and the liability to the employee never hit the
// books). Side-effect free so it can be unit tested without a database.
//
// Posting model (on approval):
//   Dr  Expense account (per item category)      net amount
//   Dr  Input VAT (recoverable)                  item VAT
//   Cr  Employee Reimbursements Payable          gross (net + VAT)
// The liability is later cleared on reimbursement (Dr payable / Cr bank).

import { ACCOUNT_CODES } from "../constants";

export type ExpenseClaimItem = {
  category?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
  description?: string | null;
};

export type JournalLine = {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Map a free-text expense-claim category to a default chart-of-accounts
 * expense code. Unknown / blank categories fall back to Office Supplies (5050),
 * a neutral operating-expense bucket.
 */
export function mapExpenseCategoryToCode(category: string | null | undefined): string {
  const c = (category ?? "").trim().toLowerCase();
  if (!c) return "5050";
  if (/(travel|flight|hotel|taxi|mileage|fuel|transport|meal|food|entertain)/.test(c)) return "5090";
  if (/(rent|lease)/.test(c)) return "5010";
  if (/(util|electric|water|cooling|dewa|sewa)/.test(c)) return "5030";
  if (/(phone|telephone|internet|mobile|telecom|sim|etisalat|du)/.test(c)) return "5040";
  if (/(market|advert|promo|campaign|ads?)/.test(c)) return "5060";
  if (/(legal|consult|account|audit|professional|advisor)/.test(c)) return "5070";
  if (/(software|saas|subscription|license|licence|app)/.test(c)) return "5080";
  if (/(office|stationery|supply|supplies|printing|courier|postage)/.test(c)) return "5050";
  if (/(bank|charge|fee)/.test(c)) return "5110";
  return "5050";
}

/**
 * Build the balanced GL legs for an approved expense claim. `resolveByCode`
 * returns the account id for a chart code (or null if absent). Fails hard if a
 * required account is missing rather than posting an unbalanced entry.
 */
export function buildExpenseClaimJournalLines(args: {
  items: ExpenseClaimItem[];
  resolveByCode: (code: string) => string | null | undefined;
  memoPrefix?: string;
}):
  | { ok: true; lines: Array<{ accountId: string; debit: number; credit: number; description: string }> }
  | { ok: false; status: number; code: string; message: string } {
  const { items, resolveByCode } = args;
  if (!items || items.length === 0) {
    return { ok: false, status: 422, code: "NO_ITEMS", message: "Expense claim has no line items to post." };
  }

  const reimbursementId = resolveByCode(ACCOUNT_CODES.EMP_REIMBURSEMENT_PAYABLE);
  if (!reimbursementId) {
    return {
      ok: false,
      status: 422,
      code: "REIMBURSEMENT_ACCOUNT_MISSING",
      message:
        "Cannot post expense claim: the Employee Reimbursements Payable account " +
        `(${ACCOUNT_CODES.EMP_REIMBURSEMENT_PAYABLE}) is missing. Seed the default chart of accounts first.`,
    };
  }

  // Aggregate net amounts per expense account, plus total recoverable VAT.
  const expenseByCode = new Map<string, number>();
  let totalVat = 0;
  let totalGross = 0;
  for (const item of items) {
    const net = round2(num(item.amount));
    const vat = round2(num(item.vatAmount));
    const code = mapExpenseCategoryToCode(item.category);
    expenseByCode.set(code, round2((expenseByCode.get(code) ?? 0) + net));
    totalVat = round2(totalVat + vat);
    totalGross = round2(totalGross + net + vat);
  }

  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
  for (const [code, amount] of expenseByCode.entries()) {
    if (amount === 0) continue;
    const accountId = resolveByCode(code);
    if (!accountId) {
      return {
        ok: false,
        status: 422,
        code: "EXPENSE_ACCOUNT_MISSING",
        message: `Cannot post expense claim: expense account ${code} is missing from the chart of accounts.`,
      };
    }
    lines.push({ accountId, debit: amount, credit: 0, description: `Expense claim — ${code}` });
  }

  if (totalVat > 0) {
    const vatId = resolveByCode(ACCOUNT_CODES.VAT_INPUT);
    if (!vatId) {
      return {
        ok: false,
        status: 422,
        code: "INPUT_VAT_ACCOUNT_MISSING",
        message: "Cannot post expense claim: Input VAT account is missing from the chart of accounts.",
      };
    }
    lines.push({ accountId: vatId, debit: totalVat, credit: 0, description: "Expense claim — recoverable input VAT" });
  }

  lines.push({
    accountId: reimbursementId,
    debit: 0,
    credit: totalGross,
    description: "Expense claim — owed to employee",
  });

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    return {
      ok: false,
      status: 500,
      code: "UNBALANCED_EXPENSE_CLAIM",
      message: `Expense claim entry is unbalanced (debits ${dr} vs credits ${cr}).`,
    };
  }
  return { ok: true, lines };
}
