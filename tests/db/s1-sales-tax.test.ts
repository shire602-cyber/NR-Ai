/**
 * S1 final sweep — sales, quotes and tax residuals, against the real app + Postgres.
 * Items (RESIDUALS.md): W4-D quote state machine / quotes.respond, W5-C quote base currency,
 * W4-E company TRN via zUaeTrn (R14-20; FTA lookup EXTERNAL), R14-13 logo upload + PDFs,
 * W4-B credit-note restock vs write-off, W4-C product GTIN + RCM goods type (AE e-invoice),
 * R07-15 margin scheme Box 1, W4-C KSA 15%, W5-C VAT filed in AED for a USD company,
 * R12-12 CT estimate label.
 */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const TRN = "100000000000003";
const BUYER_TRN = "100000000000011";
const Q3 = { periodStart: "2026-07-01", periodEnd: "2026-09-30" };
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
  resetPortalThrottle();
});

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: TRN,
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

async function issued(t: Tenant, body: Record<string, unknown>) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Acme LLC",
    date: "2026-08-10",
    placeOfSupplyEmirate: "dubai",
    ...body,
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as {
    id: string;
    number: string;
    subtotal: number;
    vatAmount: number;
    total: number;
  };
}

// 1x1 transparent PNG.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("S1 quotes: state machine and base currency", () => {
  it("[W4-D] status changes go through the quote state machine; portal answers use quotes.respond", async () => {
    const t = await h.createTenant();
    const q = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Quote Co",
      date: today(),
      lines: [{ description: "Work", quantity: 2, unitPrice: 100, vatRate: 5 }],
    });
    expect(q.status, q.text).toBe(201);
    const sent = await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "sent" });
    expect(sent.status, sent.text).toBe(200);
    const declined = await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "declined" });
    expect(declined.status, declined.text).toBe(200);
    // declined -> accepted is not a transition of the machine.
    const bad = await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "accepted" });
    expect(bad.status, bad.text).toBe(409);
    expect(bad.body.code).toBe("QUOTE_INVALID_TRANSITION");

    // Service registry: quotes.respond exists and refuses a quote that is not sent.
    const { has, resolve } = await import("../../server/platform/service-registry");
    expect(has("quotes.respond")).toBe(true);
    const respond =
      resolve<typeof import("../../server/services/quote-state.service").respondToQuote>(
        "quotes.respond"
      );
    const contact = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Portal Buyer",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    await h.sql(`UPDATE quotes SET contact_id = $2 WHERE id = $1`, [q.body.id, contact.body.id]);
    await expect(
      respond({
        companyId: t.company.id,
        quoteId: q.body.id,
        contactId: contact.body.id,
        decision: "accepted",
        signerName: "Buyer",
      })
    ).rejects.toMatchObject({ code: "QUOTE_NOT_OPEN" });
    // Re-send, then the customer's answer moves sent -> accepted once and records the signature.
    expect((await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "sent" })).status).toBe(
      200
    );
    const ok = await respond({
      companyId: t.company.id,
      quoteId: q.body.id,
      contactId: contact.body.id,
      decision: "accepted",
      signerName: "Buyer",
    });
    expect(ok.status).toBe("accepted");
    const rows = await h.sql(`SELECT decision FROM portal_quote_responses WHERE quote_id = $1`, [
      q.body.id,
    ]);
    expect(rows).toEqual([{ decision: "accepted" }]);
    // Another contact's quote is a 404, never answered.
    const other = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
      name: "Someone Else",
    });
    await expect(
      respond({
        companyId: t.company.id,
        quoteId: q.body.id,
        contactId: other.body.id,
        decision: "declined",
        signerName: "X",
      })
    ).rejects.toMatchObject({ code: "QUOTE_NOT_FOUND" });

    // Converted quotes are terminal.
    const conv = await t.as.post(`/api/quotes/${q.body.id}/convert-to-invoice`, {});
    expect(conv.status, conv.text).toBe(200);
    const after = await t.as.patch(`/api/quotes/${q.body.id}/status`, { status: "sent" });
    expect(after.status).toBe(409);
    expect(after.body.code).toBe("QUOTE_ALREADY_CONVERTED");
  });

  it("[W5-C] a quote without a currency is in the company's functional currency, not AED", async () => {
    const t = await h.createTenant({ companyColumns: { base_currency: "USD" } });
    const q = await t.as.post(`/api/companies/${t.company.id}/quotes`, {
      customerName: "Dollar Co",
      date: today(),
      lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(q.status, q.text).toBe(201);
    expect(q.body.currency).toBe("USD");
    const upd = await t.as.put(`/api/quotes/${q.body.id}`, { notes: "Revised" });
    expect(upd.status, upd.text).toBe(200);
    expect(upd.body.currency).toBe("USD");
  });
});

describe("S1 companies: TRN uses the shared zUaeTrn rule", () => {
  it("[W4-E][R14-20] 15 digits that do not start with 100 are refused; KSA numbers only for a Saudi company", async () => {
    const t = await h.createTenant();
    const id = t.company.id;
    const bad = await t.as.patch(`/api/companies/${id}`, { trnVatNumber: "123456789012345" });
    expect(bad.status, bad.text).toBe(400);
    const ok = await t.as.patch(`/api/companies/${id}`, { trnVatNumber: "100-1234-5670-0003" });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.trnVatNumber).toBe("100123456700003");
    // Format only: the FTA register lookup is EXTERNAL and labelled as such.
    expect(ok.body.trnVerification).toEqual({
      format: "checked",
      ftaLookup: "external_not_integrated",
    });
    const ksaOnUae = await t.as.patch(`/api/companies/${id}`, { trnVatNumber: "300000000000003" });
    expect(ksaOnUae.status).toBe(400);
    expect(ksaOnUae.body.code).toBe("TRN_INVALID");
    const ksa = await t.as.patch(`/api/companies/${id}`, {
      addressCountry: "SA",
      trnVatNumber: "300000000000003",
    });
    expect(ksa.status, ksa.text).toBe(200);
    const create = await t.as.post("/api/companies", {
      name: "Bad Trn Co",
      trnVatNumber: "999999999999999",
    });
    expect(create.status).toBe(400);
  });
});

describe("S1 logo: stored file, served endpoint, used by PDFs", () => {
  it("[R14-13] a logo over 1 MB of JSON reaches the upload route; invoice and quote PDFs embed the stored logo", async () => {
    // Not VAT registered (X6a harness default is a TRN): a tax invoice's FTA QR code is also an
    // image, and this test counts images to prove the logo is (not) embedded.
    const t = await h.createTenant({ vatRegistered: false });
    // ~900 KB image: base64 is ~1.2 MB, above the 1 MB default JSON cap.
    const big = Buffer.concat([
      Buffer.from(PNG_1X1, "base64").subarray(0, 33), // signature + IHDR (1x1)
      crypto.randomBytes(900 * 1024),
    ]);
    const upBig = await t.as.post(`/api/companies/${t.company.id}/logo`, {
      imageData: `data:image/png;base64,${big.toString("base64")}`,
    });
    // Previously the 1 MB JSON parser answered 413 before the route ran.
    expect(upBig.status, upBig.text).toBe(200);

    const up = await t.as.post(`/api/companies/${t.company.id}/logo`, {
      imageData: `data:image/png;base64,${PNG_1X1}`,
    });
    expect(up.status, up.text).toBe(200);
    const [row] = await h.sql(`SELECT logo_path, logo_url FROM companies WHERE id = $1`, [
      t.company.id,
    ]);
    expect(row.logo_path).toBeTruthy();
    expect(row.logo_url).toBeNull();
    const served = await t.as.get(`/api/companies/${t.company.id}/logo`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("image/png");

    const { loadCompanyLogo } = await import("../../server/services/pdf-logo");
    const company = (await import("../../server/storage")).storage;
    const c = await company.getCompany(t.company.id);
    const logo = await loadCompanyLogo(c!);
    expect(logo?.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect(await loadCompanyLogo({ ...c!, invoiceShowLogo: false })).toBeNull();

    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Logo Co",
      date: today(),
      lines: [{ description: "Work", quantity: 1, unitPrice: 100, vatRate: 5 }],
    });
    expect(inv.status, inv.text).toBe(200);
    const { generateInvoicePDF } = await import("../../server/services/pdf-invoice.service");
    const { generateQuotePDF } = await import("../../server/services/pdf-quote.service");
    const invRow = await company.getInvoice(inv.body.id, t.company.id);
    const lines = await company.getInvoiceLinesByInvoiceId(inv.body.id);
    const withLogo = (
      await generateInvoicePDF(invRow!, lines, c!, { template: "standard" })
    ).toString("latin1");
    expect(withLogo).toMatch(/\/Subtype\s*\/Image/);
    const noLogo = (
      await generateInvoicePDF(invRow!, lines, { ...c!, logoPath: null }, { template: "standard" })
    ).toString("latin1");
    expect(noLogo).not.toMatch(/\/Subtype\s*\/Image/);
    const quotePdf = (
      await generateQuotePDF(
        {
          id: crypto.randomUUID(),
          number: "QT-1",
          date: new Date(),
          customerName: "Q",
          subtotal: 100,
          vatAmount: 5,
          total: 105,
          currency: "AED",
        } as never,
        [],
        c!
      )
    ).toString("latin1");
    expect(quotePdf).toMatch(/\/Subtype\s*\/Image/);
  });
});

describe("S1 credit notes: return to stock or write off", () => {
  async function stockedSale(t: Tenant) {
    const p = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: `Widget ${Math.random().toString(36).slice(2, 7)}`,
      unitPrice: 100,
      costPrice: 0,
    });
    expect(p.status, p.text).toBe(200);
    const mv = await t.as.post(`/api/products/${p.body.id}/movements`, {
      type: "purchase",
      quantity: 5,
      unitCost: 40,
    });
    expect(mv.status, mv.text).toBeLessThan(300);
    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: today(),
      lines: [
        { description: "Widget", quantity: 2, unitPrice: 90, vatRate: 5, productId: p.body.id },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    return { productId: p.body.id as string, invoiceId: inv.body.id as string };
  }
  const qty = async (id: string) =>
    Number(
      (await h.sql(`SELECT current_stock FROM products WHERE id = $1`, [id]))[0].current_stock
    );

  it("[W4-B] restock: false writes the goods off (no stock in, COGS kept); the default restocks", async () => {
    const t = await h.createTenant();
    const a = await stockedSale(t);
    expect(await qty(a.productId)).toBe(3);
    const off = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${a.invoiceId}/credit-note`,
      {
        lines: [
          { description: "Widget", quantity: 1, unitPrice: 90, vatRate: 5, productId: a.productId },
        ],
        restock: false,
      }
    );
    expect(off.status, off.text).toBe(201);
    expect(await qty(a.productId)).toBe(3);
    const mv = await h.sql(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE source_type = 'credit_note' AND source_id = $1`,
      [off.body.id]
    );
    expect(mv[0].n).toBe(0);
    const [cn] = await h.sql(`SELECT restock FROM invoices WHERE id = $1`, [off.body.id]);
    expect(cn.restock).toBe(false);

    const back = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${a.invoiceId}/credit-note`,
      {
        lines: [
          { description: "Widget", quantity: 1, unitPrice: 90, vatRate: 5, productId: a.productId },
        ],
      }
    );
    expect(back.status, back.text).toBe(201);
    expect(await qty(a.productId)).toBe(4);
  });
});

describe("S1 products and reverse-charge e-invoices", () => {
  it("[W4-C] products carry a checked GTIN and RCM goods type; the e-invoice context reads them per line", async () => {
    const t = await vatTenant();
    const bad = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: "Gold bar",
      unitPrice: 1000,
      gtin: "12345678",
    });
    expect(bad.status).toBe(400);
    const badType = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: "Gold bar",
      unitPrice: 1000,
      rcmGoodsType: "GOLD",
    });
    expect(badType.status).toBe(400);
    const p = await t.as.post(`/api/companies/${t.company.id}/products`, {
      name: "Gold bar",
      unitPrice: 1000,
      gtin: "4006381333931",
      rcmGoodsType: "DL8.48.3.1",
      trackInventory: false,
      productType: "service",
    });
    expect(p.status, p.text).toBe(200);
    expect(p.body).toMatchObject({ gtin: "4006381333931", rcmGoodsType: "DL8.48.3.1" });

    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Bullion Buyer LLC",
      customerTrn: BUYER_TRN,
      date: today(),
      reverseCharge: true,
      placeOfSupplyEmirate: "dubai",
      lines: [
        {
          description: "Gold bar",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 0,
          vatSupplyType: "reverse_charge",
          productId: p.body.id,
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    const v = await t.as.get(`/api/invoices/${inv.body.id}/einvoice/validate`);
    expect(v.status, v.text).toBe(200);
    const fields = (v.body.issues as Array<{ field: string }>).map((i) => i.field);
    expect(fields).not.toContain("lines[0].gtin");
    expect(fields).not.toContain("lines[0].rcmGoodsType");
  });
});

describe("S1 VAT engine residuals", () => {
  it("[R07-15] a profit-margin scheme line charges VAT on the margin and reports only the margin in Box 1", async () => {
    const t = await vatTenant();
    const inv = await issued(t, {
      lines: [
        {
          description: "Used car",
          quantity: 1,
          unitPrice: 10500,
          vatRate: 5,
          marginScheme: true,
          marginPurchaseCost: 8400,
        },
        { description: "Service", quantity: 1, unitPrice: 1000, vatRate: 5 },
      ],
    });
    // Margin 2,100 VAT-inclusive: VAT 100, margin excl. VAT 2,000; the price stays 10,500.
    expect(inv.vatAmount).toBe(150);
    expect(inv.total).toBe(11550);
    expect(inv.subtotal).toBe(11400);
    const [line] = await h.sql(
      `SELECT margin_scheme, margin_purchase_cost, net_amount FROM invoice_lines WHERE invoice_id = $1 AND margin_scheme`,
      [inv.id]
    );
    expect(line).toMatchObject({ margin_scheme: true });
    expect(Number(line.margin_purchase_cost)).toBe(8400);
    expect(Number(line.net_amount)).toBe(10400);
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    expect(gen.body.box1bDubaiAmount).toBe(3000);
    expect(gen.body.box1bDubaiVat).toBe(150);
    expect(gen.body._metadata.reconciliation.hasUnexplainedDifference).toBe(false);
    // Margin lines must carry a purchase cost and be standard-rated.
    const missing = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-08-10",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Used", quantity: 1, unitPrice: 100, vatRate: 5, marginScheme: true }],
    });
    expect(missing.status).toBe(400);
  });

  it("[W4-C] a KSA company invoices at 15% (ZATCA path); a UAE company cannot", async () => {
    const ksa = await h.createTenant({ companyColumns: { address_country: "SA" } });
    const inv = await ksa.as.post(`/api/companies/${ksa.company.id}/invoices`, {
      customerName: "Riyadh Co",
      date: today(),
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 15 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body.vatAmount).toBe(150);
    expect(inv.body.total).toBe(1150);
    const [line] = await h.sql(`SELECT vat_rate FROM invoice_lines WHERE invoice_id = $1`, [
      inv.body.id,
    ]);
    expect(Number(line.vat_rate)).toBe(0.15);
    // Default rate for a KSA company is 15% too.
    const dflt = await ksa.as.post(`/api/companies/${ksa.company.id}/invoices`, {
      customerName: "Riyadh Co",
      date: today(),
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000 }],
    });
    expect(dflt.status, dflt.text).toBe(200);
    expect(dflt.body.vatAmount).toBe(150);
    const storage = (await import("../../server/storage")).storage;
    const { zatcaInputFromInvoice } = await import("../../server/services/zatca/service");
    const z = zatcaInputFromInvoice({
      invoice: (await storage.getInvoice(inv.body.id, ksa.company.id))!,
      lines: await storage.getInvoiceLinesByInvoiceId(inv.body.id),
      egs: { vat_number: "300000000000003", seller_profile: {} as never },
      icv: 1,
      previousHash: "x",
      uuid: crypto.randomUUID(),
    });
    expect(z.lines[0]).toMatchObject({ category: "S", vatRate: 0.15 });

    const uae = await h.createTenant();
    const no = await uae.as.post(`/api/companies/${uae.company.id}/invoices`, {
      customerName: "Dubai Co",
      date: today(),
      lines: [{ description: "Work", quantity: 1, unitPrice: 1000, vatRate: 15 }],
    });
    expect(no.status).toBe(400);
  });

  it("[W5-C][R14-19] a USD functional-currency company files its VAT 201 in AED through fx.toVatFilingCurrency", async () => {
    const t = await vatTenant({ base_currency: "USD" });
    const r = await t.as.post(`/api/companies/${t.company.id}/exchange-rates`, {
      fromCurrency: "USD",
      toCurrency: "AED",
      rate: 3.6725,
      effectiveDate: "2026-07-01",
    });
    expect(r.status, r.text).toBeLessThan(300);
    await issued(t, {
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const gen = await t.as.post(`/api/companies/${t.company.id}/vat-returns/generate`, Q3);
    expect(gen.status, gen.text).toBe(201);
    // 1,000 USD at 3.6725 = 3,672.50 AED; VAT 50 USD = 183.63 AED.
    expect(gen.body.box1bDubaiAmount).toBe(3672.5);
    expect(gen.body.box1bDubaiVat).toBe(183.63);
    expect(gen.body.box14PayableTax).toBe(183.63);

    const { computeVat201 } = await import("../../server/tax/vat-engine");
    const c = await computeVat201({
      companyId: t.company.id,
      from: Q3.periodStart,
      to: Q3.periodEnd,
    });
    expect(c.currency).toMatchObject({
      baseCurrency: "USD",
      filingCurrency: "AED",
      converted: true,
    });
    expect(c.currency.rates[0].rate).toMatch(/^3\.6725/);
    // The VAT-to-GL reconciliation stays in the functional currency and agrees with the ledger.
    expect(c.reconciliation.hasUnexplainedDifference).toBe(false);
    expect(c.contributions[0].baseBoxes?.box1bDubaiVat).toBe(5000);

    // Without a USD/AED rate the AED return cannot be produced.
    const noRate = await vatTenant({ base_currency: "EUR" });
    await issued(noRate, {
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const blocked = await noRate.as.post(
      `/api/companies/${noRate.company.id}/vat-returns/generate`,
      Q3
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe("NO_EXCHANGE_RATE");
  });
});

describe("S1 corporate tax: estimate until reviewed or filed", () => {
  it("[R12-12] the ledger preview and an unreviewed return are labelled estimates", async () => {
    const t = await h.createTenant();
    const calc = await t.as.get(
      `/api/companies/${t.company.id}/corporate-tax/calculate?periodStart=2025-01-01&periodEnd=2025-12-31`
    );
    expect(calc.status, calc.text).toBe(200);
    expect(calc.body).toMatchObject({ figureStatus: "estimate", isEstimate: true });
    const created = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({ figureStatus: "estimate", isEstimate: true });
    const list = await t.as.get(`/api/companies/${t.company.id}/corporate-tax/returns`);
    expect(list.body[0].figureStatus).toBe("estimate");
  });
});
