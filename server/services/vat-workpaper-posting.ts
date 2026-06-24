// Pure double-entry generator for posting a manual VAT workpaper row to the
// general ledger, so a sale (or other supply) entered in the VAT area also shows
// up in the journal, P&L and balance sheet — the books tie out to the VAT 201.
//
// Scope: the unambiguous SALES categories (standard / zero-rated / exempt). The
// purchase, import and reverse-charge categories need per-expense-account
// resolution and self-assessed-VAT treatment that can't be inferred safely, so
// they are reported as "not auto-postable" rather than risk a wrong entry. The
// service only ever posts manually-entered rows (never rows pulled from the
// books) to avoid double-counting.
//
// Side-effect free + unit-tested. Account ids are resolved by the caller and
// passed in (mirrors buildReversalLines), so this stays DB-free.

export interface PostableLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

export interface VatRowForPosting {
  rowCategory: string;
  taxableAmount: number; // net
  vatAmount: number;
  label?: string;
}

export interface SalesAccountIds {
  accountsReceivableId?: string | null;
  salesRevenueId?: string | null;
  zeroRatedRevenueId?: string | null;
  vatOutputId?: string | null;
}

export type BuildResult =
  | { ok: true; lines: PostableLine[] }
  | { ok: false; code: string; message: string };

export const POSTABLE_VAT_CATEGORIES = [
  "standard_sale",
  "zero_rated_sale",
  "exempt_sale",
] as const;

export function isPostableVatCategory(category: string): boolean {
  return (POSTABLE_VAT_CATEGORIES as readonly string[]).includes(category);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Build the balanced journal legs for a VAT workpaper sales row. Fails closed
 * (no lines) when the category isn't auto-postable, the amount is non-positive,
 * or a required account is missing — never returns an unbalanced entry.
 */
export function buildVatRowJournalLines(row: VatRowForPosting, accounts: SalesAccountIds): BuildResult {
  if (!isPostableVatCategory(row.rowCategory)) {
    return {
      ok: false,
      code: "NOT_AUTO_POSTABLE",
      message:
        `${row.rowCategory} rows aren't posted to the ledger automatically. ` +
        `Only sales rows (standard-rated, zero-rated, exempt) post automatically — ` +
        `record this one with a manual journal entry.`,
    };
  }

  const net = round2(Number(row.taxableAmount) || 0);
  const vat = round2(Number(row.vatAmount) || 0);
  if (net <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Taxable amount must be greater than zero to post." };
  }

  const label = row.label?.trim() || "VAT sale";
  const ar = accounts.accountsReceivableId;
  if (!ar) {
    return { ok: false, code: "AR_ACCOUNT_MISSING", message: "Accounts Receivable account is missing from the chart of accounts." };
  }

  const lines: PostableLine[] = [];

  if (row.rowCategory === "standard_sale") {
    if (!accounts.salesRevenueId) {
      return { ok: false, code: "REVENUE_ACCOUNT_MISSING", message: "Sales Revenue account is missing from the chart of accounts." };
    }
    if (vat > 0 && !accounts.vatOutputId) {
      return { ok: false, code: "VAT_ACCOUNT_MISSING", message: "Output VAT account is missing from the chart of accounts." };
    }
    const gross = round2(net + vat);
    lines.push({ accountId: ar, debit: gross, credit: 0, description: `${label} — receivable` });
    lines.push({ accountId: accounts.salesRevenueId, debit: 0, credit: net, description: `${label} — revenue` });
    if (vat > 0) {
      lines.push({ accountId: accounts.vatOutputId!, debit: 0, credit: vat, description: `${label} — output VAT` });
    }
  } else if (row.rowCategory === "zero_rated_sale") {
    const revenue = accounts.zeroRatedRevenueId ?? accounts.salesRevenueId;
    if (!revenue) {
      return { ok: false, code: "REVENUE_ACCOUNT_MISSING", message: "Zero-rated/Sales Revenue account is missing from the chart of accounts." };
    }
    lines.push({ accountId: ar, debit: net, credit: 0, description: `${label} — receivable` });
    lines.push({ accountId: revenue, debit: 0, credit: net, description: `${label} — zero-rated revenue` });
  } else {
    // exempt_sale
    if (!accounts.salesRevenueId) {
      return { ok: false, code: "REVENUE_ACCOUNT_MISSING", message: "Sales Revenue account is missing from the chart of accounts." };
    }
    lines.push({ accountId: ar, debit: net, credit: 0, description: `${label} — receivable` });
    lines.push({ accountId: accounts.salesRevenueId, debit: 0, credit: net, description: `${label} — exempt revenue` });
  }

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    return { ok: false, code: "UNBALANCED", message: `VAT row entry is unbalanced (${dr} vs ${cr}).` };
  }
  return { ok: true, lines };
}
