/**
 * Loop 2 follow-up to #214: an invoice payment received at a raw instant 2026-11-27T21:30Z (the
 * Dubai day is 28 Nov) books its journal, reads its FX rate, reads its bank-currency rate and
 * dates a write-off reinstatement on that one Dubai day. The invoice_payments row keeps the
 * instant. Receipt posting computes its entry date once for the entry and the FX lookup.
 */
import { afterEach, expect, it, vi } from "vitest";
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
