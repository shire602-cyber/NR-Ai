import { afterAll, beforeAll, describe, expect, it } from "vitest";

const shouldRun =
  process.env.RUN_DB_INTEGRATION === "1" && Boolean(process.env.INTEGRATION_DATABASE_URL);

const describeDb = shouldRun ? describe : describe.skip;

type VatSalesTotals = {
  standardRatedAmount: number;
  standardRatedVat: number;
  zeroRatedAmount: number;
  box14PayableTax: number;
};

type TrialBalanceTotals = {
  debit: number;
  credit: number;
  difference: number;
};

type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
  release: () => void;
};

type PgPool = {
  connect: () => Promise<PgClient>;
  end: () => Promise<void>;
};

function money(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

async function readVatSalesTotals(
  client: PgClient,
  companyId: string,
  includeStandaloneCreditNotes: boolean
): Promise<VatSalesTotals> {
  const periodStart = new Date("2026-01-01T00:00:00.000Z");
  const periodEnd = new Date("2026-03-31T23:59:59.999Z");
  const invoiceLines = await client.query(
    `SELECT
       il.quantity::numeric AS quantity,
       (il.unit_price::numeric * COALESCE(i.exchange_rate, 1)::numeric) AS unit_price,
       COALESCE(il.vat_rate, 0.05)::numeric AS vat_rate,
       COALESCE(il.vat_supply_type, 'standard_rated') AS vat_supply_type
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
     WHERE i.company_id = $1
       AND i.date >= $2
       AND i.date <= $3
       AND i.status NOT IN ('void', 'draft', 'cancelled')`,
    [companyId, periodStart, periodEnd]
  );

  let standardRatedAmount = 0;
  let standardRatedVat = 0;
  let zeroRatedAmount = 0;
  for (const row of invoiceLines.rows) {
    const amount = Number(row.quantity) * Number(row.unit_price);
    const rate = Number(row.vat_rate);
    if (row.vat_supply_type === "zero_rated" || rate === 0) {
      zeroRatedAmount += amount;
    } else {
      standardRatedAmount += amount;
      standardRatedVat += amount * rate;
    }
  }

  if (includeStandaloneCreditNotes) {
    const standaloneLines = await client.query(
      `SELECT
         cl.quantity::numeric AS quantity,
         cl.unit_price::numeric AS unit_price,
         COALESCE(cl.vat_rate, 0.05)::numeric AS vat_rate,
         COALESCE(cl.vat_supply_type, 'standard_rated') AS vat_supply_type
       FROM credit_note_lines cl
       JOIN credit_notes cn ON cn.id = cl.credit_note_id
       WHERE cn.company_id = $1
         AND cn.date >= $2
         AND cn.date <= $3
         AND cn.status = 'issued'`,
      [companyId, periodStart, periodEnd]
    );
    for (const row of standaloneLines.rows) {
      const amount = Number(row.quantity) * Number(row.unit_price);
      const rate = Number(row.vat_rate);
      if (row.vat_supply_type === "zero_rated" || rate === 0) {
        zeroRatedAmount -= amount;
      } else {
        standardRatedAmount -= amount;
        standardRatedVat -= amount * rate;
      }
    }
  }

  return {
    standardRatedAmount: money(standardRatedAmount),
    standardRatedVat: money(standardRatedVat),
    zeroRatedAmount: money(zeroRatedAmount),
    box14PayableTax: money(standardRatedVat),
  };
}

async function readTrialBalanceTotals(
  client: PgClient,
  companyId: string
): Promise<TrialBalanceTotals> {
  const res = await client.query(
    `SELECT
       COALESCE(SUM(jl.debit), 0)::numeric AS debit,
       COALESCE(SUM(jl.credit), 0)::numeric AS credit
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.company_id = $1
       AND je.status = 'posted'`,
    [companyId]
  );
  const debit = money(res.rows[0]?.debit);
  const credit = money(res.rows[0]?.credit);
  return { debit, credit, difference: money(debit - credit) };
}

async function seedStandaloneCreditNoteFixture(client: PgClient) {
  const unique = Date.now().toString(36);
  const user = await client.query(
    `INSERT INTO users (email, name, password_hash, user_type)
     VALUES ($1, 'CN Consolidation Reviewer', 'test-hash', 'customer')
     RETURNING id`,
    [`cn-consolidation-${unique}@test.local`]
  );
  const userId = user.rows[0].id as string;

  const company = await client.query(
    `INSERT INTO companies (name, trn_vat_number, vat_filing_frequency, vat_period_start_month)
     VALUES ($1, '100000000000003', 'Quarterly', 1)
     RETURNING id`,
    [`CN Consolidation ${unique}`]
  );
  const companyId = company.rows[0].id as string;

  await client.query(
    `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [companyId, userId]
  );

  const accounts = await client.query(
    `INSERT INTO accounts
       (company_id, code, name_en, type, sub_type, is_system_account, is_vat_account, vat_type)
     VALUES
       ($1, '1040', 'Accounts Receivable', 'asset', 'current_asset', true, false, null),
       ($1, '4010', 'Sales Revenue', 'income', null, true, false, null),
       ($1, '2020', 'VAT Payable (Output VAT)', 'liability', 'current_liability', true, true, 'output')
     RETURNING id, code`,
    [companyId]
  );
  const accountByCode = new Map(accounts.rows.map((row) => [row.code, row.id]));

  const invoice = await client.query(
    `INSERT INTO invoices
       (company_id, number, customer_name, date, currency, exchange_rate, base_currency_amount,
        subtotal, vat_amount, total, status, invoice_type)
     VALUES
       ($1, 'INV-CN-CONSOLIDATION', 'Benchmark Customer LLC', '2026-02-15T00:00:00Z',
        'AED', 1, 1050, 1000, 50, 1050, 'sent', 'invoice')
     RETURNING id`,
    [companyId]
  );
  const invoiceId = invoice.rows[0].id as string;

  await client.query(
    `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, vat_rate, vat_supply_type)
     VALUES ($1, 'Consulting services', 1, 1000, 0.05, 'standard_rated')`,
    [invoiceId]
  );

  const invoiceEntry = await client.query(
    `INSERT INTO journal_entries
       (company_id, entry_number, date, memo, status, source, source_id, created_by, posted_by, posted_at)
     VALUES
       ($1, 'JE-CN-CONSOLIDATION-INV', '2026-02-15T00:00:00Z',
        'Invoice fixture', 'posted', 'invoice', $2, $3, $3, now())
     RETURNING id`,
    [companyId, invoiceId, userId]
  );
  await client.query(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
     VALUES
       ($1, $2, 1050, 0, 'Invoice A/R'),
       ($1, $3, 0, 1000, 'Invoice revenue'),
       ($1, $4, 0, 50, 'Invoice output VAT')`,
    [
      invoiceEntry.rows[0].id,
      accountByCode.get("1040"),
      accountByCode.get("4010"),
      accountByCode.get("2020"),
    ]
  );

  const creditNote = await client.query(
    `INSERT INTO credit_notes
       (company_id, number, customer_name, invoice_id, invoice_number, date, currency,
        subtotal, vat_amount, total, status, reason)
     VALUES
       ($1, 'CN-STANDALONE-LEGACY', 'Benchmark Customer LLC', $2, 'INV-CN-CONSOLIDATION',
        '2026-02-20T00:00:00Z', 'AED', 100, 5, 105, 'issued', 'Returned service')
     RETURNING id`,
    [companyId, invoiceId]
  );
  const creditNoteId = creditNote.rows[0].id as string;

  await client.query(
    `INSERT INTO credit_note_lines
       (credit_note_id, description, quantity, unit_price, vat_rate, vat_supply_type)
     VALUES ($1, 'Returned service', 1, 100, 0.05, 'standard_rated')`,
    [creditNoteId]
  );

  const creditNoteEntry = await client.query(
    `INSERT INTO journal_entries
       (company_id, entry_number, date, memo, status, source, source_id, created_by, posted_by, posted_at)
     VALUES
       ($1, 'JE-CN-CONSOLIDATION-CN', '2026-02-20T00:00:00Z',
        'Standalone credit note fixture', 'posted', 'credit_note', $2, $3, $3, now())
     RETURNING id`,
    [companyId, creditNoteId, userId]
  );
  await client.query(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
     VALUES
       ($1, $2, 100, 0, 'Credit note reverse revenue'),
       ($1, $3, 5, 0, 'Credit note reverse VAT'),
       ($1, $4, 0, 105, 'Credit note reduce A/R')`,
    [
      creditNoteEntry.rows[0].id,
      accountByCode.get("4010"),
      accountByCode.get("2020"),
      accountByCode.get("1040"),
    ]
  );

  await client.query(`UPDATE credit_notes SET journal_entry_id = $1 WHERE id = $2`, [
    creditNoteEntry.rows[0].id,
    creditNoteId,
  ]);

  return { companyId };
}

describeDb("credit-note consolidation integration", () => {
  let pool: PgPool;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    const pg = await import("pg");
    pool = new pg.default.Pool({
      connectionString: process.env.INTEGRATION_DATABASE_URL,
    }) as PgPool;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps VAT-201 sales totals and trial balance unchanged after backfill", async () => {
    const { backfillStandaloneCreditNotes } = await import(
      "../../server/services/credit-note-consolidation.service"
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { companyId } = await seedStandaloneCreditNoteFixture(client);

      const beforeVat = await readVatSalesTotals(client, companyId, true);
      const beforeTrialBalance = await readTrialBalanceTotals(client, companyId);

      const result = await backfillStandaloneCreditNotes(client);

      const afterVat = await readVatSalesTotals(client, companyId, false);
      const afterTrialBalance = await readTrialBalanceTotals(client, companyId);

      expect(result.insertedInvoiceCount).toBe(1);
      expect(result.insertedLineCount).toBe(1);
      expect(result.repointedJournalCount).toBe(1);
      expect(result.postedJournalCount).toBe(0);
      expect(afterVat).toEqual(beforeVat);
      expect(afterTrialBalance).toEqual(beforeTrialBalance);
      expect(afterTrialBalance.difference).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
