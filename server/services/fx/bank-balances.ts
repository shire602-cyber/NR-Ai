/**
 * Bank-account balances in account currency and company base currency (W5-C: R14-16).
 *
 * A bank account carries a currency (bank_accounts.currency). Its balance comes from posted
 * journal lines on the linked GL account (closing entries excluded):
 *  - base balance: debit − credit of every line (the GL figure);
 *  - currency balance: base-currency account → the base balance; foreign account → the
 *    foreign_debit − foreign_credit of lines tagged with that currency (lines without a foreign
 *    amount, e.g. a revaluation adjustment, change the base balance only).
 * For a foreign account the balance is also remeasured at the closing rate (spot fallback) as
 * of `asOf`; the difference to the book base balance is the unrealised FX the revaluation run
 * (server/services/fx/revaluation.ts) would post for that account.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { NOT_CLOSING_SQL, ENTRY_LOCAL_DATE_SQL } from "../../reporting";
import { filsToNumber, mulRate, toFils } from "../../../shared/money";
import { DomainError } from "../../errors";
import { getCompanyBaseCurrency, getRate } from "./rates";

export interface BankAccountBalance {
  bankAccountId: string;
  name: string;
  bankName: string;
  currency: string;
  baseCurrency: string;
  isForeign: boolean;
  glAccountId: string | null;
  balance: number;
  baseBalance: number;
  revaluedBaseBalance: number | null;
  unrealisedGainLoss: number | null;
  rate: { rate: string; date: string; source: string; rateType: string; stale: boolean } | null;
  warning?: string;
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? (r as Row[])) as Row[];
const fils = (v: unknown): number =>
  v === null || v === undefined ? 0 : toFils(String(v), { rounding: "halfUp" });

export async function bankAccountBalances(
  companyId: string,
  asOfIso: string
): Promise<{ asOf: string; baseCurrency: string; accounts: BankAccountBalance[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfIso))
    throw new DomainError("INVALID_DATE", 400, { asOf: asOfIso });
  const base = await getCompanyBaseCurrency(companyId);
  const rows = rowsOf(
    await db.execute(sql`
      SELECT ba.id, ba.name_en, ba.bank_name, UPPER(ba.currency) AS currency, ba.gl_account_id,
             COALESCE(SUM(jl.debit - jl.credit), 0) AS base_balance,
             COALESCE(SUM(CASE WHEN UPPER(COALESCE(jl.foreign_currency, '')) = UPPER(ba.currency)
                               THEN COALESCE(jl.foreign_debit, 0) - COALESCE(jl.foreign_credit, 0)
                               ELSE 0 END), 0) AS foreign_balance
        FROM bank_accounts ba
        LEFT JOIN (journal_lines jl
                   JOIN journal_entries je ON je.id = jl.entry_id
                    AND je.company_id = ${companyId}
                    AND je.status = 'posted'
                    AND ${sql.raw(NOT_CLOSING_SQL)}
                    AND ${sql.raw(ENTRY_LOCAL_DATE_SQL)} <= ${asOfIso}::date)
               ON jl.account_id = ba.gl_account_id
       WHERE ba.company_id = ${companyId}
         AND ba.is_active = true
       GROUP BY ba.id, ba.name_en, ba.bank_name, ba.currency, ba.gl_account_id
       ORDER BY ba.name_en`)
  );
  const out: BankAccountBalance[] = [];
  for (const r of rows) {
    const currency = String(r.currency || base);
    const isForeign = currency !== base;
    const baseFils = fils(r.base_balance);
    const curFils = isForeign ? fils(r.foreign_balance) : baseFils;
    const item: BankAccountBalance = {
      bankAccountId: String(r.id),
      name: String(r.name_en ?? ""),
      bankName: String(r.bank_name ?? ""),
      currency,
      baseCurrency: base,
      isForeign,
      glAccountId: r.gl_account_id ? String(r.gl_account_id) : null,
      balance: filsToNumber(curFils),
      baseBalance: filsToNumber(baseFils),
      revaluedBaseBalance: isForeign ? null : filsToNumber(baseFils),
      unrealisedGainLoss: isForeign ? null : 0,
      rate: null,
    };
    if (isForeign) {
      try {
        const rate = await getRate(companyId, currency, base, asOfIso, { rateType: "closing" });
        const sign = curFils < 0 ? -1 : 1;
        const revalued = sign * mulRate(Math.abs(curFils), rate.rateText);
        item.revaluedBaseBalance = filsToNumber(revalued);
        item.unrealisedGainLoss = filsToNumber(revalued - baseFils);
        item.rate = {
          rate: rate.rateText,
          date: rate.date,
          source: rate.source,
          rateType: rate.rateType,
          stale: rate.stale,
        };
        if (rate.warning) item.warning = rate.warning;
      } catch (err) {
        if (!(err instanceof DomainError) || err.code !== "NO_EXCHANGE_RATE") throw err;
        item.warning = `No ${currency}→${base} rate on or before ${asOfIso}.`;
      }
    }
    out.push(item);
  }
  return { asOf: asOfIso, baseCurrency: base, accounts: out };
}
