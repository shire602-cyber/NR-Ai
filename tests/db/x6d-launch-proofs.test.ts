/**
 * X6d launch proofs on the real app + Postgres:
 *   - "Ask Najma Al Raeda" handoff is stored in-app (no email), tenant-scoped, readable by NR staff
 *   - e-invoice readiness checklist is built from the PINT AE rule hints
 *   - invoice-list compliance pills exist only when the e-invoicing mandate applies
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";
import { fixtureCompany, PINT_AE_FIXTURES } from "../fixtures/pint-ae/fixtures";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const today = () => dubaiToday();

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

  it("derives status for requested company invoices even beyond the former document cutoff", async () => {
    const tenant = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_go_live_date: "2025-01-01" },
    });
    const invoice = await issued(tenant);
    const other = await h.createSecondTenant();
    const otherInvoice = await issued(other);
    await h.sql(
      `INSERT INTO einvoice_documents
         (company_id, invoice_id, status, provider, provider_status, provider_message_id,
          delivery_status, reporting_status, report_by, updated_at)
       VALUES ($1, $2, 'accepted', 'complyance', 'final_valid', 'fixture-document',
               'delivered', 'reported', '2026-11-30', now() - interval '1 day')`,
      [tenant.company.id, invoice.id]
    );
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, updated_at)
       SELECT $1, gen_random_uuid(), 'generated', now() FROM generate_series(1, 501)`,
      [tenant.company.id]
    );
    const result = await tenant.as.get(
      `/api/companies/${tenant.company.id}/einvoicing/compliance?invoiceIds=${invoice.id},${otherInvoice.id}`
    );
    expect(result.status, result.text).toBe(200);
    expect(result.body.items).toMatchObject([
      { invoiceId: invoice.id, reportingRequired: true, delivery: "delivered" },
    ]);
    expect(result.body.documents).toMatchObject([
      { invoiceId: invoice.id, provider: "complyance", providerStatus: "final_valid" },
    ]);
  });

  async function projections(t: Awaited<ReturnType<typeof h.createTenant>>, invoiceId: string) {
    const prefix = `/api/companies/${t.company.id}/einvoicing`;
    const [batch, documents, status] = await Promise.all([
      t.as.get(`${prefix}/compliance?invoiceIds=${invoiceId}`),
      t.as.get(`${prefix}/documents`),
      t.as.get(`/api/invoices/${invoiceId}/einvoice/status`),
    ]);
    for (const response of [batch, documents, status])
      expect(response.status, response.text).toBe(200);
    const byInvoice = (item: { invoiceId: string }) => item.invoiceId === invoiceId;
    return {
      pill: batch.body.items.find(byInvoice),
      batchDoc: batch.body.documents.find(byInvoice),
      document: documents.body.items.find(byInvoice),
      status: status.body.tracks.reporting,
    };
  }

  it("does not invent a reporting deadline for an older accepted invoice from edited live buyer and mandate fields", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_go_live_date: "2025-01-01" },
    });
    const inv = await issued(t);
    await h.sql(
      `UPDATE invoices SET date = '2026-04-03', einvoice_status = 'accepted',
          einvoice_provider = 'acube', einvoice_provider_message_id = 'legacy-document'
        WHERE company_id = $1 AND id = $2`,
      [t.company.id, inv.id]
    );
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider, provider_message_id, provider_status, delivery_status)
       VALUES ($1, $2, 'accepted', 'acube', 'legacy-document', 'accepted', 'delivered')`,
      [t.company.id, inv.id]
    );

    const view = await projections(t, inv.id);
    expect(view.status).toMatchObject({
      required: false,
      obligationKnown: false,
      reportBy: null,
      overdue: false,
    });
    expect(view.pill).toMatchObject({
      reportingRequired: false,
      reportingObligationKnown: false,
      reportBy: null,
      overdue: false,
    });
    expect(view.batchDoc).toMatchObject({ reportBy: null });
    expect(view.document).toMatchObject({
      reportingRequired: false,
      reportingObligationKnown: false,
      reportBy: null,
    });
    await h.sql("UPDATE companies SET einvoice_scope = 'none' WHERE id = $1", [t.company.id]);
    const paused = await projections(t, inv.id);
    expect(paused.pill).toMatchObject({ reportingObligationKnown: false, reportBy: null });
  });

  it("retains a known historic obligation without inventing a missing deadline", async () => {
    const t = await h.createTenant({ companyColumns: { ...SELLER, einvoice_scope: "none" } });
    const inv = await issued(t);
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider, provider_message_id, delivery_status, validation)
       VALUES ($1, $2, 'submitted', 'acube', 'old-obligation', 'sending', '{"submission":{"reportingRequired":true}}')`,
      [t.company.id, inv.id]
    );
    const view = await projections(t, inv.id);
    expect(view.status).toMatchObject({
      status: "pending",
      required: true,
      obligationKnown: true,
      reportBy: null,
      overdue: false,
    });
    expect(view.pill).toMatchObject({
      reportingRequired: true,
      reportingObligationKnown: true,
      reportBy: null,
      overdue: false,
    });
    expect(view.batchDoc).toMatchObject({ reportingRequired: true, reportBy: null });
    expect(view.document).toMatchObject({ reportingRequired: true, reportBy: null });
  });

  it("re-evaluates generated-only rows using the current buyer and mandate before submission", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_go_live_date: "2025-01-01" },
    });
    const inv = await issued(t);
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "VAT Buyer",
      trnNumber: "100765432100003",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    await h.sql(
      "UPDATE invoices SET customer_trn = NULL, contact_id = $2, einvoice_status = 'generated', date = '2026-05-05' WHERE id = $1",
      [inv.id, contact.body.id]
    );
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, validation, report_by)
       VALUES ($1, $2, 'generated', '{"submission":{"reportingRequired":false}}', NULL)`,
      [t.company.id, inv.id]
    );
    const view = await projections(t, inv.id);
    expect(view.status).toMatchObject({
      required: true,
      obligationKnown: true,
      reportBy: "2026-05-19",
    });
    expect(view.pill).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });
    expect(view.document).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });
  });

  it("ignores stale generated XML when projecting the current buyer in list and detail", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, einvoice_scope: "b2b", einvoice_go_live_date: "2025-01-01" },
    });
    const inv = await issued(t);
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Updated VAT Buyer",
      trnNumber: "100765432100003",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    const { generateEInvoiceXML } = await import("../../server/services/einvoice.service");
    const source = PINT_AE_FIXTURES[0];
    const draftXml = generateEInvoiceXML(
      { ...source.invoice, customerTrn: null },
      source.lines,
      fixtureCompany,
      { ...source.customer, trn: null },
      source.opts
    ).xml;
    await h.sql(
      `UPDATE invoices SET customer_trn = NULL, contact_id = $2, einvoice_status = 'generated',
         einvoice_xml = $3, date = '2026-05-05' WHERE id = $1`,
      [inv.id, contact.body.id, draftXml]
    );
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status) VALUES ($1, $2, 'generated')`,
      [t.company.id, inv.id]
    );
    const view = await projections(t, inv.id);
    expect(view.pill).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });
    expect(view.document).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });
    expect(view.status).toMatchObject({ required: true, reportBy: "2026-05-19" });
  });

  it("retains an explicit historic report-by date across company and buyer changes", async () => {
    const t = await h.createTenant({ companyColumns: { ...SELLER, einvoice_scope: "none" } });
    const inv = await issued(t);
    await h.sql("UPDATE invoices SET customer_trn = NULL WHERE company_id = $1 AND id = $2", [
      t.company.id,
      inv.id,
    ]);
    await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider, provider_message_id, delivery_status, reporting_status, report_by, validation)
       VALUES ($1, $2, 'submitted', 'acube', 'document-with-deadline', 'sending', 'not_required', '2026-05-19', '{"submission":{"reportingRequired":false}}')`,
      [t.company.id, inv.id]
    );

    const view = await projections(t, inv.id);
    expect(view.status).toMatchObject({ required: true, reportBy: "2026-05-19" });
    expect(view.pill).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });
    expect(view.batchDoc).toMatchObject({ reportBy: "2026-05-19" });
    expect(view.document).toMatchObject({ reportingRequired: true, reportBy: "2026-05-19" });

    await h.sql("UPDATE invoices SET status = 'void' WHERE company_id = $1 AND id = $2", [
      t.company.id,
      inv.id,
    ]);
    const voidView = await projections(t, inv.id);
    expect(voidView.pill).toBeUndefined();
    expect(voidView.status).toMatchObject({ reportBy: null, overdue: false });
    expect(voidView.batchDoc).toMatchObject({ reportBy: null });
    expect(voidView.document).toMatchObject({ reportBy: null });
  });

  it("is tenant-scoped", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const res = await other.as.get(`/api/companies/${t.company.id}/einvoicing/compliance`);
    expect([403, 404]).toContain(res.status);
  });
});
