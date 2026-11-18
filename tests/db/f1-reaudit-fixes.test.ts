/**
 * F1 re-audit fixes:
 *   [G3]  optional transform-to-null fields: omitted stays undefined on PUT/PATCH, so editing an
 *         issued invoice's notes / payment terms / due date without resending the TRN is a 200,
 *         a quote / recurring-template edit keeps its TRN, and a fixed-asset PATCH keeps its life.
 *   [G7]  GET /einvoice/validate runs the same three validation layers as generate-einvoice.
 */
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const BUYER_TRN = "100765432100003";

async function issuedWithTrn(t: Tenant) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: BUYER_TRN,
    date: today(),
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string };
}

describe("[G3] omitted optional fields are not cleared on update", () => {
  it("[G3] editing notes / paymentTerms / dueDate on an issued invoice without the TRN is 200; changing the TRN is still 409", async () => {
    const t = await h.createTenant();
    const inv = await issuedWithTrn(t);

    const notes = await t.as.put(`/api/invoices/${inv.id}`, { notes: "hello" });
    expect(notes.status, notes.text).toBe(200);
    const terms = await t.as.put(`/api/invoices/${inv.id}`, { paymentTerms: "net30" });
    expect(terms.status, terms.text).toBe(200);
    const due = await t.as.put(`/api/invoices/${inv.id}`, { dueDate: inDays(30) });
    expect(due.status, due.text).toBe(200);

    const row = await h.sql<{ customer_trn: string | null; notes: string; payment_terms: string }>(
      "SELECT customer_trn, notes, payment_terms FROM invoices WHERE id = $1",
      [inv.id]
    );
    expect(row[0]).toEqual({ customer_trn: BUYER_TRN, notes: "hello", payment_terms: "net30" });

    const changed = await t.as.put(`/api/invoices/${inv.id}`, { customerTrn: "100123456700003" });
    expect(changed.status, changed.text).toBe(409);
    expect(changed.body.code).toBe("INVOICE_ISSUED_IMMUTABLE");
    const cleared = await t.as.put(`/api/invoices/${inv.id}`, { customerTrn: null });
    expect(cleared.status, cleared.text).toBe(409);
    const after = await h.sql("SELECT customer_trn FROM invoices WHERE id = $1", [inv.id]);
    expect(after[0].customer_trn).toBe(BUYER_TRN);
  });

  it('[G3] a draft invoice PUT without the TRN keeps it; explicit "" clears it', async () => {
    const t = await h.createTenant();
    const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      customerTrn: BUYER_TRN,
      date: today(),
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(c.status, c.text).toBe(200);
    const keep = await t.as.put(`/api/invoices/${c.body.id}`, { notes: "draft note" });
    expect(keep.status, keep.text).toBe(200);
    expect(keep.body.customerTrn).toBe(BUYER_TRN);
    const clear = await t.as.put(`/api/invoices/${c.body.id}`, { customerTrn: "" });
    expect(clear.status, clear.text).toBe(200);
    const row = await h.sql("SELECT customer_trn FROM invoices WHERE id = $1", [c.body.id]);
    expect(row[0].customer_trn).toBeNull();
  });

  it("[G3] a quote PUT and a recurring-template PATCH without the TRN keep it", async () => {
    const t = await h.createTenant();
    const q = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Quote Co",
      customerTrn: BUYER_TRN,
      date: today(),
      lines: [{ description: "Work", quantity: 2, unitPrice: 100, vatRate: 5 }],
    });
    expect(q.status, q.text).toBe(201);
    const qu = await t.as.put(`/api/quotes/${q.body.id}`, { notes: "updated" });
    expect(qu.status, qu.text).toBe(200);
    const qrow = await h.sql("SELECT customer_trn FROM quotes WHERE id = $1", [q.body.id]);
    expect(qrow[0].customer_trn).toBe(BUYER_TRN);

    const r = await t.as.post(`/api/companies/${t.company.id}/recurring-invoices`, {
      customerName: "Retainer Co",
      customerTrn: BUYER_TRN,
      frequency: "monthly",
      startDate: inDays(5),
      lines: [{ description: "Retainer", quantity: 1, unitPrice: 500, vatRate: 5 }],
    });
    expect(r.status, r.text).toBeLessThan(300);
    const ru = await t.as.patch(`/api/recurring-invoices/${r.body.id}`, { paymentTerms: "net30" });
    expect(ru.status, ru.text).toBe(200);
    const rrow = await h.sql("SELECT customer_trn FROM recurring_invoices WHERE id = $1", [
      r.body.id,
    ]);
    expect(rrow[0].customer_trn).toBe(BUYER_TRN);
  });

  it("[G3] a fixed-asset PATCH without usefulLifeYears keeps the stored life", async () => {
    const t = await h.createTenant();
    const a = await t.as.post(`/api/companies/${t.company.id}/fixed-assets`, {
      assetName: "Laptop",
      category: "Computer Equipment",
      purchaseDate: "2026-01-15",
      purchaseCost: 12000,
      usefulLifeYears: 5,
      taxUsefulLifeYears: 4,
    });
    expect(a.status, a.text).toBe(201);
    const p = await t.as.patch(`/api/fixed-assets/${a.body.id}`, { notes: "Desk 4" });
    expect(p.status, p.text).toBe(200);
    const row = await h.sql<{ useful_life_years: number; tax_useful_life_years: number }>(
      "SELECT useful_life_years, tax_useful_life_years, notes FROM fixed_assets WHERE id = $1",
      [a.body.id]
    );
    expect(row[0]).toMatchObject({
      useful_life_years: 5,
      tax_useful_life_years: 4,
      notes: "Desk 4",
    });
  });
});

// ─── G7: validate == generate ──────────────────────────────────────────────

const SELLER_COLUMNS = {
  trn_vat_number: "100123456700003",
  legal_name: "Pearl Trading L.L.C.",
  address_street: "Office 1204, Al Saqr Tower",
  address_city: "Dubai",
  address_country: "AE",
  emirate: "dubai",
  trade_licence_no: "CN-1234567",
  trade_licence_authority: "Dubai Department of Economy and Tourism",
};

async function issuedFor(t: Tenant, contact: Record<string, unknown> | null) {
  let contactId: string | undefined;
  if (contact) {
    const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, contact);
    expect(c.status, c.text).toBeLessThan(300);
    contactId = c.body.id;
  }
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme Gulf FZ-LLC",
    customerTrn: BUYER_TRN,
    ...(contactId ? { contactId } : {}),
    date: today(),
    paymentTerms: "net30",
    lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  return inv.body.id as string;
}

async function validateAndGenerate(t: Tenant, id: string) {
  const v = await t.as.get(`/api/invoices/${id}/einvoice/validate`);
  expect(v.status, v.text).toBe(200);
  const g = await t.as.post(`/api/invoices/${id}/generate-einvoice`, {});
  return { v: v.body, g };
}

describe("[G7] e-invoice validate agrees with generate", () => {
  it("[G7] fixture 1: a complete buyer is valid on validate and generated (200)", async () => {
    const t = await h.createTenant({ companyColumns: SELLER_COLUMNS });
    const id = await issuedFor(t, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: BUYER_TRN,
      address: "Building 7, Dubai Internet City",
      city: "Dubai",
      emirate: "dubai",
      country: "AE",
    });
    const { v, g } = await validateAndGenerate(t, id);
    expect(v.valid, JSON.stringify(v.issues)).toBe(true);
    expect(v.issues).toEqual([]);
    expect(v.document.valid).toBe(true);
    expect(g.status, g.text).toBe(200);
  });

  it("[G7] fixture 2: a buyer without an address gets the named customer.address fix on validate and generate (422)", async () => {
    const t = await h.createTenant({ companyColumns: SELLER_COLUMNS });
    const id = await issuedFor(t, null);
    const { v, g } = await validateAndGenerate(t, id);
    expect(g.status, g.text).toBe(422);
    expect(g.body.code).toBe("EINVOICE_VALIDATION_FAILED");
    expect(v.valid).toBe(false);
    const named = (v.issues as Array<{ field?: string; code?: string }>).find(
      (i) => i.field === "customer.address"
    );
    expect(named?.code).toBe("EINVOICE_BUYER_ADDRESS_MISSING");
    // validate and generate agree, and the rule id is no longer the only signal.
    expect(
      (g.body.issues as Array<{ field: string; code?: string }>).map((i) => [i.field, i.code])
    ).toContainEqual(["customer.address", "EINVOICE_BUYER_ADDRESS_MISSING"]);
    const stored = await h.sql("SELECT einvoice_xml FROM invoices WHERE id = $1", [id]);
    expect(stored[0].einvoice_xml).toBeNull();
  });

  it("[G7] fixture 3: a seller without a street address fails the pre-check on both", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, address_street: null },
    });
    const id = await issuedFor(t, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: BUYER_TRN,
      address: "Building 7, Dubai Internet City",
      city: "Dubai",
      emirate: "dubai",
      country: "AE",
    });
    const { v, g } = await validateAndGenerate(t, id);
    expect(g.status, g.text).toBe(422);
    expect(g.body.code).toBe("EINVOICE_VALIDATION_FAILED");
    expect(v.valid).toBe(false);
    expect((v.issues as Array<{ field: string }>).map((i) => i.field)).toEqual(
      (g.body.issues as Array<{ field: string }>).map((i) => i.field)
    );
  });
});

// ─── G11 R17-20: admin / email-intake write routes validate with strictBody ─────

describe("[R17-20] admin and email-intake writes reject raw bodies", () => {
  it("[R17-20] POST/PUT /api/admin/plans validate fields and reject unknown / server keys", async () => {
    const admin = await h.createTenant({ name: "PlanAdmin", isAdmin: true });
    const bad = await admin.as.post(`/api/admin/plans`, {
      name: "Pro",
      priceMonthly: 99,
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(bad.status, bad.text).toBe(400);
    expect(bad.body.fields).toHaveProperty("id");
    const neg = await admin.as.post(`/api/admin/plans`, { name: "Pro", priceMonthly: -1 });
    expect(neg.status, neg.text).toBe(400);

    const ok = await admin.as.post(`/api/admin/plans`, {
      name: "Pro",
      priceMonthly: "99.50",
      currency: "aed",
      maxUsers: 5,
      isActive: true,
    });
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body).toMatchObject({ name: "Pro", priceMonthly: 99.5, currency: "AED" });

    const smuggle = await admin.as.put(`/api/admin/plans/${ok.body.id}`, {
      name: "Pro+",
      createdAt: "2000-01-01T00:00:00Z",
    });
    expect(smuggle.status, smuggle.text).toBe(400);
    const empty = await admin.as.put(`/api/admin/plans/${ok.body.id}`, {});
    expect(empty.status, empty.text).toBe(400);
    const upd = await admin.as.put(`/api/admin/plans/${ok.body.id}`, { priceYearly: 999 });
    expect(upd.status, upd.text).toBe(200);
    const row = await h.sql(
      "SELECT name, price_yearly::text AS y FROM subscription_plans WHERE id = $1",
      [ok.body.id]
    );
    expect(row[0]).toEqual({ name: "Pro", y: "999.00" });
  });

  it("[R17-20] PATCH /api/admin/companies/:id and /api/admin/clients/:id only write declared company fields", async () => {
    const admin = await h.createTenant({ name: "CoAdmin", isAdmin: true });
    const t = await h.createTenant();
    const bad = await admin.as.patch(`/api/admin/companies/${t.company.id}`, {
      name: "Renamed Co",
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(bad.status, bad.text).toBe(400);
    const badTrn = await admin.as.patch(`/api/admin/companies/${t.company.id}`, {
      trnVatNumber: "12",
    });
    expect(badTrn.status, badTrn.text).toBe(400);
    const ok = await admin.as.patch(`/api/admin/companies/${t.company.id}`, {
      name: "Renamed Co",
      trnVatNumber: null,
      baseCurrency: "AED",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.name).toBe("Renamed Co");

    const cl = await admin.as.patch(`/api/admin/clients/${t.company.id}`, {
      industry: "Retail",
      createdAt: "2000-01-01",
    });
    expect(cl.status, cl.text).toBe(400);
    const cl2 = await admin.as.patch(`/api/admin/clients/${t.company.id}`, { industry: "Retail" });
    expect(cl2.status, cl2.text).toBe(200);
    const missing = await admin.as.patch(
      `/api/admin/clients/00000000-0000-0000-0000-000000000009`,
      { industry: "Retail" }
    );
    expect(missing.status, missing.text).toBe(404);
    const row = await h.sql("SELECT name, industry FROM companies WHERE id = $1", [t.company.id]);
    expect(row[0]).toEqual({ name: "Renamed Co", industry: "Retail" });

    const note = await admin.as.post(`/api/admin/clients/${t.company.id}/notes`, {
      content: "First call",
    });
    expect(note.status, note.text).toBe(201);
    const nbad = await admin.as.patch(`/api/admin/notes/${note.body.id}`, {
      companyId: admin.company.id,
    });
    expect(nbad.status, nbad.text).toBe(400);
    const nok = await admin.as.patch(`/api/admin/notes/${note.body.id}`, { isPinned: true });
    expect(nok.status, nok.text).toBe(200);
    const nrow = await h.sql("SELECT company_id, is_pinned FROM client_notes WHERE id = $1", [
      note.body.id,
    ]);
    expect(nrow[0]).toEqual({ company_id: t.company.id, is_pinned: true });
  });

  it("[R17-20] PATCH /api/firm/email-intake/sources/:id rejects unknown keys", async () => {
    const firm = await h.createTenant({ name: "IntakeFirm", firmRole: "firm_owner" });
    const src = await firm.as.post(`/api/firm/email-intake/sources`, {
      companyId: firm.company.id,
      senderEmail: "books@client.example",
    });
    expect(src.status, src.text).toBe(201);
    const bad = await firm.as.patch(`/api/firm/email-intake/sources/${src.body.id}`, {
      label: "x",
      firmId: "00000000-0000-0000-0000-000000000001",
    });
    expect(bad.status, bad.text).toBe(400);
    const ok = await firm.as.patch(`/api/firm/email-intake/sources/${src.body.id}`, {
      status: "paused",
      label: "Main",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ status: "paused", label: "Main", firmId: firm.user.id });
  });
});
