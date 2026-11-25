/**
 * X5 (J1 D1): which cash/bank GL account a payment posts to when the caller does not choose one.
 *
 * A payment must land on a real, postable bank or cash leaf account so the bank line can be
 * matched. The default is the company's primary bank account's GL (the earliest active managed
 * bank account, preferring one in the payment currency), never the generic "1020 Bank Accounts"
 * account once the company has its own bank accounts. Cash payments default to 1010.
 * Header accounts (accounts that have sub-accounts) never receive postings: the ledger kernel
 * refuses them (ACCOUNT_IS_HEADER).
 */
import { sql } from "drizzle-orm";
import { db, pool, rowsFromResult } from "../db";
import { ACCOUNT_CODES } from "../constants";

export interface PaymentAccountRow {
  id: string;
  code: string;
  nameEn: string;
  subType: string | null;
}

/** Active, non-archived cash/bank asset accounts that have no active sub-accounts. */
export async function postableCashBankAccounts(
  companyId: string,
  executor = db
): Promise<PaymentAccountRow[]> {
  return rowsFromResult<PaymentAccountRow & Record<string, unknown>>(
    await executor.execute(
      sql`SELECT a.id, a.code, a.name_en AS "nameEn", a.sub_type AS "subType"
       FROM accounts a
      WHERE a.company_id = ${companyId} AND a.type = 'asset' AND a.sub_type IN ('cash', 'bank')
        AND a.is_active = true AND a.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM accounts c
                         WHERE c.parent_id = a.id AND c.company_id = a.company_id
                           AND c.is_archived = false)
      ORDER BY a.code`
    )
  );
}

/**
 * GL account id of the company's primary bank account: the earliest active managed bank account
 * (preferring `currency` when given) whose GL account is postable. Null when the company has no
 * managed bank account.
 */
export async function primaryBankGlAccountId(
  companyId: string,
  currency?: string | null,
  executor = db
): Promise<string | null> {
  const [row] = rowsFromResult<{ id: string }>(
    await executor.execute(
      sql`SELECT ba.gl_account_id AS id, ba.currency
       FROM bank_accounts ba
       JOIN accounts a ON a.id = ba.gl_account_id AND a.company_id = ba.company_id
      WHERE ba.company_id = ${companyId} AND ba.is_active = true
        AND a.is_active = true AND a.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM accounts c
                         WHERE c.parent_id = a.id AND c.company_id = a.company_id
                           AND c.is_archived = false)
      ORDER BY (ba.currency = COALESCE(${currency ?? null}, ba.currency)) DESC, ba.created_at ASC, ba.id ASC`
    )
  );
  return row?.id ?? null;
}

/**
 * The default cash/bank account for a payment: cash method → 1010 (when postable), otherwise the
 * primary bank account's GL, otherwise the first postable bank account (1020 on a fresh chart),
 * otherwise any postable cash account. Null when the chart has none.
 */
export async function defaultPaymentAccountId(
  companyId: string,
  opts: { method?: string | null; currency?: string | null } = {},
  executor = db
): Promise<string | null> {
  const postable = await postableCashBankAccounts(companyId, executor);
  if (opts.method === "cash") {
    const cash = postable.find((a) => a.code === ACCOUNT_CODES.CASH);
    if (cash) return cash.id;
  }
  const primary = await primaryBankGlAccountId(companyId, opts.currency, executor);
  if (primary) return primary;
  const bank =
    postable.find((a) => a.code === ACCOUNT_CODES.BANK) ??
    postable.find((a) => a.subType === "bank");
  return (bank ?? postable[0])?.id ?? null;
}

/** True when the account has active sub-accounts (a header: summarises, never posted to). */
export async function isHeaderAccount(companyId: string, accountId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM accounts WHERE company_id = $1 AND parent_id = $2 AND is_archived = false LIMIT 1`,
    [companyId, accountId]
  );
  return rows.length > 0;
}
