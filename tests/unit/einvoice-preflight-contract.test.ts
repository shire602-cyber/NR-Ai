import { describe, expect, it } from "vitest";
import en from "../../client/src/locales/en/einvoicing.json";
import ar from "../../client/src/locales/ar/einvoicing.json";
import {
  einvoiceIssueTextKey,
  einvoiceIssuesFromError,
} from "../../client/src/lib/einvoice-issues";
import { preflightEInvoice } from "../../server/services/einvoice-submit.service";
import {
  frozenEInvoiceDispatchIssue,
  generateEInvoiceXML,
  readEInvoiceDocumentType,
} from "../../server/services/einvoice.service";
import { ublToGets } from "../../server/services/einvoice/providers/complyance-gets";
import { validateEInvoiceXml } from "../../server/services/einvoice/validate";
import { fixtureCompany, PINT_AE_FIXTURES } from "../fixtures/pint-ae/fixtures";

const [standard] = PINT_AE_FIXTURES;
const credit = PINT_AE_FIXTURES.find((fixture) => fixture.name === "credit note")!;
const ctx = { customer: standard.customer };

describe("UAE e-invoice preflight", () => {
  it.each(["consumer", "business", "government", null] as const)(
    "classifies a cash sale with buyer type %s and no identifiers",
    async (buyerType) => {
      const checked = await preflightEInvoice(
        { ...standard.invoice, source: "cash_sale", buyerType, customerTrn: null },
        standard.lines,
        fixtureCompany,
        { customer: { ...standard.customer, trn: null, endpointId: null } }
      );
      if (buyerType === "consumer") {
        expect(checked).toMatchObject({ applicable: false, issues: [] });
      } else {
        expect(checked.applicable).toBe(true);
        expect(checked.issues).toContainEqual(
          expect.objectContaining({ code: "EINVOICE_BUYER_ENDPOINT_MISSING" })
        );
      }
    }
  );

  it("guards immutable invoices already queued with contradictory buyer identifiers or generic card", () => {
    const old = (endpointId: string, paymentMeansCode: "48" | "54") =>
      generateEInvoiceXML(
        standard.invoice,
        standard.lines,
        fixtureCompany,
        { ...standard.customer, endpointId },
        { ...standard.opts, paymentMeansCode }
      ).xml;
    expect(frozenEInvoiceDispatchIssue(old("1009999999", "54"))).toBe(
      "EINVOICE_BUYER_ENDPOINT_MISMATCH"
    );
    expect(frozenEInvoiceDispatchIssue(old("1007654321", "48"))).toBe(
      "EINVOICE_PAYMENT_CARD_TYPE_REQUIRED"
    );
    expect(frozenEInvoiceDispatchIssue(old("1007654321", "54"))).toBeNull();

    const key = einvoiceIssueTextKey("EINVOICE_PAYMENT_CARD_TYPE_REQUIRED") as keyof typeof en;
    expect(en[key]).toContain("credit or debit");
    expect(ar[key]).toMatch(/[\u0600-\u06ff]/);
  });

  it.each([standard, credit])(
    "rejects a $name whose 0235 endpoint contradicts the buyer VAT TRN",
    async (fixture) => {
      const checked = await preflightEInvoice(fixture.invoice, fixture.lines, fixtureCompany, {
        customer: { ...fixture.customer, endpointId: "1009999999", endpointScheme: "0235" },
        originalInvoice: fixture.opts.originalInvoice,
      });
      expect(checked.built).toBeNull();
      expect(checked.issues).toContainEqual(
        expect.objectContaining({
          field: "customer.endpointId",
          code: "EINVOICE_BUYER_ENDPOINT_MISMATCH",
        })
      );
      const key = einvoiceIssueTextKey("EINVOICE_BUYER_ENDPOINT_MISMATCH") as keyof typeof en;
      expect(en[key]).toContain("TRN");
      expect(ar[key]).toMatch(/[\u0600-\u06ff]/);
    }
  );

  it("rejects an invalid UAE buyer TRN and discounted VAT drift with localized fixes", async () => {
    const checked = await preflightEInvoice(
      { ...standard.invoice, vatAmount: 84, total: 1774 },
      standard.lines,
      fixtureCompany,
      { customer: { ...standard.customer, trn: "200765432100005" } }
    );
    expect(checked.valid).toBe(false);
    expect(checked.built).toBeNull();
    expect(checked.issues.map((issue) => issue.code)).toEqual([
      "EINVOICE_BUYER_TRN_INVALID",
      "EINVOICE_VAT_TOTAL_MISMATCH",
      "EINVOICE_TOTAL_MISMATCH",
    ]);
    for (const issue of einvoiceIssuesFromError(checked)) {
      const key = einvoiceIssueTextKey(issue.code) as keyof typeof en;
      expect(en[key]).toBeTruthy();
      expect(ar[key]).toMatch(/[\u0600-\u06ff]/);
    }
  });

  it("refuses a credit note if its original invoice cannot be resolved within the company", async () => {
    const checked = await preflightEInvoice(credit.invoice, credit.lines, fixtureCompany, {
      ...ctx,
      originalInvoice: null,
    });
    expect(checked.built).toBeNull();
    expect(checked.issues).toEqual([
      expect.objectContaining({ code: "EINVOICE_ORIGINAL_INVOICE_REQUIRED" }),
    ]);
  });

  it("validates an exempt credit note as type 81 and preserves its original invoice details in GETS", async () => {
    const checked = await preflightEInvoice(
      { ...credit.invoice, vatAmount: 0, total: -500 },
      credit.lines.map((line) => ({ ...line, vatSupplyType: "exempt", vatRate: 0 })),
      fixtureCompany,
      { ...ctx, originalInvoice: credit.opts.originalInvoice }
    );
    expect(checked.valid, JSON.stringify(checked.validation)).toBe(true);
    const { xml, documentType } = checked.built!;
    expect(documentType).toBe("81");
    expect(readEInvoiceDocumentType(xml)).toBe("81");
    expect(ublToGets(xml)).toMatchObject({
      documentType: { base: "credit_note", modifiers: ["out_of_scope"] },
      payload: {
        header: { referenceId: credit.opts.originalInvoice!.number },
        extensions: { peppol_precedingInvoiceIssueDate: credit.opts.originalInvoice!.date },
        lineItems: [{ taxCategory: "E", taxAmount: 0 }],
      },
    });
  });

  it("reports the margin scheme as category N without disclosing the purchase cost or margin VAT", async () => {
    const checked = await preflightEInvoice(
      {
        ...standard.invoice,
        discountValue: 100,
        discountAmount: 100,
        subtotal: 10_304.76,
        vatAmount: 95.24,
        total: 10_400,
      },
      [
        {
          ...standard.lines[1],
          quantity: 1,
          unitPrice: 10_500,
          marginScheme: true,
          marginPurchaseCost: 8400,
        },
      ],
      fixtureCompany,
      ctx
    );
    expect(checked.valid, JSON.stringify(checked.validation)).toBe(true);
    const { xml } = checked.built!;
    expect(xml).not.toMatch(/8400\.00|95\.24/);
    expect(ublToGets(xml)).toMatchObject({
      documentType: { base: "tax_invoice", modifiers: ["margin_scheme"] },
      payload: {
        lineItems: [{ taxCategory: "N", taxRate: 5, taxAmount: 0, lineTotal: 10_400 }],
        totals: { totalTaxAmount: 0, totalAmountIncludingTax: 10_400 },
      },
    });
  });

  it("blocks validation when the required UBL or official schematron artefacts are unavailable", async () => {
    const checked = await preflightEInvoice(standard.invoice, standard.lines, fixtureCompany, ctx);
    expect(checked.valid).toBe(true);
    const validation = await validateEInvoiceXml(checked.built!.xml, { dir: "/dev/null" });
    expect(validation).toMatchObject({
      valid: false,
      xsd: { available: false },
      schematron: { available: false },
      rules: { valid: true },
    });
    expect(einvoiceIssuesFromError({ validation })).toEqual([
      expect.objectContaining({ code: "EINVOICE_VALIDATION_UNAVAILABLE" }),
    ]);
  });
});
