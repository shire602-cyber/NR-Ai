/**
 * WQ5 on the real app + Postgres: e-invoicing identity, the first-invoice prompt, partner
 * choice (no default, nothing transmitted without a configured provider), the no-login
 * approver link, unified customer/supplier contacts and the firm console column.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";

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

const base = (t: Tenant) => `/api/companies/${t.company.id}/einvoicing`;

async function addMember(owner: Tenant, member: Tenant, role: string) {
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    owner.company.id,
    member.user.id,
    role,
  ]);
}

const partnerIds = async (t: Tenant) =>
  ((await t.as.get(`${base(t)}/partner`)).body.partners as Array<{ id: string }>).map((p) => p.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WQ5 company e-invoicing identity", () => {
  it("prefills the TIN from the CT TRN, stores it, and refuses a TIN that does not match", async () => {
    const t = await h.createTenant({
      companyColumns: { ...SELLER, corporate_tax_id: "100123456700003" },
    });
    const view = await t.as.get(`${base(t)}/identity`);
    expect(view.status, view.text).toBe(200);
    expect(view.body).toMatchObject({
      einvoiceTin: null,
      tinSuggestion: "1001234567",
      tinSource: "ct_trn",
      effectiveTin: "1001234567",
    });

    const bad = await t.as.put(`${base(t)}/identity`, { einvoiceTin: "1009999999" });
    expect(bad.status, bad.text).toBe(422);
    expect(bad.body.code).toBe("TIN_CT_TRN_MISMATCH");
    const format = await t.as.put(`${base(t)}/identity`, { einvoiceTin: "2001234567" });
    expect(format.status).toBe(422);
    expect(format.body.code).toBe("TIN_FORMAT");
    const unknownKey = await t.as.put(`${base(t)}/identity`, { trnVatNumber: "x" });
    expect(unknownKey.status).toBe(400);

    const ok = await t.as.put(`${base(t)}/identity`, {
      einvoiceTin: "1001234567",
      sellerIdType: "EID",
      sellerIdNumber: "784-1990-1234567-1",
      addressDistrict: "Trade Centre",
      addressPoBox: "12345",
      legalNameAr: "بيرل للتجارة ش.ذ.م.م",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ einvoiceTin: "1001234567", tinSource: "stored", missing: [] });
    const [row] = await h.sql(
      `SELECT einvoice_tin, seller_id_type, seller_id_number, address_district, legal_name_ar
         FROM companies WHERE id = $1`,
      [t.company.id]
    );
    expect(row).toEqual({
      einvoice_tin: "1001234567",
      seller_id_type: "EID",
      seller_id_number: "784-1990-1234567-1",
      address_district: "Trade Centre",
      legal_name_ar: "بيرل للتجارة ش.ذ.م.م",
    });

    const badEid = await t.as.put(`${base(t)}/identity`, { sellerIdNumber: "12345" });
    expect(badEid.status).toBe(422);
    expect(badEid.body.code).toBe("SELLER_ID_EID_FORMAT");
  });

  it("only admins write the identity; another company gets no access", async () => {
    const owner = await h.createTenant({ companyColumns: SELLER });
    const viewer = await h.createSecondTenant();
    await addMember(owner, viewer, "viewer");
    const asViewer = await viewer.as.put(`${base(owner)}/identity`, { addressDistrict: "X" });
    expect(asViewer.status).toBe(403);
    const stranger = await h.createTenant({ name: "Stranger" });
    const cross = await stranger.as.get(`${base(owner)}/identity`);
    expect([403, 404]).toContain(cross.status);
  });
});

describe("WQ5 first-invoice tax-ready prompt", () => {
  it("shows only when fields are missing, lists only those, and only once", async () => {
    const complete = await h.createTenant({ companyColumns: SELLER });
    const none = await complete.as.get(`${base(complete)}/tax-ready`);
    expect(none.body).toMatchObject({ show: false, missing: [] });

    const t = await h.createTenant({
      name: "Sparse",
      companyColumns: { trn_vat_number: "100123456700003", address_country: "AE" },
    });
    const first = await t.as.get(`${base(t)}/tax-ready`);
    expect(first.status, first.text).toBe(200);
    expect(first.body.show).toBe(true);
    expect(first.body.missing).toEqual(["sellerId", "addressStreet", "addressCity", "emirate"]);

    const shown = await t.as.post(`${base(t)}/tax-ready/shown`, {});
    expect(shown.status, shown.text).toBe(200);
    expect(shown.body.show).toBe(false);
    // Still missing, but never shown again.
    const again = await t.as.get(`${base(t)}/tax-ready`);
    expect(again.body).toMatchObject({ show: false });
    expect(again.body.missing.length).toBe(4);
  });
});

describe("WQ5 partner choice and the provider gate", () => {
  it("offers every accredited provider with no default and transmits nothing without one", async () => {
    const saved = process.env.EINVOICE_PROVIDER;
    delete process.env.EINVOICE_PROVIDER;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const t = await h.createTenant({ companyColumns: SELLER });
      const view = await t.as.get(`${base(t)}/partner`);
      expect(view.status, view.text).toBe(200);
      expect(view.body.partners.length).toBeGreaterThanOrEqual(2);
      expect(view.body.partners.every((p: { live: boolean }) => !p.live)).toBe(true);
      expect(view.body).toMatchObject({
        chosen: null,
        liveProvider: null,
        verifyAvailable: false,
        appointment: { state: "not_started" },
      });

      const [firstId, secondId] = await partnerIds(t);
      for (const id of [firstId, secondId]) {
        const pick = await t.as.put(`${base(t)}/partner`, { partner: id });
        expect(pick.status, pick.text).toBe(200);
        expect(pick.body).toMatchObject({ chosen: id, verifyAvailable: false });
        // The provider's own verify (sync) route refuses honestly: not configured.
        const sync = await t.as.post(`${base(t)}/${id}/sync`, {});
        expect(sync.status).toBeGreaterThanOrEqual(400);
      }
      const unknown = await t.as.put(`${base(t)}/partner`, { partner: "nobody" });
      expect(unknown.status).toBe(422);

      const confirm = await t.as.post(`${base(t)}/partner/self-confirm`, { confirmed: true });
      expect(confirm.status, confirm.text).toBe(200);
      expect(confirm.body.appointment.state).toBe("self_confirmed");

      // Changing partner clears the self-confirmation (a different EmaraTax appointment).
      const switched = await t.as.put(`${base(t)}/partner`, { partner: firstId });
      expect(switched.body.appointment.state).toBe("not_started");

      // Nothing left the process: no provider call was made.
      const external = fetchSpy.mock.calls.filter(([u]) => !String(u).includes("127.0.0.1"));
      expect(external).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.EINVOICE_PROVIDER;
      else process.env.EINVOICE_PROVIDER = saved;
    }
  });
});

describe("WQ5 no-login approver link", () => {
  it("withdraws both types of approval when the taxpayer's full VAT registration changes", async () => {
    const t = await h.createTenant({ companyColumns: { ...SELLER, einvoice_partner: "acube" } });
    const create = async () => {
      const link = await t.as.post(`${base(t)}/approver-links`, {});
      expect(link.status, link.text).toBe(201);
      return String(link.body.url).split("/portal/einvoicing-approve/")[1];
    };
    const portal = (token: string) => `/api/portal/einvoicing-approve/${token}`;
    const completed = await create();
    const pending = await create();
    expect((await h.anon.post(`${portal(completed)}/done`, {})).body.state).toBe("completed");
    expect(
      (await t.as.post(`${base(t)}/partner/self-confirm`, { confirmed: true })).body.appointment
        .state
    ).toBe("self_confirmed");

    // The TIN and selected provider are unchanged. The full VAT registration is not.
    const { storage } = await import("../../server/storage");
    await storage.updateCompany(t.company.id, { trnVatNumber: "100123456710003" });
    const { firmEInvoicingStates } = await import("../../server/services/einvoice/identity");
    expect((await t.as.get(`${base(t)}/partner`)).body.appointment).toMatchObject({
      state: "not_started",
      confirmedAt: null,
    });
    expect((await firmEInvoicingStates([t.company.id])).get(t.company.id)?.state).toBe(
      "appoint_partner"
    );
    expect(
      (await t.as.get(`${base(t)}/approver-links`)).body.map((l: { state: string }) => l.state)
    ).toEqual(["revoked", "revoked"]);
    expect((await h.anon.get(portal(completed))).status).toBe(410);
    expect((await h.anon.post(`${portal(pending)}/done`, {})).status).toBe(410);
    await storage.updateCompany(t.company.id, { trnVatNumber: SELLER.trn_vat_number });
    expect((await h.anon.get(portal(completed))).status).toBe(410);
    expect((await t.as.get(`${base(t)}/partner`)).body.appointment.state).toBe("not_started");
    await h.sql("UPDATE companies SET trn_vat_number = '100123456710003' WHERE id = $1", [
      t.company.id,
    ]);

    const current = await create();
    expect((await h.anon.post(`${portal(current)}/done`, {})).body.state).toBe("completed");
    expect((await t.as.get(`${base(t)}/partner`)).body.appointment.state).toBe("approver_done");
    expect((await firmEInvoicingStates([t.company.id])).get(t.company.id)?.state).toBe(
      "approver_done"
    );
    // A read must verify the scope even if the restoration bypassed the application write path.
    await h.sql("UPDATE companies SET trn_vat_number = $2 WHERE id = $1", [
      t.company.id,
      SELLER.trn_vat_number,
    ]);
    expect((await h.anon.get(portal(current))).status).toBe(410);
    expect((await t.as.get(`${base(t)}/partner`)).body.appointment.state).toBe("not_started");
  });

  it("works without login, shows no TRN, notifies the owner, expires and can be revoked", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const noPartner = await t.as.post(`${base(t)}/approver-links`, { approverName: "Huda" });
    expect(noPartner.status).toBe(409);
    expect(noPartner.body.code).toBe("EINVOICE_PARTNER_REQUIRED");

    const [partner] = await partnerIds(t);
    await t.as.put(`${base(t)}/partner`, { partner });
    const created = await t.as.post(`${base(t)}/approver-links`, {
      approverName: "Huda",
      approverEmail: "huda@example.test",
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.state).toBe("active");
    const token = String(created.body.url).split("/portal/einvoicing-approve/")[1];
    expect(token.length).toBeGreaterThan(30);
    // Only the hash is stored.
    const [stored] = await h.sql(`SELECT token_hash FROM einvoice_approver_links WHERE id = $1`, [
      created.body.id,
    ]);
    expect(stored.token_hash).not.toContain(token);

    const page = await h.anon.get(`/api/portal/einvoicing-approve/${token}`);
    expect(page.status, page.text).toBe(200);
    expect(page.body).toMatchObject({ state: "active", approverName: "Huda" });
    expect(page.body.companyName).toBeTruthy();
    expect(page.body.partner.accreditationNumber).toBeTruthy();
    // Owner decision pending: no TRN / TIN on the no-login page.
    expect(page.text).not.toContain("100123456700003");
    expect(page.text).not.toContain("1001234567");

    const partnerView = await t.as.get(`${base(t)}/partner`);
    expect(partnerView.body.appointment.state).toBe("awaiting_approval");

    const done = await h.anon.post(`/api/portal/einvoicing-approve/${token}/done`, {});
    expect(done.status, done.text).toBe(200);
    expect(done.body.state).toBe("completed");
    const mails = await h.sql(
      `SELECT to_address, category FROM email_outbox WHERE company_id = $1 ORDER BY created_at`,
      [t.company.id]
    );
    expect(mails.map((m) => m.category)).toEqual([
      "einvoice_approver_link",
      "einvoice_approver_done",
    ]);
    expect(mails[1].to_address).toBe(t.email);
    // Done twice is idempotent (no second owner email).
    await h.anon.post(`/api/portal/einvoicing-approve/${token}/done`, {});
    const after = await h.sql(`SELECT 1 FROM email_outbox WHERE company_id = $1`, [t.company.id]);
    expect(after).toHaveLength(2);

    // Revoke a second link; then it is 410.
    const second = await t.as.post(`${base(t)}/approver-links`, {});
    const token2 = String(second.body.url).split("/portal/einvoicing-approve/")[1];
    const revoked = await t.as.post(`${base(t)}/approver-links/${second.body.id}/revoke`, {});
    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body.state).toBe("revoked");
    const gone = await h.anon.get(`/api/portal/einvoicing-approve/${token2}`);
    expect(gone.status).toBe(410);
    expect(gone.body.state).toBe("revoked");
    expect((await h.anon.post(`/api/portal/einvoicing-approve/${token2}/done`, {})).status).toBe(
      410
    );

    // Expiry (14 days): an expired link is 410 too.
    const third = await t.as.post(`${base(t)}/approver-links`, {});
    const token3 = String(third.body.url).split("/portal/einvoicing-approve/")[1];
    expect(new Date(third.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      13.9 * 86_400_000
    );
    await h.sql(
      `UPDATE einvoice_approver_links SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [third.body.id]
    );
    const expired = await h.anon.get(`/api/portal/einvoicing-approve/${token3}`);
    expect(expired.status).toBe(410);
    expect(expired.body.state).toBe("expired");

    // A made-up token is 404.
    expect((await h.anon.get(`/api/portal/einvoicing-approve/${"x".repeat(43)}`)).status).toBe(404);
  });

  it("another company's link id is 404, and viewers cannot list or create links", async () => {
    const a = await h.createTenant({ companyColumns: SELLER });
    const b = await h.createSecondTenant({ companyColumns: SELLER });
    for (const t of [a, b]) {
      const [p] = await partnerIds(t);
      await t.as.put(`${base(t)}/partner`, { partner: p });
    }
    const link = await a.as.post(`${base(a)}/approver-links`, {});
    expect(link.status).toBe(201);
    const cross = await b.as.post(`${base(b)}/approver-links/${link.body.id}/revoke`, {});
    expect(cross.status).toBe(404);
    const [row] = await h.sql(`SELECT revoked_at FROM einvoice_approver_links WHERE id = $1`, [
      link.body.id,
    ]);
    expect(row.revoked_at).toBeNull();

    const viewer = await h.createTenant({ name: "Viewer" });
    await addMember(a, viewer, "viewer");
    expect((await viewer.as.get(`${base(a)}/approver-links`)).status).toBe(403);
    expect((await viewer.as.post(`${base(a)}/approver-links`, {})).status).toBe(403);
  });
});

describe("WQ5 unified contacts", () => {
  it("a supplier contact links one vendors row that a bill picks; registrations stay in step", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const res = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Gulf Hosting LLC",
      email: "ap@gulfhosting.example",
      isCustomer: true,
      isSupplier: true,
      partyType: "business",
      freeZone: true,
      addressStreet: "Street 4",
      addressBuilding: "Tower B, Unit 12",
      addressDistrict: "Dubai Internet City",
      postalCode: "500001",
      taxRegistrations: [
        { type: "vat", number: "100765432100003" },
        { type: "ct", number: "100765432100003" },
      ],
      legalIdType: "TL",
      legalId: "DIC-998877",
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({
      isSupplier: true,
      freeZone: true,
      trnNumber: "100765432100003",
      legalIdType: "TL",
      legalId: "DIC-998877",
    });
    expect(res.body.vendorId).toBeTruthy();
    const vendors = await t.as.get(`/api/companies/${t.company.id}/vendors`);
    const linked = (vendors.body as Array<{ id: string; name: string; trn: string }>).filter(
      (v) => v.id === res.body.vendorId
    );
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ name: "Gulf Hosting LLC", trn: "100765432100003" });

    // The bill picks the same supplier (vendor_id), no second record.
    const bill = await t.as.post(`/api/companies/${t.company.id}/bills`, {
      vendor_id: res.body.vendorId,
      vendor_name: "Gulf Hosting LLC",
      bill_number: "GH-1",
      bill_date: today(),
      due_date: today(),
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 100, vat_rate: 5 }],
    });
    expect(bill.status, bill.text).toBe(200);
    expect(bill.body.vendor_id).toBe(res.body.vendorId);
    const count = await h.sql(`SELECT 1 FROM vendors WHERE company_id = $1`, [t.company.id]);
    expect(count).toHaveLength(1);

    // An edit keeps the vendor in step.
    const upd = await t.as.put(`/api/companies/${t.company.id}/customer-contacts/${res.body.id}`, {
      name: "Gulf Hosting FZ-LLC",
    });
    expect(upd.status, upd.text).toBe(200);
    const [v] = await h.sql(`SELECT name FROM vendors WHERE id = $1`, [res.body.vendorId]);
    expect(v.name).toBe("Gulf Hosting FZ-LLC");

    // Removing the VAT registration clears the plain TRN column too.
    const noVat = await t.as.put(
      `/api/companies/${t.company.id}/customer-contacts/${res.body.id}`,
      { taxRegistrations: [{ type: "ct", number: "100765432100003" }] }
    );
    expect(noVat.body.trnNumber).toBeNull();

    // A contact needs a role.
    const none = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Nobody",
      isCustomer: false,
      isSupplier: false,
    });
    expect(none.status).toBe(422);
  });

  it("an existing vendor with the same TRN is adopted, not duplicated", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const v = await t.as.post(`/api/companies/${t.company.id}/vendors`, {
      name: "Desert Print LLC",
      trn: "100111222300003",
    });
    expect(v.status, v.text).toBe(201);
    const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Desert Print",
      isCustomer: false,
      isSupplier: true,
      trnNumber: "100111222300003",
    });
    expect(c.status, c.text).toBe(200);
    expect(c.body.vendorId).toBe(v.body.id);
  });

  it("default accounts: control accounts and the wrong type are refused", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const acct = async (code: string) =>
      (
        await h.sql(`SELECT id FROM accounts WHERE company_id = $1 AND code = $2`, [
          t.company.id,
          code,
        ])
      )[0]?.id as string;
    const url = `/api/companies/${t.company.id}/customer-contacts`;
    const ar = await t.as.post(url, { name: "C1", defaultRevenueAccountId: await acct("1040") });
    expect(ar.status).toBe(422);
    const ap = await t.as.post(url, {
      name: "S1",
      isSupplier: true,
      defaultExpenseAccountId: await acct("2010"),
    });
    expect(ap.status).toBe(422);
    const ok = await t.as.post(url, { name: "C2", defaultRevenueAccountId: await acct("4010") });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.defaultRevenueAccountId).toBe(await acct("4010"));
  });

  it("the buyer ID type and structured address reach the PINT AE XML", async () => {
    const t = await h.createTenant({ companyColumns: SELLER });
    const c = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: "100765432100003",
      addressStreet: "Building 7",
      addressDistrict: "Dubai Internet City",
      city: "Dubai",
      emirate: "dubai",
      country: "AE",
      legalIdType: "PAS",
      legalId: "N1234567",
    });
    // PINT AE ibr-010-ae: a passport needs its issuing country.
    expect(c.status).toBe(422);
    expect(c.body.code).toBe("SELLER_ID_PASSPORT_COUNTRY");
    const withCountry = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: "100765432100003",
      addressStreet: "Building 7",
      addressDistrict: "Dubai Internet City",
      city: "Dubai",
      emirate: "dubai",
      country: "AE",
      legalIdType: "PAS",
      legalId: "N1234567",
      legalIdCountry: "in",
    });
    expect(withCountry.status, withCountry.text).toBe(200);
    expect(withCountry.body.legalIdCountry).toBe("IN");
    const c2 = withCountry;
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme Gulf FZ-LLC",
      customerTrn: "100765432100003",
      contactId: c2.body.id,
      date: today(),
      paymentTerms: "net30",
      lines: [{ description: "Consulting", quantity: 2, unitPrice: 500, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const gen = await t.as.post(`/api/invoices/${inv.body.id}/generate-einvoice`, {});
    expect(gen.status, gen.text).toBe(200);
    const [row] = await h.sql<{ einvoice_xml: string | null }>(
      `SELECT einvoice_xml FROM invoices WHERE id = $1`,
      [inv.body.id]
    );
    expect(row.einvoice_xml, "the e-invoice was generated").toBeTruthy();
    const buyer = row.einvoice_xml!.split("<cac:AccountingCustomerParty>")[1];
    expect(buyer).toMatch(/schemeAgencyID="PAS" schemeAgencyName="IN">N1234567</);
    expect(buyer).toContain("Building 7, Dubai Internet City");
  });
});

describe("WQ5 firm console e-invoicing column", () => {
  it("projects readiness for the current taxpayer in both the company and firm views", async () => {
    const { clientEInvoicingStates } =
      await import("../../server/services/firm-command-center.service");
    const { companyCredentialVariable, sealCompanyCredentials } =
      await import("../../server/services/einvoice/providers/company-credentials");
    const { upsertLegalEntity } = await import("../../server/services/einvoice/legal-entities");
    const { randomUUID } = await import("node:crypto");
    const t = await h.createTenant({ companyColumns: { ...SELLER, einvoice_partner: "acube" } });
    const context = { companyId: t.company.id, provider: "acube", environment: "sandbox" } as const;
    const envVar = companyCredentialVariable(context);
    process.env[envVar] = sealCompanyCredentials(context, {
      email: "sandbox@example.test",
      password: randomUUID(),
    });
    try {
      const setup = async (tin: string) =>
        upsertLegalEntity(t.company.id, "acube", "sandbox", tin, {
          status: "active",
          legalEntityId: `entity-${tin}`,
        });
      const partner = async () => (await t.as.get(`${base(t)}/partner`)).body;
      const firm = async () => (await clientEInvoicingStates([t.company.id])).get(t.company.id);

      await setup("1001234567");
      expect(await partner()).toMatchObject({
        verifyAvailable: true,
        appointment: { state: "verified", legalEntityStatus: "active" },
      });
      expect(await firm()).toMatchObject({ state: "connected" });

      await h.sql("UPDATE companies SET trn_vat_number = '100999999900003' WHERE id = $1", [
        t.company.id,
      ]);
      expect(await partner()).toMatchObject({
        verifyAvailable: false,
        appointment: { state: "not_started", legalEntityStatus: null },
      });
      expect(await firm()).toMatchObject({ state: "appoint_partner" });

      await setup("1009999999");
      expect(await partner()).toMatchObject({
        verifyAvailable: true,
        appointment: { state: "verified", legalEntityStatus: "active" },
      });
      expect(await firm()).toMatchObject({ state: "connected" });
    } finally {
      delete process.env[envVar];
    }
  });

  it("one state per client, and never 'connected' without a configured provider", async () => {
    const { clientEInvoicingStates } =
      await import("../../server/services/firm-command-center.service");
    const missing = await h.createTenant({ name: "Missing", vatRegistered: false });
    const ready = await h.createTenant({ name: "Ready", companyColumns: SELLER });
    const chosen = await h.createTenant({ name: "Chosen", companyColumns: SELLER });
    const waiting = await h.createTenant({ name: "Waiting", companyColumns: SELLER });
    const confirmed = await h.createTenant({ name: "Confirmed", companyColumns: SELLER });
    const [p] = await partnerIds(chosen);
    for (const c of [chosen, waiting, confirmed]) {
      await c.as.put(`${base(c)}/partner`, { partner: p });
    }
    await waiting.as.post(`${base(waiting)}/approver-links`, {});
    await confirmed.as.post(`${base(confirmed)}/partner/self-confirm`, { confirmed: true });
    // An active legal entity row is not "connected" while no provider is configured.
    await h.sql(
      `INSERT INTO einvoice_legal_entities (company_id, provider, environment, tin, status)
       VALUES ($1, $2, 'sandbox', '1001234567', 'active')`,
      [chosen.company.id, p]
    );
    const saved = process.env.EINVOICE_PROVIDER;
    delete process.env.EINVOICE_PROVIDER;
    try {
      const states = await clientEInvoicingStates(
        [missing, ready, chosen, waiting, confirmed].map((c) => c.company.id)
      );
      expect(states.get(missing.company.id)?.state).toBe("identity_missing");
      expect(states.get(missing.company.id)?.missing).toBeGreaterThan(0);
      expect(states.get(ready.company.id)?.state).toBe("partner_not_chosen");
      expect(states.get(chosen.company.id)?.state).toBe("appoint_partner");
      expect(states.get(waiting.company.id)?.state).toBe("awaiting_approval");
      expect(states.get(confirmed.company.id)?.state).toBe("self_confirmed");
    } finally {
      if (saved !== undefined) process.env.EINVOICE_PROVIDER = saved;
    }
  });
});

describe("approver outcome shows back (2026-11-19)", () => {
  it("a used approver link moves the client to approver_done; a new partner withdraws it", async () => {
    const { clientEInvoicingStates } =
      await import("../../server/services/firm-command-center.service");
    const t = await h.createTenant({ name: "Approved", companyColumns: SELLER });
    const [p, q] = await partnerIds(t);
    await t.as.put(`${base(t)}/partner`, { partner: p });
    const link = await t.as.post(`${base(t)}/approver-links`, { approverName: "Khalid" });
    expect(link.status, link.text).toBeLessThan(300);
    const token = (link.body.url as string).split("/").pop()!;
    const state = async () => (await t.as.get(`${base(t)}/partner`)).body.appointment.state;
    expect(await state()).toBe("awaiting_approval");
    const done = await h.anon.post(`/api/portal/einvoicing-approve/${token}/done`, {});
    expect(done.status, done.text).toBe(200);
    // The approver finished: the client sees it, and so does the firm column.
    expect(await state()).toBe("approver_done");
    const states = await clientEInvoicingStates([t.company.id]);
    expect(states.get(t.company.id)?.state).toBe("approver_done");
    // A different partner is a different appointment: the approval no longer applies.
    await t.as.put(`${base(t)}/partner`, { partner: q });
    expect(await state()).toBe("not_started");
    const used = await h.anon.get(`/api/portal/einvoicing-approve/${token}`);
    expect(used.status).toBe(410);
  });
});
