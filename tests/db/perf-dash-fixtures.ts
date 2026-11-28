/**
 * PERF-DASH: the books the dashboard-stats performance work is checked on. Two tenants: the
 * report 13 books (bank account with an imported statement, open bill, draft invoice) and the
 * report 11 golden books FY2025-FY2026 plus cash-flow cases in the dashboard's six-month cash
 * window (asset bought for cash, loan, dividend, depreciation, disposal with a gain, an asset
 * bought on credit with a P&L line, a go-live opening entry and entries on bucket edges).
 */
import { postJournalEntry, type Harness, type Tenant } from "./harness";
import { seedGoldenBooksFY2025_2026 } from "./golden/seed";
import { NOW, insertBill, insertInvoice, seedReport13 } from "./w3e-seed";

export const PERF_DASH_NOW = NOW;

export async function seedPerfDashBooks(h: Harness): Promise<{ a: Tenant; b: Tenant }> {
  const a = await h.createTenant({ name: "PerfDash Report13" });
  await seedReport13(h.sql, a);
  await insertBill(h.sql, a, {
    vendor: "Landlord LLC",
    number: "B-1",
    date: "2026-11-01",
    due: "2026-12-20",
    subtotal: 1000,
    vat: 50,
  });
  await insertInvoice(h.sql, a, {
    number: "INV-D",
    customer: "Draft Co",
    date: "2026-11-12",
    due: "2026-12-12",
    subtotal: 9000,
    vat: 450,
    status: "draft",
  });
  const bank = await a.as.post(`/api/companies/${a.company.id}/bank-accounts`, {
    nameEn: "Operating account",
    bankName: "Emirates NBD",
  });
  if (bank.status !== 201) throw new Error(`bank account ${bank.status} ${bank.text}`);
  await postJournalEntry(a, {
    date: "2026-10-01",
    lines: [
      { accountId: bank.body.glAccountId, debit: 4000 },
      { code: "3010", credit: 4000 },
    ],
  });
  await h.sql(
    `INSERT INTO bank_transactions (company_id, bank_statement_account_id, bank_account_id,
            transaction_date, description, amount, balance, import_source, created_at)
     VALUES ($1, $2, $3, '2026-10-01', 'Capital', 4000, 4000, 'csv', '2026-10-02T10:00:00Z'),
            ($1, $2, $3, '2026-10-15', 'Fee', -25, 3975, 'csv', '2026-10-16T10:00:00Z')`,
    [a.company.id, bank.body.id, bank.body.glAccountId]
  );

  const b = await h.createTenant({ name: "PerfDash Golden" });
  await seedGoldenBooksFY2025_2026(b);
  const je = (date: string, lines: Parameters<typeof postJournalEntry>[1]["lines"]) =>
    postJournalEntry(b, { date, description: `perf-dash ${date}`, lines });
  await je("2026-06-01", [
    { code: "1020", debit: 900 },
    { code: "4030", credit: 900 },
  ]);
  await je("2026-07-10", [
    { code: "1210", debit: 12_000 },
    { code: "1050", debit: 600 },
    { code: "1020", credit: 12_600 },
  ]);
  await je("2026-07-31", [
    { code: "5030", debit: 450 },
    { code: "1020", credit: 450 },
  ]);
  await je("2026-08-01", [
    { code: "1020", debit: 50_000 },
    { code: "2210", credit: 50_000 },
  ]);
  await je("2026-09-15", [
    { code: "3030", debit: 5_000 },
    { code: "1020", credit: 5_000 },
  ]);
  await je("2026-09-30", [
    { code: "5100", debit: 300 },
    { code: "1240", credit: 300 },
  ]);
  await je("2026-10-12", [
    { code: "1020", debit: 4_000 },
    { code: "1240", debit: 300 },
    { code: "1210", credit: 3_000 },
    { code: "4080", credit: 1_300 },
  ]);
  await je("2026-10-20", [
    { code: "1220", debit: 2_000 },
    { code: "5090", debit: 100 },
    { code: "2010", credit: 2_100 },
  ]);
  await je("2026-11-03", [
    { code: "5030", debit: 700 },
    { code: "1020", credit: 700 },
  ]);
  const opening = await je("2026-08-20", [
    { code: "1010", debit: 1_500 },
    { code: "3010", credit: 1_500 },
  ]);
  // A go-live opening entry inside the window: it moves the cash balance, not the flows.
  await h.sql(`UPDATE journal_entries SET entry_kind = 'opening' WHERE id = $1`, [opening.id]);
  return { a, b };
}
