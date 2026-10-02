import { describe, expect, it } from "vitest";
import { INVOICE_WRITABLE_FIELDS, QUOTE_WRITABLE_FIELDS, pickWritable, documentDiscountSchema } from "../../server/services/sales-input";
import { invoiceBelongsToContact } from "../../server/routes/portal.public.routes";

describe("pickWritable (no mass assignment)", () => {
  it("keeps only allow-listed header fields of an invoice", () => {
    const body = {
      customerName: "Acme",
      contactId: "c-1",
      invoiceType: "credit_note",
      status: "paid",
      isOpeningBalance: true,
      salesOrderId: "so-1",
      lateFeeForInvoiceId: "i-1",
      subtotal: 1,
      shareToken: "x",
    };
    expect(pickWritable(body, INVOICE_WRITABLE_FIELDS)).toEqual({ customerName: "Acme", contactId: "c-1" });
  });
  it("keeps only allow-listed header fields of a quote", () => {
    expect(pickWritable({ customerName: "A", status: "accepted", shareToken: "t", convertedInvoiceId: "i", notes: "n" }, QUOTE_WRITABLE_FIELDS)).toEqual({ customerName: "A", notes: "n" });
  });
  it("ignores undefined and non-object bodies", () => {
    expect(pickWritable({ customerName: undefined }, INVOICE_WRITABLE_FIELDS)).toEqual({});
    expect(pickWritable(null, INVOICE_WRITABLE_FIELDS)).toEqual({});
  });
});

describe("documentDiscountSchema", () => {
  it("accepts percent or amount and rejects other types and negative values", () => {
    expect(documentDiscountSchema.parse({ discountType: "percent", discountValue: "10" })).toEqual({ discountType: "percent", discountValue: 10 });
    expect(() => documentDiscountSchema.parse({ discountType: "bogus", discountValue: 1 })).toThrow();
    expect(() => documentDiscountSchema.parse({ discountType: "amount", discountValue: -1 })).toThrow();
  });
});

describe("portal: the contact link decides which invoices a customer sees", () => {
  const x = { id: "contact-x", name: "Same Name" };
  it("an invoice linked to another contact is not X's even with the same name", () => {
    expect(invoiceBelongsToContact({ contactId: "contact-y", customerName: "Same Name" }, x)).toBe(false);
  });
  it("an invoice linked to X is X's whatever its name says", () => {
    expect(invoiceBelongsToContact({ contactId: "contact-x", customerName: "Renamed" }, x)).toBe(true);
  });
  it("only an invoice with no contact at all falls back to the name", () => {
    expect(invoiceBelongsToContact({ contactId: null, customerName: "same name" }, x)).toBe(true);
    expect(invoiceBelongsToContact({ contactId: null, customerName: "Other" }, x)).toBe(false);
  });
});
