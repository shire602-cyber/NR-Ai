/**
 * X6d launch proofs on the real app + Postgres:
 *   - "Ask Najma Al Raeda" handoff is stored in-app (no email), tenant-scoped, readable by NR staff
 *   - e-invoice readiness checklist is built from the PINT AE rule hints
 *   - invoice-list compliance pills exist only when the e-invoicing mandate applies
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

const SELLER = {
  trn_vat_number: "100123456700003",
  legal_name: "Pearl Trading L.L.C.",
  address_street: "Office 1204, Al Saqr Tower",
  address_city: "Dubai",
  address_country: "AE",
  emirate: "dubai",
  trade_licence_no: "CN-1234567",
};

describe("X6d Ask Najma Al Raeda handoff", () => {
  it("stores the request with period and figures, says no email was sent, and is tenant-scoped", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const other = await h.createSecondTenant();
    const res = await t.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "vat201",
      period: "2026-01-01 to 2026-03-31",
      figures: [{ label: "Output VAT", value: "AED 1250.00" }],
      note: "Please check the input VAT on bills.",
    });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      status: "received",
      storedInApp: true,
      emailSent: false,
      contact: { name: "Sara", email: "support@muhasib.ai" },
    });

    const rows = await h.sql(
      "SELECT title, message, company_id FROM user_feedback WHERE category = 'najma_handoff'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].company_id).toBe(t.company.id);
    expect(rows[0].message).toContain("Period: 2026-01-01 to 2026-03-31");
    expect(rows[0].message).toContain("Output VAT: AED 1250.00");
    expect(rows[0].message).toContain("Please check the input VAT on bills.");

    const list = await t.as.get(`/api/companies/${t.company.id}/najma-handoff`);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items).toHaveLength(1);

    // Another tenant can neither read nor write this company's handoff queue.
    const crossRead = await other.as.get(`/api/companies/${t.company.id}/najma-handoff`);
    expect([403, 404]).toContain(crossRead.status);
    const crossWrite = await other.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "vat201",
    });
    expect([403, 404]).toContain(crossWrite.status);

    // Customers cannot read the NR staff queue.
    const queue = await t.as.get("/api/firm/value-ops/handoff-requests");
    expect(queue.status).toBe(403);
  });

  it("rejects unknown fields and unknown topics (strictBody)", async () => {
    const t = await h.createTenant();
    const bad = await t.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "nonsense",
    });
    expect(bad.status).toBe(400);
    const extra = await t.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "einvoice",
      surprise: true,
    });
    expect(extra.status).toBe(400);
  });

  it("lets a read-only viewer ask the firm for help", async () => {
    const t = await h.createTenant({ role: "viewer" });
    const res = await t.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "corporate_tax",
      period: "2026",
    });
    expect(res.status, res.text).toBe(201);
  });

  it("NR firm staff can read the queue", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    await t.as.post(`/api/companies/${t.company.id}/najma-handoff`, {
      topic: "year_end_close",
      period: "FY ending 2025-12-31",
    });
    const staff = await h.createTenant({ firmRole: "firm_owner" });
    const queue = await staff.as.get("/api/firm/value-ops/handoff-requests");
    expect(queue.status, queue.text).toBe(200);
    expect(queue.body.items.some((i: { companyId: string }) => i.companyId === t.company.id)).toBe(
      true
    );
  });
});

describe("X6d e-invoicing readiness checklist", () => {
  it("flags a missing trade licence and a B2B customer without an address, with fix links", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, trade_licence_no: null, einvoice_scope: "b2b" },
    });
    await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "No Address Trading",
      trnNumber: "100765432100003",
    });
    const res = await t.as.get(`/api/companies/${t.company.id}/einvoicing/readiness`);
    expect(res.status, res.text).toBe(200);
    const byKey = Object.fromEntries(
      res.body.items.map((i: { key: string }) => [i.key, i])
    ) as Record<string, { status: string; samples: string[]; fixHref: string }>;
    expect(byKey.supplier_identity.status).toBe("todo");
    expect(byKey.supplier_identity.samples).toContain("company.tradeLicenceNo");
    expect(byKey.supplier_identity.fixHref).toBe("/settings/einvoicing");
    expect(byKey.customer_details.status).toBe("todo");
    expect(byKey.customer_details.samples).toContain("No Address Trading");
    expect(byKey.customer_details.fixHref).toBe("/contacts");
    expect(byKey.provider.status).toBe("todo");
    // Honest transmission: nothing is sent with no provider connected.
    expect(res.body.transmission.enabled).toBe(false);
    expect(res.body.done).toBeLessThan(res.body.total);
  });

  it("goes green for identity and customers once the details are complete", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_turnover_band: "standard" },
    });
    await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Complete Buyer FZ-LLC",
      trnNumber: "100765432100003",
      address: "Building 7, Dubai Internet City",
      city: "Dubai",
      emirate: "dubai",
      country: "AE",
    });
    const res = await t.as.get(`/api/companies/${t.company.id}/einvoicing/readiness`);
    const byKey = Object.fromEntries(
      res.body.items.map((i: { key: string }) => [i.key, i])
    ) as Record<string, { status: string }>;
    expect(byKey.scope.status).toBe("done");
    expect(byKey.supplier_identity.status).toBe("done");
    expect(byKey.customer_details.status).toBe("done");
    expect(res.body.mandate.goLiveDate).toBe("2027-07-01");
  });

  it("is tenant-scoped", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const res = await other.as.get(`/api/companies/${t.company.id}/einvoicing/readiness`);
    expect([403, 404]).toContain(res.status);
  });
});

describe("X6d invoice-list compliance pills", () => {
  async function issued(t: Awaited<ReturnType<typeof h.createTenant>>) {
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme Gulf FZ-LLC",
      customerTrn: "100765432100003",
      date: today(),
      paymentTerms: "net30",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 500, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBe(200);
    return inv.body as { id: string };
  }

  it("shows no pills while the mandate does not apply", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    await issued(t);
    const res = await t.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ mandateApplies: false, items: [] });
  });

  it("shows the report-by date and states once the company is opted in", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_go_live_date: "2025-01-01" },
    });
    const inv = await issued(t);
    const res = await t.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect(res.status, res.text).toBe(200);
    expect(res.body.mandateApplies).toBe(true);
    const row = res.body.items.find((i: { invoiceId: string }) => i.invoiceId === inv.id);
    expect(row).toBeTruthy();
    expect(row.reportingRequired).toBe(true);
    expect(row.reporting).toBe("pending");
    expect(row.delivery).toBe("draft");
    expect(row.reportBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.overdue).toBe(false);
  });

  it("is tenant-scoped", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const res = await other.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect([403, 404]).toContain(res.status);
  });
});
