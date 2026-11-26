/**
 * F02: amending a filed VAT return. On staging POST /api/vat-returns/:id/amend answered 409
 * DUPLICATE_VALUE (a Postgres 23505) for a filed Q1 return. The amendment must be created (201),
 * the original keeps counting as the period's effective return while the amendment is a draft,
 * and only the amendment counts once it is filed.
 */
import { expect, it } from "vitest";
import { selectEffectiveVatReturns } from "../../shared/vat-effective-returns";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const period = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };

async function effective(t: Tenant) {
  const list = await t.as.get(`${base(t)}/vat-returns`);
  expect(list.status, list.text).toBe(200);
  return selectEffectiveVatReturns(list.body as Array<Record<string, any>>) as Array<
    Record<string, any>
  >;
}

it("amends a filed return: the original stays effective until the amendment is filed", async () => {
  const t = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });

  const invoice = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-10",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: 10000, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${invoice.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);

  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, period);
  expect(gen.status, gen.text).toBe(201);
  const originalId = gen.body.id as string;
  const filed = await t.as.post(`/api/vat-returns/${originalId}/submit`, {
    ftaReferenceNumber: "TEST-REF-0001",
    filedOn: "2026-04-20",
  });
  expect(filed.status, filed.text).toBe(200);
  expect(filed.body.status).toBe("filed");
  expect(Number(filed.body.box14PayableTax)).toBe(500);

  // Staging answered 409 DUPLICATE_VALUE here every time.
  const amend = await t.as.post(`/api/vat-returns/${originalId}/amend`, {
    reason: "Customer returned part of the job",
  });
  expect(amend.status, amend.text).toBe(201);
  const amendmentId = (amend.body.vatReturn?.id ?? amend.body.id) as string;
  expect(amendmentId).not.toBe(originalId);

  // While the amendment is a draft it has no effect: the original (now "amended") still counts.
  const rows = (await t.as.get(`${base(t)}/vat-returns`)).body as Array<Record<string, any>>;
  expect(rows.find((r) => r.id === originalId)?.status).toBe("amended");
  expect(rows.find((r) => r.id === amendmentId)?.status).toBe("draft");
  let current = await effective(t);
  expect(current.map((r) => r.id)).toEqual([originalId]);
  expect(Number(current[0].box14PayableTax)).toBe(500);

  // The period reopened for the correction: a credit note dated in Q1 is allowed.
  const credit = await t.as.post(`${base(t)}/invoices/${invoice.body.id}/credit-note`, {
    date: "2026-02-20",
    lines: [{ description: "Returned", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(credit.status, credit.text).toBe(201);

  const regenerated = await t.as.post(`${base(t)}/vat-returns/generate`, period);
  expect(regenerated.status, regenerated.text).toBe(201);
  expect(regenerated.body.id).toBe(amendmentId);
  expect(Number(regenerated.body.box14PayableTax)).toBe(450);
  current = await effective(t);
  expect(current.map((r) => r.id)).toEqual([originalId]);

  const refiled = await t.as.post(`/api/vat-returns/${amendmentId}/submit`, {
    ftaReferenceNumber: "TEST-REF-0002",
    filedOn: "2026-04-25",
  });
  expect(refiled.status, refiled.text).toBe(200);
  expect(refiled.body.status).toBe("filed");

  current = await effective(t);
  expect(current.map((r) => r.id)).toEqual([amendmentId]);
  expect(Number(current[0].box14PayableTax)).toBe(450);
  const original = await t.as.get(`/api/vat-returns/${originalId}`);
  expect(original.body.status).toBe("amended");
});
