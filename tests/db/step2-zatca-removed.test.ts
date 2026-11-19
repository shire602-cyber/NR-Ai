/**
 * STEP2: Saudi ZATCA is removed from the product (routes, settings, 15% KSA rate), against the
 * real app + Postgres. Every check runs for a UAE tenant AND a tenant whose company address is in
 * Saudi Arabia, with the retired ZATCA env still set, to prove no flag is left that could switch
 * anything back on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const today = () => new Date().toISOString().slice(0, 10);
const UUID = "00000000-0000-4000-8000-000000000001";

let uae: Tenant;
let sa: Tenant;

beforeAll(async () => {
  process.env.ZATCA_ENABLED = "true";
  process.env.ZATCA_ENV = "sandbox";
  const columns = { trn_vat_number: TRN, emirate: "dubai", vat_filing_frequency: "Quarterly" };
  uae = await h.createTenant({ name: "Step2Uae", planId: "professional", companyColumns: columns });
  sa = await h.createTenant({
    name: "Step2Sa",
    planId: "professional",
    companyColumns: { ...columns, address_country: "SA" },
  });
});
afterAll(() => {
  delete process.env.ZATCA_ENABLED;
  delete process.env.ZATCA_ENV;
});

const both = () => [["UAE", uae] as const, ["SA address", sa] as const];
const base = (t: Tenant) => `/api/companies/${t.company.id}`;

describe("STEP2: the ZATCA routes are gone", () => {
  it("STEP2 every ZATCA endpoint and GET /api/features is a 404 ROUTE_NOT_FOUND", async () => {
    for (const [label, t] of both()) {
      const calls = [
        await t.as.get("/api/features"),
        await t.as.get(`${base(t)}/zatca/status`),
        await t.as.post(`${base(t)}/zatca/egs-units`, { name: "x" }),
        await t.as.post(`${base(t)}/zatca/egs-units/${UUID}/onboard`, {}),
        await t.as.get(`${base(t)}/zatca/documents`),
        await t.as.post(`${base(t)}/zatca/invoices/${UUID}/submit`, {}),
        await t.as.post(`${base(t)}/zatca/documents/${UUID}/retry`, {}),
      ];
      for (const r of calls) {
        expect(r.status, `${label}: ${r.text}`).toBe(404);
        expect(r.body.code, label).toBe("ROUTE_NOT_FOUND");
      }
    }
  });

  it("STEP2 the ZATCA tables no longer exist", async () => {
    const rows = await h.sql(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'zatca\\_%'`
    );
    expect(rows).toEqual([]);
  });
});

describe("STEP2: no 15% anywhere, even for a company with a Saudi address", () => {
  it("STEP2 the default VAT rate 0.15 is refused (422) and 0.05 is accepted", async () => {
    for (const [label, t] of both()) {
      const bad = await t.as.patch(base(t), { defaultVatRate: 0.15 });
      expect(bad.status, label).toBe(422);
      expect(bad.body.code, label).toBe("VAT_RATE_NOT_FOR_COUNTRY");
      const ok = await t.as.patch(base(t), { defaultVatRate: 0.05 });
      expect(ok.status, `${label}: ${ok.text}`).toBe(200);
    }
  });

  it("STEP2 company create refuses a default VAT rate other than 0 or 0.05 (422), same as update", async () => {
    for (const [label, t] of both()) {
      const tag = label.replace(/\W/g, "");
      for (const [i, rate] of [0.15, 0.1, 0.04].entries()) {
        const bad = await t.as.post("/api/companies", {
          name: `Step2Bad${tag}${i}`,
          addressCountry: "SA",
          defaultVatRate: rate,
        });
        expect(bad.status, `${label} ${rate}: ${bad.text}`).toBe(422);
        expect(bad.body.code, label).toBe("VAT_RATE_NOT_FOR_COUNTRY");
      }
      for (const [i, rate] of [0, 0.05].entries()) {
        const ok = await t.as.post("/api/companies", {
          name: `Step2Ok${tag}${i}`,
          defaultVatRate: rate,
        });
        expect(ok.status, `${label} ${rate}: ${ok.text}`).toBe(200);
        expect(Number(ok.body.defaultVatRate), label).toBe(rate);
      }
    }
  });

  it("STEP2 products refuse a VAT rate other than 0 or 0.05 (422); 0 and 0.05 are accepted", async () => {
    for (const [label, t] of both()) {
      const product = { name: "Step2 Item", unitPrice: 10 };
      const bad = await t.as.post(`${base(t)}/products`, { ...product, vatRate: 0.15 });
      expect(bad.status, `${label}: ${bad.text}`).toBe(422);
      expect(bad.body.code, label).toBe("VAT_RATE_NOT_FOR_COUNTRY");
      const ok0 = await t.as.post(`${base(t)}/products`, { ...product, name: "Zero", vatRate: 0 });
      expect(ok0.status, `${label}: ${ok0.text}`).toBe(200);
      const ok5 = await t.as.post(`${base(t)}/products`, {
        ...product,
        name: "Five",
        vatRate: 0.05,
      });
      expect(ok5.status, `${label}: ${ok5.text}`).toBe(200);
      const patchBad = await t.as.patch(`/api/products/${ok5.body.id}`, { vatRate: 0.15 });
      expect(patchBad.status, `${label}: ${patchBad.text}`).toBe(422);
      expect(patchBad.body.code, label).toBe("VAT_RATE_NOT_FOR_COUNTRY");
      const patchOk = await t.as.patch(`/api/products/${ok5.body.id}`, { vatRate: 0 });
      expect(patchOk.status, `${label}: ${patchOk.text}`).toBe(200);
    }
  });

  it("STEP2 a KSA VAT number is refused (400)", async () => {
    for (const [label, t] of both()) {
      const r = await t.as.patch(base(t), { trnVatNumber: "300000000000003" });
      expect(r.status, label).toBe(400);
    }
  });

  it("STEP2 invoice, quote, credit note and debit note lines at 15% are 400; no rate is charged 5%", async () => {
    for (const [label, t] of both()) {
      const line15 = { description: "Work", quantity: 1, unitPrice: 1000, vatRate: 15 };
      const inv15 = await t.as.post(`${base(t)}/invoices`, {
        customerName: "Acme",
        date: today(),
        lines: [line15],
      });
      expect(inv15.status, `${label} invoice: ${inv15.text}`).toBe(400);
      expect(inv15.text, label).toMatch(/VAT rate must be 0% or 5%/);
      const quote15 = await t.as.post(`${base(t)}/quotes`, {
        customerName: "Acme",
        date: today(),
        lines: [line15],
      });
      expect(quote15.status, `${label} quote: ${quote15.text}`).toBe(400);
      expect(quote15.text, label).toMatch(/VAT rate must be 0% or 5%/);

      const inv = await t.as.post(`${base(t)}/invoices`, {
        customerName: "Acme",
        date: today(),
        placeOfSupplyEmirate: "dubai",
        lines: [{ description: "Work", quantity: 1, unitPrice: 1000 }],
      });
      expect(inv.status, `${label} default rate: ${inv.text}`).toBe(200);
      expect(inv.body.vatAmount, label).toBe(50);
      expect(inv.body.total, label).toBe(1050);
      const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
      expect(sent.status, sent.text).toBe(200);

      const cn15 = await t.as.post(`${base(t)}/invoices/${inv.body.id}/credit-note`, {
        lines: [line15],
      });
      expect(cn15.status, `${label} credit note: ${cn15.text}`).toBe(400);
      expect(cn15.text, label).toMatch(/VAT rate must be 0% or 5%/);
      const cnDraft15 = await t.as.post(`${base(t)}/credit-notes`, {
        invoiceId: inv.body.id,
        lines: [line15],
      });
      expect(cnDraft15.status, `${label} credit note draft: ${cnDraft15.text}`).toBe(400);
      expect(cnDraft15.text, label).toMatch(/VAT rate must be 0% or 5%/);
      const dn15 = await t.as.post(`${base(t)}/invoices/${inv.body.id}/debit-note`, {
        lines: [line15],
      });
      expect(dn15.status, `${label} debit note: ${dn15.text}`).toBe(400);
      expect(dn15.text, label).toMatch(/VAT rate must be 0% or 5%/);
    }
  });

  it("STEP2 a manual journal standard line derives a 5% VAT leg", async () => {
    for (const [label, t] of both()) {
      const software = await accountByCode(t, "5080");
      const bank = await accountByCode(t, "1020");
      const r = await t.as.post(`${base(t)}/journal`, {
        date: today(),
        memo: `Software licence ${label}`,
        status: "posted",
        lines: [
          { accountId: software.id, debit: 1000, vatTreatment: "standard", description: "Licence" },
          { accountId: bank.id, credit: 1050 },
        ],
      });
      expect(r.status, `${label}: ${r.text}`).toBe(200);
      const vat = await h.sql<{ debit: string }>(
        `SELECT jl.debit::text AS debit FROM journal_lines jl
           JOIN accounts a ON a.id = jl.account_id
          WHERE jl.entry_id = $1 AND jl.system_vat`,
        [r.body.id]
      );
      expect(
        vat.map((v) => Number(v.debit)),
        label
      ).toEqual([50]);
    }
  });

  it("STEP2 the tax-rates endpoint reports the 5% standard rate and no jurisdiction", async () => {
    for (const [label, t] of both()) {
      const r = await t.as.get(`${base(t)}/tax-rates`);
      expect(r.status, label).toBe(200);
      expect(r.body.standardRate, label).toBe(0.05);
      expect(r.body, label).not.toHaveProperty("jurisdiction");
    }
  });

  it("STEP2 UAE unchanged: 1,000 at 5% is 50 VAT and 1,050 total", async () => {
    const inv = await uae.as.post(`${base(uae)}/invoices`, {
      customerName: "Acme",
      date: today(),
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body.vatAmount).toBe(50);
    expect(inv.body.total).toBe(1050);
  });
});
