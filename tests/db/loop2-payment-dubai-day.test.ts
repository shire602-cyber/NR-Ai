/**
 * Loop 2 follow-up to #214: an invoice payment received at a raw instant 2026-11-27T21:30Z (the
 * Dubai day is 28 Nov) books its journal, reads its FX rate, reads its bank-currency rate and
 * dates a write-off reinstatement on that one Dubai day. The invoice_payments row keeps the
 * instant. Receipt posting computes its entry date once for the entry and the FX lookup.
 */
import { afterEach, expect, it, vi } from "vitest";
import { ACCOUNT_CODES } from "../../server/constants";
import { accountByCode, freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
const INSTANT = new Date("2026-11-27T21:30:00Z");
const NOW = "2026-11-28T08:00:00Z";
let thaw: (() => void) | null = null;
afterEach(() => {
  thaw?.();
  thaw = null;
  vi.restoreAllMocks();
});

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function issue(t: Tenant, extra: Record<string, unknown> = {}): Promise<string> {
  const draft = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme",
    date: "2026-11-20",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Services", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    ...extra,
  });
  expect(draft.status, draft.text).toBe(200);
  const issued = await t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  return draft.body.id;
}

const day = (col: string) => `to_char(${col}::date, 'YYYY-MM-DD')`;

it("payment at 2026-11-27T21:30Z: journal, FX rate and bank rate all use 2026-11-28", async () => {
  thaw = freezeTime(NOW);
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  for (const [cur, d, r] of [
    ["USD", "2026-11-27", 3.6],
    ["USD", "2026-11-28", 3.7],
    ["EUR", "2026-11-27", 4.0],
    ["EUR", "2026-11-28", 4.1],
  ] as const) {
    await h.sql(
      `INSERT INTO exchange_rates (company_id, base_currency, target_currency, rate, date, source)
       VALUES ($1, $2, 'AED', $3, $4, 'manual')`,
      [t.company.id, cur, r, d]
    );
  }
  const gl = await h.sql<{ id: string }>(
    `INSERT INTO accounts (company_id, code, name_en, type, sub_type, is_active)
     VALUES ($1, '1026', 'EUR Current Account', 'asset', 'bank', true) RETURNING id`,
    [t.company.id]
  );
  await h.sql(
    `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
     VALUES ($1, 'EUR Current', 'FAB', 'EUR', $2)`,
    [t.company.id, gl[0].id]
  );
  const invoiceId = await issue(t, { currency: "USD", exchangeRate: 3.6725 });

  const { recordInvoicePayment } = await import("../../server/services/invoice-payment.service");
  const { payment } = await recordInvoicePayment({
    invoiceId,
    companyId: t.company.id,
    amount: 100,
    date: INSTANT,
    method: "bank",
    paymentAccountId: gl[0].id,
    createdBy: t.user.id,
  } as never);

  const [row] = await h.sql<{ entry: string; instant: string; rate: string }>(
    `SELECT journal_entry_id AS entry, to_char(date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS instant,
            exchange_rate::text AS rate
       FROM invoice_payments WHERE id = $1`,
    [payment.id]
  );
  // The settlement row keeps the instant; the journal and both rates use the Dubai day.
  expect(row.instant).toBe("2026-11-27T21:30");
  const [je] = await h.sql<{ d: string }>(
    `SELECT ${day("date")} AS d FROM journal_entries WHERE id = $1`,
    [row.entry]
  );
  expect(je.d).toBe("2026-11-28");
  // Invoice-currency (USD) rate of 28 Nov, not 27 Nov.
  expect(Number(row.rate)).toBe(3.7);
  // Bank-currency (EUR) rate of 28 Nov on the cash leg, not 27 Nov.
  const [cash] = await h.sql<{ rate: string }>(
    `SELECT jl.exchange_rate::text AS rate FROM journal_lines jl
      WHERE jl.entry_id = $1 AND jl.account_id = $2`,
    [row.entry, gl[0].id]
  );
  expect(Number(cash.rate)).toBe(4.1);

  // Money, to the fil. Expected values are worked by hand below, not by the production rounding.
  const lines = await h.sql<{ account_id: string; debit: string; credit: string }>(
    `SELECT account_id, debit::text AS debit, credit::text AS credit
       FROM journal_lines WHERE entry_id = $1`,
    [row.entry]
  );
  // Independent text -> fils parse (amounts are stored with two decimals).
  const fils = (v: string) => {
    const [whole, frac = ""] = v.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  };
  const debits = lines.reduce((s, l) => s + fils(l.debit), 0);
  const credits = lines.reduce((s, l) => s + fils(l.credit), 0);
  expect(debits).toBe(credits);
  expect(debits).toBeGreaterThan(0);

  // Cash leg: 100.00 USD x 3.7 (the 28 Nov USD rate) = 370.00 AED = 37000 fils.
  const cashLine = lines.find((l) => l.account_id === gl[0].id)!;
  expect(fils(cashLine.debit)).toBe(37000);
  // A/R is relieved at the rate the invoice was booked at (3.6725), not the payment-day rate:
  // 10000 fils x 3.6725 = 36725 fils exactly (no rounding needed).
  const [ar] = await h.sql<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = '1040'`,
    [t.company.id]
  );
  const arLines = lines.filter((l) => l.account_id === ar.id);
  expect(arLines).toHaveLength(1);
  expect(fils(arLines[0].credit)).toBe(36725);
  expect(fils(arLines[0].debit)).toBe(0);
  // Realised FX: cash AED 37000 - A/R relieved 36725 = 275 fils gain, a credit.
  const fxAccount = await accountByCode(t, ACCOUNT_CODES.FX_GAIN);
  const fxLines = lines.filter((l) => l.account_id === fxAccount.id);
  expect(fxLines).toHaveLength(1);
  expect(fils(fxLines[0].credit)).toBe(37000 - 36725);
  expect(fils(fxLines[0].debit)).toBe(0);
  // Cash leg in the bank's own currency: 370.00 AED / 4.1 = 90.2439 EUR. cashTag (server/storage/sales.ts) divides and
  // rounds half-up to whole fils (the foreign amount is stored with two decimals): 90.24.
  const [cashForeign] = await h.sql<{ fd: string }>(
    `SELECT foreign_debit::text AS fd FROM journal_lines WHERE entry_id = $1 AND account_id = $2`,
    [row.entry, gl[0].id]
  );
  expect(fils(cashForeign.fd)).toBe(9024);
  expect(lines).toHaveLength(3);
});

it("a receipt after a write-off reinstates on the Dubai day of the payment instant", async () => {
  thaw = freezeTime(NOW);
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  const bank = await accountByCode(t, "1020");
  const invoiceId = await issue(t);
  const wo = await t.as.post(`${base(t)}/invoices/${invoiceId}/write-off`, {
    date: "2026-11-27",
    reason: "uncollectable",
  });
  expect(wo.status, wo.text).toBeLessThan(300);

  const { recordInvoicePayment } = await import("../../server/services/invoice-payment.service");
  await recordInvoicePayment({
    invoiceId,
    companyId: t.company.id,
    amount: 1050,
    date: INSTANT,
    method: "bank",
    paymentAccountId: bank.id,
    createdBy: t.user.id,
  } as never);

  const rows = await h.sql<{ d: string; method: string }>(
    `SELECT ${day("date")} AS d, method FROM invoice_payments WHERE invoice_id = $1`,
    [invoiceId]
  );
  const reinstated = rows.find((r) => r.method === "write_off_reinstatement");
  expect(reinstated?.d).toBe("2026-11-28");
  const [rev] = await h.sql<{ d: string }>(
    `SELECT ${day("je.date")} AS d FROM journal_entries je
      WHERE je.company_id = $1 AND je.source = 'payment_reversal' AND je.source_id = $2`,
    [t.company.id, invoiceId]
  );
  expect(rev.d).toBe("2026-11-28");
});

it("receiptEntryDate reads the clock once: the entry date is the Dubai day", async () => {
  const { receiptEntryDate } = await import("../../server/services/receipt-posting.service");
  const entry = receiptEntryDate({ date: null }, new Date("2026-11-27T21:30:00Z"));
  expect(entry.toISOString()).toBe("2026-11-28T00:00:00.000Z");
});

it("resolveReceiptRate reads the Dubai-day rate for a raw instant (27 Nov 21:30Z -> 28 Nov)", async () => {
  thaw = freezeTime(NOW);
  const t = await h.createTenant({ companyColumns: { emirate: "dubai" } });
  for (const [d, r] of [
    ["2026-11-27", 3.6],
    ["2026-11-28", 3.7],
  ] as const) {
    await h.sql(
      `INSERT INTO exchange_rates (company_id, base_currency, target_currency, rate, date, source)
       VALUES ($1, 'USD', 'AED', $2, $3, 'manual')`,
      [t.company.id, r, d]
    );
  }
  const { resolveReceiptRate, receiptEntryDate, postReceipt } =
    await import("../../server/services/receipt-posting.service");

  // The raw instant goes straight in: the lookup must use the Dubai day, not the UTC slice.
  const quote = await resolveReceiptRate(t.company.id, "USD", INSTANT, null);
  expect(quote.source).toBe("lookup");
  expect(quote.rate).toBe(3.7);

  // End to end: a foreign-currency receipt dated at that instant posts on 28 Nov at that rate.
  expect(receiptEntryDate({ date: INSTANT }).toISOString()).toBe(INSTANT.toISOString());
  const expense = await accountByCode(t, "5010");
  const bank = await accountByCode(t, "1020");
  const draft = await t.as.post(`${base(t)}/receipts`, {
    date: INSTANT.toISOString(),
    amount: 100,
    currency: "USD",
  });
  expect(draft.status, draft.text).toBe(200);
  // The route trims a receipt date to its calendar day; set the raw instant on the stored row.
  await h.sql(`UPDATE receipts SET date = $1 WHERE id = $2`, [
    INSTANT.toISOString(),
    draft.body.id,
  ]);
  const posted = await postReceipt(draft.body, t.user.id, {
    accountId: expense.id,
    paymentAccountId: bank.id,
  });
  expect(Number(posted.receipt.exchangeRate)).toBe(3.7);
  expect(posted.receipt.baseCurrencyAmount).toBe(370);
  // The ledger keeps the instant; reports bucket it by its Dubai day (localDateSql = UTC+4).
  const [je] = await h.sql<{ d: string; instant: string }>(
    `SELECT to_char((je.date + interval '4 hours')::date, 'YYYY-MM-DD') AS d,
            to_char(je.date, 'YYYY-MM-DD"T"HH24:MI') AS instant
       FROM journal_entries je
      WHERE je.company_id = $1 AND je.source = 'receipt'`,
    [t.company.id]
  );
  expect(je.instant).toBe("2026-11-27T21:30");
  expect(je.d).toBe("2026-11-28");
});
