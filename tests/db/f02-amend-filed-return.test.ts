/**
 * F02: amending a filed/submitted VAT return. On staging (9e5fa726) POST /api/vat-returns/:id/amend
 * answered 409 DUPLICATE_VALUE (Postgres 23505) repeatedly — both for a filed return and for the
 * exact staging scenario: a record-only submission (transmittedByMuhasib:false, no ftaReferenceNumber)
 * which produces "submitted" status. The amendment must be created (201), the original keeps
 * counting as the period's effective return while the amendment is a draft, and only the amendment
 * counts once it is filed.
 */
import { expect, it } from "vitest";
import {
  selectEffectiveVatReturns,
  type VatReturnVersionLike,
} from "../../shared/vat-effective-returns";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const period = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };

async function effective(t: Tenant) {
  const list = await t.as.get(`${base(t)}/vat-returns`);
  expect(list.status, list.text).toBe(200);
  return selectEffectiveVatReturns(list.body as VatReturnVersionLike[]);
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
  const rows = (await t.as.get(`${base(t)}/vat-returns`)).body as VatReturnVersionLike[];
  expect(rows.find((r) => r.id === originalId)?.status).toBe("amended");
  expect(rows.find((r) => r.id === amendmentId)).toMatchObject({
    status: "draft",
    amendsReturnId: originalId,
  });
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

  // The original used the recording timestamp because filedOn was omitted.
  const refiled = await t.as.post(`/api/vat-returns/${amendmentId}/submit`, {
    ftaReferenceNumber: "TEST-REF-0002",
    filedOn: "2026-04-25",
  });
  expect(refiled.status, refiled.text).toBe(200);
  expect(refiled.body.status).toBe("filed");
  expect(Date.parse(refiled.body.submittedAt)).toBeLessThan(Date.parse(filed.body.submittedAt));

  current = await effective(t);
  expect(current.map((r) => r.id)).toEqual([amendmentId]);
  expect(Number(current[0].box14PayableTax)).toBe(450);
  const original = await t.as.get(`/api/vat-returns/${originalId}`);
  expect(original.body.status).toBe("amended");
});

it("amends a submitted (record-only) return: exact staging scenario that produced 409 DUPLICATE_VALUE", async () => {
  // The staging failure was with transmittedByMuhasib:false (no ftaReferenceNumber) which produces
  // "submitted" status. POST /api/vat-returns/:id/amend repeatedly returned 409 DUPLICATE_VALUE.
  const t = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000004",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });

  const invoice = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Beta LLC",
    customerTrn: "100000000000012",
    date: "2026-02-15",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Service", quantity: 1, unitPrice: 20000, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${invoice.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);

  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, period);
  expect(gen.status, gen.text).toBe(201);
  const originalId = gen.body.id as string;

  // Record-only submission: no ftaReferenceNumber → "submitted" status (not "filed").
  const submitted = await t.as.post(`/api/vat-returns/${originalId}/submit`, {});
  expect(submitted.status, submitted.text).toBe(200);
  expect(submitted.body.status).toBe("submitted");
  expect(Number(submitted.body.box14PayableTax)).toBe(1000);

  // This is the call that returned 409 DUPLICATE_VALUE on staging 9e5fa726.
  const amend = await t.as.post(`/api/vat-returns/${originalId}/amend`, {
    reason: "Invoice amount was incorrect",
  });
  expect(amend.status, amend.text).toBe(201);
  const amendmentId = (amend.body.vatReturn?.id ?? amend.body.id) as string;
  expect(amendmentId).not.toBe(originalId);

  // The original (now stored as "amended") still appears as the effective return.
  const rows = (await t.as.get(`${base(t)}/vat-returns`)).body as VatReturnVersionLike[];
  expect(rows.find((r) => r.id === originalId)?.status).toBe("amended");
  expect(rows.find((r) => r.id === amendmentId)).toMatchObject({
    status: "draft",
    amendsReturnId: originalId,
  });
  const current = await effective(t);
  expect(current.map((r) => r.id)).toEqual([originalId]);
  expect(Number(current[0].box14PayableTax)).toBe(1000);
});
