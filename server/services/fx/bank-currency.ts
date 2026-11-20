/**
 * A2 (C4, IAS 21.21-23): the cash leg of a payment or receipt is measured in the bank account's
 * own currency. A bank account (bank_accounts.currency, linked by gl_account_id) only ever holds
 * money in that currency, so the journal line on its GL account carries the foreign amount in
 * the bank's currency, never in the document's:
 *
 *   bank = base currency         no foreign tag; the base amount is the bank amount.
 *   bank = document currency     tagged with the document amount at the payment-date rate.
 *   bank = a third currency      converted explicitly: the base amount (document amount at the
 *                                payment-date rate, or the bank amount actually debited at the
 *                                bank currency's rate) and its bank-currency equivalent at the
 *                                bank currency's payment-date rate. A EUR bill paid from a USD
 *                                account debits USD (EUR -> AED -> USD), never "EUR on a USD
 *                                account", so the USD balance and its revaluation stay true.
 *
 * Without a bank-currency rate on file the payment is refused with a clear message rather than
 * booked against the wrong currency.
 */
import Decimal from "decimal.js";
import { pool } from "../../db";
import { DomainError } from "../../errors";
import { fromFils, mulRate } from "../../../shared/money";
import { getRate } from "./rates";

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** Currency of the bank account linked to a GL account; null for cash / unlinked accounts. */
export async function bankCurrencyOf(
  companyId: string,
  glAccountId: string,
  q: Queryable = pool
): Promise<string | null> {
  const { rows } = await q.query(
    `SELECT UPPER(currency) AS currency FROM bank_accounts
      WHERE company_id = $1 AND gl_account_id = $2
      ORDER BY is_active DESC, created_at LIMIT 1`,
    [companyId, glAccountId]
  );
  const cur = (rows[0] as { currency?: string | null } | undefined)?.currency;
  return cur ? String(cur) : null;
}

export interface CashLeg {
  /** Base-currency amount of the cash line (fils). */
  cashBaseFils: number;
  /** Currency the bank account holds. */
  bankCurrency: string;
  /** Foreign tag for the cash line; null when the bank holds the base currency. */
  tag: { foreignCurrency: string; amount: string; exchangeRate: string } | null;
}

/** Resolve the bank currency's rate to base on `date`, refusing clearly when none is on file. */
export async function bankRateOn(
  companyId: string,
  bankCurrency: string,
  base: string,
  date: string,
  docCurrency: string
): Promise<string> {
  try {
    const r = await getRate(companyId, bankCurrency, base, date);
    return r.rateText;
  } catch (err) {
    if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") {
      throw new DomainError(
        "BANK_CURRENCY_RATE_REQUIRED",
        422,
        { bankCurrency, documentCurrency: docCurrency, date },
        `This ${bankCurrency} account can only pay or receive ${bankCurrency}. To settle a ` +
          `${docCurrency} document from it, add a ${bankCurrency} to ${base} rate for ${date} ` +
          `(or send bank_exchange_rate), or choose a ${docCurrency} or ${base} account.`
      );
    }
    throw err;
  }
}

/**
 * The cash leg of a settlement of `docAmountFils` (document currency) at `docRate` (document
 * currency -> base, "1" for a base document).
 */
export async function cashLegFor(args: {
  companyId: string;
  base: string;
  bankCurrency: string | null;
  docCurrency: string;
  docAmountFils: number;
  docRate: string;
  date: string;
  /** Amount the bank actually moved, in the bank currency (fils); third-currency only. */
  bankAmountFils?: number | null;
  /** Bank currency -> base rate on the payment date; default fx.getRate. */
  bankRate?: string | null;
}): Promise<CashLeg> {
  const base = args.base.toUpperCase();
  const doc = args.docCurrency.toUpperCase();
  const bank = (args.bankCurrency ?? base).toUpperCase();
  const docBase = doc === base ? args.docAmountFils : mulRate(args.docAmountFils, args.docRate);
  if (bank === base) {
    return { cashBaseFils: docBase, bankCurrency: bank, tag: null };
  }
  if (bank === doc) {
    return {
      cashBaseFils: docBase,
      bankCurrency: bank,
      tag: {
        foreignCurrency: bank,
        amount: fromFils(args.docAmountFils),
        exchangeRate: args.docRate,
      },
    };
  }
  const rate = args.bankRate || (await bankRateOn(args.companyId, bank, base, args.date, doc));
  let bankFils: number;
  let cashBaseFils: number;
  if (args.bankAmountFils && args.bankAmountFils > 0) {
    bankFils = args.bankAmountFils;
    cashBaseFils = mulRate(bankFils, rate);
  } else {
    cashBaseFils = docBase;
    bankFils = new Decimal(docBase).div(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
  return {
    cashBaseFils,
    bankCurrency: bank,
    tag: { foreignCurrency: bank, amount: fromFils(bankFils), exchangeRate: rate },
  };
}
