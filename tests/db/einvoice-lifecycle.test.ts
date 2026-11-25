/**
 * W4-C UAE e-invoicing on the real app + Postgres:
 *   R07-04/R07-05 generate a PINT AE document from stored data and validate it,
 *   R07-13/R03-18 settings honesty, submit → cleared with the mock ASP, retries
 *   with backoff, cancellation, the immutable five-year archive and tenancy.
 */
import { describe, expect, it } from "vitest";
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

  it("replaces an ambiguous legacy card setting with an explicit credit or debit card", async () => {
    const t = await readyTenant();
    const settings = `/api/companies/${t.company.id}/einvoicing/settings`;
    await h.sql("UPDATE companies SET einvoice_payment_means_code = '48' WHERE id = $1", [
      t.company.id,
    ]);
    const unrelatedEdit = await t.as.put(settings, { tradeLicenceNo: "CN-9876543" });
    expect(unrelatedEdit.status, unrelatedEdit.text).toBe(200);
    expect(unrelatedEdit.body.identity.einvoicePaymentMeansCode).toBe("48");

    for (const code of ["54", "55"]) {
      const saved = await t.as.put(settings, { einvoicePaymentMeansCode: code });
      expect(saved.status, saved.text).toBe(200);
      expect((await t.as.get(settings)).body.identity.einvoicePaymentMeansCode).toBe(code);
    }
    const ambiguous = await t.as.put(settings, { einvoicePaymentMeansCode: "48" });
    expect(ambiguous.status, ambiguous.text).toBe(400);
    expect((await t.as.get(settings)).body.identity.einvoicePaymentMeansCode).toBe("55");
  });

  it("stores UAE Peppol addresses entered with localized digits in ASCII", async () => {
    const t = await readyTenant();
    const base = `/api/companies/${t.company.id}`;
    const seller = await t.as.put(`${base}/einvoicing/settings`, {
      peppolScheme: "٠٢٣٥",
      peppolParticipantId: "١٠٠١٢٣٤٥٦٧",
    });
    expect(seller.status, seller.text).toBe(200);
    expect(seller.body.identity).toMatchObject({
      peppolScheme: "0235",
      peppolParticipantId: "1001234567",
    });

    const contact = await t.as.post(`${base}/customer-contacts`, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: "100765432100003",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    // Legacy row: the stored TRN itself is in Arabic-Indic digits.
    await h.sql(`UPDATE customer_contacts SET trn_number = $1 WHERE id = $2 AND company_id = $3`, [
      "١٠٠٧٦٥٤٣٢١٠٠٠٠٣",
      contact.body.id,
      t.company.id,
    ]);
    const url = `${base}/einvoicing/buyer-endpoints/${contact.body.id}`;
    const mismatch = await t.as.put(url, { scheme: "۰۲۳۵", participantId: "۱۰۰۹۹۹۹۹۹۹" });
    expect(mismatch.status, mismatch.text).toBe(422);
    expect(mismatch.body.code).toBe("EINVOICE_BUYER_ENDPOINT_MISMATCH");
    const buyer = await t.as.put(url, { scheme: "۰۲۳۵", participantId: "۱۰۰۷۶۵۴۳۲۱" });
    expect(buyer.status, buyer.text).toBe(200);
    expect(buyer.body).toMatchObject({ scheme: "0235", participantId: "1007654321" });
  });

  it("stores contact TRNs entered with localized digits in ASCII (create, update, import)", async () => {
    const t = await readyTenant();
    const base = `/api/companies/${t.company.id}/customer-contacts`;
    const storedTrn = async (id: string) => {
      const [row] = await h.sql<{ trn_number: string }>(
        `SELECT trn_number FROM customer_contacts WHERE id = $1 AND company_id = $2`,
        [id, t.company.id]
      );
      return row?.trn_number;
    };
    const storedTrnByEmail = async (email: string) => {
      const [row] = await h.sql<{ trn_number: string }>(
        `SELECT trn_number FROM customer_contacts WHERE email = $1 AND company_id = $2`,
        [email, t.company.id]
      );
      return row?.trn_number;
    };

    const created = await t.as.post(base, {
      name: "Localized TRN LLC",
      trnNumber: "١٠٠٧٦٥٤٣٢١٠٠٠٠٣",
    });
    expect(created.status, created.text).toBeLessThan(300);
    expect(created.body.trnNumber).toBe("100765432100003");
    expect(await storedTrn(created.body.id)).toBe("100765432100003");

    const updated = await t.as.put(`${base}/${created.body.id}`, {
      trnNumber: "۱۰۰۱۲۳۴۵۶۷۰۰۰۰۳",
    });
    expect(updated.status, updated.text).toBe(200);
    expect(await storedTrn(created.body.id)).toBe("100123456700003");

    const insert = await t.as.post(`${base}/import`, {
      contacts: [{ name: "Imported Co", email: "imp@example.com", trnNumber: "١٠٠٧٦٥٤٣٢١٠٠٠٠٣" }],
    });
    expect(insert.status, insert.text).toBe(200);
    expect(insert.body).toMatchObject({ created: 1, updated: 0 });
    expect(await storedTrnByEmail("imp@example.com")).toBe("100765432100003");
    const upd = await t.as.post(`${base}/import`, {
      contacts: [{ name: "Imported Co", email: "imp@example.com", trnNumber: "۱۰۰۱۲۳۴۵۶۷۰۰۰۰۳" }],
    });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body).toMatchObject({ created: 0, updated: 1 });
    expect(await storedTrnByEmail("imp@example.com")).toBe("100123456700003");
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
    const { MockEInvoiceProvider } = await import("../../server/services/einvoice-provider");
    const { storage } = await import("../../server/storage");
    const { enqueueEInvoiceSubmission, refreshAndPersist, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const provider = new MockEInvoiceProvider();
    const company = (await storage.getCompany(t.company.id))!;
    const getInvoice = async () => (await storage.getInvoice(inv.id, company.id))!;
    const opts = { company, provider };
    const sub = await enqueueEInvoiceSubmission({ ...opts, invoice: await getInvoice() });
    expect(sub).toMatchObject({
      ok: true,
      update: { einvoiceStatus: "queued" },
      documentRow: { deliveryStatus: "queued", attempts: 0 },
    });
    expect(await runEInvoiceRetries(new Date(), () => provider)).toMatchObject({ submitted: 1 });
    const again = await enqueueEInvoiceSubmission({ ...opts, invoice: await getInvoice() });
    expect(again).toMatchObject({ ok: false, status: 409, code: "EINVOICE_ALREADY_SUBMITTED" });

    const ref = await refreshAndPersist({ ...opts, invoice: await getInvoice() });
    expect(ref).toMatchObject({ ok: true, update: { einvoiceStatus: "cleared" } });

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
    const { enqueueEInvoiceSubmission, runEInvoiceRetries } =
      await import("../../server/services/einvoice/workflow");
    const invoice = (await storage.getInvoice(inv.id, t.company.id))!;
    const company = (await storage.getCompany(t.company.id))!;
    const t0 = new Date();
    const first = await enqueueEInvoiceSubmission({ invoice, company, provider: flaky, now: t0 });
    expect(first).toMatchObject({
      ok: true,
      update: { einvoiceStatus: "queued" },
      documentRow: { deliveryStatus: "queued", attempts: 0 },
    });
    expect(await runEInvoiceRetries(t0, () => flaky)).toEqual({ attempted: 1, submitted: 0 });
    let doc = (
      await h.sql(
        `SELECT status, attempts, next_retry_at AT TIME ZONE 'UTC' AS next_retry_at, last_error
           FROM einvoice_documents WHERE invoice_id = $1`,
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
