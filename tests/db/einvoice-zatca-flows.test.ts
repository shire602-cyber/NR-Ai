/**
 * R07-14: ZATCA Phase 2 on the real app + Postgres against the recorded
 * Fatoora mock: 503 when unconfigured, EGS onboarding with OTP, hash-chained
 * signed documents, clearance / reporting, rejection and retry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { createMockFatoora } from "../fixtures/zatca/mock-fatoora";

const h = useHarness();
const realFetch = globalThis.fetch;

function useMockFatoora(opts: Parameters<typeof createMockFatoora>[0] = {}) {
  const mock = createMockFatoora(opts);
  vi.stubGlobal("fetch", ((url: string | URL, init?: RequestInit) =>
    String(url).includes("gw-fatoora.zatca.gov.sa")
      ? mock.fetch(String(url) as never, init as RequestInit)
      : realFetch(url, init)) as typeof fetch);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZATCA_ENV;
});

const EGS_BODY = {
  name: "Riyadh-POS-1",
  vatNumber: "399999999900003",
  organizationName: "Pearl Trading KSA",
  organizationUnit: "Riyadh Branch",
  invoiceTypes: "1100",
  locationAddress: "King Fahd Road, Riyadh",
  industry: "Trading",
  seller: {
    nameAr: "شركة اللؤلؤة للتجارة",
    nameEn: "Pearl Trading KSA",
    crn: "1010010000",
    address: {
      street: "King Fahd Road",
      buildingNumber: "1234",
      district: "Olaya",
      city: "Riyadh",
      postalZone: "12345",
    },
  },
};

async function ksaInvoice(t: Tenant, n: number, buyerVat: string | null) {
  const inv = await h.sql<{ id: string }>(
    `INSERT INTO invoices (company_id, number, customer_name, customer_trn, date, currency, subtotal, vat_amount, total, status)
     VALUES ($1, $2, $3, $4, now(), 'SAR', 200, 30, 230, 'sent') RETURNING id`,
    [t.company.id, `KSA-${n}`, buyerVat ? "شركة المشتري" : "Walk-in customer", buyerVat]
  );
  await h.sql(
    `INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, vat_rate, vat_supply_type)
     VALUES ($1, 'Office chairs', 2, 100, 0.15, 'standard_rated')`,
    [inv[0].id]
  );
  return inv[0].id;
}

async function onboarded(t: Tenant) {
  const egs = await t.as.post(`/api/companies/${t.company.id}/zatca/egs-units`, EGS_BODY);
  expect(egs.status, egs.text).toBe(201);
  const ob = await t.as.post(
    `/api/companies/${t.company.id}/zatca/egs-units/${egs.body.id}/onboard`,
    {
      otp: "123456",
    }
  );
  expect(ob.status, ob.text).toBe(200);
  return egs.body.id as string;
}

describe("W4-C ZATCA boundary", () => {
  it("[R07-14] every endpoint answers 503 ZATCA_NOT_CONFIGURED without ZATCA_ENV", async () => {
    const t = await h.createTenant();
    const status = await t.as.get(`/api/companies/${t.company.id}/zatca/status`);
    expect(status.status).toBe(503);
    expect(status.body).toMatchObject({ code: "ZATCA_NOT_CONFIGURED", onboarded: false });
    expect(status.body.capability.status).toBe("requires_external");
    const calls = [
      t.as.post(`/api/companies/${t.company.id}/zatca/egs-units`, EGS_BODY),
      t.as.post(
        `/api/companies/${t.company.id}/zatca/egs-units/00000000-0000-4000-8000-000000000000/onboard`,
        { otp: "123456" }
      ),
      t.as.get(`/api/companies/${t.company.id}/zatca/documents`),
      t.as.post(
        `/api/companies/${t.company.id}/zatca/invoices/00000000-0000-4000-8000-000000000000/submit`,
        {
          egsUnitId: "00000000-0000-4000-8000-000000000000",
        }
      ),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status, r.text).toBe(503);
      expect(r.body.code).toBe("ZATCA_NOT_CONFIGURED");
    }
  });

  it("[R07-14] onboarding: bad OTP fails honestly; a valid OTP yields a production CSID; keys stay encrypted", async () => {
    process.env.ZATCA_ENV = "sandbox";
    const mock = useMockFatoora({ validOtp: "123456" });
    const t = await h.createTenant();
    const egs = await t.as.post(`/api/companies/${t.company.id}/zatca/egs-units`, EGS_BODY);
    expect(egs.status, egs.text).toBe(201);
    expect(egs.body.csrPem).toContain("BEGIN CERTIFICATE REQUEST");
    expect(JSON.stringify(egs.body)).not.toMatch(/PRIVATE KEY|private_key/);
    const badOtp = await t.as.post(
      `/api/companies/${t.company.id}/zatca/egs-units/${egs.body.id}/onboard`,
      { otp: "000000" }
    );
    expect(badOtp.status).toBe(422);
    expect(badOtp.body.code).toBe("ZATCA_COMPLIANCE_CSID_FAILED");
    const ok = await t.as.post(
      `/api/companies/${t.company.id}/zatca/egs-units/${egs.body.id}/onboard`,
      { otp: "123456" }
    );
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.egs).toMatchObject({ status: "production", hasProductionCsid: true });
    expect(ok.body.complianceChecks).toHaveLength(6); // 388/381/383 × standard/simplified
    expect(
      mock.received.filter((r) => r.path === "/compliance/invoices").every((r) => r.verified)
    ).toBe(true);
    const row = await h.sql(
      `SELECT private_key_enc, production_secret_enc FROM zatca_egs_units WHERE id = $1`,
      [egs.body.id]
    );
    expect(row[0].private_key_enc).toMatch(/^enc:v1:/);
    expect(row[0].production_secret_enc).toMatch(/^enc:v1:/);
    const st = await t.as.get(`/api/companies/${t.company.id}/zatca/status`);
    expect(st.body).toMatchObject({ configured: true, environment: "sandbox", onboarded: true });
  });

  it("[R07-14] clears standard / reports simplified invoices in one unbroken hash chain", async () => {
    process.env.ZATCA_ENV = "sandbox";
    const mock = useMockFatoora();
    const t = await h.createTenant();
    const egsId = await onboarded(t);
    const statuses: string[] = [];
    for (let n = 1; n <= 5; n++) {
      const id = await ksaInvoice(t, n, n % 2 === 1 ? "300000000000003" : null);
      const r = await t.as.post(`/api/companies/${t.company.id}/zatca/invoices/${id}/submit`, {
        egsUnitId: egsId,
      });
      expect(r.status, r.text).toBe(200);
      statuses.push(r.body.status);
    }
    expect(statuses).toEqual(["cleared", "reported", "cleared", "reported", "cleared"]);
    const chain = await h.sql<{
      icv: number;
      invoice_hash: string;
      previous_hash: string;
      profile: string;
    }>(
      `SELECT icv, invoice_hash, previous_hash, profile FROM zatca_documents WHERE egs_unit_id = $1 ORDER BY icv`,
      [egsId]
    );
    expect(chain.map((c) => c.icv)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < chain.length; i++)
      expect(chain[i].previous_hash).toBe(chain[i - 1].invoice_hash);
    const egs = await h.sql(`SELECT icv, last_invoice_hash FROM zatca_egs_units WHERE id = $1`, [
      egsId,
    ]);
    expect(egs[0]).toEqual({ icv: 5, last_invoice_hash: chain[4].invoice_hash });
    const sent = mock.received.filter((r) => r.path.startsWith("/invoices/"));
    expect(sent.map((s) => s.path)).toEqual([
      "/invoices/clearance/single",
      "/invoices/reporting/single",
      "/invoices/clearance/single",
      "/invoices/reporting/single",
      "/invoices/clearance/single",
    ]);
    expect(sent.every((s) => s.verified)).toBe(true);
    const again = await t.as.post(
      `/api/companies/${t.company.id}/zatca/invoices/${await ksaInvoiceId(t, "KSA-1")}/submit`,
      { egsUnitId: egsId }
    );
    expect(again.status).toBe(409);
  });

  it("[R07-14] a rejection is final; a transport failure is retried without breaking the chain", async () => {
    process.env.ZATCA_ENV = "sandbox";
    useMockFatoora({ submissionOutcomes: ["rejected", "unavailable", "ok"] });
    const t = await h.createTenant();
    const egsId = await onboarded(t);
    const rejectedId = await ksaInvoice(t, 1, "300000000000003");
    const rej = await t.as.post(
      `/api/companies/${t.company.id}/zatca/invoices/${rejectedId}/submit`,
      { egsUnitId: egsId }
    );
    expect(rej.status).toBe(422);
    expect(rej.body.status).toBe("rejected");
    expect(JSON.stringify(rej.body.response)).toContain("BR-KSA-37");

    const flakyId = await ksaInvoice(t, 2, "300000000000003");
    const failed = await t.as.post(
      `/api/companies/${t.company.id}/zatca/invoices/${flakyId}/submit`,
      { egsUnitId: egsId }
    );
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: "failed", attempts: 1, icv: 2 });
    expect(failed.body.next_retry_at).toBeTruthy();
    const retry = await t.as.post(
      `/api/companies/${t.company.id}/zatca/documents/${failed.body.id}/retry`,
      {}
    );
    expect(retry.status, retry.text).toBe(200);
    expect(retry.body).toMatchObject({ status: "cleared", attempts: 2, icv: 2 });
    const egs = await h.sql(`SELECT icv FROM zatca_egs_units WHERE id = $1`, [egsId]);
    expect(egs[0].icv).toBe(2); // the retry re-sent the same signed document

    const other = await h.createSecondTenant();
    const leak = await other.as.post(
      `/api/companies/${other.company.id}/zatca/documents/${failed.body.id}/retry`,
      {}
    );
    expect(leak.status).toBe(404);
  });
});

async function ksaInvoiceId(t: Tenant, number: string): Promise<string> {
  const r = await h.sql<{ id: string }>(
    `SELECT id FROM invoices WHERE company_id = $1 AND number = $2`,
    [t.company.id, number]
  );
  return r[0].id;
}
