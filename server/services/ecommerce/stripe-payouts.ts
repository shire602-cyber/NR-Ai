/**
 * Stripe payouts adapter (W5-B, R19-03, R19-14). Uses the merchant's own
 * Stripe secret or restricted key (read access to balance transactions).
 * Connect verifies the key with GET /v1/balance; sync imports balance
 * transactions (charges, refunds, fees, payouts) as bank-style rows on a
 * "Stripe balance" bank account so they reconcile like any bank line.
 * Idempotent by balance-transaction id.
 */
import { pq } from "../connectors/pq";
import { ecommerceHttp } from "./http";
import { PlatformAuthError, PlatformError, type AdapterContext, type SyncCounts } from "./types";

const API = "https://api.stripe.com/v1";

/** Currencies Stripe expresses without minor units. */
const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

export function minorToMajor(amount: number, currency: string): string {
  if (ZERO_DECIMAL.has(currency.toUpperCase())) return String(amount);
  const neg = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

async function stripeGet(key: string, path: string) {
  const res = await ecommerceHttp()(`${API}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new PlatformAuthError("Stripe rejected the API key");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new PlatformError(`Stripe API returned HTTP ${res.status}`);
  }
  return res;
}

export async function verifyStripeKey(key: string): Promise<{ name: string }> {
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{8,}$/.test(key)) {
    throw new PlatformAuthError("Not a Stripe secret or restricted key");
  }
  const res = await stripeGet(key, "/balance");
  const livemode = (res.body as { livemode?: boolean })?.livemode;
  if (typeof livemode !== "boolean") throw new PlatformError("Unexpected Stripe balance response");
  return { name: livemode ? "Stripe (live)" : "Stripe (test mode)" };
}

interface BalanceTransaction {
  id: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  type: string;
  created: number;
  description?: string | null;
  status?: string;
  source?: string | null;
}

async function stripeBankAccount(companyId: string, currency: string): Promise<string> {
  const name = `Stripe balance (${currency})`;
  const found = await pq<{ id: string }>(
    `SELECT id FROM bank_accounts WHERE company_id = $1 AND bank_name = 'Stripe' AND currency = $2 LIMIT 1`,
    [companyId, currency]
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await pq<{ id: string }>(
    `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, is_active, opening_balance)
          VALUES ($1, $2, 'Stripe', $3, true, 0) RETURNING id`,
    [companyId, name, currency]
  );
  return created.rows[0].id;
}

async function insertBankLine(
  companyId: string,
  bankAccountId: string,
  externalId: string,
  date: Date,
  description: string,
  amount: string
): Promise<string> {
  const { rows } = await pq<{ id: string }>(
    `INSERT INTO bank_transactions
       (company_id, bank_statement_account_id, transaction_date, description, amount, reference,
        import_source, external_id, is_reconciled, match_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'stripe', $6, false, 'unmatched') RETURNING id`,
    [companyId, bankAccountId, date, description.slice(0, 500), amount, externalId]
  );
  return rows[0].id;
}

export async function syncStripePayouts(ctx: AdapterContext): Promise<SyncCounts> {
  const counts: SyncCounts = { imported: 0, skipped: 0, documents: 0, pending: 0 };
  const key = ctx.credentials.apiKey!;
  const since = ctx.integration.lastSyncAt
    ? `&created[gte]=${Math.floor(new Date(ctx.integration.lastSyncAt).getTime() / 1000) - 3600}`
    : "";
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const res = await stripeGet(key, `/balance_transactions?limit=100${since}${cursor}`);
    const body = res.body as { data?: BalanceTransaction[]; has_more?: boolean };
    const data = body?.data ?? [];
    for (const bt of data) {
      const currency = bt.currency.toUpperCase();
      const date = new Date(bt.created * 1000);
      const inserted = await ctx.recordTransaction({
        externalId: bt.id,
        transactionType: bt.type,
        amount: minorToMajor(bt.amount, currency),
        currency,
        description: bt.description || `Stripe ${bt.type}`,
        status: bt.status ?? "available",
        transactionDate: date.toISOString(),
        platformFees: minorToMajor(bt.fee, currency),
        netAmount: minorToMajor(bt.net, currency),
        metadata: { source: bt.source ?? null, type: bt.type },
      });
      if (!inserted) {
        counts.skipped++;
        continue;
      }
      counts.imported++;
      const accountId = await stripeBankAccount(ctx.companyId, currency);
      const lineId = await insertBankLine(
        ctx.companyId,
        accountId,
        bt.id,
        date,
        `Stripe ${bt.type}${bt.description ? `: ${bt.description}` : ""}`,
        minorToMajor(bt.amount, currency)
      );
      await ctx.linkBankTransaction(bt.id, lineId);
      if (bt.fee > 0) {
        await insertBankLine(
          ctx.companyId,
          accountId,
          `${bt.id}:fee`,
          date,
          `Stripe fee for ${bt.id}`,
          minorToMajor(-bt.fee, currency)
        );
      }
      counts.documents++;
    }
    if (!body?.has_more || !data.length) break;
    cursor = `&starting_after=${encodeURIComponent(data[data.length - 1].id)}`;
  }
  return counts;
}
