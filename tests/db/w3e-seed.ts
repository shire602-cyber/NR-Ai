/**
 * Shared seed for the W3-E (dashboard / planning) DB tests: the report 13 books.
 *
 *   capital 10,000 (1 Sep)            bank 10,000
 *   INV-1  2,100 (2,000 + 100 VAT)    dated 10 Nov, due 10 Dec (not yet due)
 *   INV-2  5,250 (5,000 + 250 VAT)    dated 15 Sep, due 16 Oct (30 days overdue on 15 Nov), 1,000 paid on 20 Oct
 *   rent   700 (5 Sep) / 600 (5 Oct) / 800 (5 Nov)
 *   => cash 8,900, outstanding 6,350, this-month profit 2,000 - 800 = 1,200, all-time profit 4,900
 */
import { randomUUID } from "node:crypto";
import { accountByCode, postJournalEntry, type Tenant } from "./harness";

export const NOW = "2026-11-15T08:00:00Z";

export type Sql = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

export async function insertInvoice(
  sql: Sql,
  t: Tenant,
  o: {
    number: string;
    customer: string;
    date: string;
    due: string;
    subtotal: number;
    vat: number;
    status?: string;
    currency?: string;
  }
): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO invoices (id, company_id, number, customer_name, date, due_date, subtotal, vat_amount, total, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      t.company.id,
      o.number,
      o.customer,
      `${o.date}T00:00:00Z`,
      `${o.due}T00:00:00Z`,
      o.subtotal,
      o.vat,
      o.subtotal + o.vat,
      o.status ?? "sent",
    ]
  );
  return id;
}

export async function insertPayment(
  sql: Sql,
  t: Tenant,
  invoiceId: string,
  amount: number,
  date: string
) {
  await sql(
    `INSERT INTO invoice_payments (invoice_id, company_id, amount, date, method, created_by)
     VALUES ($1,$2,$3,$4,'bank',$5)`,
    [invoiceId, t.company.id, amount, `${date}T00:00:00Z`, t.user.id]
  );
}

export async function insertBill(
  sql: Sql,
  t: Tenant,
  o: {
    vendor: string;
    number: string;
    date: string;
    due: string;
    subtotal: number;
    vat: number;
    status?: string;
    vendorTrn?: string | null;
  }
): Promise<string> {
  const id = randomUUID();
  await sql(
    `INSERT INTO vendor_bills (id, company_id, vendor_name, vendor_trn, bill_number, bill_date, due_date,
        subtotal, vat_amount, total_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      t.company.id,
      o.vendor,
      o.vendorTrn ?? null,
      o.number,
      `${o.date}T00:00:00Z`,
      `${o.due}T00:00:00Z`,
      o.subtotal,
      o.vat,
      o.subtotal + o.vat,
      o.status ?? "approved",
    ]
  );
  return id;
}

/** The report 13 books (journals through the API, documents through SQL). */
export async function seedReport13(sql: Sql, t: Tenant) {
  await postJournalEntry(t, {
    date: "2026-09-01",
    description: "Capital",
    lines: [
      { code: "1020", debit: 10000 },
      { code: "3010", credit: 10000 },
    ],
  });
  const inv2 = await insertInvoice(sql, t, {
    number: "INV-2",
    customer: "Beta Trading",
    date: "2026-09-15",
    due: "2026-10-16",
    subtotal: 5000,
    vat: 250,
  });
  await postJournalEntry(t, {
    date: "2026-09-15",
    description: "INV-2",
    lines: [
      { code: "1040", debit: 5250 },
      { code: "4010", credit: 5000 },
      { code: "2020", credit: 250 },
    ],
  });
  await insertPayment(sql, t, inv2, 1000, "2026-10-20");
  await postJournalEntry(t, {
    date: "2026-10-20",
    description: "INV-2 part payment",
    lines: [
      { code: "1020", debit: 1000 },
      { code: "1040", credit: 1000 },
    ],
  });
  const inv1 = await insertInvoice(sql, t, {
    number: "INV-1",
    customer: "Alpha Co",
    date: "2026-11-10",
    due: "2026-12-10",
    subtotal: 2000,
    vat: 100,
  });
  await postJournalEntry(t, {
    date: "2026-11-10",
    description: "INV-1",
    lines: [
      { code: "1040", debit: 2100 },
      { code: "4010", credit: 2000 },
      { code: "2020", credit: 100 },
    ],
  });
  for (const [date, amount] of [
    ["2026-09-05", 700],
    ["2026-10-05", 600],
    ["2026-11-05", 800],
  ] as const) {
    await postJournalEntry(t, {
      date,
      description: `Rent ${date}`,
      lines: [
        { code: "5020", debit: amount },
        { code: "1020", credit: amount },
      ],
    });
  }
  return { inv1, inv2 };
}

export async function rentAccountId(t: Tenant): Promise<string> {
  return (await accountByCode(t, "5020")).id;
}
