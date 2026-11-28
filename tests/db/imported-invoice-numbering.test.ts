/**
 * Imported invoice numbers never collide with newly allocated ones (launch fix WS1).
 * The import commit reserves the counter; the allocator also skips any number already taken.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const YEAR = new Date().getUTCFullYear();
const today = () => dubaiToday();

function openInvoicesCsv(numbers: string[]) {
  const rows = numbers.map(
    (n) => `Gulf Retail LLC,ap@gulfretail.example,${n},15/11/2025,15/12/2025,100.00,100.00,AED`
  );
  return [
    "*ContactName,EmailAddress,*InvoiceNumber,*InvoiceDate,*DueDate,Total,AmountDue,Currency",
    ...rows,
  ].join("\n");
}

async function importInvoices(t: Tenant, numbers: string[]) {
  const base = `/api/companies/${t.company.id}/imports`;
  const p = await t.as.post(`${base}/preview`, {
    kind: "open_invoices",
    sourceSystem: "xero",
    csv: openInvoicesCsv(numbers),
    cutOverDate: "2025-12-31",
  });
  expect(p.status, p.text).toBe(201);
  const v = await t.as.post(`${base}/${p.body.id}/validate`);
  expect(v.status, v.text).toBe(200);
  expect(v.body.status, JSON.stringify(v.body.issues)).toBe("validated");
  const c = await t.as.post(`${base}/${p.body.id}/commit`);
  expect(c.status, c.text).toBe(200);
}

async function mkInvoice(t: Tenant) {
  const r = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "C",
    date: today(),
    lines: [{ description: "x", quantity: 1, unitPrice: 10, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  return r.body.number as string;
}

async function setNumbering(t: Tenant, yearlyReset: boolean) {
  const r = await t.as.put(`/api/companies/${t.company.id}/numbering/invoice`, {
    prefix: "INV",
    padding: 5,
    yearlyReset,
  });
  expect(r.status, r.text).toBeLessThan(300);
}

describe("imported invoice numbering", () => {
  it("continues after imported yearly numbers without a duplicate", async () => {
    const t = await h.createTenant();
    await importInvoices(
      t,
      [1, 2, 3].map((n) => `INV-${YEAR}-0000${n}`)
    );
    expect(await mkInvoice(t)).toBe(`INV-${YEAR}-00004`);
  });

  it("continues after imported continuous numbers (yearlyReset=false)", async () => {
    const t = await h.createTenant();
    await setNumbering(t, false);
    await importInvoices(t, ["INV-00001", "INV-00002", "INV-00003"]);
    expect(await mkInvoice(t)).toBe("INV-00004");
  });

  it("allocates unique consecutive numbers for parallel creates after an import", async () => {
    const t = await h.createTenant();
    await importInvoices(
      t,
      [1, 2, 3].map((n) => `INV-${YEAR}-0000${n}`)
    );
    const numbers = await Promise.all(Array.from({ length: 5 }, () => mkInvoice(t)));
    expect([...numbers].sort()).toEqual([4, 5, 6, 7, 8].map((n) => `INV-${YEAR}-0000${n}`));
  });

  it("skips a number inserted behind the counter (allocator defence)", async () => {
    const t = await h.createTenant();
    await h.sql(
      `INSERT INTO invoices (company_id, number, customer_name, date, currency, exchange_rate, subtotal, vat_amount, total, status)
       VALUES ($1, $2, 'X', now(), 'AED', 1, 1, 0, 1, 'draft')`,
      [t.company.id, `INV-${YEAR}-00001`]
    );
    expect(await mkInvoice(t)).toBe(`INV-${YEAR}-00002`);
  });

  it("an imported number in a foreign format causes no skip", async () => {
    const t = await h.createTenant();
    await importInvoices(t, ["XERO-INV-0041", "INV-0042"]);
    expect(await mkInvoice(t)).toBe(`INV-${YEAR}-00001`);
  });
});
