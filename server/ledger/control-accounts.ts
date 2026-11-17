/**
 * Control-account protection for manual journals (A2: H8).
 *
 * A control account is the GL total of a sub-ledger: receivables (1040, the invoices), payables
 * (2010, the bills), inventory (1070 and each product's inventory account, the stock valuation),
 * input / output VAT (1050 / 2020 and every input / output VAT account, the VAT engine; the
 * zero-rated / exempt sales accounts 4060 / 4070 carry a VAT flag but are not control accounts),
 * goods received not invoiced (2015, the PO receipts) and the payroll payables (2030 / 2032 /
 * 2034 / 2036, the payroll runs). Its sub-ledger must be its only writer, otherwise the aging, valuation or VAT
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
import { rowsOf } from "./tx";
import type { LedgerContext, LedgerTx, NormalizedLine } from "./types";
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

const CONTROL_CHAIN_SQL = `WITH RECURSIVE chain AS (
       SELECT a.id AS leaf, a.id, a.parent_id, a.code,
              (a.is_vat_account AND a.vat_type IN ('input', 'output')) AS is_vat_account, 0 AS depth
         FROM accounts a WHERE a.company_id = $1 AND a.id = ANY($2::uuid[])
       UNION ALL
       SELECT c.leaf, p.id, p.parent_id, p.code,
              (p.is_vat_account AND p.vat_type IN ('input', 'output')), c.depth + 1
         FROM chain c JOIN accounts p ON p.id = c.parent_id AND p.company_id = $1
        WHERE c.depth < 8
     )
     SELECT c.leaf, c.code, c.is_vat_account, a.code AS leaf_code, a.name_en AS leaf_name,
            EXISTS (SELECT 1 FROM products pr WHERE pr.company_id = $1
                       AND pr.inventory_account_id = c.leaf) AS is_inventory
       FROM chain c JOIN accounts a ON a.id = c.leaf
      ORDER BY c.leaf, c.depth`;

interface ChainRow {
  leaf: string;
  code: string;
  is_vat_account: boolean;
  leaf_code: string;
  leaf_name: string | null;
  is_inventory: boolean;
}

function uuidsOf(accountIds: readonly string[]): string[] {
  return [...new Set(accountIds.filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
}

function classify(rows: ChainRow[]): ControlAccountHit[] {
  const hits = new Map<string, ControlAccountHit>();
  for (const r of rows) {
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

/** The control accounts among `accountIds` (a sub-account of a control account is one too). */
export async function controlAccountsAmong(
  companyId: string,
  accountIds: readonly string[],
  q: Queryable = pool
): Promise<ControlAccountHit[]> {
  const ids = uuidsOf(accountIds);
  if (!ids.length) return [];
  const { rows } = await q.query(CONTROL_CHAIN_SQL, [companyId, ids]);
  return classify(rows as ChainRow[]);
}

/** controlAccountsAmong inside a ledger transaction (the posting kernel). */
async function controlAccountsAmongTx(
  tx: LedgerTx,
  companyId: string,
  accountIds: readonly string[]
): Promise<ControlAccountHit[]> {
  const ids = uuidsOf(accountIds);
  if (!ids.length) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  );
  const res = await tx.execute(sql`WITH RECURSIVE chain AS (
       SELECT a.id AS leaf, a.id, a.parent_id, a.code,
              (a.is_vat_account AND a.vat_type IN ('input', 'output')) AS is_vat_account, 0 AS depth
         FROM accounts a WHERE a.company_id = ${companyId} AND a.id IN (${list})
       UNION ALL
       SELECT c.leaf, p.id, p.parent_id, p.code,
              (p.is_vat_account AND p.vat_type IN ('input', 'output')), c.depth + 1
         FROM chain c JOIN accounts p ON p.id = c.parent_id AND p.company_id = ${companyId}
        WHERE c.depth < 8
     )
     SELECT c.leaf, c.code, c.is_vat_account, a.code AS leaf_code, a.name_en AS leaf_name,
            EXISTS (SELECT 1 FROM products pr WHERE pr.company_id = ${companyId}
                       AND pr.inventory_account_id = c.leaf) AS is_inventory
       FROM chain c JOIN accounts a ON a.id = c.leaf
      ORDER BY c.leaf, c.depth`);
  return classify(rowsOf<ChainRow>(res));
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
  if (!args.adjustment && !args.stampedReason) throw controlPostingError(hits);
  assertAdjustmentAllowed(args.role, reason);
  return hits;
}

/** Where each control account's transactions are recorded instead of a generic journal. */
const SUBLEDGER_PATHS: Record<ControlLedger, { action: string; endpoint: string }> = {
  receivables: {
    action: "Match the bank line or receipt to the customer's invoice, or record a deposit",
    endpoint: "POST /api/companies/:companyId/bank-statements/:id/match",
  },
  payables: {
    action: "Match the bank line or payment to the supplier's bill",
    endpoint: "POST /api/companies/:companyId/bank-statements/:id/match",
  },
  inventory: {
    action: "Record a stock movement, adjustment or stocktake",
    endpoint: "POST /api/companies/:companyId/inventory/adjustments",
  },
  vat: {
    action: "Pay or receive a filed VAT return through its settlement",
    endpoint: "POST /api/vat-returns/:id/settlement",
  },
  grni: {
    action: "Receive the goods against the purchase order, then bill them",
    endpoint: "POST /api/purchase-orders/:id/receive",
  },
  payroll: {
    action: "Use the payroll run payment, the pension payment or the final settlement",
    endpoint: "POST /api/companies/:companyId/payroll/runs/:id/pay",
  },
};

/**
 * The 422 refusal. `paths` names the sub-ledger flow that records the transaction instead (a bank
 * line is matched to its invoice or bill; VAT is paid or refunded through the return's settlement).
 */
function controlPostingError(hits: ControlAccountHit[]): DomainError {
  const first = hits[0];
  return new DomainError(
    "CONTROL_ACCOUNT_MANUAL_POSTING",
    422,
    {
      accounts: hits.map((h) => ({ accountId: h.accountId, code: h.code, ledger: h.ledger })),
      paths: [...new Set(hits.map((h) => h.ledger))].map((ledger) => ({
        ledger,
        ...SUBLEDGER_PATHS[ledger],
      })),
    },
    `${first.code} ${first.name ?? ""} is a control account kept by ${OWNER_TEXT[first.ledger]}. ` +
      "Record the transaction there so the sub-ledger stays tied to the general ledger, or " +
      "post it as a control-account adjustment with a reason."
  );
}

function assertAdjustmentAllowed(role: string | null, reason: string): void {
  if (role !== null && !CONTROL_ADJUSTMENT_ROLES.has(role)) {
    throw new DomainError(
      "CONTROL_ADJUSTMENT_ROLE_REQUIRED",
      403,
      { role },
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

/**
 * B1 (NC1): journal sources that ARE the sub-ledger of the control accounts they post to. Each
 * one records its document (invoice, bill, payment, payroll run, stock movement, VAT return, ...)
 * in the same transaction, so the aging, valuation, payroll or VAT figures move with the GL. Any
 * other source (manual journals, templates, bank-line entries, imports, AI postings, receipts, a
 * source added later) is generic: the kernel refuses its lines on a control account unless the
 * entry is an explicit, reasoned control-account adjustment by a permitted role.
 */
export const SUBLEDGER_SOURCES: ReadonlySet<string> = new Set([
  // Receivables
  "invoice",
  "payment",
  "payment_reversal",
  "customer_credit",
  "customer_deposit",
  "invoice_write_off",
  "doubtful_debt_allowance",
  // Payables
  "bill",
  "bill_reversal",
  "bill_payment",
  "bill_payment_void",
  "vendor_prepayment",
  "vendor_debit_note",
  "bill_credit_fx",
  // Inventory and goods received not invoiced
  "inventory",
  "inventory_adjustment",
  "invoice_cogs",
  "credit_note_cogs",
  "stocktake",
  "po_receipt",
  // Payroll
  "payroll",
  "payroll_payment",
  "payroll_settlement",
  "payroll_settlement_payment",
  "payroll_pension_payment",
  // VAT
  "vat_return_settlement",
  "vat_bad_debt_relief",
  "vat_partial_exemption",
  // NR firm VAT workpaper rows post the documents the firm's VAT file reports.
  "vat_workpaper_row",
  // Fixed assets (capitalisation input VAT, disposal output VAT)
  "fixed_asset",
  // FX revaluation of the control accounts' foreign balances (and its reversal / undo)
  "fx_revaluation",
  "fx_revaluation_reversal",
  "fx_revaluation_undo",
  // Go-live: the opening trial balance (A/R and A/P carried by imported documents)
  "opening_balance",
  // Expense claims: the claim's own account mapping (reimbursement payable, input VAT)
  "expense_claim",
  "expense_claim_payment",
]);

/**
 * B1 (NC1): the single control-account gate of the posting kernel. Called for every new entry
 * (draft or posted) and every draft edit whose source is not a sub-ledger; reversals mirror an
 * entry that already passed it. A line flagged `systemVat` (VAT the posting service derived from
 * a VAT treatment) may sit on a VAT account; every other control-account line needs
 * `ctx.controlAdjustment` (role and reason checked here) or a reason already stamped on the
 * draft. Returns the reason to stamp on the entry (null when no control account is touched).
 */
export async function assertKernelControlPosting(
  tx: LedgerTx,
  args: {
    companyId: string;
    source: string | null;
    lines: readonly NormalizedLine[];
    ctx: LedgerContext;
    stampedReason?: string | null;
  }
): Promise<string | null> {
  if (SUBLEDGER_SOURCES.has(args.source ?? "")) return null;
  const all = await controlAccountsAmongTx(
    tx,
    args.companyId,
    args.lines.map((l) => l.accountId)
  );
  if (!all.length) return null;
  const ledgerOf = new Map(all.map((h) => [h.accountId, h]));
  const userHits = new Map<string, ControlAccountHit>();
  for (const l of args.lines) {
    const hit = ledgerOf.get(l.accountId);
    if (!hit) continue;
    if (l.systemVat === true && hit.ledger === "vat") continue;
    userHits.set(hit.accountId, hit);
  }
  if (!userHits.size) return null;
  const adjustment = args.ctx.controlAdjustment ?? null;
  if (!adjustment) {
    if (args.stampedReason && args.stampedReason.trim().length >= 5) return args.stampedReason;
    throw controlPostingError([...userHits.values()]);
  }
  const reason = String(adjustment.reason ?? "").trim();
  assertAdjustmentAllowed(adjustment.role, reason);
  return reason;
}

/** Source family -> where the document's own correction flow lives (NH2 refusal). */
const OWNED_SOURCE_FLOWS: Array<{ sources: string[]; document: string; action: string }> = [
  {
    sources: ["invoice", "invoice_cogs", "credit_note_cogs", "invoice_write_off"],
    document: "invoice",
    action: "Void the invoice or issue a credit note",
  },
  {
    sources: ["payment", "payment_reversal", "customer_credit", "doubtful_debt_allowance"],
    document: "customer_payment",
    action: "Reverse the payment or credit from the invoice",
  },
  {
    sources: ["customer_deposit"],
    document: "customer_deposit",
    action: "Refund or reverse the deposit",
  },
  {
    sources: ["bill", "bill_reversal", "vendor_debit_note", "bill_credit_fx"],
    document: "bill",
    action: "Void the bill or raise a debit note",
  },
  {
    sources: ["bill_payment", "bill_payment_void", "vendor_prepayment"],
    document: "bill_payment",
    action: "Void the bill payment",
  },
  {
    sources: ["inventory", "inventory_adjustment", "stocktake", "po_receipt"],
    document: "inventory",
    action: "Record a reversing stock movement or adjustment",
  },
  {
    sources: [
      "payroll",
      "payroll_payment",
      "payroll_settlement",
      "payroll_settlement_payment",
      "payroll_pension_payment",
    ],
    document: "payroll",
    action: "Reverse the payroll run, payment or settlement",
  },
  {
    sources: ["vat_return_settlement", "vat_bad_debt_relief", "vat_partial_exemption"],
    document: "vat_return",
    action: "Use the VAT return's settlement, relief or amendment flow",
  },
  { sources: ["fixed_asset"], document: "fixed_asset", action: "Use the fixed-asset register" },
  {
    sources: ["fx_revaluation", "fx_revaluation_reversal", "fx_revaluation_undo"],
    document: "fx_revaluation",
    action: "Undo the FX revaluation run",
  },
  {
    sources: ["bank_reconciliation", "bank_transfer"],
    document: "bank_transaction",
    action: "Unmatch the bank statement line",
  },
  { sources: ["receipt"], document: "receipt", action: "Revise the receipt" },
  {
    sources: ["expense_claim", "expense_claim_payment"],
    document: "expense_claim",
    action: "Reverse the expense claim",
  },
  {
    sources: ["opening_balance"],
    document: "import_job",
    action: "Correct the opening balances with a reasoned adjustment",
  },
  {
    sources: ["corporate_tax", "corporate_tax_accrual", "deferred_tax"],
    document: "corporate_tax_return",
    action: "Use the corporate tax return's provision flow",
  },
  { sources: ["year_end_close"], document: "fiscal_year", action: "Re-open the fiscal year" },
  {
    sources: ["vat_workpaper_row"],
    document: "vat_workpaper",
    action: "Correct the row in the VAT workpaper",
  },
];

/**
 * B1 (NH2): the generic journal routes (POST /api/journal/:id/reverse and /void) may only undo a
 * journal the user owns (manual, template, bulk import, AI posting, legacy rows with no source).
 * An entry posted by a document flow is undone through that document, otherwise the document
 * stays live while its GL entry is gone (AR / AP aging and the VAT return stop tying). 409
 * SUBLEDGER_ENTRY names the document and its correction flow.
 */
export function assertUserReversible(entry: {
  id: string;
  source: string | null;
  sourceId: string | null;
}): void {
  const source = entry.source ?? "";
  const flow = OWNED_SOURCE_FLOWS.find((f) => f.sources.includes(source));
  if (!flow) return;
  throw new DomainError(
    "SUBLEDGER_ENTRY",
    409,
    { entryId: entry.id, source, document: flow.document, documentId: entry.sourceId ?? null },
    `This journal entry was posted by a ${flow.document.replace(/_/g, " ")} and is undone from ` +
      `there, so the document and the general ledger stay in step. ${flow.action}.`
  );
}
