/**
 * Control-account protection for manual journals (A2: H8).
 *
 * A control account is the GL total of a sub-ledger: receivables (1040, the invoices), payables
 * (2010, the bills), inventory (1070 and each product's inventory account, the stock valuation),
 * input / output VAT (1050 / 2020 and every VAT account, the VAT engine), goods received not
 * invoiced (2015, the PO receipts) and the payroll payables (2030 / 2032 / 2034 / 2036, the
 * payroll runs). Its sub-ledger must be its only writer, otherwise the aging, valuation or VAT
 * return silently stops tying to the GL (H1: a manual Dr 5120 / Cr 1040 broke the A/R tie).
 *
 * A manual journal (POST /api/companies/:id/journal, draft edits, posting or approving a draft,
 * journal templates) that touches one is refused with 422 CONTROL_ACCOUNT_MANUAL_POSTING,
 * naming the account and the module that owns it. The one exception is an explicit adjustment:
 * `controlAdjustment: { reason }` from an owner, admin, accountant or CFO (403 otherwise). The
 * reason and the user are stamped on the entry (journal_entries.control_adjustment_reason / _by),
 * and the aging reconciliation lists such entries as reconciling items, so the difference
 * between the sub-ledger and the GL is always explained.
 */
import { pool } from "../db";
import { sql } from "drizzle-orm";
import { DomainError } from "../errors";
import type { LedgerTx } from "./types";
import { CONTROL_ACCOUNT_CODES, type ControlLedger } from "../../shared/control-accounts";

export { CONTROL_ACCOUNT_CODES, type ControlLedger };

const OWNER_TEXT: Record<ControlLedger, string> = {
  receivables: "invoices, credit notes and customer payments",
  payables: "bills, debit notes and bill payments",
  inventory: "stock movements, bills and invoices with products",
  vat: "invoices, bills and VAT adjustments",
  grni: "purchase-order receipts and their bills",
  payroll: "payroll runs, payments and final settlements",
};

/** Roles that may post an explicit control-account adjustment (firm staff with access pass). */
export const CONTROL_ADJUSTMENT_ROLES = new Set(["owner", "admin", "accountant", "cfo"]);

export interface ControlAccountHit {
  accountId: string;
  code: string;
  name: string | null;
  ledger: ControlLedger;
}

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** The control accounts among `accountIds` (a sub-account of a control account is one too). */
export async function controlAccountsAmong(
  companyId: string,
  accountIds: readonly string[],
  q: Queryable = pool
): Promise<ControlAccountHit[]> {
  const ids = [...new Set(accountIds.filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  if (!ids.length) return [];
  const { rows } = await q.query(
    `WITH RECURSIVE chain AS (
       SELECT a.id AS leaf, a.id, a.parent_id, a.code, a.is_vat_account, 0 AS depth
         FROM accounts a WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])
       UNION ALL
       SELECT c.leaf, p.id, p.parent_id, p.code, p.is_vat_account, c.depth + 1
         FROM chain c JOIN accounts p ON p.id = c.parent_id AND p.company_id = $1
        WHERE c.depth < 8
     )
     SELECT c.leaf, c.code, c.is_vat_account, a.code AS leaf_code, a.name_en AS leaf_name,
            EXISTS (SELECT 1 FROM products pr WHERE pr.company_id = $1
                       AND pr.inventory_account_id = c.leaf) AS is_inventory
       FROM chain c JOIN accounts a ON a.id = c.leaf
      ORDER BY c.leaf, c.depth`,
    [companyId, ids]
  );
  const hits = new Map<string, ControlAccountHit>();
  for (const r of rows as Array<{
    leaf: string;
    code: string;
    is_vat_account: boolean;
    leaf_code: string;
    leaf_name: string | null;
    is_inventory: boolean;
  }>) {
    if (hits.has(r.leaf)) continue;
    const ledger: ControlLedger | undefined =
      CONTROL_ACCOUNT_CODES[r.code] ??
      (r.is_vat_account ? "vat" : undefined) ??
      (r.is_inventory ? "inventory" : undefined);
    if (ledger) {
      hits.set(r.leaf, {
        accountId: r.leaf,
        code: r.leaf_code,
        name: r.leaf_name,
        ledger,
      });
    }
  }
  return [...hits.values()];
}

export interface ControlAdjustmentInput {
  reason: string;
}

/**
 * Gate a manual journal's lines. Returns the control accounts touched (empty when none). Throws
 * 422 CONTROL_ACCOUNT_MANUAL_POSTING without an adjustment, 403 CONTROL_ADJUSTMENT_ROLE_REQUIRED
 * for a role that may not adjust, 422 CONTROL_ADJUSTMENT_REASON_REQUIRED for an empty reason.
 */
export async function assertManualControlPosting(args: {
  companyId: string;
  accountIds: readonly string[];
  adjustment?: ControlAdjustmentInput | null;
  /** Stamped reason already on the draft being posted. */
  stampedReason?: string | null;
  /** The user's company role; null = firm staff reaching the company through access rules. */
  role: string | null;
}): Promise<ControlAccountHit[]> {
  const hits = await controlAccountsAmong(args.companyId, args.accountIds);
  if (!hits.length) return hits;
  const reason = (args.adjustment?.reason ?? args.stampedReason ?? "").trim();
  if (!args.adjustment && !args.stampedReason) {
    const first = hits[0];
    throw new DomainError(
      "CONTROL_ACCOUNT_MANUAL_POSTING",
      422,
      {
        accounts: hits.map((h) => ({ accountId: h.accountId, code: h.code, ledger: h.ledger })),
      },
      `${first.code} ${first.name ?? ""} is a control account kept by ${OWNER_TEXT[first.ledger]}. ` +
        "Record the transaction there so the sub-ledger stays tied to the general ledger, or " +
        "post it as a control-account adjustment with a reason."
    );
  }
  if (args.role !== null && !CONTROL_ADJUSTMENT_ROLES.has(args.role)) {
    throw new DomainError(
      "CONTROL_ADJUSTMENT_ROLE_REQUIRED",
      403,
      { role: args.role },
      "Only an owner, admin, accountant or CFO can adjust a control account directly"
    );
  }
  if (reason.length < 5) {
    throw new DomainError(
      "CONTROL_ADJUSTMENT_REASON_REQUIRED",
      422,
      undefined,
      "Give a reason (at least 5 characters) for adjusting a control account"
    );
  }
  return hits;
}

/** Stamp (or clear) the adjustment reason on a manual entry, in the posting transaction. */
export async function stampControlAdjustment(
  tx: LedgerTx,
  entryId: string,
  reason: string | null,
  userId: string | null
): Promise<void> {
  await tx.execute(
    sql`UPDATE journal_entries SET control_adjustment_reason = ${reason},
               control_adjustment_by = ${reason ? userId : null}
         WHERE id = ${entryId}`
  );
}

/** The stamped adjustment reason and the line accounts of an entry. */
export async function manualEntryControlState(
  entryId: string
): Promise<{ reason: string | null; accountIds: string[] }> {
  const [head, lines] = await Promise.all([
    pool.query(`SELECT control_adjustment_reason FROM journal_entries WHERE id = $1`, [entryId]),
    pool.query(`SELECT DISTINCT account_id FROM journal_lines WHERE entry_id = $1`, [entryId]),
  ]);
  return {
    reason:
      (head.rows[0] as { control_adjustment_reason?: string | null } | undefined)
        ?.control_adjustment_reason ?? null,
    accountIds: (lines.rows as Array<{ account_id: string }>).map((r) => r.account_id),
  };
}

/** Sources gated as manual journals. */
export const MANUAL_SOURCES = new Set(["manual", "journal_template"]);
