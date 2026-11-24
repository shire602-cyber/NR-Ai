import { expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();

it("only the invoice company's own write-offs qualify it for VAT relief", async () => {
  const owner = await h.createTenant();
  const other = await h.createSecondTenant();
  const companyId = owner.company.id;
  const created = await owner.as.post(`/api/companies/${companyId}/invoices`, {
    customerName: "Customer",
    date: "2024-01-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(created.status, created.text).toBe(200);
  const invoiceId = created.body.id;
  const issued = await owner.as.patch(`/api/invoices/${invoiceId}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);

  // Historical rows can contain individually valid foreign keys to different companies.
  await h.sql(
    `INSERT INTO invoice_payments (company_id, invoice_id, amount, date, method, created_by)
     VALUES ($1, $2, 105, '2024-07-01', 'write_off', $3)`,
    [other.company.id, invoiceId, other.user.id]
  );
  const claim = () =>
    owner.as.post(`/api/companies/${companyId}/vat/bad-debt-relief`, {
      invoiceId,
      claimDate: "2024-08-01",
      writtenOff: true,
      customerNotified: true,
    });
  const denied = await claim();
  expect(denied.status, denied.text).toBe(422);
  expect(denied.body.code).toBe("BAD_DEBT_NOT_WRITTEN_OFF");
  expect(
    await h.sql("SELECT id FROM bad_debt_relief_claims WHERE invoice_id = $1", [invoiceId])
  ).toHaveLength(0);

  const writeOff = await owner.as.post(
    `/api/companies/${companyId}/invoices/${invoiceId}/write-off`,
    { date: "2024-07-01", amount: 63, reason: "Uncollectible balance" }
  );
  expect(writeOff.status, writeOff.text).toBe(201);
  const accepted = await claim();
  expect(accepted.status, accepted.text).toBe(201);
  expect(Number(accepted.body.outstandingAmount)).toBe(63);
  expect(Number(accepted.body.vatAmount)).toBe(3);
});

it("reverses both sides of a balanced historical journal line and preserves its metadata", async () => {
  const owner = await h.createTenant();
  const [cash, capital] = await Promise.all([
    accountByCode(owner, "1010"),
    accountByCode(owner, "3010"),
  ]);
  const [costCenter] = await h.sql<{ id: string }>(
    "INSERT INTO cost_centers (company_id, code, name) VALUES ($1, 'CC-1', 'Operations') RETURNING id",
    [owner.company.id]
  );
  const [entry] = await h.sql<{ id: string }>(
    `INSERT INTO journal_entries (company_id, entry_number, date, source, status, created_by)
     VALUES ($1, 'JE-LEGACY-IMPORT', '2024-01-01', 'manual', 'posted', $2) RETURNING id`,
    [owner.company.id, owner.user.id]
  );
  await h.sql(
    `INSERT INTO journal_lines
       (entry_id, account_id, debit, credit, foreign_debit, foreign_credit, foreign_currency, exchange_rate,
        cost_center_id, description, line_key, line_params, system_vat, vat_treatment, ct_treatment, ct_disallowed_pct)
     VALUES
       ($1, $2, 100.01, 40.00, 50.00, 20.00, 'USD', 2.000200, $4, 'Legacy FX', 'legacy', '{"ref":"L-1"}',
        true, 'standard', 'non_deductible', 25),
       ($1, $3, 0, 60.01, 0, 30.00, 'USD', 2.000200, null, 'Offset', null, null, false, null, null, null)`,
    [entry.id, cash.id, capital.id, costCenter.id]
  );
  const reversed = await owner.as.post(`/api/journal/${entry.id}/reverse`, {});
  expect(reversed.status, reversed.text).toBe(200);
  const rows = await h.sql(
    `SELECT account_id, debit::text, credit::text, foreign_debit::text, foreign_credit::text,
            foreign_currency, exchange_rate::text, cost_center_id, description, line_key, line_params,
            system_vat, vat_treatment, ct_treatment, ct_disallowed_pct::text
       FROM journal_lines WHERE entry_id = $1 ORDER BY debit, credit`,
    [reversed.body.reversalId]
  );
  const metadata = {
    account_id: cash.id,
    foreign_currency: "USD",
    exchange_rate: "2.000200",
    cost_center_id: costCenter.id,
    description: "Legacy FX",
    line_key: "legacy",
    line_params: { ref: "L-1" },
    system_vat: true,
    vat_treatment: "standard",
    ct_treatment: "non_deductible",
    ct_disallowed_pct: "25.00",
  };
  expect(rows).toMatchObject([
    {
      ...metadata,
      debit: "0.00",
      credit: "100.01",
      foreign_debit: "0.00",
      foreign_credit: "50.00",
    },
    { ...metadata, debit: "40.00", credit: "0.00", foreign_debit: "20.00", foreign_credit: "0.00" },
    {
      account_id: capital.id,
      debit: "60.01",
      credit: "0.00",
      foreign_debit: "30.00",
      foreign_credit: "0.00",
    },
  ]);
  const totals = await h.sql(
    `SELECT SUM(debit)::text AS debit, SUM(credit)::text AS credit
       FROM journal_lines WHERE entry_id = $1`,
    [reversed.body.reversalId]
  );
  expect(totals).toEqual([{ debit: "100.01", credit: "100.01" }]);
});

it("rounds the original legacy FX decimal exactly before storing it", async () => {
  const owner = await h.createTenant();
  const [cash, capital] = await Promise.all([
    accountByCode(owner, "1010"),
    accountByCode(owner, "3010"),
  ]);
  const { postJournal } = await import("../../server/ledger");
  const { entry } = await postJournal(
    {
      companyId: owner.company.id,
      date: "2024-01-01",
      status: "posted",
      amountRounding: "halfUp",
      lines: [
        { accountId: cash.id, debitFils: 100, exchangeRate: "999999999.00000049" },
        { accountId: capital.id, creditFils: 100 },
      ],
    },
    { actorId: owner.user.id }
  );
  expect(
    await h.sql(
      "SELECT exchange_rate::text FROM journal_lines WHERE entry_id = $1 AND account_id = $2",
      [entry.id, cash.id]
    )
  ).toEqual([{ exchange_rate: "999999999.000000" }]);
});

it("reverses signed historical journal amounts as nonnegative base and FX legs", async () => {
  const owner = await h.createTenant();
  const [cash, capital] = await Promise.all([
    accountByCode(owner, "1010"),
    accountByCode(owner, "3010"),
  ]);
  const [entry] = await h.sql<{ id: string }>(
    `INSERT INTO journal_entries (company_id, entry_number, date, source, status, created_by)
     VALUES ($1, 'JE-SIGNED-IMPORT', '2024-01-01', 'manual', 'posted', $2) RETURNING id`,
    [owner.company.id, owner.user.id]
  );
  await h.sql(
    `INSERT INTO journal_lines
       (entry_id, account_id, debit, credit, foreign_debit, foreign_credit, foreign_currency,
        exchange_rate, description, line_key, line_params)
     VALUES
       ($1, $2, -75.01, 24.99, -37.50, 12.50, 'USD', 2, 'Legacy cash', 'legacy', '{"ref":"S-1"}'),
       ($1, $3, 39.00, -60.00, null, null, null, null, 'Legacy capital', null, null),
       ($1, $2, 1.00, 0, -0.50, 0, 'USD', 2, 'Legacy FX correction', null, null)`,
    [entry.id, cash.id, capital.id]
  );
  const reversed = await owner.as.post(`/api/journal/${entry.id}/reverse`, {});
  expect(reversed.status, reversed.text).toBe(200);
  const rows = await h.sql(
    `SELECT account_id, debit::text, credit::text, foreign_debit::text, foreign_credit::text,
            foreign_currency, exchange_rate::text, description, line_key, line_params
       FROM journal_lines WHERE entry_id = $1 ORDER BY debit DESC, credit DESC`,
    [reversed.body.reversalId]
  );
  const cashMetadata = {
    account_id: cash.id,
    foreign_currency: "USD",
    exchange_rate: "2.000000",
    description: "Legacy cash",
    line_key: "legacy",
    line_params: { ref: "S-1" },
  };
  const capitalMetadata = {
    account_id: capital.id,
    foreign_currency: null,
    foreign_debit: "0.00",
    foreign_credit: "0.00",
    description: "Legacy capital",
  };
  expect(rows).toMatchObject([
    {
      ...cashMetadata,
      debit: "75.01",
      credit: "0.00",
      foreign_debit: "37.50",
      foreign_credit: "0.00",
    },
    {
      ...cashMetadata,
      debit: "24.99",
      credit: "0.00",
      foreign_debit: "12.50",
      foreign_credit: "0.00",
    },
    { ...capitalMetadata, debit: "0.00", credit: "60.00" },
    { ...capitalMetadata, debit: "0.00", credit: "39.00" },
    {
      account_id: cash.id,
      debit: "0.00",
      credit: "1.00",
      foreign_debit: "0.00",
      foreign_credit: "0.00",
      foreign_currency: "USD",
      description: "Legacy FX correction",
    },
    {
      account_id: cash.id,
      debit: "0.00",
      credit: "0.00",
      foreign_debit: "0.50",
      foreign_credit: "0.00",
      foreign_currency: "USD",
      description: "Legacy FX correction",
    },
  ]);
  const net = await h.sql(
    `SELECT account_id, SUM(debit - credit)::text AS base_net,
                   SUM(COALESCE(foreign_debit, 0) - COALESCE(foreign_credit, 0))::text AS foreign_net
       FROM journal_lines WHERE entry_id = ANY($1::uuid[]) GROUP BY account_id`,
    [[entry.id, reversed.body.reversalId]]
  );
  expect(net).toHaveLength(2);
  expect(net).toMatchObject([
    { base_net: "0.00", foreign_net: "0.00" },
    { base_net: "0.00", foreign_net: "0.00" },
  ]);
});
