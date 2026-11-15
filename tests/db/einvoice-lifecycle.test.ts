/**
 * W4-C UAE e-invoicing on the real app + Postgres:
 *   R07-04/R07-05 generate a PINT AE document from stored data and validate it,
 *   R07-13/R03-18 settings honesty, submit → cleared with the mock ASP, retries
 *   with backoff, cancellation, the immutable five-year archive and tenancy.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import type { EInvoiceProvider } from "../../server/services/einvoice-provider";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

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

async function readyTenant(): Promise<Tenant> {
  return h.createTenant({ companyColumns: SELLER_COLUMNS });
}

async function issuedInvoice(t: Tenant) {
  const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name: "Acme Gulf FZ-LLC",
    trnNumber: "100765432100003",
    address: "Building 7, Dubai Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(c.status, c.text).toBeLessThan(300);
  const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme Gulf FZ-LLC",
    customerTrn: "100765432100003",
    contactId: c.body.id,
    date: today(),
    paymentTerms: "net30",
    lines: [
      { description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 },
      {
        description: "Exported spare parts",
        quantity: 1,
        unitPrice: 300,
        vatRate: 0,
        vatSupplyType: "zero_rated",
      },
      {
        description: "Residential lease",
        quantity: 1,
        unitPrice: 200,
        vatRate: 0,
        vatSupplyType: "exempt",
      },
    ],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  return inv.body as { id: string; number: string };
}

const env = { ...process.env };
afterEach(() => {
  for (const k of ["EINVOICE_PROVIDER", "EINVOICE_ASP_BASE_URL", "EINVOICE_ASP_API_KEY"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

describe("W4-C settings are honest about the ASP boundary", () => {
  it("[R07-13] shows 'requires external' / not connected, and stores participant ids with validation", async () => {
    const t = await readyTenant();
    const s = await t.as.get(`/api/companies/${t.company.id}/einvoicing/settings`);
    expect(s.status, s.text).toBe(200);
    expect(s.body.asp.capability.status).toBe("requires_external");
    expect(s.body.asp.connected).toBe(false);
    expect(s.body.identity.participantIdFallback).toBe("1001234567");
    expect(s.body.validation).toMatchObject({ xsd: true, schematron: true });
    expect(s.body.inbound.enabled).toBe(false);

    const bad = await t.as.put(`/api/companies/${t.company.id}/einvoicing/settings`, {
      peppolParticipantId: "12345",
    });
    expect(bad.status).toBe(400);
    const unknown = await t.as.put(`/api/companies/${t.company.id}/einvoicing/settings`, {
      status: "live",
    });
    expect(unknown.status).toBe(400);

    const ok = await t.as.put(`/api/companies/${t.company.id}/einvoicing/settings`, {
      peppolParticipantId: "1001234567",
      peppolScheme: "0235",
      einvoicePayeeIban: "AE070331234567890123456",
      einvoicePaymentMeansCode: "30",
      einvoiceScope: "b2b",
      einvoiceTurnoverBand: "large",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.scope).toMatchObject({ scope: "b2b", band: "large", goLiveDate: "2027-01-01" });
    const row = await h.sql(
      `SELECT peppol_participant_id, einvoice_turnover_band FROM companies WHERE id = $1`,
      [t.company.id]
    );
    expect(row[0]).toEqual({
      peppol_participant_id: "1001234567",
      einvoice_turnover_band: "large",
    });
  });

  it("[R07-13] a viewer cannot change e-invoicing settings and another tenant cannot read them", async () => {
    const t = await readyTenant();
    const viewer = await h.createTenant({ role: "viewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    const put = await viewer.as.put(`/api/companies/${t.company.id}/einvoicing/settings`, {
      einvoiceScope: "none",
    });
    expect(put.status).toBe(403);
    const other = await h.createSecondTenant();
    const get = await other.as.get(`/api/companies/${t.company.id}/einvoicing/settings`);
    expect([403, 404]).toContain(get.status);
  });
});

describe("W4-C generate → submit → cleared, archived immutably", () => {
  it("[R07-04][R07-05] generates a validated PINT AE document with per-line S/Z/E categories", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const g = await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    expect(g.status, g.text).toBe(200);
    expect(g.body.validation).toMatchObject({ valid: true });
    expect(g.body.validation.schematron).toMatchObject({ available: true, errorCount: 0 });
    const xml = await t.as.get(`/api/invoices/${inv.id}/einvoice-xml`);
    expect(xml.text).toContain('<cbc:EndpointID schemeID="0235">1001234567</cbc:EndpointID>');
    expect(xml.text).toContain("<cbc:CountrySubentity>DXB</cbc:CountrySubentity>");
    const cats = [
      ...xml.text.matchAll(/<cac:ClassifiedTaxCategory>\s*<cbc:ID>(\w+)<\/cbc:ID>/g),
    ].map((m) => m[1]);
    expect(cats).toEqual(["S", "Z", "E"]);
    expect(xml.text).toContain(
      "<cbc:TaxExemptionReasonCode>VATEX-AE-EX</cbc:TaxExemptionReasonCode>"
    );
    const doc = await h.sql(
      `SELECT status, document_type, validation->>'valid' AS valid FROM einvoice_documents WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(doc[0]).toEqual({ status: "generated", document_type: "380", valid: "true" });
  });

  it("[R07-13][R03-18] submits through the mock ASP, refreshes to cleared and archives both copies immutably", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    const sub = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(sub.status, sub.text).toBe(200);
    expect(sub.body).toMatchObject({
      status: "submitted",
      provider: "mock",
      environment: "mock",
      attempts: 1,
    });
    const again = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("EINVOICE_ALREADY_SUBMITTED");

    const ref = await t.as.post(`/api/invoices/${inv.id}/einvoice/refresh-status`, {});
    expect(ref.status, ref.text).toBe(200);
    expect(ref.body.status).toBe("cleared");

    const list = await t.as.get(`/api/companies/${t.company.id}/einvoicing/archive`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { kind: string }) => i.kind).sort()).toEqual([
      "cleared",
      "submitted",
    ]);
    const entry = list.body.items[0];
    expect(entry.retainUntil).toBe(`${new Date().getUTCFullYear() + 5}-12-31`);
    const dl = await t.as.get(`/api/companies/${t.company.id}/einvoicing/archive/${entry.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("x-content-sha256")).toBe(entry.sha256);
    expect(dl.text).toContain("urn:peppol:pint:billing-1@ae-1");

    await expect(
      h.sql(`UPDATE einvoice_archive SET xml = 'tampered' WHERE id = $1`, [entry.id])
    ).rejects.toThrow(/immutable/);
    await expect(h.sql(`DELETE FROM einvoice_archive WHERE id = $1`, [entry.id])).rejects.toThrow(
      /immutable/
    );

    const other = await h.createSecondTenant();
    const leak = await other.as.get(
      `/api/companies/${t.company.id}/einvoicing/archive/${entry.id}`
    );
    expect([403, 404]).toContain(leak.status);
    const mixed = await other.as.get(
      `/api/companies/${other.company.id}/einvoicing/archive/${entry.id}`
    );
    expect(mixed.status).toBe(404);

    const cancel = await t.as.post(`/api/invoices/${inv.id}/einvoice/cancel`, {
      reason: "issued in error",
    });
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe("EINVOICE_CREDIT_NOTE_REQUIRED");
  });

  it("[R07-13] answers 503 EINVOICE_PROVIDER_NOT_CONFIGURED when no usable ASP is configured", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    process.env.EINVOICE_PROVIDER = "http"; // http without base URL / key
    const sub = await t.as.post(`/api/invoices/${inv.id}/einvoice/submit`, {});
    expect(sub.status).toBe(503);
    expect(sub.body.code).toBe("EINVOICE_PROVIDER_NOT_CONFIGURED");
    const st = await h.sql(`SELECT einvoice_status FROM invoices WHERE id = $1`, [inv.id]);
    expect(st[0].einvoice_status).toBeNull();
  });

  it("[R07-04] refuses to generate for an incomplete supplier with fix-it issues", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER_COLUMNS, trade_licence_no: null, address_city: null },
    });
    const inv = await issuedInvoice(t);
    const g = await t.as.post(`/api/invoices/${inv.id}/generate-einvoice`, {});
    expect(g.status).toBe(422);
    expect(g.body.code).toBe("EINVOICE_VALIDATION_FAILED");
    expect(g.body.issues.map((i: { field: string }) => i.field)).toEqual(
      expect.arrayContaining(["company.addressCity", "company.tradeLicenceNo"])
    );
  });
});

describe("W4-C transport failures are retried with backoff", () => {
  it("[R07-13] a failed hand-off is scheduled, retried by the job and then succeeds", async () => {
    const t = await readyTenant();
    const inv = await issuedInvoice(t);
    let calls = 0;
    const flaky: EInvoiceProvider = {
      name: "flaky",
      environment: "sandbox",
      capabilities: { submit: true, getStatus: true, receive: false, cancel: false },
      submit: async (s) => {
        calls++;
        return calls === 1
          ? { providerMessageId: "", status: "failed", detail: "ETIMEDOUT" }
          : { providerMessageId: `flaky-${s.uuid}`, status: "submitted" };
      },
      getStatus: async (id) => ({ providerMessageId: id, status: "cleared" }),
      receive: async () => [],
      cancel: async (id) => ({ providerMessageId: id, status: "cancelled" }),
      parseWebhook: () => null,
    };
    // Server modules are imported after the harness bound the database.
    const { storage } = await import("../../server/storage");
    const { runEInvoiceRetries, submitAndPersist } =
      await import("../../server/services/einvoice/workflow");
    const invoice = (await storage.getInvoice(inv.id, t.company.id))!;
    const company = (await storage.getCompany(t.company.id))!;
    const t0 = new Date();
    const first = await submitAndPersist({ invoice, company, provider: flaky, now: t0 });
    expect(first.ok).toBe(true);
    let doc = (
      await h.sql(
        `SELECT status, attempts, next_retry_at, last_error FROM einvoice_documents WHERE invoice_id = $1`,
        [inv.id]
      )
    )[0];
    expect(doc).toMatchObject({ status: "failed", attempts: 1, last_error: "ETIMEDOUT" });
    expect(new Date(doc.next_retry_at).getTime() - t0.getTime()).toBe(60_000);
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM einvoice_archive WHERE invoice_id = $1`, [
          inv.id,
        ])
      )[0].n
    ).toBe(0);

    // Not due yet: nothing happens.
    expect(await runEInvoiceRetries(new Date(t0.getTime() + 30_000), () => flaky)).toEqual({
      attempted: 0,
      submitted: 0,
    });
    const r = await runEInvoiceRetries(new Date(t0.getTime() + 61_000), () => flaky);
    expect(r).toEqual({ attempted: 1, submitted: 1 });
    doc = (
      await h.sql(
        `SELECT status, attempts, next_retry_at FROM einvoice_documents WHERE invoice_id = $1`,
        [inv.id]
      )
    )[0];
    expect(doc).toMatchObject({ status: "submitted", attempts: 2, next_retry_at: null });
    expect(
      (await h.sql(`SELECT kind FROM einvoice_archive WHERE invoice_id = $1`, [inv.id])).map(
        (x) => x.kind
      )
    ).toEqual(["submitted"]);
  });
});
