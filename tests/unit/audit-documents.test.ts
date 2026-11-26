import { expect, it } from "vitest";
import { PINT_AE_FIXTURES, fixtureCompany } from "../fixtures/pint-ae/fixtures";
import { generateEInvoiceXML } from "../../server/services/einvoice.service";
import { attr, first, parseXml, text, textAt } from "../../server/services/einvoice/dom";
import { ublToGets } from "../../server/services/einvoice/providers/complyance-gets";
import { generateInvoicePDF } from "../../server/services/pdf-invoice.service";
import { pdfToText } from "./pdf-test-helpers";

const standard = PINT_AE_FIXTURES[0];
const invoice = {
  ...standard.invoice,
  discountType: null,
  discountAmount: 0,
  discountValue: null,
  subtotal: 1040,
  vatAmount: 10,
  total: 1050,
  status: "sent",
};
const line = {
  ...standard.lines[1],
  description: "Second-hand equipment",
  quantity: 1,
  unitPrice: 1050,
  marginScheme: true,
  marginPurchaseCost: 840,
  netAmount: 1040,
};

it("keeps the agreed VAT-inclusive margin-scheme selling price on the e-invoice", () => {
  // (1050 − 840) × 5 / 105 = 10 AED embedded VAT. The customer owes 1050.
  const result = generateEInvoiceXML(invoice, [line], fixtureCompany, standard.customer);
  const root = parseXml(result.xml).documentElement;
  expect(textAt(root, "cac:LegalMonetaryTotal/cbc:PayableAmount")).toBe("1050.00");
});

it("keeps a margin-scheme PDF line consistent with its VAT-inclusive selling price", async () => {
  const pdf = await generateInvoicePDF(invoice, [line], fixtureCompany);
  const text = await pdfToText(pdf);
  expect(text).toContain("1,050.00");
  // The net line is 1040 and its embedded VAT is 10. Charging 5% of the entire net
  // line would display 52 in tax and a gross line of 1092, exceeding the invoice total.
  expect(text).not.toMatch(/\b52\.00\b|\b1,092\.00\b/);
}, 60_000);

it("renders the stored PDF line net after the quantity loses precision in PostgreSQL real", async () => {
  const pdf = await generateInvoicePDF(
    { ...invoice, subtotal: 1_000_000.01, vatAmount: 50_000, total: 1_050_000.01 },
    [
      {
        ...standard.lines[1],
        quantity: Math.fround(10_000.0001),
        unitPrice: 100,
        netAmount: 1_000_000.01,
      },
    ],
    fixtureCompany
  );
  const text = await pdfToText(pdf);
  expect(text).toContain("1,000,000.01");
  expect(text).toContain("1,050,000.01");
  expect(text).not.toMatch(/\b1,000,000\.00\b|\b1,050,000\.00\b/);
}, 60_000);

it.each([
  { scope: "line", onDocument: false, withMargin: false },
  { scope: "document", onDocument: true, withMargin: false },
  { scope: "line on a mixed invoice", onDocument: false, withMargin: true },
])(
  "generates the PDF when a fixed $scope discount already reduced the stored net to zero",
  async ({ onDocument, withMargin }) => {
    const discount = { discountType: "amount", discountValue: 1_000_000.01 };
    const pdf = await generateInvoicePDF(
      {
        ...invoice,
        ...(onDocument ? discount : {}),
        discountAmount: 1_000_000.01,
        subtotal: withMargin ? invoice.subtotal : 0,
        vatAmount: withMargin ? invoice.vatAmount : 0,
        total: withMargin ? invoice.total : 0,
      },
      [
        {
          ...standard.lines[1],
          ...(!onDocument ? { ...discount, discountAmount: 1_000_000.01 } : {}),
          quantity: Math.fround(10_000.0001),
          unitPrice: 100,
          netAmount: 0,
        },
        ...(withMargin ? [line] : []),
      ],
      fixtureCompany
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  },
  60_000
);

it("expresses both UAE line extension amounts in AED on a USD tax invoice", () => {
  // PINT AE BTAE-08 and BTAE-10 are denominated in AED, even when the invoice is in USD.
  const foreign = PINT_AE_FIXTURES.find((fixture) => fixture.name === "foreign currency")!;
  const { xml } = generateEInvoiceXML(
    foreign.invoice,
    foreign.lines,
    fixtureCompany,
    foreign.customer,
    foreign.opts
  );
  const root = parseXml(xml).documentElement;
  const extension = first(root, "cac:InvoiceLine/cac:ItemPriceExtension")!;
  const amounts = ["cbc:Amount", "cac:TaxTotal/cbc:TaxAmount"].map((path) => {
    const amount = first(extension, path);
    return [attr(amount, "currencyID"), text(amount)];
  });
  // At 3.6725 AED/USD, 1050 USD gross and 50 USD VAT round half-up to the fils.
  expect(amounts).toEqual([
    ["AED", "3856.13"],
    ["AED", "183.63"],
  ]);
});

it("passes exact document currency line amounts when AED rounding loses precision", () => {
  const foreign = PINT_AE_FIXTURES.find((fixture) => fixture.name === "foreign currency")!;
  const { xml } = generateEInvoiceXML(
    { ...foreign.invoice, currency: "INR", exchangeRate: 1 },
    foreign.lines,
    fixtureCompany,
    foreign.customer,
    { ...foreign.opts, taxExchangeRate: "0.0313" }
  );
  const root = parseXml(xml).documentElement;
  expect(textAt(root, "cac:InvoiceLine/cac:ItemPriceExtension/cbc:Amount")).toBe("32.87");
  expect(textAt(root, "cac:InvoiceLine/cac:ItemPriceExtension/cac:TaxTotal/cbc:TaxAmount")).toBe(
    "1.57"
  );
  expect(ublToGets(xml, [{ taxAmount: 50, lineTotal: 1050 }]).payload).toMatchObject({
    lineItems: [expect.objectContaining({ taxAmount: 50, lineTotal: 1050 })],
  });
});
