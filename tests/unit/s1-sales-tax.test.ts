/**
 * S1 final sweep (unit): invoice-form totals module vs the server engine, e-invoice 422 issue
 * list, ?status= filters, UAE-only VAT rates, margin scheme math, quote state machine,
 * CT estimate labels, RCM goods-type codes / GTIN, company TRN rule, logo helpers, body limits.
 */
import { describe, expect, it } from "vitest";
import {
  computeInvoiceFormLine,
  computeInvoiceFormTotals,
  lineVatRate,
} from "../../client/src/lib/invoice-totals";
import { einvoiceIssuesFromError } from "../../client/src/lib/einvoice-issues";
import { invoiceStatusQuery, parseInvoiceStatusFilter } from "../../client/src/lib/invoice-filters";
import { computeSalesDocument } from "../../server/services/document-totals.service";
import {
  classifySupply,
  isValidGtin,
  RCM_GOODS_TYPES,
  resolveSupplyType,
} from "../../shared/vat-classification";
import { RCM_GOODS_TYPE_CODES } from "../../server/services/einvoice/pint-ae-codes";
import { createInvoiceSchema, salesLineInputSchema } from "../../shared/validators/invoices";
import { updateCompanyBody } from "../../shared/validators/companies";
import { createProductBody } from "../../shared/validators/products";
import {
  canTransitionQuote,
  QUOTE_TRANSITIONS,
  quoteSourcesFor,
} from "../../server/services/quote-state.service";
import { ctFigure, ctFigureStatus } from "../../server/routes/corporate-tax.routes";
import { logoFromDataUrl, loadCompanyLogo } from "../../server/services/pdf-logo";
import { usesLargeJson } from "../../server/http/body-limits";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("[W5-E] invoice-form totals module", () => {
  it("matches the server engine to the fil (line discounts, mixed supply types, rounding)", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const types = ["standard_rated", "zero_rated", "exempt", "out_of_scope"] as const;
    for (let round = 0; round < 200; round++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({
        // As typed in the form (the API accepts at most 4 / 2 decimals).
        quantity: Number((Math.round(rnd() * 1000) / 100 + 0.01).toFixed(2)),
        unitPrice: Number((Math.round(rnd() * 1_000_000) / 100 + 0.01).toFixed(2)),
        vatSupplyType: types[Math.floor(rnd() * types.length)],
        discountPercent: rnd() < 0.4 ? Math.round(rnd() * 5000) / 100 : 0,
      }));
      const client = computeInvoiceFormTotals(lines);
      const server = computeSalesDocument(
        lines.map((l) => ({
          quantity: l.quantity,
          unitPriceFils: Math.round(l.unitPrice * 100),
          vatRate: lineVatRate(l.vatSupplyType),
          vatSupplyType: l.vatSupplyType,
          discountType: l.discountPercent ? "percent" : null,
          discountValue: l.discountPercent || null,
        })),
        { resolve: true }
      );
      expect(client.subtotalFils, JSON.stringify(lines)).toBe(server.subtotalFils);
      expect(client.vatFils, JSON.stringify(lines)).toBe(server.vatFils);
      expect(client.totalFils).toBe(server.totalFils);
    }
  });

  it("rounds VAT once per document and labels the charged rates", () => {
    // 3 × 0.10 at 5%: per-line VAT 0.005 each would round to 0.03; document rounding gives 0.02.
    const t = computeInvoiceFormTotals([
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 1, unitPrice: 0.1 },
      { quantity: 1, unitPrice: 0.1 },
    ]);
    expect(t.vatFils).toBe(server3());
    expect(t.ratesCharged).toEqual([0.05]);
    expect(
      computeInvoiceFormLine({ quantity: 1, unitPrice: 100, discountPercent: 10 }).lineTotal
    ).toBe(94.5);
    expect(lineVatRate("zero_rated")).toBe(0);
  });
});

function server3() {
  return computeSalesDocument(
    [10, 10, 10].map((f) => ({ quantity: 1, unitPriceFils: f, vatRate: 0.05 })),
    { resolve: true }
  ).vatFils;
}

describe("[W4-C] e-invoice 422 issue list", () => {
  it("collects the fix-it list and the schema/schematron/rule findings", () => {
    expect(
      einvoiceIssuesFromError({
        code: "EINVOICE_VALIDATION_FAILED",
        issues: [
          { field: "lines[0].gtin", message: "A reverse-charge line needs the item GTIN" },
          { field: "invoice.customerTrn", message: "Buyer TRN is required" },
        ],
      })
    ).toEqual([
      { field: "lines[0].gtin", message: "A reverse-charge line needs the item GTIN" },
      { field: "invoice.customerTrn", message: "Buyer TRN is required" },
    ]);
    const schema = einvoiceIssuesFromError({
      code: "EINVOICE_SCHEMA_INVALID",
      validation: {
        xsd: { errors: [{ message: "cvc-complex-type" }] },
        schematron: { errors: [{ id: "ibr-174-ae", message: "GTIN scheme 0160" }] },
        rules: { errors: [] },
      },
    });
    expect(schema).toEqual([
      { field: "UBL schema", message: "cvc-complex-type" },
      { field: "PINT AE schematron ibr-174-ae", message: "GTIN scheme 0160" },
    ]);
    expect(einvoiceIssuesFromError(undefined)).toEqual([]);
    expect(einvoiceIssuesFromError({ message: "x" })).toEqual([]);
  });
});

describe("[W3-E][R13-21] invoice ?status= filter from dashboard links", () => {
  it("reads open / overdue / stored statuses and ignores anything else", () => {
    expect(parseInvoiceStatusFilter("?status=open")).toBe("open");
    expect(parseInvoiceStatusFilter("?tab=x&status=OVERDUE")).toBe("overdue");
    expect(parseInvoiceStatusFilter("?status=paid")).toBe("paid");
    expect(parseInvoiceStatusFilter("?status=drop%20table")).toBeNull();
    expect(parseInvoiceStatusFilter("")).toBeNull();
    expect(invoiceStatusQuery("overdue")).toBe("&status=overdue");
    expect(invoiceStatusQuery(null)).toBe("");
  });
});

describe("[STEP2] VAT rate: UAE only (5% standard, no 15% KSA rate)", () => {
  it("refuses 15%, never charges it, and prices a 1,000 AED document at 50 VAT", () => {
    expect(() => resolveSupplyType({ vatRate: 15 })).toThrow(/0% or 5%/);
    expect(resolveSupplyType({ vatRate: 5 })).toBe("standard_rated");
    expect(classifySupply({ supplyType: "standard_rated", vatRate: 0.15 }).chargedVatRate).toBe(
      0.05
    );
    expect(classifySupply({ supplyType: "standard_rated", vatRate: 0.05 }).chargedVatRate).toBe(
      0.05
    );
    const t = computeSalesDocument([{ quantity: 1, unitPriceFils: 100_000 }], { resolve: true });
    expect(t.vatFils).toBe(5_000);
  });
});

describe("[R07-15] profit-margin scheme math", () => {
  it("charges VAT on the margin only and keeps the price; Box 1 gets the margin excl. VAT", () => {
    const t = computeSalesDocument(
      [{ quantity: 1, unitPriceFils: 1_050_000, marginScheme: true, marginCostFils: 840_000 }],
      { resolve: true }
    );
    expect(t.lines[0]).toMatchObject({ netFils: 1_040_000, vatFils: 10_000, marginFils: 200_000 });
    expect(t.totalFils).toBe(1_050_000);
    // Sold below cost: no margin, no VAT.
    const loss = computeSalesDocument(
      [{ quantity: 1, unitPriceFils: 50_000, marginScheme: true, marginCostFils: 60_000 }],
      { resolve: true }
    );
    expect(loss.vatFils).toBe(0);
    expect(() =>
      computeSalesDocument(
        [
          {
            quantity: 1,
            unitPriceFils: 100,
            vatRate: 0,
            vatSupplyType: "zero_rated",
            marginScheme: true,
            marginCostFils: 0,
          },
        ],
        { resolve: true }
      )
    ).toThrow(/standard-rated/);
    // Contract: margin lines are invoice-only and need a purchase cost.
    const base = { customerName: "A", date: new Date().toISOString().slice(0, 10) };
    expect(
      createInvoiceSchema.safeParse({
        ...base,
        lines: [{ description: "Car", quantity: 1, unitPrice: 100, marginScheme: true }],
      }).success
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        ...base,
        lines: [
          {
            description: "Car",
            quantity: 1,
            unitPrice: 100,
            marginScheme: true,
            marginPurchaseCost: 80,
          },
        ],
      }).success
    ).toBe(true);
    expect(
      salesLineInputSchema.safeParse({
        description: "Car",
        quantity: 1,
        unitPrice: 100,
        marginScheme: true,
      }).success
    ).toBe(false);
  });
});

describe("[W4-D] quote state machine", () => {
  it("allows the documented moves only; converted is terminal", () => {
    expect(canTransitionQuote("sent", "accepted")).toBe(true);
    expect(canTransitionQuote("declined", "accepted")).toBe(false);
    expect(canTransitionQuote("converted", "sent")).toBe(false);
    expect(QUOTE_TRANSITIONS.converted).toEqual([]);
    expect(quoteSourcesFor("accepted").sort()).toEqual(["draft", "sent"]);
  });
});

describe("[R12-12] corporate tax figure labels", () => {
  it("is an estimate until reviewed; reviewed is filing-ready; filed/paid is filed", () => {
    expect(ctFigureStatus("draft")).toBe("estimate");
    expect(ctFigureStatus("computed")).toBe("estimate");
    expect(ctFigureStatus("reviewed")).toBe("filing_ready");
    expect(ctFigureStatus("filed")).toBe("filed");
    expect(ctFigureStatus("paid")).toBe("filed");
    expect(ctFigureStatus("amended")).toBe("superseded");
    expect(ctFigure("preview")).toMatchObject({ figureStatus: "estimate", isEstimate: true });
  });
});

describe("[W4-C] product GTIN and RCM goods type", () => {
  it("keeps one RCM list and checks the GTIN check digit", () => {
    expect([...RCM_GOODS_TYPES]).toEqual([...RCM_GOODS_TYPE_CODES]);
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("abc")).toBe(false);
    expect(
      createProductBody.safeParse({ name: "X", unitPrice: 1, gtin: "4006381333932" }).success
    ).toBe(false);
    const ok = createProductBody.safeParse({
      name: "X",
      unitPrice: 1,
      gtin: "4006381333931",
      rcmGoodsType: "DL8.48.3.1",
    });
    expect(ok.success && ok.data).toMatchObject({ gtin: "4006381333931" });
  });
});

describe("[W4-E][R14-20] company TRN uses zUaeTrn", () => {
  it("rejects 15 digits that do not start with 100 and normalises separators", () => {
    expect(updateCompanyBody.safeParse({ trnVatNumber: "123456789012345" }).success).toBe(false);
    const ok = updateCompanyBody.safeParse({ trnVatNumber: "100 1234 5670 0003" });
    expect(ok.success && ok.data.trnVatNumber).toBe("100123456700003");
    expect(updateCompanyBody.safeParse({ trnVatNumber: "" }).success).toBe(true);
    // A KSA-shaped VAT number is refused: Saudi VAT numbers are no longer accepted (STEP2).
    expect(updateCompanyBody.safeParse({ trnVatNumber: "300000000000003" }).success).toBe(false);
  });
});

describe("[R14-13] logo helpers and body limits", () => {
  it("prints the stored logo, falls back to a raster data: URL, and honours show-logo", async () => {
    const png = Buffer.from(PNG_1X1, "base64");
    expect(logoFromDataUrl(`data:image/png;base64,${PNG_1X1}`)?.equals(png)).toBe(true);
    expect(logoFromDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(logoFromDataUrl("https://example.com/logo.png")).toBeNull();
    const legacy = { logoPath: null, logoUrl: `data:image/png;base64,${PNG_1X1}` };
    expect((await loadCompanyLogo(legacy))?.equals(png)).toBe(true);
    expect(await loadCompanyLogo({ ...legacy, invoiceShowLogo: false })).toBeNull();
    expect(await loadCompanyLogo(legacy, { show: false })).toBeNull();
    expect(usesLargeJson("/api/companies/abc/logo")).toBe(true);
    expect(usesLargeJson("/api/companies/abc")).toBe(false);
  });
});
