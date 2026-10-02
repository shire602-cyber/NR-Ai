// An asset is "recorded in the books" when it is tied to the purchase document that put its cost on a fixed-asset account
// (12xx, not the accumulated depreciation 1240): a posted vendor bill coded to 1290, or a posted journal (an opening balance,
// a card purchase). Linking posts nothing - the cost is already in the ledger, so linking can never double-count it.
// A line may fund several assets as long as their costs together stay within the line.

import { pool } from "../db";
import { AppError } from "../errors";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const linkInvalid = (reason: string, message: string, details?: Record<string, unknown>) =>
  new AppError({ message, statusCode: 422, code: "LINK_INVALID", details: { reason, ...(details ?? {}) } });

export interface SourceLink {
  billId: string | null;
  journalEntryId: string;
  journalLineId: string;
  document: { type: "bill" | "journal"; number: string | null };
}

export async function resolveSourceLink(args: {
  companyId: string;
  cost: number;
  billId?: string | null;
  billLineId?: string | null;
  journalEntryId?: string | null;
  /** The asset being linked: its own cost does not count against the line. */
  excludeAssetId?: string | null;
}): Promise<SourceLink> {
  const { companyId, cost } = args;
  let entryId: string | null = null;
  let entryNumber: string | null = null;
  let billNumber: string | null = null;
  let billId: string | null = null;
  let accountFilter: string | null = null;
  let amountHint: number | null = null;

  if (args.billId) {
    const bill = (await pool.query(`SELECT id, bill_number, exchange_rate FROM vendor_bills WHERE id = $1 AND company_id = $2`, [args.billId, companyId])).rows[0];
    if (!bill) throw linkInvalid("BILL_NOT_FOUND", "The bill is not one of this company's bills.");
    const entry = (await pool.query(`SELECT id, entry_number FROM journal_entries WHERE company_id = $1 AND source = 'bill' AND source_id = $2 AND status = 'posted' LIMIT 1`, [companyId, bill.id])).rows[0];
    if (!entry) throw linkInvalid("BILL_NOT_POSTED", "The bill is not approved yet: its cost is not in the books. Approve it first.");
    entryId = entry.id;
    entryNumber = entry.entry_number;
    billNumber = bill.bill_number;
    billId = bill.id;
    if (args.billLineId) {
      const line = (await pool.query(`SELECT account_id, amount::float8 AS amount FROM bill_line_items WHERE id = $1 AND bill_id = $2`, [args.billLineId, bill.id])).rows[0];
      if (!line) throw linkInvalid("BILL_LINE_NOT_FOUND", "That line is not on the bill.");
      accountFilter = line.account_id;
      amountHint = r2(Number(line.amount) * (Number(bill.exchange_rate) > 0 ? Number(bill.exchange_rate) : 1));
    }
  } else if (args.journalEntryId) {
    const entry = (await pool.query(`SELECT id, entry_number FROM journal_entries WHERE id = $1 AND company_id = $2 AND status = 'posted'`, [args.journalEntryId, companyId])).rows[0];
    if (!entry) throw linkInvalid("JOURNAL_NOT_FOUND", "The journal entry is not a posted entry of this company.");
    entryId = entry.id;
    entryNumber = entry.entry_number;
  } else {
    throw linkInvalid("NO_DOCUMENT", "Choose the bill or journal entry that bought the asset.");
  }

  const lines = (
    await pool.query(
      `SELECT jl.id, jl.account_id, (jl.debit - jl.credit)::float8 AS cost,
              COALESCE((SELECT SUM(fa.purchase_cost) FROM fixed_assets fa WHERE fa.source_journal_line_id = jl.id AND ($3::uuid IS NULL OR fa.id <> $3::uuid)), 0)::float8 AS used,
              EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.source_journal_line_id = jl.id AND ($3::uuid IS NULL OR fa.id <> $3::uuid)) AS linked
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE jl.entry_id = $1 AND a.company_id = $2 AND a.type = 'asset' AND a.code ~ '^12' AND a.code <> '1240' AND jl.debit - jl.credit > 0
        ORDER BY jl.id`,
      [entryId, companyId, args.excludeAssetId ?? null]
    )
  ).rows.map((l: any): { id: string; accountId: string; cost: number; remaining: number; linked: boolean } => ({ id: l.id as string, accountId: l.account_id as string, cost: Number(l.cost), remaining: r2(Number(l.cost) - Number(l.used)), linked: l.linked === true }));
  if (lines.length === 0) throw linkInvalid("NO_FIXED_ASSET_LINE", "That document puts nothing on a fixed-asset account (12xx). Code its line to Fixed Assets at Cost (1290).");

  type Candidate = { id: string; accountId: string; cost: number; remaining: number; linked: boolean };
  let pool2: Candidate[] = lines;
  if (accountFilter) pool2 = pool2.filter((l) => l.accountId === accountFilter);
  if (amountHint !== null) {
    const exact = pool2.filter((l) => Math.abs(l.cost - amountHint!) <= 0.01);
    if (exact.length > 0) pool2 = exact;
  }
  // a line funds one asset: a line already linked to another asset is not offered and cannot be linked again
  const open = pool2.filter((l) => !l.linked);
  if (open.length === 0 && pool2.length > 0) {
    throw new AppError({ message: "That line is already linked to another asset. A bill or journal line records one asset: unlink the other asset first, or choose another line.", statusCode: 409, code: "LINE_ALREADY_LINKED" });
  }
  pool2 = open;
  const fits = pool2.filter((l) => l.remaining >= cost - 0.005);
  if (fits.length === 0) {
    const best = Math.max(0, ...pool2.map((l) => l.remaining));
    throw linkInvalid("COST_EXCEEDS_DOCUMENT", `The cost ${cost.toFixed(2)} is more than what is left on the document's fixed-asset lines (${best.toFixed(2)}).`, { remaining: best });
  }
  // the tightest fit, so a big line is not eaten by a small asset
  const pick = fits.sort((a, b) => a.remaining - b.remaining)[0];
  return {
    billId,
    journalEntryId: entryId as string,
    journalLineId: pick.id,
    document: { type: billId ? "bill" : "journal", number: billId ? billNumber : entryNumber },
  };
}

/** Linking later: an asset with a capitalization journal of its own is already in the books and cannot be linked (it would count twice). */
export async function linkAssetToSource(companyId: string, assetId: string, input: { billId?: string | null; billLineId?: string | null; journalEntryId?: string | null }) {
  const asset = (await pool.query(`SELECT id, purchase_cost::float8 AS cost, needs_capitalization_je, source_journal_line_id FROM fixed_assets WHERE id = $1 AND company_id = $2`, [assetId, companyId])).rows[0];
  if (!asset) throw new AppError({ message: "Fixed asset not found", statusCode: 404, code: "ASSET_NOT_FOUND" });
  if (asset.source_journal_line_id) throw new AppError({ message: "This asset is already linked to a document. Unlink it first.", statusCode: 409, code: "ASSET_ALREADY_LINKED" });
  if (asset.needs_capitalization_je !== true) throw linkInvalid("ALREADY_CAPITALIZED", "This asset already has its own capitalization entry in the books; linking it would count its cost twice.");
  const link = await resolveSourceLink({ companyId, cost: Number(asset.cost), excludeAssetId: assetId, ...input });
  const res = await pool.query(
    `UPDATE fixed_assets SET source_bill_id = $1, source_journal_entry_id = $2, source_journal_line_id = $3, needs_capitalization_je = false WHERE id = $4 AND company_id = $5 RETURNING *`,
    [link.billId, link.journalEntryId, link.journalLineId, assetId, companyId]
  );
  return { asset: res.rows[0], link };
}

export async function unlinkAsset(companyId: string, assetId: string) {
  const res = await pool.query(
    `UPDATE fixed_assets SET source_bill_id = NULL, source_journal_entry_id = NULL, source_journal_line_id = NULL, needs_capitalization_je = true
      WHERE id = $1 AND company_id = $2 AND source_journal_line_id IS NOT NULL RETURNING *`,
    [assetId, companyId]
  );
  if (res.rows.length === 0) throw new AppError({ message: "This asset is not linked to a document.", statusCode: 409, code: "ASSET_NOT_LINKED" });
  return res.rows[0];
}

/** Fixed-asset cost lines (12xx debits of posted entries) that no asset is linked to yet: what the link screens may offer. */
export async function linkableLines(companyId: string) {
  const res = await pool.query(
    `SELECT jl.id AS line_id, je.id AS entry_id, je.entry_number, to_char(je.date, 'YYYY-MM-DD') AS day, je.memo, a.code AS account_code, (jl.debit - jl.credit)::float8 AS cost,
            CASE WHEN je.source = 'bill' THEN je.source_id END AS bill_id, vb.bill_number
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
       LEFT JOIN vendor_bills vb ON je.source = 'bill' AND vb.id = je.source_id
      WHERE je.company_id = $1 AND je.status = 'posted' AND a.company_id = $1 AND a.type = 'asset' AND a.code ~ '^12' AND a.code <> '1240'
        AND jl.debit - jl.credit > 0 AND NOT EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.source_journal_line_id = jl.id)
      ORDER BY je.date DESC, je.entry_number DESC LIMIT 500`,
    [companyId]
  );
  return res.rows.map((r: any) => ({ lineId: r.line_id, journalEntryId: r.entry_id, entryNumber: r.entry_number, date: r.day, memo: r.memo, accountCode: r.account_code, cost: r2(Number(r.cost)), billId: r.bill_id ?? null, billNumber: r.bill_number ?? null }));
}
