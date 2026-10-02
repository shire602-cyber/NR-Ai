import { describe, it, expect } from "vitest";
import { canonicalJson, requestHash } from "../../server/api-v1/idempotency";
import { invoiceCreate, invoicePaymentCreate, journalCreate, money, contactCreate } from "../../server/api-v1/schemas";

describe("request hash", () => {
  it("ignores key order and undefined, not values", () => {
    expect(requestHash({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(requestHash({ b: { d: "x", c: [1, 2] }, a: 1, e: undefined }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
    expect(requestHash({ a: [1, 2] })).not.toBe(requestHash({ a: [2, 1] }));
    expect(requestHash(undefined)).toBe(requestHash(null));
  });
  it("canonicalises nested structures", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});

describe("money schema", () => {
  it("accepts 2 dp strings and numbers, normalising to a number", () => {
    expect(money.parse("1250.50")).toBe(1250.5);
    expect(money.parse(10)).toBe(10);
    expect(money.parse("0")).toBe(0);
  });
  it.each(["100.005", "-5", "abc", "1000000000000000", "1e3", "", "12.", ".5"])("rejects %s", (v) => {
    expect(money.safeParse(v).success).toBe(false);
  });
  it("rejects numbers with 3 decimals, negatives and absurd sizes", () => {
    expect(money.safeParse(1.005).success).toBe(false);
    expect(money.safeParse(-1).success).toBe(false);
    expect(money.safeParse(1e15).success).toBe(false);
  });
});

const goodInvoice = { customerName: "A", date: "2026-10-02", lines: [{ description: "x", quantity: 1, unitPrice: "10.00" }] };

describe("strict whitelists", () => {
  it("accepts a minimal invoice", () => {
    expect(invoiceCreate.safeParse(goodInvoice).success).toBe(true);
  });
  it.each(["isOpeningBalance", "companyId", "status", "number", "total", "subtotal", "baseCurrencyAmount"])(
    "rejects %s on an invoice",
    (key) => {
      expect(invoiceCreate.safeParse({ ...goodInvoice, [key]: 1 }).success).toBe(false);
    }
  );
  it("rejects bad VAT rates, dates and empty lines", () => {
    const line = goodInvoice.lines[0];
    expect(invoiceCreate.safeParse({ ...goodInvoice, lines: [{ ...line, vatRate: 0.5 }] }).success).toBe(false);
    expect(invoiceCreate.safeParse({ ...goodInvoice, lines: [{ ...line, vatRate: 5 }] }).success).toBe(true);
    expect(invoiceCreate.safeParse({ ...goodInvoice, date: "2026-02-30" }).success).toBe(false);
    expect(invoiceCreate.safeParse({ ...goodInvoice, lines: [] }).success).toBe(false);
  });
  it("turns percent 5 into 0.05", () => {
    const parsed = invoiceCreate.parse({ ...goodInvoice, lines: [{ ...goodInvoice.lines[0], vatRate: 5 }] });
    expect(parsed.lines[0].vatRate).toBe(0.05);
  });
  it("requires a positive payment amount and an account", () => {
    expect(invoicePaymentCreate.safeParse({ amount: "0.00", paymentAccountId: crypto.randomUUID() }).success).toBe(false);
    expect(invoicePaymentCreate.safeParse({ amount: "5.00" }).success).toBe(false);
    expect(invoicePaymentCreate.safeParse({ amount: "5.00", paymentAccountId: crypto.randomUUID() }).success).toBe(true);
  });
  it("requires balanced journals with one-sided lines and no system source", () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const ok = { date: "2026-10-02", lines: [{ accountId: a, debit: "10.00" }, { accountId: b, credit: "10.00" }] };
    expect(journalCreate.safeParse(ok).success).toBe(true);
    expect(journalCreate.safeParse({ ...ok, source: "invoice" }).success).toBe(false);
    expect(journalCreate.safeParse({ ...ok, lines: [{ accountId: a, debit: "10.00" }, { accountId: b, credit: "9.00" }] }).success).toBe(false);
    expect(journalCreate.safeParse({ ...ok, lines: [{ accountId: a, debit: "10.00", credit: "1.00" }, { accountId: b, credit: "9.00" }] }).success).toBe(false);
  });
  it("requires a 15-digit TRN on contacts", () => {
    expect(contactCreate.safeParse({ name: "A", trn: "123" }).success).toBe(false);
    expect(contactCreate.safeParse({ name: "A", trn: "100123456700003" }).success).toBe(true);
  });
});
