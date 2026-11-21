import { expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const asOf = "2025-05-20";

interface Plan {
  Alias?: string;
  "Actual Loops": number;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Relation Name"?: string;
  Plans?: Plan[];
}

async function explain(text: string, params?: unknown[]): Promise<Plan[]> {
  const [row] = await h.sql<{ "QUERY PLAN": Array<{ Plan: Plan }> }>(
    `EXPLAIN (ANALYZE, FORMAT JSON) ${text}`,
    params
  );
  const walk = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(walk)];
  return walk(row["QUERY PLAN"][0].Plan);
}

it("computes firm receivables once per invoice and uses the invoice date index for the UAE cutoff", async () => {
  const a = await h.createTenant();
  const b = await h.createSecondTenant();
  const [partPaid] = await h.sql<{ id: string }>(
    `INSERT INTO invoices (company_id, number, customer_name, date, due_date, status, total, currency, exchange_rate)
     VALUES ($1, 'PARTIAL', 'Customer', '2025-04-01', '2025-05-19', 'partial', 100, 'USD', 3.675)
     RETURNING id`,
    [a.company.id]
  );
  await h.sql(
    `INSERT INTO invoices (company_id, number, customer_name, date, due_date, status, total, exchange_rate)
     VALUES
       ($1, 'TINY', 'Customer', '2025-05-20 19:59:59.999999', '2025-05-20', 'sent', 0.01, 0.3),
       ($1, 'FUTURE', 'Customer', '2025-05-20 20:00:00', '2025-05-19', 'sent', 500, 1),
       ($2, 'OTHER-TENANT', 'Customer', '2025-04-01', '2025-05-19', 'sent', 1000, 1)`,
    [a.company.id, b.company.id]
  );
  await h.sql(
    `INSERT INTO invoices (company_id, number, customer_name, date, status, total)
     SELECT company_id, 'FIXTURE-' || n, 'Customer', '2025-06-01', 'sent', 500
       FROM unnest($1::uuid[]) AS company_id
      CROSS JOIN generate_series(1, 2000) AS n`,
    [[a.company.id, b.company.id]]
  );
  await h.sql(
    `INSERT INTO invoice_payments (invoice_id, company_id, created_by, amount, date)
     VALUES
       ($1, $2, $3, 40, '2025-05-20 19:59:59.999999'),
       ($1, $2, $3, 50, '2025-05-20 20:00:00'),
       ($1, $4, $5, 20, '2025-05-01')`,
    [partPaid.id, a.company.id, a.user.id, b.company.id, b.user.id]
  );
  await h.sql(
    `INSERT INTO invoices (company_id, number, customer_name, date, status, total, invoice_type, original_invoice_id)
     VALUES ($1, 'CN-1', 'Customer', '2025-05-01', 'sent', -5, 'credit_note', $2)`,
    [b.company.id, partPaid.id]
  );
  await h.sql("ANALYZE invoices");

  const { receivablesByCompany } = await import("../../server/reporting/firm-receivables");
  let plan: Plan[] = [];
  const result = await receivablesByCompany([a.company.id], asOf, {
    async query(statement, params) {
      plan = await explain(statement, params);
      return { rows: await h.sql(statement, params) };
    },
  });
  expect([...result.values()]).toEqual([
    {
      companyId: a.company.id,
      baseCurrency: "AED",
      openFils: 22050,
      overdueFils: 22050,
      openCount: 2,
      overdueCount: 1,
    },
  ]);
  expect(
    plan.find((node) => node["Index Name"] === "idx_invoices_company_date")?.["Index Cond"]
  ).toMatch(/company_id.*date </);
  const settlementScans = plan.filter((node) =>
    ["sp", "scn", "slc", "sa"].includes(node.Alias ?? "")
  );
  expect(settlementScans.map((node) => node.Alias).sort()).toEqual(["sa", "scn", "slc", "sp"]);
  expect(settlementScans.map((node) => node["Actual Loops"])).toEqual([2, 2, 2, 2]);
});

it("aggregates vendor credit applications once, net of reversals and within the company's bills", async () => {
  const a = await h.createTenant();
  const b = await h.createSecondTenant();
  const [note] = await h.sql<{ id: string }>(
    `INSERT INTO vendor_debit_notes
       (company_id, debit_note_number, vendor_name, note_date, total_amount, currency, exchange_rate)
     VALUES
       ($1, 'DN-1', 'Vendor', '2025-05-01', 100, 'USD', 1.25),
       ($1, 'DN-2', 'Vendor', '2025-05-01', 10, 'AED', 1)
     RETURNING id`,
    [a.company.id]
  );
  const [own, other] = await h.sql<{ id: string }>(
    `INSERT INTO vendor_bills (company_id, bill_number, vendor_name, bill_date)
     VALUES ($1, 'B-1', 'Vendor', '2025-05-01'), ($2, 'B-1', 'Vendor', '2025-05-01')
     RETURNING id`,
    [a.company.id, b.company.id]
  );
  await h.sql(
    `INSERT INTO bill_payments (bill_id, source_document_id, kind, amount, payment_date)
     VALUES
       ($1, $3, 'vendor_credit', 25, '2025-05-10'),
       ($1, $3, 'reversal', -5, '2025-05-12'),
       ($1, $3, 'vendor_credit', 15, '2025-05-20 20:00:00'),
       ($2, $3, 'vendor_credit', 7, '2025-05-10')`,
    [own.id, other.id, note.id]
  );

  const { agedPayables } = await import("../../server/reporting/aging");
  let plan: Plan[] = [];
  const result = await agedPayables(
    { companyId: a.company.id, asOf },
    {
      async query(statement, params) {
        if (statement.includes("FROM vendor_debit_notes")) plan = await explain(statement, params);
        return { rows: await h.sql(statement, params) };
      },
    }
  );
  expect(result.unappliedCredits).toBe(110);
  const paymentScans = plan.filter((node) => node["Relation Name"] === "bill_payments");
  expect(paymentScans).toHaveLength(1);
  expect(paymentScans[0]["Actual Loops"]).toBe(1);
});

it("calculates remaining credit-note amounts using only the originating company's notes", async () => {
  const a = await h.createTenant();
  const b = await h.createSecondTenant();
  const original = await a.as.post(`/api/companies/${a.company.id}/invoices`, {
    customerName: "Customer",
    date: "2025-05-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(original.status, original.text).toBe(200);
  const issued = await a.as.patch(`/api/invoices/${original.body.id}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  const creditUrl = `/api/companies/${a.company.id}/invoices/${original.body.id}/credit-note`;
  const partialCredit = await a.as.post(creditUrl, {
    lines: [{ description: "Adjustment", quantity: 1, unitPrice: 20, vatRate: 5 }],
  });
  expect(partialCredit.status, partialCredit.text).toBe(201);

  await h.sql(
    `INSERT INTO invoices
       (company_id, number, customer_name, date, status, subtotal, vat_amount, total, invoice_type, original_invoice_id)
     VALUES ($1, 'CN-1', 'Customer', '2025-05-01', 'sent', -20, -1, -21, 'credit_note', $2)`,
    [b.company.id, original.body.id]
  );
  const remainder = await a.as.post(creditUrl, {});
  expect(remainder.status, remainder.text).toBe(201);
  expect(Number(remainder.body.subtotal)).toBe(-80);
  expect(Number(remainder.body.vatAmount)).toBe(-4);
  expect(Number(remainder.body.total)).toBe(-84);
});
