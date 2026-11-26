import { expect, it } from "vitest";
import { useHarness } from "./harness";
import { all, attr, first, parseXml, text } from "../../server/services/einvoice/dom";

const h = useHarness();

it("exports UAE tax in AED for an invoice issued in the company's USD functional currency", async () => {
  const seller = await h.createTenant({
    companyColumns: {
      base_currency: "USD",
      trn_vat_number: "100123456700003",
      legal_name: "Dollar Trading LLC",
      address_street: "Office 12, Sheikh Zayed Road",
      address_city: "Dubai",
      address_country: "AE",
      emirate: "dubai",
      trade_licence_no: "CN-1234567",
      trade_licence_authority: "Dubai Department of Economy and Tourism",
    },
  });
  const api = `/api/companies/${seller.company.id}`;
  const date = new Date().toISOString().slice(0, 10);
  const rate = await seller.as.post(`${api}/exchange-rates`, {
    fromCurrency: "AED",
    rate: 0.25,
    effectiveDate: date,
  });
  expect(rate.status, rate.text).toBe(201);
  const contact = await seller.as.post(`${api}/customer-contacts`, {
    name: "Gulf Trading LLC",
    trnNumber: "100765432100003",
    address: "Building 7, Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(contact.status, contact.text).toBeLessThan(300);
  const invoice = await seller.as.post(`${api}/invoices`, {
    customerName: contact.body.name,
    customerTrn: "100765432100003",
    contactId: contact.body.id,
    date,
    paymentTerms: "net30",
    currency: "USD",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  expect(Number(invoice.body.exchangeRate)).toBe(1);
  expect(Number(invoice.body.vatAmount)).toBe(50);
  const path = `/api/invoices/${invoice.body.id}`;
  const issued = await seller.as.patch(`${path}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  const generated = await seller.as.post(`${path}/generate-einvoice`, {});
  expect(generated.status, generated.text).toBe(200);
  const download = await seller.as.get(`${path}/einvoice-xml`);
  expect(download.status, download.text).toBe(200);
  const root = parseXml(download.text).documentElement;
  const tax = all(root, "cac:TaxTotal/cbc:TaxAmount").map((amount) => [
    attr(amount, "currencyID"),
    text(amount),
  ]);
  expect(tax).toEqual([
    ["USD", "50.00"],
    ["AED", "200.00"],
  ]);
  expect(Number(text(first(root, "cac:TaxExchangeRate/cbc:CalculationRate")))).toBe(4);
});

it("[PR174] converts an AED-ledger sale at the earlier supply date's rate", async () => {
  const seller = await h.createTenant({
    companyColumns: {
      trn_vat_number: "100123456700003",
      legal_name: "Dirham Trading LLC",
      address_street: "Office 12, Sheikh Zayed Road",
      address_city: "Dubai",
      address_country: "AE",
      emirate: "dubai",
      trade_licence_no: "CN-1234567",
      trade_licence_authority: "Dubai Department of Economy and Tourism",
    },
  });
  const api = `/api/companies/${seller.company.id}`;
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  for (const [rate, effectiveDate] of [
    [4, day(-10)],
    [4.2, day(0)],
  ] as const) {
    const saved = await seller.as.post(`${api}/exchange-rates`, {
      fromCurrency: "EUR",
      rate,
      effectiveDate,
    });
    expect(saved.status, saved.text).toBe(201);
  }
  const contact = await seller.as.post(`${api}/customer-contacts`, {
    name: "Gulf Trading LLC",
    trnNumber: "100765432100003",
    address: "Building 7, Internet City",
    city: "Dubai",
    emirate: "dubai",
    country: "AE",
  });
  expect(contact.status, contact.text).toBeLessThan(300);
  const invoice = await seller.as.post(`${api}/invoices`, {
    customerName: contact.body.name,
    customerTrn: "100765432100003",
    contactId: contact.body.id,
    date: day(0),
    paymentTerms: "net30",
    currency: "EUR",
    lines: [{ description: "Supplies", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(invoice.status, invoice.text).toBe(200);
  expect(Number(invoice.body.exchangeRate)).toBe(4.2);
  await h.sql("UPDATE invoices SET supply_date = $1 WHERE id = $2", [day(-9), invoice.body.id]);
  const path = `/api/invoices/${invoice.body.id}`;
  const issued = await seller.as.patch(`${path}/status`, { status: "sent" });
  expect(issued.status, issued.text).toBe(200);
  const generated = await seller.as.post(`${path}/generate-einvoice`, {});
  expect(generated.status, generated.text).toBe(200);
  const download = await seller.as.get(`${path}/einvoice-xml`);
  expect(download.status, download.text).toBe(200);
  const root = parseXml(download.text).documentElement;
  expect(
    all(root, "cac:TaxTotal/cbc:TaxAmount").map((amount) => [
      attr(amount, "currencyID"),
      text(amount),
    ])
  ).toEqual([
    ["EUR", "50.00"],
    ["AED", "200.00"],
  ]);
  expect(Number(text(first(root, "cac:TaxExchangeRate/cbc:CalculationRate")))).toBe(4);
});
