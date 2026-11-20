import { describe, expect, it } from "vitest";
import { parseXml, textAt } from "../../server/services/einvoice/dom";
import { ublToGets } from "../../server/services/einvoice/providers/complyance-gets";
import { useHarness } from "./harness";

const h = useHarness();

describe("UAE PINT AE cash sales", () => {
  it("keeps the issued cash-sale series and records its payment in PINT AE and GETS", async () => {
    const tenant = await h.createTenant({
      companyColumns: {
        trn_vat_number: "100123456700003",
        legal_name: "Pearl Trading L.L.C.",
        address_street: "Office 1204, Al Saqr Tower",
        address_city: "Dubai",
        address_country: "AE",
        emirate: "dubai",
        trade_licence_no: "CN-1234567",
        trade_licence_authority: "Dubai Department of Economy and Tourism",
        address_district: "Trade Centre",
        address_po_box: "12345",
      },
    });
    const base = `/api/companies/${tenant.company.id}`;
    const contact = await tenant.as.post(`${base}/customer-contacts`, {
      name: "Acme Gulf FZ-LLC",
      trnNumber: "100765432100003",
      address: "Building 7, Al Majaz",
      city: "Sharjah",
      emirate: "sharjah",
      postalCode: "45678",
      country: "AE",
    });
    expect(contact.status, contact.text).toBeLessThan(300);
    const bank = await tenant.as.post(`${base}/bank-accounts`, {
      nameEn: "Cash receipts account",
      bankName: "Test bank",
    });
    expect(bank.status, bank.text).toBe(201);
    const sale = await tenant.as.post(`${base}/cash-sales`, {
      contactId: contact.body.id,
      date: new Date().toISOString().slice(0, 10),
      placeOfSupplyEmirate: "dubai",
      paymentAccountId: bank.body.glAccountId,
      method: "cash",
      lines: [{ description: "Counter sale", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
    });
    expect(sale.status, sale.text).toBe(201);
    expect(sale.body.number).toMatch(/^CS-/);
    expect(sale.body.status).toBe("paid");

    const invoiceBase = `/api/invoices/${sale.body.id}`;
    const generated = await tenant.as.post(`${invoiceBase}/generate-einvoice`, {});
    expect(generated.status, generated.text).toBe(200);
    expect(generated.body.validation).toMatchObject({ valid: true });
    const xmlResponse = await tenant.as.get(`${invoiceBase}/einvoice-xml`);
    expect(xmlResponse.status).toBe(200);
    const root = parseXml(xmlResponse.text).documentElement;
    expect(textAt(root, "cbc:ID")).toBe(sale.body.number);
    expect(textAt(root, "cbc:InvoiceTypeCode")).toBe("380");
    expect(textAt(root, "cac:PaymentMeans/cbc:PaymentMeansCode")).toBe("10");
    expect(ublToGets(xmlResponse.text).payload).toMatchObject({
      header: { documentNumber: sale.body.number },
      parties: {
        seller: { address: { addressLine2: "Trade Centre, PO Box 12345" } },
        buyer: { address: { postalCode: "45678", stateOrProvince: "SHJ" } },
      },
      payment: { paymentMeans: [{ paymentMeansCode: "IN_CASH" }] },
      totals: { prepaidAmount: 105, amountDue: 0, totalAmountIncludingTax: 105 },
    });
  });
});
