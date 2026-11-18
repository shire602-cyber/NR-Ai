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
 * The entry is dated on the payment date (after the period; the A1 filed-period lock refuses a
 * VAT posting dated inside a submitted / filed period). Its source `vat_return_settlement` is
 * not a VAT transaction of the period it is dated in, so the VAT engine leaves it out of the
 * return's ledger movement (no manual adjustment, no reconciliation difference). One settlement
 * per return (idempotency key); reversing it uses the kernel's reverseBySource.
 */
import type { Request } from "express";
import { DomainError } from "../errors";
import { pool } from "../db";
import { recordAudit } from "../services/audit.service";
import { postJournal, reverseBySource, withLedgerTx, type PostJournalLineInput } from "../ledger";
import { fromFils, toFils } from "../../shared/money";
import { VAT_SETTLEMENT_SOURCE } from "./vat-reconciliation";

export { VAT_SETTLEMENT_SOURCE };

const SETTLEABLE = new Set(["submitted", "filed"]);

interface ReturnRow {
  id: string;
  company_id: string;
  status: string;
  period_start: string;
  period_end: string;
  box12: string;
  box13: string;
  box14: string;
}

async function loadReturn(companyId: string, vatReturnId: string): Promise<ReturnRow> {
  const { rows } = await pool.query(
    `SELECT id, company_id, status, period_start::date::text AS period_start,
            period_end::date::text AS period_end, box12_total_due_tax::text AS box12,
            box13_recoverable_tax::text AS box13, box14_payable_tax::text AS box14
       FROM vat_returns WHERE id = $1 AND company_id = $2`,
    [vatReturnId, companyId]
  );
  if (!rows[0]) throw new DomainError("VAT_RETURN_NOT_FOUND", 404);
  return rows[0] as ReturnRow;
}

async function accountId(companyId: string, code: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND is_active = true LIMIT 1`,
    [companyId, code]
  );
  if (!rows[0]) throw new DomainError("VAT_ACCOUNTS_MISSING", 422, { code });
  return rows[0].id as string;
}

async function assertCashOrBank(companyId: string, id: string): Promise<void> {
  const { rows } = await pool.query(
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

/** The posted, unreversed settlement entry of a return, or null. */
export async function getVatReturnSettlement(companyId: string, vatReturnId: string) {
  await loadReturn(companyId, vatReturnId);
  const { rows } = await pool.query(
    `SELECT id, entry_number AS "entryNumber", to_char(date, 'YYYY-MM-DD') AS date
       FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND source_id = $3 AND status = 'posted'
        AND reversed_by_entry_id IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, VAT_SETTLEMENT_SOURCE, vatReturnId]
  );
  return (rows[0] as { id: string; entryNumber: string; date: string } | undefined) ?? null;
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
  const ret = await loadReturn(input.companyId, input.vatReturnId);
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
  if (await getVatReturnSettlement(input.companyId, ret.id)) {
    throw new DomainError("VAT_RETURN_ALREADY_SETTLED", 409);
  }
  await assertCashOrBank(input.companyId, input.paymentAccountId);
  const [output, inputVat] = await Promise.all([
    accountId(input.companyId, "2020"),
    accountId(input.companyId, "1050"),
  ]);
  // B2 (NH4): an amended return (voluntary disclosure) replaces the figures of the return it
  // amends, but what was already paid or refunded for those returns stays paid. Only the
  // difference is settled now (Exec. Reg. Art. 70: the disclosure states the difference).
  const prior = await settledOnSupersededReturns(input.companyId, ret.id, output, inputVat);
  const outputFils = toFils(ret.box12, { rounding: "halfUp" }) - prior.outputFils;
  const inputFils = toFils(ret.box13, { rounding: "halfUp" }) - prior.inputFils;
  const netFils = outputFils - inputFils;
  if (outputFils === 0 && inputFils === 0) {
    throw new DomainError(
      prior.returnIds.length ? "VAT_AMENDMENT_NOTHING_TO_SETTLE" : "VAT_RETURN_NOTHING_TO_SETTLE",
      422,
      prior.returnIds.length ? { alreadySettledOn: prior.returnIds } : undefined,
      prior.returnIds.length
        ? "The amended return changes no VAT already settled for this period"
        : undefined
    );
  }
  const label = `${prior.returnIds.length ? "Amended VAT return" : "VAT return"} ${ret.period_start} to ${ret.period_end}`;
  const side = (fils: number) => (fils >= 0 ? { debitFils: fils } : { creditFils: -fils });
  const lines: PostJournalLineInput[] = [];
  if (outputFils !== 0)
    lines.push({
      accountId: output,
      ...side(outputFils),
      systemVat: true,
      description: `${label}: output VAT`,
    });
  if (inputFils !== 0)
    lines.push({
      accountId: inputVat,
      ...side(-inputFils),
      systemVat: true,
      description: `${label}: input VAT`,
    });
  if (netFils !== 0)
    lines.push({
      accountId: input.paymentAccountId,
      ...side(-netFils),
      description:
        netFils > 0 ? `${label}: VAT paid to the FTA` : `${label}: VAT refund from the FTA`,
    });
  // B2: one live settlement per return, but a reversed one may be settled again; each attempt
  // gets its own key (the first keeps the original format), so a re-settlement after a reversal
  // posts a new entry instead of replaying the reversed one.
  const earlier = await pool.query(
    `SELECT COUNT(*)::int AS n FROM journal_entries
      WHERE company_id = $1 AND source = $2 AND source_id = $3 AND entry_kind <> 'reversal'`,
    [input.companyId, VAT_SETTLEMENT_SOURCE, ret.id]
  );
  const attempt = Number(earlier.rows[0]?.n ?? 0);
  const { entry } = await postJournal(
    {
      companyId: input.companyId,
      date: input.date,
      memo: `${label} - ${netFils >= 0 ? "VAT payment" : "VAT refund"}`,
      status: "posted",
      source: VAT_SETTLEMENT_SOURCE,
      sourceId: ret.id,
      reference: input.reference ?? null,
      idempotencyKey: `${VAT_SETTLEMENT_SOURCE}:${ret.id}${attempt ? `:${attempt}` : ""}`,
      lines,
    },
    { actorId: input.actorId, audit: true }
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
  });
  return {
    vatReturnId: ret.id,
    journalEntryId: entry.id,
    entryNumber: entry.entryNumber,
    outputVat: Number(fromFils(outputFils)),
    inputVat: Number(fromFils(inputFils)),
    netPayable: Number(fromFils(netFils)),
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
 * chain): the output VAT debited to 2020 and the input VAT credited to 1050 by their live
 * (posted, unreversed) settlement entries. Each earlier settlement on the chain was itself only
 * a difference, so the sum is what has been paid or refunded for the period so far.
 */
async function settledOnSupersededReturns(
  companyId: string,
  vatReturnId: string,
  outputAccountId: string,
  inputAccountId: string
): Promise<{ returnIds: string[]; outputFils: number; inputFils: number }> {
  const { rows } = await pool.query(
    `WITH RECURSIVE chain(id, amends, depth) AS (
       SELECT id, amends_return_id, 0 FROM vat_returns WHERE id = $2 AND company_id = $1
       UNION ALL
       SELECT r.id, r.amends_return_id, c.depth + 1
         FROM vat_returns r JOIN chain c ON r.id = c.amends
        WHERE r.company_id = $1 AND c.depth < 50
     )
     SELECT je.source_id AS return_id,
            COALESCE(SUM(CASE WHEN jl.account_id = $4
                              THEN ROUND(jl.debit * 100) - ROUND(jl.credit * 100) END), 0)::bigint AS output,
            COALESCE(SUM(CASE WHEN jl.account_id = $5
                              THEN ROUND(jl.credit * 100) - ROUND(jl.debit * 100) END), 0)::bigint AS input
       FROM chain c
       JOIN journal_entries je ON je.company_id = $1 AND je.source = $3
                              AND je.source_id = c.id AND je.status = 'posted'
                              AND je.reversed_by_entry_id IS NULL
       JOIN journal_lines jl ON jl.entry_id = je.id
      WHERE c.depth > 0
      GROUP BY je.source_id`,
    [companyId, vatReturnId, VAT_SETTLEMENT_SOURCE, outputAccountId, inputAccountId]
  );
  return {
    returnIds: rows.map((r) => r.return_id as string),
    outputFils: rows.reduce((s, r) => s + Number(r.output), 0),
    inputFils: rows.reduce((s, r) => s + Number(r.input), 0),
  };
}

export async function reverseVatReturnSettlement(input: {
  companyId: string;
  vatReturnId: string;
  date: string;
  reason: string;
  actorId: string;
  req?: Request;
}) {
  const settled = await getVatReturnSettlement(input.companyId, input.vatReturnId);
  if (!settled) throw new DomainError("VAT_RETURN_NOT_SETTLED", 409);
  await withLedgerTx(async (tx) => {
    await reverseBySource(
      input.companyId,
      VAT_SETTLEMENT_SOURCE,
      input.vatReturnId,
      { date: input.date, reason: `VAT settlement reversed: ${input.reason}` },
      { actorId: input.actorId, req: input.req, companyId: input.companyId, tx }
    );
  });
  await recordAudit({
    userId: input.actorId,
    companyId: input.companyId,
    action: "vat.return_settlement.reverse",
    entityType: "vat_return",
    entityId: input.vatReturnId,
    after: { reversedEntryId: settled.id, date: input.date, reason: input.reason },
    req: input.req,
  });
  return { vatReturnId: input.vatReturnId, reversedEntryId: settled.id };
}
