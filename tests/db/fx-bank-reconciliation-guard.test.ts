/**
 * FX reconciliation guard (WS3): a bank account whose currency differs from the company base
 * currency reconciles in the account currency from the ledger's foreign amounts, or is refused
 * with 409 FX_RECONCILIATION_UNSUPPORTED. An AED GL balance is never compared with a foreign
 * statement balance and "reconciled" is never saved on a mismatch.
 */
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness, type Tenant } from "./harness";

const h = useHarness();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function usdBank(t: Tenant): Promise<{ glId: string; bankId: string }> {
  const gl = await h.sql<{ id: string }>(
    `INSERT INTO accounts (company_id, code, name_en, type, sub_type, is_active)
     VALUES ($1, '1025', 'USD Current Account', 'asset', 'bank', true) RETURNING id`,
    [t.company.id]
  );
  const ba = await h.sql<{ id: string }>(
    `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
     VALUES ($1, 'USD Current', 'FAB', 'USD', $2) RETURNING id`,
    [t.company.id, gl[0].id]
  );
  return { glId: gl[0].id, bankId: ba[0].id };
}

/** A 1,000 USD invoice settled with a 1,050 USD receipt: one posted line with foreign amounts. */
async function usdReceipt(t: Tenant, glId: string) {
  const rate = await t.as.post(`${base(t)}/exchange-rates`, {
    fromCurrency: "USD",
    toCurrency: "AED",
    rate: 3.65,
    effectiveDate: daysAgo(40),
  });
  expect(rate.status, rate.text).toBe(201);
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Globex",
    date: daysAgo(30),
    currency: "USD",
    exchangeRate: 3.65,
    lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  expect((await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status).toBe(
    200
  );
  const pay = await t.as.post(`${base(t)}/invoices/${inv.body.id}/payments`, {
    amount: 1050,
    date: daysAgo(20),
    method: "bank",
    paymentAccountId: glId,
    exchangeRate: 3.65,
  });
  expect(pay.status, pay.text).toBe(201);
}

describe("WS3 FX bank reconciliation guard", () => {
  it("reconciles a USD account in USD and labels every output USD", async () => {
    const t = await h.createTenant({ name: "FxRecon" });
    const { glId, bankId } = await usdBank(t);
    await usdReceipt(t, glId);
    const q = (bal: string) =>
      `${base(t)}/bank-accounts/${bankId}/reconciliation-statement?periodEnd=${daysAgo(1)}&statementClosingBalance=${bal}`;

    // The receipt is not on the bank statement yet: deposit in transit 1,050.00 USD, so a USD
    // statement of 0.00 ties to zero and the GL balance is in USD (not 3,832.50 AED).
    const ok = await t.as.get(q("0.00"));
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({
      currency: "USD",
      glBalanceFils: 105000,
      depositsInTransitFils: 105000,
      differenceFils: 0,
    });
    expect(ok.body.totals.glBalance).toBe("1050.00");

    // A statement balance equal to the book figure is a real mismatch, not an AED/USD mix-up.
    const off = await t.as.get(q("1050.00"));
    expect(off.status, off.text).toBe(200);
    expect(off.body.differenceFils).toBe(105000);

    const draft = await t.as.post(`${base(t)}/bank-accounts/${bankId}/reconciliations`, {
      periodEnd: daysAgo(1),
      statementClosingBalance: "0.00",
    });
    expect(draft.status, draft.text).toBe(201);
    expect(draft.body.statement.currency).toBe("USD");
    const signed = await t.as.post(`${base(t)}/bank-reconciliations/${draft.body.id}/sign-off`, {});
    expect(signed.status, signed.text).toBe(200);

    // Imported after the harness is up: the service module opens the database at load.
    const { reconciliationSheets } =
      await import("../../server/services/bank-reconciliation.service");
    const sheets = reconciliationSheets(draft.body.statement, {
      status: "signed_off",
      signedOffAt: new Date(),
    });
    expect(sheets[0].columns[1].header).toBe("USD");
    for (const format of ["pdf", "xlsx"]) {
      const ex = await t.as.get(
        `${base(t)}/bank-reconciliations/${draft.body.id}/export?format=${format}`
      );
      expect(ex.status, ex.text).toBe(200);
    }

    // A mismatching draft can never be signed off.
    const bad = await t.as.post(`${base(t)}/bank-accounts/${bankId}/reconciliations`, {
      periodEnd: daysAgo(1),
      statementClosingBalance: "1050.00",
    });
    expect(bad.status, bad.text).toBe(201);
    const refused = await t.as.post(`${base(t)}/bank-reconciliations/${bad.body.id}/sign-off`, {});
    expect(refused.status).toBe(422);
  });

  it("refuses with 409 FX_RECONCILIATION_UNSUPPORTED when a ledger line has no foreign amount", async () => {
    const t = await h.createTenant({ name: "FxReconMixed" });
    const { glId, bankId } = await usdBank(t);
    await usdReceipt(t, glId);
    const [equity] = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND type = 'equity' LIMIT 1`,
      [t.company.id]
    );
    // An AED-only manual line on the USD bank GL account.
    await postJournalEntry(t, {
      date: daysAgo(10),
      lines: [
        { accountId: glId, debit: 100 },
        { accountId: equity.id, credit: 100 },
      ],
    });
    const get = await t.as.get(
      `${base(t)}/bank-accounts/${bankId}/reconciliation-statement?periodEnd=${daysAgo(1)}&statementClosingBalance=1050.00`
    );
    expect(get.status, get.text).toBe(409);
    expect(get.body.code).toBe("FX_RECONCILIATION_UNSUPPORTED");
    const save = await t.as.post(`${base(t)}/bank-accounts/${bankId}/reconciliations`, {
      periodEnd: daysAgo(1),
      statementClosingBalance: "1050.00",
    });
    expect(save.status, save.text).toBe(409);
    const saved = await h.sql(`SELECT 1 FROM bank_reconciliations WHERE bank_account_id = $1`, [
      bankId,
    ]);
    expect(saved).toHaveLength(0);
  });

  it("leaves an AED account unchanged", async () => {
    const t = await h.createTenant({ name: "AedRecon" });
    const gl = await h.sql<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name_en, type, sub_type, is_active)
       VALUES ($1, '1026', 'AED Current', 'asset', 'bank', true) RETURNING id`,
      [t.company.id]
    );
    const ba = await h.sql<{ id: string }>(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'AED Current', 'FAB', 'AED', $2) RETURNING id`,
      [t.company.id, gl[0].id]
    );
    const r = await t.as.get(
      `${base(t)}/bank-accounts/${ba[0].id}/reconciliation-statement?periodEnd=${daysAgo(1)}&statementClosingBalance=0.00`
    );
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({ currency: "AED", glBalanceFils: 0, differenceFils: 0 });
  });
});
