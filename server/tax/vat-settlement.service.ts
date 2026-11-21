/**
 * VAT return settlement (accounting round A integration; A2 H8 follow-up).
 *
 * A2 made 2020 Output VAT / 1050 Input VAT control accounts: a manual journal on them needs a
 * reasoned adjustment. Paying the FTA (or receiving a refund) for a submitted / filed return is
 * not an adjustment, so it posts through this seam, from the return's own figures:
 *
 *   Dr 2020 Output VAT          Box 12 (total VAT due)
 *   Cr 1050 Input VAT           Box 13 (recoverable VAT)
 *   Cr bank / cash              Box 14 (payable)      -- or Dr bank for a refund (Box 14 < 0)
 *
 * The filed boxes stay in AED. The VAT controls clear at their carrying value in the books,
 * and cash uses the payment-date rate. Any difference goes to realized FX.
 *
 * The entry is dated on the payment date (after the period; the A1 filed-period lock refuses a
 * VAT posting dated inside a submitted / filed period). Its source `vat_return_settlement` is
 * not a VAT transaction of the period it is dated in, so the VAT engine leaves it out of the
 * return's ledger movement (no manual adjustment, no reconciliation difference). One settlement
 * per return (idempotency key); reversing it uses the kernel's reverseBySource.
 */
import { journalLine, journalMemo } from "@shared/journal-memo";
import type { Request } from "express";
import { DomainError } from "../errors";
import { ledgerQueryable } from "../ledger/tx";
import { lockVatReturns } from "../ledger/vat-lock";
import { recordAudit } from "../services/audit.service";
import { bankCurrencyOf, cashLegFor } from "../services/fx/bank-currency";
import { convertFilsAtRate, getRate } from "../services/fx/rates";
import { getFxAccounts } from "../services/invoice-posting.service";
import {
  loadBaseCurrency,
  postJournal,
  reverseBySource,
  VAT_FILING_CURRENCY,
  withLedgerTx,
  type LedgerTx,
  type PostJournalLineInput,
} from "../ledger";
import { fromFils, toFils } from "../../shared/money";
import { VAT_SETTLEMENT_SOURCE } from "./vat-reconciliation";

export { VAT_SETTLEMENT_SOURCE };

const SETTLEABLE = new Set(["submitted", "filed"]);

interface ReturnRow {
  id: string;
  status: string;
  period_start: string;
  period_end: string;
  box12: string;
  box13: string;
  vat_group_id: string | null;
  amends_return_id: string | null;
  reconciliation_snapshot: {
    basis?: string;
    returnOutputVatFils?: number;
    returnInputVatFils?: number;
    filingVatGroup?: unknown;
  } | null;
  payment_date: string | null;
  payment_amount: string | null;
  payment_status: string | null;
  /** D2 (N13): the EmaraTax filing date stated on submit (filedOn), when one was given. */
  filed_on: string | null;
}

async function loadReturn(
  companyId: string,
  vatReturnId: string,
  tx?: LedgerTx
): Promise<ReturnRow> {
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT id, status, period_start::date::text AS period_start,
            period_end::date::text AS period_end, box12_total_due_tax::text AS box12,
            box13_recoverable_tax::text AS box13, vat_group_id, amends_return_id,
            reconciliation_snapshot, payment_status,
            payment_date::date::text AS payment_date, payment_amount::text AS payment_amount,
            declaration_date::date::text AS filed_on
       FROM vat_returns WHERE id = $1 AND company_id = $2 ${tx ? "FOR UPDATE" : ""}`,
    [vatReturnId, companyId]
  );
  if (!rows[0]) throw new DomainError("VAT_RETURN_NOT_FOUND", 404);
  return rows[0] as ReturnRow;
}

async function accountId(companyId: string, code: string, tx: LedgerTx): Promise<string> {
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND is_active = true LIMIT 1`,
    [companyId, code]
  );
  if (!rows[0]) throw new DomainError("VAT_ACCOUNTS_MISSING", 422, { code });
  return rows[0].id as string;
}

async function assertCashOrBank(companyId: string, id: string, tx: LedgerTx): Promise<void> {
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2 AND type = 'asset'
        AND sub_type IN ('cash', 'bank') AND is_active = true`,
    [id, companyId]
  );
  if (!rows[0]) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_INVALID",
      422,
      undefined,
      "Choose an active cash or bank account for the VAT payment"
    );
  }
}

export interface VatReturnSettlementEntry {
  id: string;
  entryNumber: string;
  date: string;
  reference: string | null;
  /** E2 (J3-r2): signed cash movement; > 0 paid to the FTA, < 0 refunded by the FTA. */
  netPayable: number;
  kind: "payment" | "refund" | "none";
}

interface SettlementJournal {
  id: string;
  entryNumber: string;
  date: string;
  reference: string | null;
  outputFils: string;
  inputFils: string;
  paymentAccountId: string | null;
}

interface PriorSettlement {
  returnIds: string[];
  outputFils: number;
  inputFils: number;
  outputBaseFils: number;
  inputBaseFils: number;
}

async function findSettlementJournal(
  companyId: string,
  vatReturnId: string,
  tx?: LedgerTx
): Promise<SettlementJournal | undefined> {
  // Before FX-aware settlements the AED box deltas were copied directly to the journal columns.
  // Keep those original nominal amounts for legacy replay, even on a non-AED ledger.
  const { rows } = await ledgerQueryable(tx).query(
    `SELECT je.id, je.entry_number AS "entryNumber", to_char(je.date, 'YYYY-MM-DD') AS date,
            je.reference,
            COALESCE((je.memo_params ->> 'vatOutputAedFils')::bigint,
                SUM(ROUND(jl.debit * 100) - ROUND(jl.credit * 100))
                FILTER (WHERE a.code = '2020'), 0)::bigint AS "outputFils",
            COALESCE((je.memo_params ->> 'vatInputAedFils')::bigint,
                SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100))
                FILTER (WHERE a.code = '1050'), 0)::bigint AS "inputFils",
            COALESCE(je.memo_params ->> 'vatPaymentAccountId',
                MAX(jl.account_id::text) FILTER (WHERE a.code NOT IN ('2020', '1050')))
                AS "paymentAccountId"
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id AND a.company_id = je.company_id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $3 AND je.status = 'posted'
        AND je.reversed_by_entry_id IS NULL AND je.entry_kind <> 'reversal'
      GROUP BY je.id
      ORDER BY je.created_at DESC LIMIT 1`,
    [companyId, VAT_SETTLEMENT_SOURCE, vatReturnId]
  );
  return rows[0] as SettlementJournal | undefined;
}

/** Standalone return reconciliation is calculated in the ledger currency before AED conversion. */
function bookVatAmounts(ret: ReturnRow) {
  const snapshot = ret.reconciliation_snapshot;
  const output = snapshot?.returnOutputVatFils;
  const input = snapshot?.returnInputVatFils;
  // Group reconciliation is consolidated in AED. A legacy amendment lacking its filing scope
  // might also be a group return, so its reconciliation figures cannot establish book amounts.
  if (
    ret.vat_group_id ||
    snapshot?.filingVatGroup ||
    (ret.amends_return_id && snapshot?.filingVatGroup === undefined) ||
    snapshot?.basis !== "vat_control_accounts" ||
    typeof output !== "number" ||
    !Number.isSafeInteger(output) ||
    typeof input !== "number" ||
    !Number.isSafeInteger(input)
  ) {
    return null;
  }
  return { output, input };
}

function settlementRoundsToZero(): DomainError {
  return new DomainError(
    "VAT_SETTLEMENT_ROUNDS_TO_ZERO",
    422,
    undefined,
    "The VAT settlement is too small to record in the selected currency."
  );
}

async function buildSettlementLines(
  tx: LedgerTx,
  ret: ReturnRow,
  prior: PriorSettlement,
  input: { companyId: string; paymentAccountId: string; date: string },
  outputFils: number,
  inputFils: number
): Promise<PostJournalLineInput[]> {
  const { companyId, paymentAccountId, date } = input;
  const base = await loadBaseCurrency(companyId, tx);
  const carrying = base === VAT_FILING_CURRENCY ? null : bookVatAmounts(ret);
  const bookDeltas = carrying && {
    output: carrying.output - prior.outputBaseFils,
    input: carrying.input - prior.inputBaseFils,
  };
  if (outputFils === 0 && inputFils === 0 && !bookDeltas?.output && !bookDeltas?.input) {
    throw new DomainError(
      prior.returnIds.length ? "VAT_AMENDMENT_NOTHING_TO_SETTLE" : "VAT_RETURN_NOTHING_TO_SETTLE",
      422,
      prior.returnIds.length ? { alreadySettledOn: prior.returnIds } : undefined,
      prior.returnIds.length
        ? "The amended return changes no VAT already settled for this period"
        : undefined
    );
  }
  const netFils = outputFils - inputFils;
  const rate =
    netFils || !bookDeltas
      ? await getRate(companyId, VAT_FILING_CURRENCY, base, date, { tx })
      : null;
  const toBase = (fils: number) => (rate ? convertFilsAtRate(fils, rate) : fils);
  // Group returns and older returns without book amounts use the payment-date rate on the
  // outstanding AED amounts. For standalone returns subtract the controls actually posted
  // on the amendment chain from the return's recorded functional-currency amounts.
  const outputBaseFils = bookDeltas?.output ?? toBase(outputFils);
  const inputBaseFils = bookDeltas?.input ?? toBase(inputFils);
  const amended = prior.returnIds.length > 0;
  const params = { from: ret.period_start, to: ret.period_end };
  const side = (fils: number) => (fils > 0 ? { debitFils: fils } : { creditFils: -fils });
  const lines: PostJournalLineInput[] = [];
  if (outputBaseFils)
    lines.push({
      accountId: await accountId(companyId, "2020", tx),
      ...side(outputBaseFils),
      systemVat: true,
      ...journalLine(amended ? "vatAmendedReturnOutput" : "vatReturnOutput", params),
    });
  if (inputBaseFils)
    lines.push({
      accountId: await accountId(companyId, "1050", tx),
      ...side(-inputBaseFils),
      systemVat: true,
      ...journalLine(amended ? "vatAmendedReturnInput" : "vatReturnInput", params),
    });
  let bankMovement = 0;
  if (netFils) {
    const cash = await cashLegFor({
      companyId,
      base,
      bankCurrency: await bankCurrencyOf(companyId, paymentAccountId, ledgerQueryable(tx)),
      docCurrency: VAT_FILING_CURRENCY,
      docAmountFils: Math.abs(netFils),
      docRate: rate?.rateText ?? "1",
      // Translate the single net remittance before rounding to ledger cents.
      docBaseFils: toBase(Math.abs(netFils)),
      date,
      tx,
    });
    if (!cash.cashBaseFils || (cash.tag && !toFils(cash.tag.amount)))
      throw settlementRoundsToZero();
    bankMovement = netFils > 0 ? -cash.cashBaseFils : cash.cashBaseFils;
    lines.push({
      accountId: paymentAccountId,
      ...side(bankMovement),
      ...(cash.tag
        ? {
            foreignCurrency: cash.tag.foreignCurrency,
            ...(netFils > 0
              ? { foreignCredit: cash.tag.amount }
              : { foreignDebit: cash.tag.amount }),
            exchangeRate: cash.tag.exchangeRate,
          }
        : {}),
      ...journalLine(
        netFils > 0
          ? amended
            ? "vatAmendedReturnPaid"
            : "vatReturnPaid"
          : amended
            ? "vatAmendedReturnRefund"
            : "vatReturnRefund",
        params
      ),
    });
  }
  if (!lines.length) throw settlementRoundsToZero();
  const difference = outputBaseFils - inputBaseFils + bankMovement;
  if (difference) {
    const accounts = await getFxAccounts(tx, companyId);
    lines.push({
      accountId: difference > 0 ? accounts.gain : accounts.loss,
      ...side(-difference),
      ...journalLine(difference > 0 ? "vatSettlementFxGain" : "vatSettlementFxLoss", params),
    });
  }
  return lines;
}

/** The posted, unreversed settlement entry of a return, or null. */
export async function getVatReturnSettlement(
  companyId: string,
  vatReturnId: string,
  tx?: LedgerTx
): Promise<VatReturnSettlementEntry | null> {
  await loadReturn(companyId, vatReturnId, tx);
  const entry = await findSettlementJournal(companyId, vatReturnId, tx);
  if (!entry) return null;
  const netFils = Number(entry.outputFils) - Number(entry.inputFils);
  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date,
    reference: entry.reference ?? null,
    netPayable: Number(fromFils(netFils)),
    kind: netFils > 0 ? "payment" : netFils < 0 ? "refund" : "none",
  };
}

/**
 * E2 (J3-r2): the return's payment fields mirror its live settlement entry (the only writer), so
 * the Returns list, reports and the ledger agree. `null` clears them after a reversal.
 */
async function syncPaymentFields(
  vatReturnId: string,
  settled: { date: string; netPayable: number } | null,
  tx: LedgerTx
): Promise<void> {
  await ledgerQueryable(tx).query(
    `UPDATE vat_returns
        SET payment_status = $2, payment_amount = $3, payment_date = $4, updated_at = now()
      WHERE id = $1`,
    [
      vatReturnId,
      settled ? "paid" : "unpaid",
      settled ? settled.netPayable : null,
      settled ? `${settled.date}T00:00:00Z` : null,
    ]
  );
}

export async function settleVatReturn(input: {
  companyId: string;
  vatReturnId: string;
  date: string;
  paymentAccountId: string;
  reference?: string | null;
  actorId: string;
  req?: Request;
}) {
  const reference = input.reference || null;
  const paymentAccountId = input.paymentAccountId.toLowerCase();
  return withLedgerTx(async (tx) => {
    await lockVatReturns(tx, input.companyId);
    const ret = await loadReturn(input.companyId, input.vatReturnId, tx);
    const settled = await findSettlementJournal(input.companyId, ret.id, tx);
    if (settled) {
      if (
        settled.date !== input.date ||
        settled.reference !== reference ||
        (settled.paymentAccountId && settled.paymentAccountId !== paymentAccountId)
      ) {
        throw new DomainError("VAT_RETURN_ALREADY_SETTLED", 409);
      }
      // Recover the mirror if an older server committed the journal before updating the return.
      const netFils = Number(settled.outputFils) - Number(settled.inputFils);
      if (
        ret.payment_status !== "paid" ||
        ret.payment_date !== settled.date ||
        ret.payment_amount === null ||
        toFils(ret.payment_amount) !== netFils
      ) {
        await syncPaymentFields(
          ret.id,
          { date: settled.date, netPayable: Number(fromFils(netFils)) },
          tx
        );
      }
      const prior = await settledOnSupersededReturns(input.companyId, ret.id, tx);
      return settlementResult(
        ret.id,
        settled,
        Number(settled.outputFils),
        Number(settled.inputFils),
        prior
      );
    }
    if (!SETTLEABLE.has(ret.status)) {
      throw new DomainError(
        "VAT_RETURN_NOT_SUBMITTED",
        409,
        { status: ret.status },
        "Submit the VAT return before recording its payment or refund"
      );
    }
    if (input.date <= ret.period_end) {
      throw new DomainError(
        "VAT_SETTLEMENT_DATE_IN_PERIOD",
        422,
        { periodEnd: ret.period_end },
        "The VAT payment or refund is dated after the end of the return period"
      );
    }
    // D2 (N13): the settlement of a filed return is the payment (or refund) of what that return
    // declared, so it cannot predate the filing recorded on EmaraTax (the payable tax is the one the
    // filed return states). A payment made before filing is a payment on account:
    // record it once the return is filed. Without a stated filing date nothing is checked.
    if (ret.status === "filed" && ret.filed_on && input.date < ret.filed_on) {
      throw new DomainError(
        "VAT_SETTLEMENT_BEFORE_FILING",
        422,
        { filedOn: ret.filed_on, fields: { date: [`On or after ${ret.filed_on}`] } },
        `The return was filed on ${ret.filed_on}. Date the payment or refund on or after the filing date.`
      );
    }
    await assertCashOrBank(input.companyId, paymentAccountId, tx);
    // B2 (NH4): an amended return (voluntary disclosure) replaces the figures of the return it
    // amends, but what was already paid or refunded for those returns stays paid. Only the
    // difference is settled now (Exec. Reg. Art. 70: the disclosure states the difference).
    const prior = await settledOnSupersededReturns(input.companyId, ret.id, tx);
    const outputFils = toFils(ret.box12, { rounding: "halfUp" }) - prior.outputFils;
    const inputFils = toFils(ret.box13, { rounding: "halfUp" }) - prior.inputFils;
    const netFils = outputFils - inputFils;
    const lines = await buildSettlementLines(
      tx,
      ret,
      prior,
      { companyId: input.companyId, paymentAccountId, date: input.date },
      outputFils,
      inputFils
    );
    // B2: one live settlement per return, but a reversed one may be settled again; each attempt
    // gets its own key (the first keeps the original format), so a re-settlement after a reversal
    // posts a new entry instead of replaying the reversed one.
    const earlier = await ledgerQueryable(tx).query(
      `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND source_id = $3 AND entry_kind <> 'reversal'`,
      [input.companyId, VAT_SETTLEMENT_SOURCE, ret.id]
    );
    const attempt = Number(earlier.rows[0]?.n ?? 0);
    const { entry } = await postJournal(
      {
        companyId: input.companyId,
        date: input.date,
        ...journalMemo(
          netFils === 0
            ? "vatReturnControlSettlement"
            : prior.returnIds.length
              ? netFils > 0
                ? "vatAmendedReturnPayment"
                : "vatAmendedReturnRefund"
              : netFils > 0
                ? "vatReturnPayment"
                : "vatReturnRefund",
          {
            from: ret.period_start,
            to: ret.period_end,
            // Store the statutory amounts on the immutable entry, including amounts with no
            // separately representable base line. The memo template uses only the dates.
            vatOutputAedFils: String(outputFils),
            vatInputAedFils: String(inputFils),
            vatPaymentAccountId: paymentAccountId,
          }
        ),
        status: "posted",
        source: VAT_SETTLEMENT_SOURCE,
        sourceId: ret.id,
        reference,
        idempotencyKey: `${VAT_SETTLEMENT_SOURCE}:${ret.id}${attempt ? `:${attempt}` : ""}`,
        lines,
      },
      { actorId: input.actorId, audit: true, tx }
    );
    await syncPaymentFields(
      ret.id,
      { date: input.date, netPayable: Number(fromFils(netFils)) },
      tx
    );
    await recordAudit({
      userId: input.actorId,
      companyId: input.companyId,
      action: "vat.return_settlement.create",
      entityType: "vat_return",
      entityId: ret.id,
      after: {
        journalEntryId: entry.id,
        netPayable: fromFils(netFils),
        date: input.date,
        previouslySettledOn: prior.returnIds,
      },
      req: input.req,
      tx,
    });
    return settlementResult(ret.id, entry, outputFils, inputFils, prior);
  });
}

function settlementResult(
  vatReturnId: string,
  entry: { id: string; entryNumber: string },
  outputFils: number,
  inputFils: number,
  prior: PriorSettlement
) {
  return {
    vatReturnId,
    journalEntryId: entry.id,
    entryNumber: entry.entryNumber,
    outputVat: Number(fromFils(outputFils)),
    inputVat: Number(fromFils(inputFils)),
    netPayable: Number(fromFils(outputFils - inputFils)),
    previouslySettled: {
      returnIds: prior.returnIds,
      outputVat: Number(fromFils(prior.outputFils)),
      inputVat: Number(fromFils(prior.inputFils)),
      netPaid: Number(fromFils(prior.outputFils - prior.inputFils)),
    },
  };
}

/**
 * B2 (NH4): VAT already settled for the returns `vatReturnId` supersedes (its amends_return_id
 * chain): each live settlement was itself only a difference. Sum the AED deltas for the amount
 * already paid or refunded, and sum the actual ledger lines for VAT control carrying values.
 */
async function settledOnSupersededReturns(
  companyId: string,
  vatReturnId: string,
  tx: LedgerTx
): Promise<PriorSettlement> {
  const { rows } = await ledgerQueryable(tx).query(
    `WITH RECURSIVE chain(id, amends, depth) AS (
       SELECT id, amends_return_id, 0 FROM vat_returns WHERE id = $2 AND company_id = $1
       UNION ALL
       SELECT r.id, r.amends_return_id, c.depth + 1
         FROM vat_returns r JOIN chain c ON r.id = c.amends
        WHERE r.company_id = $1 AND c.depth < 50
     )
     SELECT je.source_id AS return_id,
            (je.memo_params ->> 'vatOutputAedFils')::bigint AS output_aed,
            (je.memo_params ->> 'vatInputAedFils')::bigint AS input_aed,
            COALESCE(SUM(CASE WHEN a.code = '2020'
                              THEN ROUND(jl.debit * 100) - ROUND(jl.credit * 100) END), 0)::bigint AS output_base,
            COALESCE(SUM(CASE WHEN a.code = '1050'
                              THEN ROUND(jl.credit * 100) - ROUND(jl.debit * 100) END), 0)::bigint AS input_base
       FROM chain c
       JOIN journal_entries je ON je.company_id = $1 AND je.source = $3
                              AND je.source_id = c.id AND je.status = 'posted'
                              AND je.reversed_by_entry_id IS NULL AND je.entry_kind <> 'reversal'
       JOIN journal_lines jl ON jl.entry_id = je.id
     JOIN accounts a ON a.id = jl.account_id AND a.company_id = je.company_id
      WHERE c.depth > 0
      GROUP BY je.id`,
    [companyId, vatReturnId, VAT_SETTLEMENT_SOURCE]
  );
  return {
    returnIds: rows.map((r) => r.return_id as string).sort(),
    outputFils: rows.reduce((s, r) => s + Number(r.output_aed ?? r.output_base), 0),
    inputFils: rows.reduce((s, r) => s + Number(r.input_aed ?? r.input_base), 0),
    outputBaseFils: rows.reduce((s, r) => s + Number(r.output_base), 0),
    inputBaseFils: rows.reduce((s, r) => s + Number(r.input_base), 0),
  };
}

/**
 * C2 (RL6): returns that amend `vatReturnId` (directly or down the chain) and have a live
 * settlement, which was computed net of this return's settlement.
 */
async function laterSettledAmendments(
  companyId: string,
  vatReturnId: string,
  tx: LedgerTx
): Promise<string[]> {
  const { rows } = await ledgerQueryable(tx).query(
    `WITH RECURSIVE later(id, depth) AS (
       SELECT id, 0 FROM vat_returns WHERE id = $2 AND company_id = $1
       UNION ALL
       SELECT r.id, l.depth + 1
         FROM vat_returns r JOIN later l ON r.amends_return_id = l.id
        WHERE r.company_id = $1 AND l.depth < 50
     )
     SELECT DISTINCT l.id
       FROM later l
       JOIN journal_entries je ON je.company_id = $1 AND je.source = $3 AND je.source_id = l.id
                              AND je.status = 'posted' AND je.reversed_by_entry_id IS NULL
                              AND je.entry_kind <> 'reversal'
      WHERE l.depth > 0`,
    [companyId, vatReturnId, VAT_SETTLEMENT_SOURCE]
  );
  return rows.map((r) => r.id as string);
}

export async function reverseVatReturnSettlement(input: {
  companyId: string;
  vatReturnId: string;
  date: string;
  reason: string;
  actorId: string;
  req?: Request;
}) {
  return withLedgerTx(async (tx) => {
    await lockVatReturns(tx, input.companyId);
    await loadReturn(input.companyId, input.vatReturnId, tx);
    const settled = await findSettlementJournal(input.companyId, input.vatReturnId, tx);
    if (!settled) throw new DomainError("VAT_RETURN_NOT_SETTLED", 409);
    // C2 (RL6): a later amendment's settlement only settled the difference from this one. Undoing
    // this one alone would leave that VAT neither paid nor payable on any return (GL 2020 / 1050
    // off with nothing to re-settle), so reverse the latest settlement first.
    const later = await laterSettledAmendments(input.companyId, input.vatReturnId, tx);
    if (later.length) {
      throw new DomainError(
        "VAT_SETTLEMENT_COUNTED_BY_AMENDMENT",
        409,
        { amendedBy: later },
        "A later amended return's settlement already counted this payment. Reverse the latest amendment's settlement first, then this one."
      );
    }
    await reverseBySource(
      input.companyId,
      VAT_SETTLEMENT_SOURCE,
      input.vatReturnId,
      { date: input.date, reason: `VAT settlement reversed: ${input.reason}` },
      { actorId: input.actorId, req: input.req, companyId: input.companyId, tx }
    );
    await syncPaymentFields(input.vatReturnId, null, tx);
    await recordAudit({
      userId: input.actorId,
      companyId: input.companyId,
      action: "vat.return_settlement.reverse",
      entityType: "vat_return",
      entityId: input.vatReturnId,
      after: { reversedEntryId: settled.id, date: input.date, reason: input.reason },
      req: input.req,
      tx,
    });
    return { vatReturnId: input.vatReturnId, reversedEntryId: settled.id };
  });
}
