/**
 * Cash-flow classification from cash legs (B2: NC2, NM1; IAS 7.10-7.21, 7.43).
 *
 * Both methods classify the SAME cash flows, so they agree on every subtotal:
 *
 *  - Only entries that move cash are cash flows. Each non-cash line of such an entry carries
 *    its own share of the cash (credit − debit of that line: the lines of an entry sum to its
 *    cash movement), so a capital purchase with recoverable VAT splits into the asset (investing)
 *    and the VAT (operating), and disposal proceeds and purchases stay gross (IAS 7.21).
 *  - An entry that moves cash and touches property, plant and equipment (or another non-current
 *    asset) is an investing flow: the asset lines, the gain or loss on derecognition (part of the
 *    proceeds) and any financing / equity part of the same entry (a non-cash part of the
 *    acquisition) form one purchase or proceeds line (IAS 7.16). Working-capital lines in it
 *    (VAT) stay operating.
 *  - A payment of a supplier bill that capitalised an asset is investing for the bill's asset
 *    share (the bill's asset debit over its payable), the rest operating (IAS 7.16(a)).
 *  - C2 (RM2): a receipt against the invoice that billed an asset disposal is investing for the
 *    invoice's net share (net proceeds over the receivable), the output VAT operating
 *    (IAS 7.16(b)); a reversed receipt reverses the same split.
 *  - C2 (RL2): a realised exchange difference settled in the same cash entry as a receivable,
 *    payable or financing balance is folded into that balance's line, so each line shows the
 *    cash actually received or paid (IAS 7.18(a), 7.25-7.28); the indirect method keeps the
 *    balance's movement at carrying amount and the difference in profit.
 *  - Lines on equity and on financing liabilities (borrowings, lease liabilities, dividends
 *    payable) in a cash entry are financing (IAS 7.17).
 *  - Every other line of a cash entry is operating.
 *  - Entries with no cash leg that touch a non-current asset, equity or a financing liability
 *    are non-cash investing and financing transactions (an asset bought on credit, a dividend
 *    declared but unpaid, a provision charged to retained earnings at go-live, a revaluation):
 *    they are excluded and disclosed (IAS 7.43). C2 (RL3): an entry that also carries a profit
 *    or loss line (an asset bill with a delivery expense, a disposal on credit) is disclosed for
 *    its investing / financing part; depreciation and impairment (contra-asset lines only) are
 *    adjustments, not transactions to disclose. Their profit-or-loss lines (depreciation,
 *    impairment, accrued interest) are the indirect method's non-cash adjustments (IAS 7.20(b)).
 *  - Period-end FX revaluation of cash is the effect of exchange-rate changes (IAS 7.28).
 *
 * The indirect method's operating section is the reconciliation from profit: net income, the
 * non-cash adjustments and the working-capital changes, where a working-capital change is the
 * account's movement less what was classified as investing or financing above. By construction
 * it equals the direct method's operating total.
 *
 * Everything is summed in SQL in integer fils; only entries that need per-entry treatment
 * (cash entries touching investing / financing accounts) come back per entry.
 */
import { pool } from "../db";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  type Fils,
  type Queryable,
  type ReportAccount,
} from "./ledger-query";
import {
  indirectActivity,
  isCashAccount,
  isContraAsset,
  isNonCurrent,
  isOperatingNonCurrent,
  type CashFlowActivity,
} from "./classify";
import { FX_REVALUATION_SOURCES } from "./ifrs-adjustments";
import type { IsoDate } from "./dates";

const FX_SOURCES_SQL = FX_REVALUATION_SOURCES.map((s) => `'${s}'`).join(", ");

export function isInvestingAccount(a: ReportAccount, cashIds: Set<string>): boolean {
  return a.type === "asset" && !cashIds.has(a.id) && isNonCurrent(a) && !isOperatingNonCurrent(a);
}

export function isFinancingAccount(a: ReportAccount, cashIds: Set<string>): boolean {
  if (cashIds.has(a.id)) return false;
  if (a.type !== "equity" && a.type !== "liability") return false;
  return indirectActivity(a) === "financing";
}

/** One classified amount (fils): positive = cash in, negative = cash out. */
export interface ClassifiedAmount {
  accountId: string | null;
  fils: Fils;
  /** Gross inflow / outflow parts (per entry and account) of `fils`. */
  inFils: Fils;
  outFils: Fils;
}

export interface InvestingFlow {
  /** The asset account naming the line (cost account first). */
  accountId: string;
  kind: "purchase" | "proceeds";
  fils: Fils;
}

export interface NonCashTransaction {
  entryId: string;
  entryNumber: string | null;
  date: IsoDate;
  memo: string | null;
  source: string | null;
  /** Total debits of the entry (fils). */
  amountFils: Fils;
}

export interface ClassifiedCashFlows {
  /** Operating cash flows per counter-account (direct method lines). */
  operatingDirect: Map<string, ClassifiedAmount>;
  investing: InvestingFlow[];
  /** Financing cash flows per account. */
  financing: Map<string, ClassifiedAmount>;
  /** Indirect method: non-cash P&L adjustments per P&L account (fils to ADD to net income). */
  nonCashAdjustments: Map<string, Fils>;
  /** Indirect method: working-capital change per balance-sheet account (credit − debit). */
  workingCapital: Map<string, Fils>;
  /** Cash movement from FX revaluation entries (debit − credit, fils). */
  fxOnCashFils: Fils;
  nonCashTransactions: NonCashTransaction[];
}

function bump(m: Map<string, ClassifiedAmount>, key: string, f: Fils, inF = 0, outF = 0) {
  const cur = m.get(key);
  const pos = inF || outF ? inF : Math.max(f, 0);
  const neg = inF || outF ? outF : Math.min(f, 0);
  if (cur) {
    cur.fils += f;
    cur.inFils += pos;
    cur.outFils += neg;
  } else m.set(key, { accountId: key, fils: f, inFils: pos, outFils: neg });
}

function bumpN(m: Map<string, Fils>, key: string, f: Fils) {
  if (f === 0) return;
  m.set(key, (m.get(key) ?? 0) + f);
}

interface Row {
  kind: "fx" | "detail" | "cash" | "noncash_invfin" | "noncash";
  entry_id: string | null;
  account_id: string;
  f: string;
  pos: string;
  neg: string;
  has_pl: boolean | null;
}

/**
 * Bill payments in range whose bill capitalised an asset: per payment entry, the asset debit
 * (per asset account) and the payable credit of the bill's current (unreversed) journal.
 */
async function billAssetShares(
  companyId: string,
  range: { from: IsoDate | null; to: IsoDate },
  ppeCostIds: string[],
  cashIds: string[],
  q: Queryable
): Promise<Map<string, { ppe: Map<string, Fils>; apFils: Fils }>> {
  const out = new Map<string, { ppe: Map<string, Fils>; apFils: Fils }>();
  if (!ppeCostIds.length) return out;
  const { rows } = await q.query(
    `WITH p AS (
       SELECT je.id AS entry_id, bj.id AS bill_entry_id
         FROM journal_entries je
         JOIN bill_payments bp ON bp.id = je.source_id
         JOIN LATERAL (
           SELECT b.id FROM journal_entries b
            WHERE b.company_id = je.company_id AND b.source = 'bill'
              AND b.source_id = bp.bill_id AND b.status = 'posted'
              AND b.reversed_by_entry_id IS NULL
            ORDER BY b.created_at DESC LIMIT 1
         ) bj ON true
        WHERE je.company_id = $1 AND je.status = 'posted' AND je.source = 'bill_payment'
          AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
          AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
          AND EXISTS (SELECT 1 FROM journal_lines c WHERE c.entry_id = je.id
                         AND c.account_id = ANY($5::uuid[]))
     )
     SELECT p.entry_id,
            jl.account_id,
            (jl.account_id = ANY($4::uuid[])) AS is_ppe,
            SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))::bigint AS f
       FROM p
       JOIN journal_lines jl ON jl.entry_id = p.bill_entry_id
      WHERE jl.account_id = ANY($4::uuid[])
         OR jl.account_id IN (SELECT pl.account_id FROM journal_lines pl
                               WHERE pl.entry_id = p.entry_id AND pl.debit > 0
                                 AND NOT (pl.account_id = ANY($5::uuid[])))
      GROUP BY p.entry_id, jl.account_id`,
    [companyId, range.from, range.to, ppeCostIds, cashIds]
  );
  for (const r of rows) {
    const cur = out.get(r.entry_id) ?? { ppe: new Map<string, Fils>(), apFils: 0 };
    const f = Number(r.f);
    if (r.is_ppe) {
      if (f > 0) cur.ppe.set(r.account_id, (cur.ppe.get(r.account_id) ?? 0) + f);
    } else cur.apFils += -f;
    out.set(r.entry_id, cur);
  }
  for (const [k, v] of Array.from(out.entries())) {
    const ppe = Array.from(v.ppe.values()).reduce((s, x) => s + x, 0);
    if (ppe <= 0 || v.apFils <= 0) out.delete(k);
  }
  return out;
}

/** C2 (RL2): realised exchange-difference accounts (4090 gain / 5140 loss in the default chart). */
export function isRealisedFxAccount(a: Pick<ReportAccount, "type" | "subType" | "code">): boolean {
  if (a.type !== "income" && a.type !== "expense") return false;
  if (a.code === "4090" || a.code === "5140") return true;
  const sub = (a.subType ?? "").toLowerCase();
  return sub === "fx_gain" || sub === "fx_loss" || sub === "realised_fx";
}

/**
 * C2 (RM2): receipts (and reversed receipts) in range of an invoice that billed a fixed-asset
 * disposal: per entry, the asset's cost account and the invoice's net share (net / total).
 */
async function disposalReceiptShares(
  companyId: string,
  range: { from: IsoDate | null; to: IsoDate },
  q: Queryable
): Promise<Map<string, { accountId: string; netFils: Fils; totalFils: Fils }>> {
  const out = new Map<string, { accountId: string; netFils: Fils; totalFils: Fils }>();
  const { rows } = await q.query(
    `SELECT je.id AS entry_id,
            COALESCE(fa.cost_account_id,
                     (SELECT a.id FROM accounts a WHERE a.company_id = je.company_id
                         AND a.code = '1290' LIMIT 1)) AS account_id,
            ROUND(i.total * 100)::bigint AS total_fils,
            ROUND(COALESCE(i.vat_amount, 0) * 100)::bigint AS vat_fils
       FROM journal_entries je
       JOIN fixed_assets fa
         ON fa.company_id = je.company_id AND fa.disposal_invoice_id = je.source_id
       JOIN invoices i ON i.id = fa.disposal_invoice_id
      WHERE je.company_id = $1 AND je.status = 'posted'
        AND je.source IN ('payment', 'payment_reversal')
        AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
        AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date`,
    [companyId, range.from, range.to]
  );
  for (const r of rows) {
    const total = Number(r.total_fils);
    if (!r.account_id || total <= 0) continue;
    out.set(r.entry_id, {
      accountId: r.account_id,
      netFils: total - Number(r.vat_fils),
      totalFils: total,
    });
  }
  return out;
}

export async function classifyCashFlows(
  companyId: string,
  range: { from: IsoDate | null; to: IsoDate },
  accounts: ReportAccount[],
  q: Queryable = pool
): Promise<ClassifiedCashFlows> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cash = new Set(accounts.filter(isCashAccount).map((a) => a.id));
  const cashIds = Array.from(cash);
  const ppeAccounts = accounts.filter((a) => isInvestingAccount(a, cash));
  const ppeIds = ppeAccounts.map((a) => a.id);
  const ppeCostIds = ppeAccounts.filter((a) => !isContraAsset(a)).map((a) => a.id);
  const finIds = accounts.filter((a) => isFinancingAccount(a, cash)).map((a) => a.id);
  const plIds = accounts
    .filter((a) => a.type === "income" || a.type === "expense")
    .map((a) => a.id);

  const fxIds = accounts.filter(isRealisedFxAccount).map((a) => a.id);
  const contraIds = ppeAccounts.filter((a) => isContraAsset(a)).map((a) => a.id);

  const [traced, disposalReceipts] = await Promise.all([
    billAssetShares(companyId, range, ppeCostIds, cashIds, q),
    disposalReceiptShares(companyId, range, q),
  ]);
  const tracedIds = Array.from(traced.keys()).concat(Array.from(disposalReceipts.keys()));
  const none = [null];
  const { rows } = (await q.query(
    `WITH e AS (
       SELECT je.id, (je.source IN (${FX_SOURCES_SQL})) AS is_fx
         FROM journal_entries je
        WHERE je.company_id = $1 AND je.status = 'posted'
          AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
          AND ${ENTRY_LOCAL_DATE_SQL} <= $3::date
          AND ${NOT_CLOSING_SQL}
     ),
     l AS (
       SELECT jl.entry_id, jl.account_id,
              SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))::bigint AS f
         FROM journal_lines jl JOIN e ON e.id = jl.entry_id
        GROUP BY jl.entry_id, jl.account_id
     ),
     k AS (
       SELECT l.entry_id,
              CASE
                WHEN bool_or(e.is_fx) THEN 'fx'
                WHEN bool_or(l.account_id = ANY($4::uuid[])) THEN
                  CASE WHEN bool_or(l.account_id = ANY($5::uuid[]) OR l.account_id = ANY($6::uuid[]))
                         OR l.entry_id = ANY($8::uuid[])
                         OR bool_or(l.account_id = ANY($9::uuid[]))
                       THEN 'detail' ELSE 'cash' END
                WHEN bool_or(l.account_id = ANY($5::uuid[]) OR l.account_id = ANY($6::uuid[]))
                  THEN 'noncash_invfin'
                ELSE 'noncash'
              END AS kind,
              bool_or(l.account_id = ANY($7::uuid[])) AS has_pl,
              bool_or((l.account_id = ANY($5::uuid[]) AND NOT (l.account_id = ANY($10::uuid[])))
                      OR l.account_id = ANY($6::uuid[])) AS has_invfin_part
         FROM l JOIN e ON e.id = l.entry_id
        GROUP BY l.entry_id
     )
     SELECT k.kind,
            CASE WHEN k.kind = 'detail'
                   OR (k.kind = 'noncash_invfin' AND (NOT k.has_pl OR k.has_invfin_part))
                 THEN l.entry_id END AS entry_id,
            bool_or(k.has_pl) AS has_pl,
            l.account_id,
            SUM(l.f)::bigint AS f,
            SUM(GREATEST(l.f, 0))::bigint AS pos,
            SUM(LEAST(l.f, 0))::bigint AS neg
       FROM l JOIN k ON k.entry_id = l.entry_id
      WHERE k.kind = 'fx' OR NOT (l.account_id = ANY($4::uuid[]))
      GROUP BY 1, 2, 4`,
    [
      companyId,
      range.from,
      range.to,
      cashIds.length ? cashIds : none,
      ppeIds.length ? ppeIds : none,
      finIds.length ? finIds : none,
      plIds.length ? plIds : none,
      tracedIds.length ? tracedIds : none,
      fxIds.length ? fxIds : none,
      contraIds.length ? contraIds : none,
    ]
  )) as { rows: Row[] };

  const out: ClassifiedCashFlows = {
    operatingDirect: new Map(),
    investing: [],
    financing: new Map(),
    nonCashAdjustments: new Map(),
    workingCapital: new Map(),
    fxOnCashFils: 0,
    nonCashTransactions: [],
  };
  const isTradeControl = (a?: ReportAccount) =>
    !!a &&
    ((a.type === "liability" && (a.subType === "payable" || ["2010", "2015"].includes(a.code))) ||
      (a.type === "asset" && (a.subType === "receivable" || a.code === "1040")));
  const isPl = (a?: ReportAccount) => !!a && (a.type === "income" || a.type === "expense");
  const detail = new Map<string, Array<{ accountId: string; f: Fils }>>();
  const disclosed = new Map<string, Fils>();
  // C2 (RL3): an entry with a P&L line is disclosed for its investing / financing part only.
  const disclosedPart = new Map<string, Fils>();
  const ppeSet = new Set(ppeIds);
  const finSet = new Set(finIds);

  for (const r of rows) {
    const f = Number(r.f);
    const a = byId.get(r.account_id);
    switch (r.kind) {
      case "fx":
        if (cash.has(r.account_id)) out.fxOnCashFils += -f;
        else if (!isPl(a)) bumpN(out.workingCapital, r.account_id, f);
        break;
      case "noncash":
        if (!isPl(a)) bumpN(out.workingCapital, r.account_id, f);
        break;
      case "noncash_invfin":
        if (isPl(a)) bumpN(out.nonCashAdjustments, r.account_id, -f);
        else if (r.entry_id && r.has_pl) {
          if (ppeSet.has(r.account_id) || finSet.has(r.account_id))
            disclosedPart.set(r.entry_id, (disclosedPart.get(r.entry_id) ?? 0) + f);
        } else if (r.entry_id && f < 0)
          disclosed.set(r.entry_id, (disclosed.get(r.entry_id) ?? 0) - f);
        break;
      case "cash":
        bump(out.operatingDirect, r.account_id, f, Number(r.pos), Number(r.neg));
        if (!isPl(a)) bumpN(out.workingCapital, r.account_id, f);
        break;
      case "detail": {
        const list = detail.get(r.entry_id!) ?? [];
        list.push({ accountId: r.account_id, f });
        detail.set(r.entry_id!, list);
        break;
      }
    }
  }

  const costSet = new Set(ppeCostIds);
  const fxSet = new Set(fxIds);
  const investing = new Map<string, InvestingFlow>();
  const addInvesting = (accountId: string, fils: Fils, forced?: InvestingFlow["kind"]) => {
    if (fils === 0) return;
    const kind = forced ?? (fils < 0 ? "purchase" : "proceeds");
    const key = `${kind}:${accountId}`;
    const cur = investing.get(key);
    if (cur) cur.fils += fils;
    else investing.set(key, { accountId, kind, fils });
  };
  const operating = (accountId: string, f: Fils) => {
    if (f === 0) return;
    bump(out.operatingDirect, accountId, f);
    if (!isPl(byId.get(accountId))) bumpN(out.workingCapital, accountId, f);
  };
  /** Direct method: the cash moved; indirect working capital: the balance's movement. */
  const operatingSplit = (accountId: string, cashF: Fils, movementF: Fils) => {
    if (cashF !== 0) bump(out.operatingDirect, accountId, cashF);
    if (!isPl(byId.get(accountId))) bumpN(out.workingCapital, accountId, movementF);
  };

  for (const [entryId, lines] of Array.from(detail.entries())) {
    const hasPpe = lines.some((l) => ppeSet.has(l.accountId));
    const share = traced.get(entryId);
    if (hasPpe) {
      const derecognises = lines.some((l) => costSet.has(l.accountId) && l.f > 0);
      let inv = 0;
      let primary: string | null = null;
      let weight = -1;
      for (const l of lines) {
        const a = byId.get(l.accountId);
        if (ppeSet.has(l.accountId)) {
          inv += l.f;
          const w = costSet.has(l.accountId) ? Math.abs(l.f) : Math.abs(l.f) / 1e6;
          if (w > weight) {
            weight = w;
            primary = l.accountId;
          }
        } else if (finSet.has(l.accountId) || isTradeControl(a)) {
          // A non-cash part of the acquisition / disposal (asset contributed, loan-financed or
          // on-credit portion, reserve transfer): only the cash moves in investing (IAS 7.43).
          inv += l.f;
        } else if (isPl(a) && derecognises) {
          // Gain / loss on derecognition is part of the proceeds (IAS 7.16(b), 7.20(c)).
          inv += l.f;
          bumpN(out.nonCashAdjustments, l.accountId, -l.f);
        } else operating(l.accountId, l.f);
      }
      if (primary) addInvesting(primary, inv);
      continue;
    }
    // C2 (RL2): fold a realised exchange difference into the receivable / payable / financing
    // line it settles, so that line carries the cash actually received or paid.
    let target: { accountId: string; f: Fils } | null = null;
    let fxF = 0;
    if (lines.some((l) => fxSet.has(l.accountId))) {
      for (const l of lines) {
        if (fxSet.has(l.accountId)) fxF += l.f;
        else if (finSet.has(l.accountId) || isTradeControl(byId.get(l.accountId))) {
          if (!target || Math.abs(l.f) > Math.abs(target.f)) target = l;
        }
      }
    }
    const receipt = disposalReceipts.get(entryId);
    for (const l of lines) {
      const a = byId.get(l.accountId);
      if (target && fxSet.has(l.accountId)) {
        // Stays in profit; settling a financing balance takes it out of operating (IAS 7.28).
        if (finSet.has(target.accountId)) bumpN(out.nonCashAdjustments, l.accountId, -l.f);
        continue;
      }
      const cashF = l === target ? l.f + fxF : l.f;
      if (finSet.has(l.accountId)) {
        bump(out.financing, l.accountId, cashF);
        continue;
      }
      if (share && !isPl(a) && l.f < 0) {
        // Payment of a bill that capitalised an asset: the asset share is investing.
        const ppeTotal = Array.from(share.ppe.values()).reduce((s, x) => s + x, 0);
        const ratio = Math.min(1, ppeTotal / share.apFils);
        const invPart = Math.round(cashF * ratio);
        const accs = Array.from(share.ppe.entries()).sort((x, y) => y[1] - x[1]);
        let rest = invPart;
        accs.forEach(([acc, amt], i) => {
          const part = i === accs.length - 1 ? rest : Math.round((invPart * amt) / ppeTotal);
          rest -= part;
          addInvesting(acc, part);
        });
        operatingSplit(l.accountId, cashF - invPart, l.f - invPart);
        continue;
      }
      if (receipt && isTradeControl(a) && l.f !== 0) {
        // C2 (RM2): disposal proceeds received: the invoice's net share is investing (IAS 7.16(b)).
        const invPart = Math.round((cashF * receipt.netFils) / receipt.totalFils);
        addInvesting(receipt.accountId, invPart, "proceeds");
        operatingSplit(l.accountId, cashF - invPart, l.f - invPart);
        continue;
      }
      operatingSplit(l.accountId, cashF, l.f);
    }
  }
  out.investing = Array.from(investing.values());

  for (const [id, f] of Array.from(disclosedPart.entries())) {
    if (f !== 0 && !disclosed.has(id)) disclosed.set(id, Math.abs(f));
  }
  if (disclosed.size) {
    const ids = Array.from(disclosed.keys()).slice(0, 200);
    const { rows: meta } = await q.query(
      `SELECT je.id, je.entry_number, ${ENTRY_LOCAL_DATE_SQL}::text AS d, je.memo, je.source
         FROM journal_entries je WHERE je.company_id = $1 AND je.id = ANY($2::uuid[])
        ORDER BY je.date, je.entry_number`,
      [companyId, ids]
    );
    out.nonCashTransactions = meta.map((m) => ({
      entryId: m.id,
      entryNumber: m.entry_number ?? null,
      date: m.d,
      memo: m.memo ?? null,
      source: m.source ?? null,
      amountFils: disclosed.get(m.id) ?? 0,
    }));
  }
  return out;
}

export type { CashFlowActivity };
