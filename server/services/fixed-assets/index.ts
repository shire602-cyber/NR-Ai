/**
 * Fixed-asset register service (W4-B: R10-04, R10-05, R10-06, R10-08, R10-11, R10-12, R10-17).
 * Raw-SQL tables (migrations 0011 / 0031 / 0038 / 0101); every journal goes through server/ledger
 * with source 'fixed_asset' and an idempotency key, inside the same transaction as the register
 * update and its audit-trail event.
 *
 *   capitalise   Dr asset cost account          / Cr payment account (or 3040 opening balance)
 *   depreciate   Dr depreciation expense (+cc)  / Cr accumulated depreciation
 *   revalue      up:   Dr cost / Cr 3050 Revaluation Surplus (other comprehensive income)
 *                down: Dr 3050 (up to the asset's surplus) + Dr 5150 Impairment / Cr cost
 *   impair       Dr 3050 (up to the asset's surplus, IAS 36.60-61) + Dr 5150 Impairment Loss
 *                / Cr accumulated depreciation and impairment
 *
 * A3 (H4/H5): the asset's revaluation surplus is read from its own posted 3050 lines
 * (`assetSurplusFils`), so a decrease or an impairment is charged to the surplus first and the
 * realised surplus moved to retained earnings on disposal is exactly what is left. After a
 * revaluation or impairment, depreciation follows the revised carrying amount over the
 * remaining useful life (IAS 16.50, IAS 36.63).
 *   dispose      Dr proceeds (cash/bank) incl. VAT + Dr accumulated (+ Dr loss)
 *                / Cr cost (+ Cr 2020 output VAT) (+ Cr 4080 gain)
 *
 * B1 (NH3): an asset sold on credit is billed with a sales tax invoice (FDL 8/2017 Art. 65),
 * issued through the invoice service: Dr 1040 / Cr sales / Cr 2020. The receivable, its aging,
 * its receipt and the output VAT are then the invoice's, and the disposal entry moves the
 * invoiced proceeds out of revenue into the gain or loss (IAS 16.68, 16.71): Dr sales (the
 * invoice's net) + Dr accumulated (+ Dr loss) / Cr cost (+ Cr 4080 gain), with no VAT line.
 *
 * B1 (M3): a new asset's cost account follows its category when no class or account is given:
 * vehicles 1250, furniture 1220, computers / electronics 1230, equipment 1210, else 1290.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { DomainError } from "../../errors";
import { createLogger } from "../../config/logger";
import { fromFils, toFils } from "../../../shared/money";
import { isNonDepreciableCategory } from "../../../shared/validators/fixed-assets";
import {
  postJournal,
  reverseEntry,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../../ledger";
import { todayIso } from "../../ledger/normalize";
import { assertAccount, ensureAccountByCode, q } from "../inventory/store";
import { assertChosenAccountsNotControl } from "../../ledger/control-accounts";
import { defaultPaymentAccountId, isHeaderAccount } from "../payment-accounts.service";
import { normaliseEmirate } from "../../tax/vat-boxes";
import { createDraftInvoice } from "../connectors/draft-documents";
import { issueInvoice, voidInvoice } from "../invoice-posting.service";
import {
  depreciationFor,
  disposalSplit,
  monthsThrough,
  prorateToDay,
  scheduleTo,
  type AssetCalcInput,
  type DepreciationCalc,
} from "./calc";

export * from "./calc";
// C2 (RM3): registers the credit-note hooks on disposal invoices.
import "./disposal-credit";

const log = createLogger("fixed-assets");

export const FA_SOURCE = "fixed_asset";
export const FA_CODES = {
  COST: "1290",
  ACCUMULATED: "1240",
  EXPENSE: "5100",
  GAIN: "4080",
  LOSS: "5130",
  CASH: "1010",
  AR: "1040",
  VAT_OUTPUT: "2020",
  REVALUATION: "3050",
  IMPAIRMENT: "5150",
  OPENING: "3040",
  VAT_INPUT: "1050",
} as const;

const f = (v: unknown): number =>
  v === null || v === undefined || v === "" ? 0 : toFils(String(v), { rounding: "halfUp" });

/**
 * B1 (M3): default-chart cost account per asset category (IAS 16.37 classes). The accumulated
 * depreciation of every class stays on 1240, the chart's only accumulated-depreciation account.
 */
export const CATEGORY_COST_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/vehicle|\bcars?\b|\bvans?\b|truck|motor/i, "1250"],
  [/furniture|fixture|fitting/i, "1220"],
  [/computer|software|electronic|laptop|hardware|server|\bit\b/i, "1230"],
  [/equipment|machine|printer|tool/i, "1210"],
];

/** The cost account a new asset of `category` capitalises to, or null for 1290. */
export async function categoryCostAccountId(
  tx: LedgerTx,
  companyId: string,
  category: string | null | undefined
): Promise<string | null> {
  const code = CATEGORY_COST_CODES.find(([re]) => re.test(category ?? ""))?.[1];
  if (!code) return null;
  const rows = await q<{ id: string }>(
    tx,
    sql`SELECT id FROM accounts
         WHERE company_id = ${companyId} AND code = ${code} AND type = 'asset'
           AND is_active IS NOT FALSE AND is_archived IS NOT TRUE
         LIMIT 1`
  );
  const id = rows[0]?.id ?? null;
  if (!id || (await isHeaderAccount(companyId, id))) return null;
  return id;
}

export interface AssetRow {
  id: string;
  company_id: string;
  asset_name: string;
  asset_name_ar: string | null;
  asset_number: string | null;
  category: string;
  asset_class_id: string | null;
  purchase_iso: string;
  purchase_cost: string;
  salvage_value: string | null;
  useful_life_years: number | null;
  depreciation_method: string | null;
  accumulated_depreciation: string | null;
  net_book_value: string | null;
  status: string;
  is_depreciable: boolean;
  needs_capitalization_je: boolean;
  cost_account_id: string | null;
  accumulated_account_id: string | null;
  expense_account_id: string | null;
  cost_center_id: string | null;
  tax_useful_life_years: number | null;
  tax_depreciation_method: string | null;
  revaluation_surplus: string;
  impairment_loss: string;
  capitalization_entry_id: string | null;
  location: string | null;
  serial_number: string | null;
  disposal_iso: string | null;
  disposal_amount: string | null;
  carrying_rebased?: boolean;
}

/**
 * B2: events after which straight-line depreciation follows the re-based carrying amount over
 * the remaining life (see AssetCalcInput.rebased).
 */
const REBASED_SQL = `EXISTS (SELECT 1 FROM fixed_asset_events ev WHERE ev.asset_id = fixed_assets.id
      AND (ev.event_type IN ('revalued', 'impaired')
           OR (ev.event_type = 'recosted' AND COALESCE((ev.details->>'rebased')::boolean, false))))`;

const ASSET_COLUMNS = sql.raw(
  `*, to_char(purchase_date, 'YYYY-MM-DD') AS purchase_iso, to_char(disposal_date, 'YYYY-MM-DD') AS disposal_iso,
   ${REBASED_SQL} AS carrying_rebased`
);

export async function loadAsset(
  tx: LedgerTx,
  id: string,
  opts: { lock?: boolean; companyId?: string } = {}
): Promise<AssetRow> {
  const rows = await q<AssetRow>(
    tx,
    opts.lock
      ? sql`SELECT ${ASSET_COLUMNS} FROM fixed_assets WHERE id = ${id} FOR UPDATE`
      : sql`SELECT ${ASSET_COLUMNS} FROM fixed_assets WHERE id = ${id}`
  );
  const a = rows[0];
  if (!a || (opts.companyId && a.company_id !== opts.companyId)) {
    throw new DomainError("FIXED_ASSET_NOT_FOUND", 404, undefined, "Fixed asset not found");
  }
  return a;
}

export function calcInput(a: AssetRow): AssetCalcInput {
  return {
    costFils: f(a.purchase_cost),
    salvageFils: f(a.salvage_value),
    revaluationFils: f(a.revaluation_surplus),
    impairmentFils: f(a.impairment_loss),
    usefulLifeYears: a.useful_life_years,
    method: a.depreciation_method,
    purchaseDate: a.purchase_iso,
    accumulatedFils: f(a.accumulated_depreciation),
    isDepreciable: a.is_depreciable !== false && !isNonDepreciableCategory(a.category),
    rebased: a.carrying_rebased === true,
  };
}

/**
 * X6a: cash proceeds with no account chosen land on 1010 Cash, or, when 1010 has become a cash
 * header (it has sub-accounts, which the ledger refuses to post to), on the company's default
 * postable cash/bank leaf.
 */
async function defaultDisposalCashAccount(tx: LedgerTx, companyId: string): Promise<string> {
  const cashId = await ensureAccountByCode(tx, companyId, FA_CODES.CASH);
  if (!(await isHeaderAccount(companyId, cashId))) return cashId;
  return (await defaultPaymentAccountId(companyId, { method: "cash" })) ?? cashId;
}

export async function assetAccounts(tx: LedgerTx, a: AssetRow) {
  return {
    cost: a.cost_account_id ?? (await ensureAccountByCode(tx, a.company_id, FA_CODES.COST)),
    accumulated:
      a.accumulated_account_id ??
      (await ensureAccountByCode(tx, a.company_id, FA_CODES.ACCUMULATED)),
    expense:
      a.expense_account_id ?? (await ensureAccountByCode(tx, a.company_id, FA_CODES.EXPENSE)),
  };
}

/**
 * Revaluation surplus (fils, credit balance) still held in equity for this asset: the asset's
 * own posted lines on the revaluation-surplus account (revaluations, decreases and impairments
 * charged to it, the realisation on disposal).
 */
export async function assetSurplusFils(
  tx: LedgerTx,
  a: Pick<AssetRow, "id" | "company_id">
): Promise<number> {
  const rows = await q<{ f: string }>(
    tx,
    sql`SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::text AS f
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN accounts ac ON ac.id = jl.account_id
         WHERE je.company_id = ${a.company_id} AND je.status = 'posted'
           AND je.source = ${FA_SOURCE} AND je.source_id = ${a.id}
           AND ac.code = ${FA_CODES.REVALUATION}`
  );
  return Number(rows[0]?.f ?? 0);
}

export async function recordEvent(
  tx: LedgerTx,
  a: Pick<AssetRow, "id" | "company_id">,
  e: {
    type: string;
    date?: string | null;
    amountFils?: number | null;
    journalEntryId?: string | null;
    details?: Record<string, unknown> | null;
    actorId?: string | null;
  }
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, amount, journal_entry_id, details, actor_id, created_at)
        VALUES (${a.company_id}, ${a.id}, ${e.type}, ${e.date ?? null},
                ${e.amountFils === null || e.amountFils === undefined ? null : fromFils(e.amountFils)},
                ${e.journalEntryId ?? null}, ${e.details ? JSON.stringify(e.details) : null}::jsonb, ${e.actorId ?? null}, clock_timestamp())`
  );
}

/**
 * The capitalisation guard (R10-05): an asset is on the GL once its capitalisation entry exists
 * (new path) or, for legacy rows, once any posted entry is linked to it. Used by the single-asset
 * path, the bulk run and disposal catch-up alike.
 */
export async function isCapitalised(tx: LedgerTx, a: AssetRow): Promise<boolean> {
  if (a.capitalization_entry_id) return true;
  if (a.needs_capitalization_je) return false;
  const rows = await q(
    tx,
    sql`SELECT 1 FROM journal_entries
         WHERE company_id = ${a.company_id} AND source IN ('system', ${FA_SOURCE}) AND source_id = ${a.id}
           AND status = 'posted' LIMIT 1`
  );
  return rows.length > 0;
}

async function post(
  tx: LedgerTx,
  a: AssetRow,
  args: {
    date: string;
    memo: string;
    key: string;
    lines: PostJournalLineInput[];
    actorId: string;
    reportsVat?: boolean;
  }
): Promise<string> {
  const { entry } = await postJournal(
    {
      companyId: a.company_id,
      date: args.date,
      memo: args.memo.slice(0, 500),
      status: "posted",
      source: FA_SOURCE,
      sourceId: a.id,
      idempotencyKey: args.key,
      allowFutureDate: true,
      reportsVat: args.reportsVat === true,
      lines: args.lines.filter((l) => (l.debitFils ?? 0) > 0 || (l.creditFils ?? 0) > 0),
    },
    { actorId: args.actorId, tx }
  );
  return entry.id;
}

// ─── Capitalisation ─────────────────────────────────────────────────────────

export async function capitalizeAsset(
  tx: LedgerTx,
  a: AssetRow,
  args: {
    paymentAccountId?: string | null;
    openingBalance?: boolean;
    /** Go-live registers: depreciation already charged before the books started. */
    openingAccumulatedFils?: number;
    date?: string | null;
    actorId: string;
  }
): Promise<string> {
  if (await isCapitalised(tx, a)) {
    throw new DomainError(
      "ASSET_ALREADY_CAPITALIZED",
      409,
      undefined,
      "This asset is already on the general ledger"
    );
  }
  const costFils = f(a.purchase_cost);
  if (costFils <= 0)
    throw new DomainError("ASSET_ZERO_COST", 422, undefined, "Asset cost must be above zero");
  const credit = args.openingBalance
    ? await ensureAccountByCode(tx, a.company_id, FA_CODES.OPENING)
    : (
        await assertAccount(tx, a.company_id, args.paymentAccountId!, [
          "asset",
          "liability",
          "equity",
        ])
      ).id;
  // C1 (RM1): the payment account is the user's choice; a control account (Cr 2010 / 1040 / 2020)
  // would book a payable, receivable or output VAT with no bill, invoice or return behind it.
  if (!args.openingBalance) {
    await assertChosenAccountsNotControl(
      a.company_id,
      [{ field: "paymentAccountId", accountId: credit }],
      { tx }
    );
  }
  const acc = await assetAccounts(tx, a);
  const date = args.date ?? a.purchase_iso;
  const opening = args.openingBalance ? Math.max(0, args.openingAccumulatedFils ?? 0) : 0;
  if (opening > costFils - f(a.salvage_value)) {
    throw new DomainError(
      "OPENING_ACCUMULATED_TOO_HIGH",
      422,
      undefined,
      "Accumulated depreciation exceeds the depreciable cost"
    );
  }
  // X4 (J3): recoverable input VAT on a purchased asset (Dr 1050); VAT 201 reads it from
  // fixed_assets.acquisition_vat (server/tax/vat-engine.ts, collectFixedAssetAcquisitions).
  const vatFils = args.openingBalance
    ? 0
    : f((a as { acquisition_vat?: unknown }).acquisition_vat ?? 0);
  const vatAccount =
    vatFils > 0 ? await ensureAccountByCode(tx, a.company_id, FA_CODES.VAT_INPUT) : null;
  const entryId = await post(tx, a, {
    date,
    memo: `Capitalization: ${a.asset_name}`,
    key: `${FA_SOURCE}:${a.id}:capitalize`,
    lines: [
      { accountId: acc.cost, debitFils: costFils, description: `Capitalize ${a.asset_name}` },
      ...(vatAccount
        ? [
            {
              accountId: vatAccount,
              debitFils: vatFils,
              systemVat: true,
              description: `Input VAT - ${a.asset_name}`,
            },
          ]
        : []),
      ...(opening > 0
        ? [
            {
              accountId: acc.accumulated,
              creditFils: opening,
              description: `Opening accumulated depreciation - ${a.asset_name}`,
            },
          ]
        : []),
      {
        accountId: credit,
        creditFils: costFils - opening + vatFils,
        description: args.openingBalance
          ? `Opening balance - ${a.asset_name}`
          : `Payment for ${a.asset_name}`,
      },
    ],
    actorId: args.actorId,
  });
  await tx.execute(
    sql`UPDATE fixed_assets SET needs_capitalization_je = false, capitalization_entry_id = ${entryId},
               accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + ${fromFils(opening)},
               net_book_value = purchase_cost - COALESCE(accumulated_depreciation, 0) - ${fromFils(opening)}
         WHERE id = ${a.id}`
  );
  a.accumulated_depreciation = fromFils(f(a.accumulated_depreciation) + opening);
  a.capitalization_entry_id = entryId;
  a.needs_capitalization_je = false;
  await recordEvent(tx, a, {
    type: "capitalized",
    date,
    amountFils: costFils,
    journalEntryId: entryId,
    details: { openingBalance: args.openingBalance === true },
    actorId: args.actorId,
  });
  return entryId;
}

// ─── Assets bought on a bill (A2: H9) ───────────────────────────────────────

/** A bill line debited to a fixed-asset cost account (base fils, incl. blocked VAT). */
export interface BillAssetLine {
  billLineId: string | null;
  accountId: string;
  description: string;
  costFils: number;
}

/**
 * Fixed-asset cost accounts of a company: sub_type fixed_asset, excluding accumulated
 * depreciation (1240, any class's accumulated account, contra names).
 */
export async function fixedAssetCostAccountIds(
  tx: LedgerTx,
  companyId: string
): Promise<Set<string>> {
  const rows = await q<{ id: string }>(
    tx,
    sql`SELECT a.id FROM accounts a
         WHERE a.company_id = ${companyId} AND a.type = 'asset' AND a.sub_type = 'fixed_asset'
           AND a.code <> ${FA_CODES.ACCUMULATED}
           AND COALESCE(a.name_en, '') NOT ILIKE '%accumulated%'
           AND NOT EXISTS (SELECT 1 FROM fixed_asset_classes c
                            WHERE c.company_id = a.company_id AND c.accumulated_account_id = a.id)`
  );
  return new Set(rows.map((r) => r.id));
}

async function assetHasOwnJournals(tx: LedgerTx, a: { id: string; company_id: string }) {
  const rows = await q(
    tx,
    sql`SELECT 1 FROM journal_entries WHERE company_id = ${a.company_id} AND source = ${FA_SOURCE}
          AND source_id = ${a.id} AND status = 'posted' LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * A2 (H9, IAS 16.7 / 16.43 / 16.73): a bill line coded to a fixed-asset account is capitalised by
 * the bill's own journal, so it must also be on the register or it is never depreciated. Each such
 * line opens a DRAFT register entry (cost = the line's base debit, capitalisation entry = the
 * bill's journal, no useful life yet); the user completes it (useful life) on the asset, which
 * makes it active for depreciation. Called after every bill posting: a revision re-links the
 * existing entries (same line description), re-costs them and removes entries whose line went
 * away. `entryId` null (a void) releases all of the bill's entries. An entry that already has
 * its own journals (depreciation, revaluation, disposal) is never removed or re-costed silently:
 * 409 BILL_ASSET_IN_USE.
 */
export async function syncBillAssets(
  tx: LedgerTx,
  args: {
    companyId: string;
    billId: string;
    billNumber: string | null;
    date: string;
    entryId: string | null;
    lines: BillAssetLine[];
    actorId: string;
  }
): Promise<string[]> {
  const existing = await q<AssetRow>(
    tx,
    sql`SELECT ${ASSET_COLUMNS} FROM fixed_assets
         WHERE company_id = ${args.companyId} AND source_bill_id = ${args.billId}
         ORDER BY created_at, id FOR UPDATE`
  );
  const ref = args.billNumber || args.billId.slice(0, 8);
  const claimed = new Set<string>();
  const out: string[] = [];
  for (const l of args.entryId ? args.lines : []) {
    if (l.costFils <= 0) continue;
    const name = l.description.slice(0, 255);
    const prev = existing.find((a) => !claimed.has(a.id) && a.asset_name === name);
    if (prev) {
      claimed.add(prev.id);
      // B2 (NM2): debit notes already posted against the bill keep reducing the asset's cost.
      const cost = l.costFils + (await recostedFils(tx, prev.id));
      if (f(prev.purchase_cost) !== cost && (await assetHasOwnJournals(tx, prev))) {
        throw new DomainError(
          "BILL_ASSET_IN_USE",
          409,
          { assetId: prev.id },
          "This bill's asset has been depreciated or revalued; its cost cannot change with the bill"
        );
      }
      await tx.execute(
        sql`UPDATE fixed_assets SET capitalization_entry_id = ${args.entryId},
                   source_bill_line_id = ${l.billLineId}, cost_account_id = ${l.accountId},
                   purchase_cost = ${fromFils(cost)},
                   net_book_value = ${fromFils(cost)}::numeric + revaluation_surplus
                     - COALESCE(accumulated_depreciation, 0) - impairment_loss
             WHERE id = ${prev.id}`
      );
      out.push(prev.id);
      continue;
    }
    const account = (
      await q<{ name_en: string | null; code: string }>(
        tx,
        sql`SELECT name_en, code FROM accounts WHERE id = ${l.accountId}`
      )
    )[0];
    const cost = fromFils(l.costFils);
    const [row] = await q<{ id: string }>(
      tx,
      sql`INSERT INTO fixed_assets (company_id, asset_name, category, purchase_date, purchase_cost,
            salvage_value, useful_life_years, depreciation_method, accumulated_depreciation,
            net_book_value, status, is_depreciable, needs_capitalization_je, cost_account_id,
            capitalization_entry_id, acquisition_vat, source_bill_id, source_bill_line_id, notes)
          VALUES (${args.companyId}, ${name}, ${account?.name_en || account?.code || "Fixed asset"},
            ${args.date}, ${cost}, 0, NULL, 'straight_line', 0, ${cost}, 'draft', true, false,
            ${l.accountId}, ${args.entryId}, 0, ${args.billId}, ${l.billLineId},
            ${`From bill ${ref}`})
          RETURNING id`
    );
    await recordEvent(
      tx,
      { id: row.id, company_id: args.companyId },
      {
        type: "created_from_bill",
        date: args.date,
        amountFils: l.costFils,
        journalEntryId: args.entryId,
        details: { billId: args.billId, billLineId: l.billLineId },
        actorId: args.actorId,
      }
    );
    out.push(row.id);
  }
  for (const a of existing) {
    if (claimed.has(a.id)) continue;
    if (a.status === "disposed" || (await assetHasOwnJournals(tx, a))) {
      throw new DomainError(
        "BILL_ASSET_IN_USE",
        409,
        { assetId: a.id },
        "This bill's asset has been depreciated, revalued or disposed of; reverse those first"
      );
    }
    await tx.execute(sql`DELETE FROM fixed_assets WHERE id = ${a.id}`);
  }
  return out;
}

/** Cost reductions (fils, ≤ 0) recorded on an asset by supplier debit notes. */
async function recostedFils(tx: LedgerTx, assetId: string): Promise<number> {
  const rows = await q<{ f: string }>(
    tx,
    sql`SELECT COALESCE(SUM(ROUND(amount * 100)), 0)::bigint::text AS f FROM fixed_asset_events
         WHERE asset_id = ${assetId} AND event_type = 'recosted'`
  );
  return Number(rows[0]?.f ?? 0);
}

/**
 * B2 (NM2, IAS 16.16(a) / 16.23): a supplier debit note that credits a fixed-asset cost account
 * of a bill reduces the cost of the asset that bill capitalised, so the register keeps tying to
 * the GL. The credit goes to the bill's asset on that account with the line's name, else the
 * only one, else is spread over them by cost. Once depreciation has been posted, the reduced
 * carrying amount is depreciated over the remaining useful life (a change in estimate applied
 * prospectively, IAS 8.36-38). A disposed asset, or a credit above the carrying amount, is
 * refused (409).
 */
export async function recostBillAssetsForDebitNote(
  tx: LedgerTx,
  args: {
    companyId: string;
    billId: string | null;
    date: string;
    entryId: string;
    noteId: string;
    noteNumber: string;
    credits: Array<{ accountId: string; creditFils: number; description: string }>;
    actorId: string;
  }
): Promise<string[]> {
  if (!args.billId) return [];
  const costIds = await fixedAssetCostAccountIds(tx, args.companyId);
  const credits = args.credits.filter((c) => c.creditFils > 0 && costIds.has(c.accountId));
  if (!credits.length) return [];
  const assets = await q<AssetRow>(
    tx,
    sql`SELECT ${ASSET_COLUMNS} FROM fixed_assets
         WHERE company_id = ${args.companyId} AND source_bill_id = ${args.billId}
         ORDER BY created_at, id FOR UPDATE`
  );
  const touched = new Map<string, number>();
  for (const c of credits) {
    const onAccount = assets.filter((a) => a.cost_account_id === c.accountId);
    if (!onAccount.length) continue;
    const named = onAccount.find((a) => a.asset_name === c.description.slice(0, 255));
    const targets = named ? [named] : onAccount;
    const totalCost = targets.reduce((s, a) => s + f(a.purchase_cost), 0);
    let rest = c.creditFils;
    targets.forEach((a, i) => {
      const part =
        i === targets.length - 1
          ? rest
          : totalCost > 0
            ? Math.round((c.creditFils * f(a.purchase_cost)) / totalCost)
            : 0;
      rest -= part;
      touched.set(a.id, (touched.get(a.id) ?? 0) + part);
    });
  }
  const out: string[] = [];
  for (const a of assets) {
    const reduce = touched.get(a.id) ?? 0;
    if (reduce <= 0) continue;
    const calc = calcInput(a);
    const carrying = calc.costFils + (calc.revaluationFils ?? 0) - calc.accumulatedFils;
    if (a.status === "disposed" || reduce > carrying - (calc.impairmentFils ?? 0)) {
      throw new DomainError(
        "DEBIT_NOTE_EXCEEDS_ASSET",
        409,
        { assetId: a.id, carrying: fromFils(carrying - (calc.impairmentFils ?? 0)) },
        "The debit note credits more than the carrying amount of the bill's asset"
      );
    }
    const rebased = calc.accumulatedFils > 0;
    await tx.execute(
      sql`UPDATE fixed_assets SET purchase_cost = purchase_cost - ${fromFils(reduce)}::numeric,
                 net_book_value = COALESCE(net_book_value, purchase_cost) - ${fromFils(reduce)}::numeric
           WHERE id = ${a.id}`
    );
    await recordEvent(tx, a, {
      type: "recosted",
      date: args.date,
      amountFils: -reduce,
      journalEntryId: args.entryId,
      details: { debitNoteId: args.noteId, debitNoteNumber: args.noteNumber, rebased },
      actorId: args.actorId,
    });
    out.push(a.id);
  }
  return out;
}

// ─── Depreciation ───────────────────────────────────────────────────────────

export interface DepreciationOutcome {
  assetId: string;
  assetName: string;
  period: { month: number; year: number };
  skipped: boolean;
  reason?: string;
  code?: string;
  calc?: DepreciationCalc;
  journalEntryId?: string;
  scheduleId?: string;
}

const SKIP_TEXT: Record<string, string> = {
  NON_DEPRECIABLE: "Land and other non-depreciable assets are not depreciated",
  NO_USEFUL_LIFE: "Asset has no useful life",
  PREDATES_ACQUISITION: "Period predates acquisition",
  FULLY_DEPRECIATED: "Fully depreciated",
  ASSET_NOT_CAPITALIZED: "Asset is not on the general ledger (capitalise it first)",
  ALREADY_DEPRECIATED: "Already depreciated for this period",
  NOT_ACTIVE: "Asset is not active",
  ASSET_DRAFT: "Asset bought on a bill: set its useful life to start depreciation",
  PERIOD_NOT_ENDED: "The month has not ended yet: depreciation is recorded after the month ends",
};

/** The month-end posting date of a depreciation period (YYYY-MM-DD). */
export function depreciationPeriodEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * E2 (J3-r2): depreciation is dated at month end and never in the future, so a month can be
 * depreciated only once it has ended (UAE date). Refused 422 DEPRECIATION_PERIOD_NOT_ENDED.
 */
export function assertDepreciationPeriodEnded(year: number, month: number, today = todayIso()) {
  const end = depreciationPeriodEnd(year, month);
  if (end > today) {
    throw new DomainError(
      "DEPRECIATION_PERIOD_NOT_ENDED",
      422,
      { periodEnd: end, today },
      `Depreciation for ${month}/${year} is dated ${end}, after today. Record it once the month has ended.`
    );
  }
}

/** The last month that has fully ended (the default depreciation period). */
export function lastEndedMonth(today = todayIso()): { year: number; month: number } {
  const [y, m] = today.split("-").map(Number);
  const end = depreciationPeriodEnd(y, m);
  if (end <= today) return { year: y, month: m };
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

/** Depreciate one asset for one month inside `tx` (asset row should be locked by the caller). */
export async function depreciateInTx(
  tx: LedgerTx,
  a: AssetRow,
  year: number,
  month: number,
  actorId: string,
  opts: { catchUp?: boolean; throughDate?: string; keySuffix?: string } = {}
): Promise<DepreciationOutcome> {
  const out = (code: string, extra: Partial<DepreciationOutcome> = {}): DepreciationOutcome => ({
    assetId: a.id,
    assetName: a.asset_name,
    period: { month, year },
    skipped: true,
    code,
    reason: SKIP_TEXT[code] ?? code,
    ...extra,
  });
  if (a.status === "draft") return out("ASSET_DRAFT");
  if (a.status !== "active") return out("NOT_ACTIVE");
  if (!(await isCapitalised(tx, a))) return out("ASSET_NOT_CAPITALIZED");
  const already = await q<{ id: string }>(
    tx,
    sql`SELECT id FROM depreciation_schedules WHERE asset_id = ${a.id} AND period_year = ${year} AND period_month = ${month}`
  );
  if (already[0]) return out("ALREADY_DEPRECIATED", { scheduleId: already[0].id });
  // E2 (J3-r2): never a future-dated depreciation entry. C2 (RL5): a disposal-month charge
  // is dated at the disposal date, so only that date has to have passed.
  if ((opts.throughDate ?? depreciationPeriodEnd(year, month)) > todayIso())
    return out("PERIOD_NOT_ENDED");
  const full = depreciationFor(calcInput(a), year, month);
  // C2 (RL5): the disposal month is charged up to the disposal date.
  const calc = opts.throughDate
    ? prorateToDay(full, a.purchase_iso, year, month, Number(opts.throughDate.slice(8, 10)))
    : full;
  if (calc.skipped || calc.amountFils <= 0)
    return out(calc.skipReason ?? "FULLY_DEPRECIATED", { calc });
  const claim = await q<{ id: string }>(
    tx,
    sql`INSERT INTO depreciation_schedules (company_id, asset_id, period_year, period_month, amount, posted_by)
        VALUES (${a.company_id}, ${a.id}, ${year}, ${month}, ${fromFils(calc.amountFils)}, ${actorId})
        ON CONFLICT (asset_id, period_year, period_month) DO NOTHING RETURNING id`
  );
  if (!claim[0])
    throw new DomainError(
      "DEPRECIATION_RACE",
      409,
      { year, month },
      "Depreciation already posted for this period"
    );
  const acc = await assetAccounts(tx, a);
  // X4 (J3): date the entry at month end, so it never predates an in-month capitalisation.
  const date = opts.throughDate ?? depreciationPeriodEnd(year, month);
  const suffix = opts.throughDate
    ? ` (${month}/${year}, to disposal on ${opts.throughDate})`
    : calc.prorationFactor < 1
      ? ` (${month}/${year}, prorated ${(calc.prorationFactor * 100).toFixed(1)}%${opts.catchUp ? ", catch-up" : ""})`
      : ` (${month}/${year}${opts.catchUp ? ", catch-up" : ""})`;
  const entryId = await post(tx, a, {
    date,
    memo: `Depreciation: ${a.asset_name}${suffix}`,
    // D2 (N6): a month re-charged after its depreciation was reversed gets a new key.
    key: `${FA_SOURCE}:${a.id}:dep:${year}-${month}${opts.keySuffix ?? ""}`,
    lines: [
      {
        accountId: acc.expense,
        debitFils: calc.amountFils,
        costCenterId: a.cost_center_id ?? null,
        description: `Depreciation - ${a.asset_name}`,
      },
      {
        accountId: acc.accumulated,
        creditFils: calc.amountFils,
        description: `Accumulated depreciation - ${a.asset_name}`,
      },
    ],
    actorId,
  });
  await tx.execute(
    sql`UPDATE depreciation_schedules SET journal_entry_id = ${entryId} WHERE id = ${claim[0].id}`
  );
  await tx.execute(
    sql`UPDATE fixed_assets SET accumulated_depreciation = ${fromFils(calc.newAccumulatedFils)},
               net_book_value = ${fromFils(calc.newNetBookValueFils)} WHERE id = ${a.id}`
  );
  a.accumulated_depreciation = fromFils(calc.newAccumulatedFils);
  a.net_book_value = fromFils(calc.newNetBookValueFils);
  await recordEvent(tx, a, {
    type: "depreciated",
    date,
    amountFils: calc.amountFils,
    journalEntryId: entryId,
    details: { year, month, catchUp: opts.catchUp === true },
    actorId,
  });
  return {
    assetId: a.id,
    assetName: a.asset_name,
    period: { month, year },
    skipped: false,
    calc,
    journalEntryId: entryId,
    scheduleId: claim[0].id,
  };
}

/** Bulk run for one month (all-or-nothing). Same guard as the single path (R10-05). */
export async function runDepreciation(
  companyId: string,
  year: number,
  month: number,
  actorId: string
) {
  return withLedgerTx(async (tx) => {
    const ids = await q<{ id: string }>(
      tx,
      sql`SELECT id FROM fixed_assets WHERE company_id = ${companyId} AND status IN ('active', 'draft') ORDER BY created_at, id`
    );
    const results: DepreciationOutcome[] = [];
    for (const { id } of ids) {
      const a = await loadAsset(tx, id, { lock: true });
      results.push(await depreciateInTx(tx, a, year, month, actorId));
    }
    return results;
  });
}

// ─── Revaluation / impairment ───────────────────────────────────────────────

export async function revalueAsset(
  tx: LedgerTx,
  a: AssetRow,
  args: { date: string; fairValueFils: number; notes?: string | null; actorId: string }
) {
  if (a.status !== "active") throw new DomainError("ASSET_NOT_ACTIVE", 409);
  if (!(await isCapitalised(tx, a))) throw new DomainError("ASSET_NOT_CAPITALIZED", 422);
  const c = calcInput(a);
  const carrying =
    c.costFils + (c.revaluationFils ?? 0) - c.accumulatedFils - (c.impairmentFils ?? 0);
  const delta = args.fairValueFils - carrying;
  if (delta === 0)
    throw new DomainError(
      "REVALUATION_NO_CHANGE",
      422,
      undefined,
      "Fair value equals the carrying amount"
    );
  const acc = await assetAccounts(tx, a);
  const surplusAcct = await ensureAccountByCode(tx, a.company_id, FA_CODES.REVALUATION);
  const lines: PostJournalLineInput[] = [];
  // `surplus` tracks the gross revaluation adjustment on the cost account (register column
  // revaluation_surplus); `equitySurplus` is what the asset still holds in 3050 (A3, H4).
  // IAS 16.35(b) (A4 L7): accumulated depreciation and impairment are eliminated against the
  // gross carrying amount, so after the revaluation the gross amount is the fair value and the
  // accumulated balance restarts at zero. One net line on the cost account carries both steps.
  const eliminated = c.accumulatedFils + (c.impairmentFils ?? 0);
  let surplus = (c.revaluationFils ?? 0) - eliminated;
  const equitySurplus = await assetSurplusFils(tx, a);
  if (eliminated > 0) {
    lines.push({
      accountId: acc.accumulated,
      debitFils: eliminated,
      description: `Eliminate accumulated depreciation on revaluation - ${a.asset_name}`,
    });
  }
  let costNet = -eliminated;
  if (delta > 0) {
    costNet += delta;
    lines.push({
      accountId: surplusAcct,
      creditFils: delta,
      description: `Revaluation surplus - ${a.asset_name}`,
    });
    surplus += delta;
  } else {
    const down = -delta;
    const fromSurplus = Math.min(down, Math.max(0, equitySurplus));
    const toExpense = down - fromSurplus;
    if (fromSurplus > 0)
      lines.push({
        accountId: surplusAcct,
        debitFils: fromSurplus,
        description: `Reverse surplus - ${a.asset_name}`,
      });
    if (toExpense > 0) {
      const imp = await ensureAccountByCode(tx, a.company_id, FA_CODES.IMPAIRMENT);
      lines.push({
        accountId: imp,
        debitFils: toExpense,
        costCenterId: a.cost_center_id,
        description: `Revaluation loss - ${a.asset_name}`,
      });
    }
    costNet -= down;
    surplus -= down;
  }
  if (costNet !== 0) {
    lines.push({
      accountId: acc.cost,
      ...(costNet > 0 ? { debitFils: costNet } : { creditFils: -costNet }),
      description: `Revaluation - ${a.asset_name}`,
    });
  }
  const n = await q<{ n: number }>(
    tx,
    sql`SELECT COUNT(*)::int AS n FROM fixed_asset_events WHERE asset_id = ${a.id}`
  );
  const entryId = await post(tx, a, {
    date: args.date,
    memo: `Revaluation: ${a.asset_name}`,
    key: `${FA_SOURCE}:${a.id}:revalue:${n[0].n}`,
    lines,
    actorId: args.actorId,
  });
  await tx.execute(
    sql`UPDATE fixed_assets SET revaluation_surplus = ${fromFils(surplus)},
               accumulated_depreciation = 0, impairment_loss = 0,
               net_book_value = ${fromFils(args.fairValueFils)} WHERE id = ${a.id}`
  );
  await recordEvent(tx, a, {
    type: "revalued",
    date: args.date,
    amountFils: delta,
    journalEntryId: entryId,
    details: { fairValue: fromFils(args.fairValueFils), notes: args.notes ?? null },
    actorId: args.actorId,
  });
  return { journalEntryId: entryId, deltaFils: delta };
}

export async function impairAsset(
  tx: LedgerTx,
  a: AssetRow,
  args: { date: string; amountFils: number; notes?: string | null; actorId: string }
) {
  if (a.status !== "active") throw new DomainError("ASSET_NOT_ACTIVE", 409);
  if (!(await isCapitalised(tx, a))) throw new DomainError("ASSET_NOT_CAPITALIZED", 422);
  const c = calcInput(a);
  const carrying =
    c.costFils + (c.revaluationFils ?? 0) - c.accumulatedFils - (c.impairmentFils ?? 0);
  if (args.amountFils > carrying) {
    throw new DomainError("IMPAIRMENT_EXCEEDS_CARRYING", 422, { carrying: fromFils(carrying) });
  }
  const acc = await assetAccounts(tx, a);
  // A3 (H4): an impairment loss on a revalued asset is a revaluation decrease, charged to the
  // asset's surplus (through OCI) first; only the excess is recognised in profit or loss
  // (IAS 36.60-61).
  const fromSurplus = Math.min(args.amountFils, Math.max(0, await assetSurplusFils(tx, a)));
  const toProfitOrLoss = args.amountFils - fromSurplus;
  const lines: PostJournalLineInput[] = [];
  if (fromSurplus > 0) {
    lines.push({
      accountId: await ensureAccountByCode(tx, a.company_id, FA_CODES.REVALUATION),
      debitFils: fromSurplus,
      description: `Impairment charged to revaluation surplus - ${a.asset_name}`,
    });
  }
  if (toProfitOrLoss > 0) {
    lines.push({
      accountId: await ensureAccountByCode(tx, a.company_id, FA_CODES.IMPAIRMENT),
      debitFils: toProfitOrLoss,
      costCenterId: a.cost_center_id,
      description: `Impairment - ${a.asset_name}`,
    });
  }
  lines.push({
    accountId: acc.accumulated,
    creditFils: args.amountFils,
    description: `Accumulated impairment - ${a.asset_name}`,
  });
  const n = await q<{ n: number }>(
    tx,
    sql`SELECT COUNT(*)::int AS n FROM fixed_asset_events WHERE asset_id = ${a.id}`
  );
  const entryId = await post(tx, a, {
    date: args.date,
    memo: `Impairment: ${a.asset_name}`,
    key: `${FA_SOURCE}:${a.id}:impair:${n[0].n}`,
    lines,
    actorId: args.actorId,
  });
  const newImp = (c.impairmentFils ?? 0) + args.amountFils;
  await tx.execute(
    sql`UPDATE fixed_assets SET impairment_loss = ${fromFils(newImp)},
               net_book_value = ${fromFils(carrying - args.amountFils)} WHERE id = ${a.id}`
  );
  await recordEvent(tx, a, {
    type: "impaired",
    date: args.date,
    amountFils: args.amountFils,
    journalEntryId: entryId,
    details: {
      notes: args.notes ?? null,
      chargedToRevaluationSurplus: fromFils(fromSurplus),
      chargedToProfitOrLoss: fromFils(toProfitOrLoss),
    },
    actorId: args.actorId,
  });
  return {
    journalEntryId: entryId,
    chargedToRevaluationSurplus: Number(fromFils(fromSurplus)),
    chargedToProfitOrLoss: Number(fromFils(toProfitOrLoss)),
  };
}

// ─── Disposal (R10-08) ──────────────────────────────────────────────────────

export interface DisposeInput {
  disposalDate: string;
  proceedsFils: number;
  proceedsAccountId?: string | null;
  onCredit?: boolean;
  buyerName?: string | null;
  /** Sold on credit: the customer contact billed (optional; buyerName alone also works). */
  buyerContactId?: string | null;
  vatTreatment?: "standard" | "zero_rated" | "exempt" | "out_of_scope";
  notes?: string | null;
  actorId: string;
}

/**
 * A1 (M9): a standard-rated disposal is a supply from the company's establishment, reported in
 * the VAT 201 Box 1 row of the company's emirate. Without one the output VAT would post to 2020
 * and then be left out of the return, so refuse up front (as invoices refuse a missing place of
 * supply) with a message that says where to set it.
 */
async function assertCompanyEmirateForDisposal(tx: LedgerTx, companyId: string): Promise<void> {
  const rows = await q<{ emirate: string | null }>(
    tx,
    sql`SELECT emirate FROM companies WHERE id = ${companyId}`
  );
  if (!normaliseEmirate(rows[0]?.emirate ?? null)) {
    throw new DomainError(
      "COMPANY_EMIRATE_REQUIRED",
      422,
      { field: "emirate" },
      "Set the company's emirate in company settings before recording a standard-rated disposal: the VAT return reports it in that emirate's Box 1 row."
    );
  }
}

const SUPPLY_TYPE_OF: Record<string, "standard_rated" | "zero_rated" | "exempt" | "out_of_scope"> =
  {
    standard: "standard_rated",
    zero_rated: "zero_rated",
    exempt: "exempt",
    out_of_scope: "out_of_scope",
  };

/** The checks a disposal makes before anything is written (shared by the credit path). */
async function assertDisposable(tx: LedgerTx, a: AssetRow, input: DisposeInput): Promise<void> {
  if (a.status === "disposed")
    throw new DomainError("ASSET_ALREADY_DISPOSED", 409, undefined, "Asset is already disposed");
  // D2 (N10): derecognition is recorded when it happens (IAS 16.67), never ahead of time. A future
  // date would post the proceeds and the VAT before the supply and skip the disposal month's
  // depreciation (it can only be charged once its date has passed), so it is refused, like a
  // future depreciation month (E2, J3-r2).
  const today = todayIso();
  if (input.disposalDate > today) {
    throw new DomainError(
      "DISPOSAL_DATE_IN_FUTURE",
      422,
      { today, fields: { disposalDate: [`On or before ${today}`] } },
      `The disposal date ${input.disposalDate} is after today (${today}). Record the disposal on or after the day the asset leaves the business.`
    );
  }
  if (input.disposalDate < a.purchase_iso) {
    throw new DomainError(
      "DISPOSAL_BEFORE_PURCHASE",
      400,
      undefined,
      "disposalDate cannot precede purchaseDate"
    );
  }
  if (!(await isCapitalised(tx, a))) {
    throw new DomainError(
      "ASSET_NOT_CAPITALIZED",
      422,
      undefined,
      "This asset is not on the general ledger; capitalise it before recording a disposal"
    );
  }
  // D2 (N6): depreciation already booked after the disposal date is reversed by the disposal
  // (reverseDepreciationAfter). A revaluation or impairment after that date changed the basis of
  // those charges, so it has to be undone first.
  const remeasured = await q<{ event_type: string; event_date: string }>(
    tx,
    sql`SELECT event_type, event_date::text AS event_date FROM fixed_asset_events
         WHERE asset_id = ${a.id} AND event_type IN ('revalued', 'impaired')
           AND event_date > ${input.disposalDate}::date
         ORDER BY event_date DESC LIMIT 1`
  );
  if (remeasured[0]) {
    throw new DomainError(
      "DISPOSAL_BEFORE_REMEASUREMENT",
      409,
      {
        eventType: remeasured[0].event_type,
        eventDate: remeasured[0].event_date,
        fields: { disposalDate: [`On or after ${remeasured[0].event_date}`] },
      },
      `The asset was ${remeasured[0].event_type} on ${remeasured[0].event_date}, after this disposal date. Undo that first, or dispose of the asset on or after it.`
    );
  }
  if (input.proceedsFils > 0 && (input.vatTreatment ?? "standard") === "standard") {
    await assertCompanyEmirateForDisposal(tx, a.company_id);
  }
}

/**
 * D2 (N6): depreciation stops at derecognition (IAS 16.55), so a disposal recorded late reverses,
 * in its own transaction, every depreciation charge dated after the disposal date (the disposal
 * month too: it is charged again up to the disposal date). Each charge is reversed through the
 * ledger on its own date (reverseEntry), so a locked or closed period refuses the disposal
 * (PERIOD_LOCKED) instead of moving the charge into another month. The register drops those
 * months and gets its accumulated depreciation back.
 */
async function reverseDepreciationAfter(
  tx: LedgerTx,
  a: AssetRow,
  disposalDate: string,
  actorId: string
): Promise<Array<{ year: number; month: number; amount: number; reversalEntryId: string }>> {
  const rows = await q<{
    id: string;
    period_year: number;
    period_month: number;
    amount: string;
    journal_entry_id: string | null;
    entry_date: string | null;
  }>(
    tx,
    sql`SELECT ds.id, ds.period_year, ds.period_month, ds.amount::text AS amount,
               ds.journal_entry_id, to_char(je.date, 'YYYY-MM-DD') AS entry_date
          FROM depreciation_schedules ds
          LEFT JOIN journal_entries je ON je.id = ds.journal_entry_id
         WHERE ds.asset_id = ${a.id}
           AND COALESCE(to_char(je.date, 'YYYY-MM-DD'),
                        to_char(make_date(ds.period_year, ds.period_month, 1)
                                + interval '1 month' - interval '1 day', 'YYYY-MM-DD'))
               > ${disposalDate}
         ORDER BY ds.period_year DESC, ds.period_month DESC
         FOR UPDATE OF ds`
  );
  const out: Array<{ year: number; month: number; amount: number; reversalEntryId: string }> = [];
  let reversedFils = 0;
  for (const r of rows) {
    const amountFils = toFils(r.amount, { rounding: "halfUp" });
    let reversalEntryId = "";
    if (r.journal_entry_id) {
      const { reversal } = await reverseEntry(
        r.journal_entry_id,
        {
          date: r.entry_date ?? depreciationPeriodEnd(r.period_year, r.period_month),
          reason: `Depreciation after the disposal on ${disposalDate} (IAS 16.55)`,
        },
        { actorId, tx, companyId: a.company_id }
      );
      reversalEntryId = reversal.id;
    }
    await tx.execute(sql`DELETE FROM depreciation_schedules WHERE id = ${r.id}`);
    reversedFils += amountFils;
    out.push({
      year: r.period_year,
      month: r.period_month,
      amount: Number(fromFils(amountFils)),
      reversalEntryId,
    });
    await recordEvent(tx, a, {
      type: "depreciation_reversed",
      date: r.entry_date ?? depreciationPeriodEnd(r.period_year, r.period_month),
      amountFils: -amountFils,
      journalEntryId: reversalEntryId || null,
      details: { year: r.period_year, month: r.period_month, disposalDate },
      actorId,
    });
  }
  if (reversedFils > 0) {
    await tx.execute(
      sql`UPDATE fixed_assets
             SET accumulated_depreciation = COALESCE(accumulated_depreciation, 0) - ${fromFils(reversedFils)}::numeric,
                 net_book_value = COALESCE(net_book_value, 0) + ${fromFils(reversedFils)}::numeric
           WHERE id = ${a.id}`
    );
  }
  return out;
}

/**
 * B1 (NH3): dispose of an asset sold on credit. The buyer gets a sales tax invoice issued through
 * the invoice service (it carries the receivable, the aging and the output VAT), then the disposal
 * is posted against that invoice. If the disposal fails after the invoice was issued, the invoice
 * is voided again so no orphan receivable is left.
 */
async function disposeOnCredit(assetId: string, companyId: string, input: DisposeInput) {
  const pre = await withLedgerTx(async (tx) => {
    const a = await loadAsset(tx, assetId, { companyId });
    await assertDisposable(tx, a, input);
    const co = await q<{ emirate: string | null }>(
      tx,
      sql`SELECT emirate FROM companies WHERE id = ${companyId}`
    );
    return { asset: a, emirate: normaliseEmirate(co[0]?.emirate ?? null) };
  });
  const treatment = input.vatTreatment ?? "standard";
  const draft = await createDraftInvoice(
    companyId,
    {
      contactId: input.buyerContactId ?? null,
      customerName: input.buyerName ?? null,
      date: input.disposalDate,
      // Goods supplied from the company's establishment (Art. 27): its emirate's Box 1 row.
      placeOfSupplyEmirate: pre.emirate,
      notes: `Disposal of fixed asset ${pre.asset.asset_number ?? pre.asset.asset_name}`,
      lines: [
        {
          description: `Disposal of ${pre.asset.asset_name}`.slice(0, 500),
          quantity: 1,
          unitPrice: input.proceedsFils,
          vatRate: treatment === "standard" ? 0.05 : 0,
          vatSupplyType: SUPPLY_TYPE_OF[treatment] ?? "standard_rated",
        },
      ],
    },
    input.actorId
  );
  try {
    const issued = await issueInvoice(draft.id, companyId, input.actorId, "sent");
    const out = await withLedgerTx((tx) =>
      disposeInTx(tx, assetId, companyId, input, { id: issued.invoice.id })
    );
    return { ...out, invoiceId: issued.invoice.id, invoiceNumber: issued.invoice.number };
  } catch (err) {
    try {
      const inv = await q<{ status: string }>(
        db,
        sql`SELECT status FROM invoices WHERE id = ${draft.id} AND company_id = ${companyId}`
      );
      if (inv[0]) {
        await voidInvoice(
          draft.id,
          companyId,
          input.actorId,
          inv[0].status === "draft" ? "cancelled" : "void",
          "Asset disposal failed"
        );
      }
    } catch (cleanupErr) {
      log.error(
        { err: (cleanupErr as Error)?.message, invoiceId: draft.id },
        "Disposal invoice could not be withdrawn after a failed disposal"
      );
    }
    throw err;
  }
}

export async function disposeAsset(assetId: string, companyId: string, input: DisposeInput) {
  if (input.onCredit && input.proceedsFils > 0) {
    return disposeOnCredit(assetId, companyId, input);
  }
  return withLedgerTx((tx) => disposeInTx(tx, assetId, companyId, input, null));
}

async function disposeInTx(
  tx: LedgerTx,
  assetId: string,
  companyId: string,
  input: DisposeInput,
  invoice: { id: string } | null
) {
  {
    let a = await loadAsset(tx, assetId, { lock: true, companyId });
    await assertDisposable(tx, a, input);
    // D2 (N6): charges booked after the disposal date are reversed before anything is measured.
    const reversedDepreciation = await reverseDepreciationAfter(
      tx,
      a,
      input.disposalDate,
      input.actorId
    );
    if (reversedDepreciation.length) a = await loadAsset(tx, assetId, { lock: true });
    const redoneMonth = new Set(reversedDepreciation.map((r) => `${r.year}-${r.month}`));
    // Catch-up depreciation through the month before disposal, then (C2, RL5) the disposal
    // month up to the disposal date, so the gain or loss is measured against the carrying
    // amount at derecognition (IAS 16.55, 16.68).
    const [dy, dm] = input.disposalDate.split("-").map(Number);
    const endY = dm === 1 ? dy - 1 : dy;
    const endM = dm === 1 ? 12 : dm - 1;
    const catchUp: Array<{ year: number; month: number; amount: number; journalEntryId: string }> =
      [];
    for (const pm of monthsThrough(a.purchase_iso, endY, endM)) {
      const r = await depreciateInTx(tx, a, pm.year, pm.month, input.actorId, { catchUp: true });
      if (!r.skipped && r.calc && r.journalEntryId) {
        catchUp.push({
          ...pm,
          amount: Number(fromFils(r.calc.amountFils)),
          journalEntryId: r.journalEntryId,
        });
      }
    }
    if (input.disposalDate.slice(0, 7) >= a.purchase_iso.slice(0, 7)) {
      const r = await depreciateInTx(tx, a, dy, dm, input.actorId, {
        catchUp: true,
        throughDate: input.disposalDate,
        keySuffix: redoneMonth.has(`${dy}-${dm}`) ? `:to-${input.disposalDate}` : undefined,
      });
      if (!r.skipped && r.calc && r.journalEntryId) {
        catchUp.push({
          year: dy,
          month: dm,
          amount: Number(fromFils(r.calc.amountFils)),
          journalEntryId: r.journalEntryId,
        });
      }
    }
    a = await loadAsset(tx, assetId, { lock: true });
    const c = calcInput(a);
    const vatRate: 0 | 5 =
      input.proceedsFils > 0 && (input.vatTreatment ?? "standard") === "standard" ? 5 : 0;
    const split = disposalSplit({
      proceedsFils: input.proceedsFils,
      vatRate,
      costFils: c.costFils,
      revaluationFils: c.revaluationFils ?? 0,
      accumulatedFils: c.accumulatedFils,
      impairmentFils: c.impairmentFils ?? 0,
    });
    const acc = await assetAccounts(tx, a);
    const lines: PostJournalLineInput[] = [];
    const grossFils = input.proceedsFils + split.vatFils;
    if (invoice) {
      // B1 (NH3): the invoice credited its sales account(s) with the net proceeds; move them to
      // the disposal. Its receivable and output VAT stay with the invoice.
      const sales = await invoiceSalesLines(tx, a.company_id, invoice.id);
      const salesTotal = sales.reduce((t, l) => t + l.fils, 0);
      if (salesTotal !== input.proceedsFils) {
        throw new DomainError(
          "DISPOSAL_INVOICE_MISMATCH",
          409,
          { invoiceId: invoice.id, invoicedFils: salesTotal, proceedsFils: input.proceedsFils },
          "The disposal invoice's net amount differs from the disposal proceeds"
        );
      }
      for (const l of sales) {
        lines.push({
          accountId: l.accountId,
          debitFils: l.fils,
          description: `Invoiced proceeds moved to disposal of ${a.asset_name}`,
        });
      }
    } else if (grossFils > 0) {
      const proceedsAccount = input.proceedsAccountId
        ? (await assertAccount(tx, a.company_id, input.proceedsAccountId, ["asset"])).id
        : await defaultDisposalCashAccount(tx, a.company_id);
      // C1 (RM1): cash proceeds land on a bank or cash account. A receivable is a disposal on
      // credit (onCredit), which raises the invoice that 1040 belongs to.
      await assertChosenAccountsNotControl(
        a.company_id,
        [{ field: "proceedsAccountId", accountId: proceedsAccount }],
        { tx }
      );
      lines.push({
        accountId: proceedsAccount,
        debitFils: grossFils,
        description: `Proceeds from disposal of ${a.asset_name}`,
      });
    }
    const accumulated = c.accumulatedFils + (c.impairmentFils ?? 0);
    if (accumulated > 0) {
      lines.push({
        accountId: acc.accumulated,
        debitFils: accumulated,
        description: `Reverse accumulated depreciation on ${a.asset_name}`,
      });
    }
    if (split.gainLossFils < 0) {
      const loss = await ensureAccountByCode(tx, a.company_id, FA_CODES.LOSS);
      lines.push({
        accountId: loss,
        debitFils: -split.gainLossFils,
        description: `Loss on disposal of ${a.asset_name}`,
      });
    }
    const grossCost = c.costFils + (c.revaluationFils ?? 0);
    lines.push({
      accountId: acc.cost,
      creditFils: grossCost,
      description: `Remove cost of ${a.asset_name}`,
    });
    if (split.vatFils > 0 && !invoice) {
      const vat = await ensureAccountByCode(tx, a.company_id, FA_CODES.VAT_OUTPUT);
      lines.push({
        accountId: vat,
        creditFils: split.vatFils,
        systemVat: true,
        description: `Output VAT 5% - disposal of ${a.asset_name}`,
      });
    }
    if (split.gainLossFils > 0) {
      const gain = await ensureAccountByCode(tx, a.company_id, FA_CODES.GAIN);
      lines.push({
        accountId: gain,
        creditFils: split.gainLossFils,
        description: `Gain on disposal of ${a.asset_name}`,
      });
    }
    // Realised revaluation surplus moves to retained earnings (IAS 16.41): what the asset still
    // holds in the surplus after any decreases / impairments charged to it (A3, H4).
    const heldSurplus = await assetSurplusFils(tx, a);
    if (heldSurplus > 0) {
      const surplus = await ensureAccountByCode(tx, a.company_id, FA_CODES.REVALUATION);
      const re = await ensureAccountByCode(tx, a.company_id, "3020");
      lines.push({
        accountId: surplus,
        debitFils: heldSurplus,
        description: `Realise revaluation surplus - ${a.asset_name}`,
      });
      lines.push({
        accountId: re,
        creditFils: heldSurplus,
        description: `Realised revaluation surplus - ${a.asset_name}`,
      });
    }
    const treatment = input.proceedsFils > 0 ? (input.vatTreatment ?? "standard") : null;
    const entryId = await post(tx, a, {
      date: input.disposalDate,
      memo: `Disposal: ${a.asset_name}${input.buyerName ? ` to ${input.buyerName}` : ""}`,
      key: `${FA_SOURCE}:${a.id}:dispose`,
      lines,
      actorId: input.actorId,
      // B1 (NH1): a disposal for consideration is a supply the VAT return reports from the
      // register (exempt / zero-rated too), unless its invoice reports it.
      reportsVat: !invoice && treatment !== null && treatment !== "out_of_scope",
    });
    await tx.execute(
      sql`UPDATE fixed_assets SET status = 'disposed', disposal_date = ${input.disposalDate},
                 disposal_amount = ${fromFils(input.proceedsFils)}, net_book_value = 0,
                 disposal_entry_id = ${entryId}, buyer_name = ${input.buyerName ?? null},
                 disposal_invoice_id = ${invoice?.id ?? null},
                 disposal_vat = ${fromFils(split.vatFils)},
                 disposal_vat_treatment = ${input.proceedsFils > 0 ? (input.vatTreatment ?? "standard") : null},
                 notes = COALESCE(${input.notes ?? null}, notes)
           WHERE id = ${a.id}`
    );
    await recordEvent(tx, a, {
      type: "disposed",
      date: input.disposalDate,
      amountFils: input.proceedsFils,
      journalEntryId: entryId,
      details: {
        vat: fromFils(split.vatFils),
        vatTreatment: input.proceedsFils > 0 ? (input.vatTreatment ?? "standard") : null,
        gainLoss: fromFils(split.gainLossFils),
        buyerName: input.buyerName ?? null,
        onCredit: input.onCredit === true,
        invoiceId: invoice?.id ?? null,
      },
      actorId: input.actorId,
    });
    const asset = await loadAsset(tx, a.id);
    log.info({ assetId: a.id, entryId }, "Asset disposed");
    return {
      asset,
      disposalAmount: Number(fromFils(input.proceedsFils)),
      vatAmount: Number(fromFils(split.vatFils)),
      netBookValueAtDisposal: Number(fromFils(split.nbvFils)),
      gainLoss: Number(fromFils(split.gainLossFils)),
      gainLossType: split.gainLossFils > 0 ? "gain" : split.gainLossFils < 0 ? "loss" : "breakeven",
      journalEntryId: entryId,
      catchUpDepreciation: catchUp,
      reversedDepreciation,
    };
  }
}

/** The income (sales) credit lines of an invoice's posted revenue entry (fils). */
async function invoiceSalesLines(
  tx: LedgerTx,
  companyId: string,
  invoiceId: string
): Promise<Array<{ accountId: string; fils: number }>> {
  const rows = await q<{ account_id: string; f: string }>(
    tx,
    sql`SELECT jl.account_id, SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))::text AS f
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          JOIN accounts ac ON ac.id = jl.account_id
         WHERE je.company_id = ${companyId} AND je.source = 'invoice' AND je.source_id = ${invoiceId}
           AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
           AND je.entry_kind <> 'reversal'
           -- the income lines (zero-rated / exempt sales accounts carry a VAT flag too)
           AND ac.type = 'income'
         GROUP BY jl.account_id
        HAVING SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)) > 0`
  );
  return rows.map((r) => ({ accountId: r.account_id, fils: Number(r.f) }));
}

// ─── Register (book vs tax) ─────────────────────────────────────────────────

/**
 * B2 (INTEGRATE-A follow-up, NL9): the register as at `asOf`. The asset row holds the CURRENT
 * state; the book columns are rolled back to asOf from the asset's own journals and events:
 *  - gross carrying amount and accumulated depreciation + impairment: current GL effect less the
 *    asset's fixed-asset journals dated after asOf (depreciation, revaluation, impairment,
 *    disposal) and the debit-note re-costs dated after asOf;
 *  - accumulated depreciation: depreciation posted on or before asOf since the last revaluation
 *    on or before asOf (a revaluation eliminates it, IAS 16.35(b)); impairment is the rest;
 *  - revaluation reserve: what the asset holds in 3050 at asOf (IAS 16.39-41), shown beside the
 *    gross revaluation adjustment on the cost account.
 * Assets bought after asOf are not on the register at asOf.
 */
export async function assetRegister(companyId: string, asOf: string) {
  const { rows } = await pool.query(
    `SELECT fa.*, to_char(fa.purchase_date, 'YYYY-MM-DD') AS purchase_iso,
            to_char(fa.disposal_date, 'YYYY-MM-DD') AS disposal_iso, c.code AS class_code, cc.code AS cost_center_code
       FROM fixed_assets fa
       LEFT JOIN fixed_asset_classes c ON c.id = fa.asset_class_id
       LEFT JOIN cost_centers cc ON cc.id = fa.cost_center_id
      WHERE fa.company_id = $1 AND fa.purchase_date::date <= $2::date
      ORDER BY fa.purchase_date, fa.asset_name`,
    [companyId, asOf]
  );
  const defaults = await pool.query(
    `SELECT code, id FROM accounts WHERE company_id = $1 AND code IN ($2, $3, $4)`,
    [companyId, FA_CODES.COST, FA_CODES.ACCUMULATED, FA_CODES.REVALUATION]
  );
  const byCode = new Map(defaults.rows.map((r) => [r.code as string, r.id as string]));
  const LOCAL = `((je.date + interval '4 hours')::date)`;
  const [after, deps, reserve, recost] = await Promise.all([
    pool.query(
      `SELECT je.source_id AS asset_id, jl.account_id,
              SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))::bigint AS f
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $3
          AND ${LOCAL} > $2::date
        GROUP BY 1, 2`,
      [companyId, asOf, FA_SOURCE]
    ),
    pool.query(
      `WITH r AS (
         SELECT je.source_id AS asset_id, MAX(je.created_at) AS at
           FROM journal_entries je
          WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $3
            AND je.idempotency_key LIKE '%:revalue:%' AND ${LOCAL} <= $2::date
          GROUP BY 1
       )
       SELECT je.source_id AS asset_id, jl.account_id,
              SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))::bigint AS f
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
         LEFT JOIN r ON r.asset_id = je.source_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $3
          AND ${LOCAL} <= $2::date
          AND (je.idempotency_key LIKE '%:dep:%' OR je.idempotency_key LIKE '%:capitalize')
          AND (r.at IS NULL OR je.created_at > r.at)
        GROUP BY 1, 2`,
      [companyId, asOf, FA_SOURCE]
    ),
    pool.query(
      `SELECT je.source_id AS asset_id,
              SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))::bigint AS f
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = $3
          AND ${LOCAL} <= $2::date AND jl.account_id = $4
        GROUP BY 1`,
      [companyId, asOf, FA_SOURCE, byCode.get(FA_CODES.REVALUATION) ?? null]
    ),
    pool.query(
      `SELECT asset_id, COALESCE(SUM(ROUND(amount * 100)), 0)::bigint AS f
         FROM fixed_asset_events
        WHERE company_id = $1 AND event_type = 'recosted' AND event_date > $2::date
        GROUP BY 1`,
      [companyId, asOf]
    ),
  ]);
  const key = (asset: string, account: string | null | undefined) => `${asset}:${account}`;
  const afterBy = new Map(after.rows.map((r) => [key(r.asset_id, r.account_id), Number(r.f)]));
  const depBy = new Map(deps.rows.map((r) => [key(r.asset_id, r.account_id), Number(r.f)]));
  const reserveBy = new Map(reserve.rows.map((r) => [r.asset_id as string, Number(r.f)]));
  const recostBy = new Map(recost.rows.map((r) => [r.asset_id as string, Number(r.f)]));
  // C2 (RL4): the tax columns run through the same months as the book columns at asOf: book
  // depreciation is dated at month end, so a mid-month asOf has not charged its own month yet.
  const [ay, am, ad] = asOf.split("-").map(Number);
  const monthEnd = ad >= new Date(Date.UTC(ay, am, 0)).getUTCDate();
  const y = monthEnd ? ay : am === 1 ? ay - 1 : ay;
  const m = monthEnd ? am : am === 1 ? 12 : am - 1;
  return (
    rows as Array<AssetRow & { class_code: string | null; cost_center_code: string | null }>
  ).map((a) => {
    const c = calcInput(a);
    const recostAfter = recostBy.get(a.id) ?? 0;
    const tax = scheduleTo(
      {
        ...c,
        // C2 (RL4): the tax base at asOf (before any later debit-note re-cost).
        costFils: c.costFils - recostAfter,
        usefulLifeYears: a.tax_useful_life_years ?? a.useful_life_years,
        method: a.tax_depreciation_method ?? a.depreciation_method,
        revaluationFils: 0,
        impairmentFils: 0,
        rebased: false,
      },
      y,
      m
    );
    const costAccount = a.cost_account_id ?? byCode.get(FA_CODES.COST);
    const accAccount = a.accumulated_account_id ?? byCode.get(FA_CODES.ACCUMULATED);
    const disposed = a.status === "disposed" && !!a.disposal_iso && a.disposal_iso <= asOf;
    const disposedNow = a.status === "disposed";
    const costFils = c.costFils - recostAfter;
    const grossNow = disposedNow ? 0 : c.costFils + (c.revaluationFils ?? 0);
    const accNow = disposedNow ? 0 : c.accumulatedFils + (c.impairmentFils ?? 0);
    const gross = disposed
      ? 0
      : grossNow - (afterBy.get(key(a.id, costAccount)) ?? 0) - recostAfter;
    const accumulated = disposed ? 0 : accNow + (afterBy.get(key(a.id, accAccount)) ?? 0);
    const depreciation = disposed
      ? 0
      : Math.min(accumulated, Math.max(0, depBy.get(key(a.id, accAccount)) ?? 0));
    const impairment = accumulated - depreciation;
    const bookNbv = gross - accumulated;
    const taxNbv = costFils - tax.accumulatedFils;
    return {
      id: a.id,
      assetNumber: a.asset_number,
      assetName: a.asset_name,
      assetNameAr: a.asset_name_ar,
      category: a.category,
      classCode: a.class_code,
      costCenter: a.cost_center_code,
      status: disposedNow && !disposed ? "active" : a.status,
      purchaseDate: a.purchase_iso,
      cost: Number(fromFils(costFils)),
      /** Gross revaluation adjustment on the cost account (fair value less cost). */
      revaluationSurplus: Number(fromFils(disposed ? 0 : gross - costFils)),
      /** NL9: the asset's revaluation reserve in equity (3050) at asOf. */
      revaluationReserve: Number(fromFils(reserveBy.get(a.id) ?? 0)),
      bookAccumulatedDepreciation: Number(fromFils(depreciation)),
      impairment: Number(fromFils(impairment)),
      // A3 (H5): the figures that tie to the GL cost (1290 etc.) and accumulated
      // depreciation and impairment (1240) accounts.
      grossCarryingAmount: Number(fromFils(gross)),
      accumulatedDepreciationAndImpairment: Number(fromFils(accumulated)),
      bookNetBookValue: Number(fromFils(bookNbv)),
      taxUsefulLifeYears: a.tax_useful_life_years ?? a.useful_life_years,
      taxAccumulatedDepreciation: disposed ? 0 : Number(fromFils(tax.accumulatedFils)),
      taxWrittenDownValue: disposed ? 0 : Number(fromFils(taxNbv)),
      bookTaxDifference: disposed ? 0 : Number(fromFils(bookNbv - taxNbv)),
      capitalized: !!a.capitalization_entry_id || !a.needs_capitalization_je,
      disposalDate: disposed ? a.disposal_iso : null,
      disposalAmount: disposed && a.disposal_amount !== null ? Number(a.disposal_amount) : null,
    };
  });
}

export const REGISTER_COLUMNS = [
  { header: "Asset No.", key: "assetNumber", width: 14 },
  { header: "Asset", key: "assetName", width: 30 },
  { header: "Category", key: "category", width: 16 },
  { header: "Class", key: "classCode", width: 10 },
  { header: "Cost centre", key: "costCenter", width: 12 },
  { header: "Status", key: "status", width: 10 },
  { header: "Purchase date", key: "purchaseDate", width: 14 },
  { header: "Cost (AED)", key: "cost", width: 16 },
  { header: "Revaluation adjustment to gross (AED)", key: "revaluationSurplus", width: 18 },
  { header: "Revaluation reserve (AED)", key: "revaluationReserve", width: 16 },
  { header: "Book acc. depreciation (AED)", key: "bookAccumulatedDepreciation", width: 20 },
  { header: "Impairment (AED)", key: "impairment", width: 14 },
  { header: "Gross carrying amount (AED)", key: "grossCarryingAmount", width: 18 },
  {
    header: "Acc. depreciation and impairment (AED)",
    key: "accumulatedDepreciationAndImpairment",
    width: 22,
  },
  { header: "Book NBV (AED)", key: "bookNetBookValue", width: 16 },
  { header: "Tax acc. depreciation (AED)", key: "taxAccumulatedDepreciation", width: 20 },
  { header: "Tax WDV (AED)", key: "taxWrittenDownValue", width: 16 },
  { header: "Book − tax (AED)", key: "bookTaxDifference", width: 16 },
  { header: "Disposal date", key: "disposalDate", width: 14 },
  { header: "Disposal proceeds (AED)", key: "disposalAmount", width: 18 },
];

// ─── CSV import ─────────────────────────────────────────────────────────────

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

export const IMPORT_COLUMNS = [
  "assetName",
  "assetNameAr",
  "assetNumber",
  "category",
  "classCode",
  "purchaseDate",
  "purchaseCost",
  "salvageValue",
  "usefulLifeYears",
  "depreciationMethod",
  "location",
  "serialNumber",
  "accumulatedDepreciation",
] as const;
