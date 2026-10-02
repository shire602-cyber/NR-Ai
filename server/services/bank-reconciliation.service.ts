// Statement-vs-ledger reconciliation for one bank account, and the sessions that close it.
//
// computeBankReconciliationStatement is the one definition of the report (exported for the reports catalogue):
//   L  = ledger balance of the bank GL account at the as-of day, in the account's currency
//   a statement line is CLEARED when it is dated on or before the day and matched to a ledger entry dated on or before it
//   a ledger entry is ON THE STATEMENT when such a statement line is matched to it
//   lines dated before the account's reconcile_from count as cleared
//   S  = the balance given, else the completed session, else the import's closing balance, else the last running balance

import { dubaiDaySql, dubaiDayTextSql } from "./vat-dubai-day";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  bankReconciliations,
  type BankAccount,
  type BankReconciliation,
} from "../../shared/schema";
import { AppError } from "../errors";
import { storage } from "../storage";
import { LOCK_NS, withDocumentLock } from "./document-lock";
import {
  computeStatementMath,
  type LedgerItem,
  type ReconciliationStatement,
  type StatementBalanceSource,
  type StatementItem,
} from "./bank-reconciliation-math";
import { uaeYmdParts } from "../utils/date";
import { linkedTo } from "./bank-posting-common";
import { getLatestRate } from "./exchange-rate.service";

type Executor = Pick<typeof db, "execute">;
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const err = (status: number, code: string, message: string, details?: unknown) => new AppError({ message, statusCode: status, code, details });
const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
const todayYmd = (): string => {
  const p = uaeYmdParts(new Date());
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

async function requireBankAccount(companyId: string, bankAccountId: string): Promise<BankAccount> {
  const account = await storage.getBankAccountById(bankAccountId);
  if (!account || account.companyId !== companyId) throw err(404, "BANK_ACCOUNT_NOT_FOUND", "Bank account not found");
  return account;
}

async function loadStatement(
  ex: Executor,
  companyId: string,
  account: BankAccount,
  asOf: string,
  statementBalance: number | null | undefined
): Promise<ReconciliationStatement> {
  if (!account.glAccountId) throw err(422, "BANK_GL_NOT_LINKED", "This bank account is not linked to a ledger account.");
  const currency = (account.currency || "AED").toUpperCase();
  const foreign = currency !== "AED";
  const from = account.reconcileFrom ? ymd(account.reconcileFrom) : null;
  // A foreign-currency account is reconciled in its own currency. Lines that carry the foreign amount use it; a line that
  // was keyed in AED only (an opening balance, a plain journal) is converted at the company rate of its day; a
  // revaluation moves AED only and has no foreign amount at all, so it is left out.
  const foreignExpr = sql`CASE WHEN jl.foreign_currency = ${currency} THEN COALESCE(jl.foreign_debit, 0) - COALESCE(jl.foreign_credit, 0) ELSE 0 END`;
  const aedOnlyExpr = sql`CASE WHEN jl.foreign_currency IS NULL OR jl.foreign_currency <> ${currency} THEN jl.debit - jl.credit ELSE 0 END`;
  const rateCache = new Map<string, number | null>();
  const warnings: string[] = [];
  const rateOn = async (day: string): Promise<number | null> => {
    if (!rateCache.has(day)) rateCache.set(day, (await getLatestRate(currency, "AED", new Date(`${day}T00:00:00Z`), companyId)) ?? null);
    return rateCache.get(day) ?? null;
  };

  const ledgerRows = rowsOf(
    await ex.execute(sql`
      SELECT je.id, je.entry_number, ${sql.raw(dubaiDayTextSql("je.date"))} AS day, je.memo, je.source, je.source_id,
             SUM(jl.debit - jl.credit)::float8 AS aed_net,
             SUM(${foreignExpr})::float8 AS f_net,
             SUM(${aedOnlyExpr})::float8 AS a_net,
             EXISTS (SELECT 1 FROM journal_entries rv WHERE rv.reversed_entry_id = je.id AND rv.status = 'posted' AND ${sql.raw(dubaiDaySql("rv.date"))} <= ${asOf}::date) AS reversed,
             (je.reversed_entry_id IS NOT NULL) AS is_reversal,
             EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.company_id = je.company_id AND ${linkedTo("bt", "je")}
                       AND bt.bank_statement_account_id = ${account.id} AND ${sql.raw(dubaiDaySql("bt.transaction_date"))} <= ${asOf}::date) AS cleared
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.entry_id
       WHERE je.company_id = ${companyId} AND je.status = 'posted' AND jl.account_id = ${account.glAccountId}
         AND ${sql.raw(dubaiDaySql("je.date"))} <= ${asOf}::date
       GROUP BY je.id
      HAVING ABS(SUM(jl.debit - jl.credit)) > 0.005 OR ABS(SUM(${foreignExpr})) > 0.005
       ORDER BY je.date, je.entry_number`)
  );
  let ledgerBalance = 0;
  const ledgerItems: LedgerItem[] = [];
  for (const r of ledgerRows) {
    let net = Number(r.aed_net) || 0;
    if (foreign) {
      net = Number(r.f_net) || 0;
      const aedOnly = Number(r.a_net) || 0;
      if (Math.abs(aedOnly) > 0.005 && !String(r.source).startsWith("fx_revaluation")) {
        const rate = await rateOn(r.day);
        if (rate && rate > 0) net += aedOnly / rate;
        else if (!warnings.includes("FX_RATE_MISSING")) warnings.push("FX_RATE_MISSING");
      }
      net = Math.round(net * 100) / 100;
      if (Math.abs(net) < 0.005) continue;
    }
    ledgerBalance += net;
    if (r.cleared || r.reversed || r.is_reversal) continue;
    if (from && r.day < from) continue;
    ledgerItems.push({ entryId: r.id, entryNumber: r.entry_number, date: r.day, memo: r.memo, source: r.source, sourceId: r.source_id, amount: Math.round(net * 100) / 100 });
  }

  const bankRows = rowsOf(
    await ex.execute(sql`
      SELECT bt.id, ${sql.raw(dubaiDayTextSql("bt.transaction_date"))} AS day, bt.description, bt.reference, bt.amount::float8 AS amount, bt.balance::float8 AS balance,
             bt.matched_journal_entry_id, ${sql.raw(dubaiDayTextSql("je.date"))} AS entry_day
        FROM bank_transactions bt
        LEFT JOIN journal_entries je ON je.id = bt.matched_journal_entry_id AND je.company_id = bt.company_id AND je.status = 'posted'
       WHERE bt.company_id = ${companyId} AND bt.bank_statement_account_id = ${account.id}
         AND ${sql.raw(dubaiDaySql("bt.transaction_date"))} <= ${asOf}::date
       ORDER BY bt.transaction_date, bt.created_at`)
  );
  const bankItems: StatementItem[] = [];
  let lastRunning: number | null = null;
  for (const r of bankRows) {
    if (r.balance !== null && r.balance !== undefined) lastRunning = Number(r.balance);
    const cleared = r.matched_journal_entry_id && r.entry_day && r.entry_day <= asOf;
    if (cleared) continue;
    if (from && r.day < from) continue;
    bankItems.push({ transactionId: r.id, date: r.day, description: r.description, reference: r.reference, amount: Number(r.amount) });
  }

  let balance: number | null = null;
  let source: StatementBalanceSource = null;
  if (statementBalance !== undefined && statementBalance !== null) {
    balance = statementBalance;
    source = "param";
  } else {
    const [session] = rowsOf(
      await ex.execute(sql`
        SELECT statement_balance::float8 AS bal FROM bank_reconciliations
         WHERE company_id = ${companyId} AND bank_account_id = ${account.id} AND status = 'completed' AND statement_date = ${asOf}::date
         LIMIT 1`)
    );
    if (session) {
      balance = Number(session.bal);
      source = "session";
    } else {
      const [imp] = rowsOf(
        await ex.execute(sql`
          SELECT closing_balance::float8 AS bal FROM bank_statement_imports
           WHERE company_id = ${companyId} AND bank_account_id = ${account.id} AND status = 'committed'
             AND closing_balance IS NOT NULL AND statement_to <= ${asOf}::date
           ORDER BY statement_to DESC, committed_at DESC LIMIT 1`)
      );
      if (imp) {
        balance = Number(imp.bal);
        source = "import";
      } else if (lastRunning !== null) {
        balance = lastRunning;
        source = "running_balance";
      }
    }
  }

  const result = computeStatementMath({
    bankAccountId: account.id,
    asOf,
    currency,
    statementBalance: balance,
    statementBalanceSource: source,
    ledgerBalance: Math.round(ledgerBalance * 100) / 100,
    bankItems,
    ledgerItems,
  });
  return warnings.length ? { ...result, warnings } : result;
}

/** The two-sided reconciliation statement for one bank account on a day. Exported for the reports catalogue. */
export async function computeBankReconciliationStatement(
  companyId: string,
  bankAccountId: string,
  asOf: string,
  statementBalance?: number | null
): Promise<ReconciliationStatement> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw err(400, "VALIDATION_ERROR", "asOf must be a date (YYYY-MM-DD).");
  const account = await requireBankAccount(companyId, bankAccountId);
  return await loadStatement(db, companyId, account, asOf, statementBalance);
}

// ─── sessions ──────────────────────────────────────────────────────────────

export async function listReconciliations(companyId: string, bankAccountId?: string): Promise<BankReconciliation[]> {
  return await db
    .select()
    .from(bankReconciliations)
    .where(bankAccountId ? and(eq(bankReconciliations.companyId, companyId), eq(bankReconciliations.bankAccountId, bankAccountId)) : eq(bankReconciliations.companyId, companyId))
    .orderBy(desc(bankReconciliations.statementDate), desc(bankReconciliations.completedAt))
    .limit(200);
}

/** Complete a session: difference must be 0; the cleared bank lines are stamped (frozen) with the session id. */
export async function completeReconciliation(args: {
  companyId: string;
  userId: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number;
}): Promise<BankReconciliation> {
  const account = await requireBankAccount(args.companyId, args.bankAccountId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.statementDate)) throw err(400, "VALIDATION_ERROR", "statementDate must be a date (YYYY-MM-DD).");
  if (args.statementDate > todayYmd()) throw err(422, "STATEMENT_DATE_IN_FUTURE", "The statement date cannot be in the future.");

  return await withDocumentLock(account.id, LOCK_NS.BANK_RECONCILIATION, async (tx) => {
    const [latest] = await tx
      .select()
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.bankAccountId, account.id), eq(bankReconciliations.status, "completed")))
      .orderBy(desc(bankReconciliations.statementDate))
      .limit(1);
    if (latest && ymd(latest.statementDate) >= args.statementDate) {
      throw err(409, "RECONCILIATION_OUT_OF_ORDER", `A reconciliation dated ${ymd(latest.statementDate)} is already complete. A new one must be dated after it.`);
    }

    // hold every bank line of the account up to the date while the statement is recomputed and stamped
    await tx.execute(sql`
      SELECT id FROM bank_transactions
       WHERE company_id = ${args.companyId} AND bank_statement_account_id = ${account.id}
         AND ${sql.raw(dubaiDaySql("transaction_date"))} <= ${args.statementDate}::date
       FOR UPDATE`);

    const statement = await loadStatement(tx, args.companyId, account, args.statementDate, args.statementBalance);
    if (statement.difference === null || Math.abs(statement.difference) > 0.005) {
      throw err(422, "RECONCILIATION_NOT_BALANCED", `The adjusted balances differ by ${(statement.difference ?? 0).toFixed(2)}.`, { difference: statement.difference });
    }

    const [session] = await tx
      .insert(bankReconciliations)
      .values({
        companyId: args.companyId,
        bankAccountId: account.id,
        statementDate: args.statementDate,
        statementBalance: args.statementBalance,
        ledgerBalance: statement.ledgerBalance,
        status: "completed",
        snapshot: statement,
        completedBy: args.userId,
      })
      .returning();

    await tx.execute(sql`
      UPDATE bank_transactions bt SET reconciliation_id = ${session.id}
        FROM journal_entries je
       WHERE bt.company_id = ${args.companyId} AND bt.bank_statement_account_id = ${account.id}
         AND bt.reconciliation_id IS NULL AND bt.matched_journal_entry_id = je.id
         AND ${sql.raw(dubaiDaySql("bt.transaction_date"))} <= ${args.statementDate}::date AND ${sql.raw(dubaiDaySql("je.date"))} <= ${args.statementDate}::date`);
    return session;
  });
}

/** Reopen the latest completed session of the account and release its bank lines. */
export async function reopenReconciliation(args: { companyId: string; userId: string; reconciliationId: string }): Promise<BankReconciliation> {
  const [existing] = await db
    .select()
    .from(bankReconciliations)
    .where(and(eq(bankReconciliations.id, args.reconciliationId), eq(bankReconciliations.companyId, args.companyId)));
  if (!existing) throw err(404, "RECONCILIATION_NOT_FOUND", "Reconciliation not found");

  return await withDocumentLock(existing.bankAccountId, LOCK_NS.BANK_RECONCILIATION, async (tx) => {
    const [fresh] = await tx.select().from(bankReconciliations).where(eq(bankReconciliations.id, existing.id));
    if (!fresh || fresh.status !== "completed") throw err(409, "NOT_COMPLETED", "Only a completed reconciliation can be reopened.");
    const [latest] = await tx
      .select()
      .from(bankReconciliations)
      .where(and(eq(bankReconciliations.bankAccountId, fresh.bankAccountId), eq(bankReconciliations.status, "completed")))
      .orderBy(desc(bankReconciliations.statementDate))
      .limit(1);
    if (!latest || latest.id !== fresh.id) {
      throw err(409, "NOT_LATEST", "Only the latest completed reconciliation of the account can be reopened.");
    }
    await tx.execute(sql`UPDATE bank_transactions SET reconciliation_id = NULL WHERE reconciliation_id = ${fresh.id} AND company_id = ${args.companyId}`);
    const [saved] = await tx
      .update(bankReconciliations)
      .set({ status: "reopened", reopenedBy: args.userId, reopenedAt: new Date() })
      .where(eq(bankReconciliations.id, fresh.id))
      .returning();
    return saved;
  });
}


