import { describe, expect, it } from "vitest";
import {
  selectPeriodSalesDocuments,
  vatDocumentEffectForPeriod,
  type VatDocumentEffect,
} from "../../server/services/vat-document-effect";
import { uaeCalendarDate } from "../../server/utils/date";

// A tax return reflects the documents as they stood in the period: an invoice cancelled in a later
// period was a valid supply in its own period, and its cancellation is reported where it happened
// (as a negative line, like a credit note). One rule, used by every VAT engine.

const AUG = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };
const SEP = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };
const OCT = { periodStart: "2026-10-01", periodEnd: "2026-10-31" };
const effect = (documentDate: string, voidedOn: string | null, period: { periodStart: string; periodEnd: string }, neverPosted = false): VatDocumentEffect =>
  vatDocumentEffectForPeriod({ documentDate, voidedOn, neverPosted, ...period });

describe("vatDocumentEffectForPeriod", () => {
  it("never voided: included in its own period, nothing in any other", () => {
    expect(effect("2026-08-10", null, AUG)).toBe("include");
    expect(effect("2026-08-10", null, SEP)).toBe("none");
  });

  it("voided inside the same period: excluded (net zero, as before)", () => {
    expect(effect("2026-08-10", "2026-08-20", AUG)).toBe("exclude");
    expect(effect("2026-08-10", "2026-08-20", SEP)).toBe("none");
  });

  it("voided on the same day it was issued: excluded", () => {
    expect(effect("2026-08-10", "2026-08-10", AUG)).toBe("exclude");
  });

  it("voided in the next period: still included in its own period, reversed in the void's period", () => {
    expect(effect("2026-08-10", "2026-09-29", AUG)).toBe("include");
    expect(effect("2026-08-10", "2026-09-29", SEP)).toBe("reverse_in_period");
    expect(effect("2026-08-10", "2026-09-29", OCT)).toBe("none");
  });

  it("voided two periods later: included, nothing in between, reversed where it happened", () => {
    expect(effect("2026-08-10", "2026-10-05", AUG)).toBe("include");
    expect(effect("2026-08-10", "2026-10-05", SEP)).toBe("none");
    expect(effect("2026-08-10", "2026-10-05", OCT)).toBe("reverse_in_period");
  });

  it("void dated exactly on the last day of the period stays inside that period", () => {
    expect(effect("2026-08-10", "2026-08-31", AUG)).toBe("exclude");
    expect(effect("2026-08-10", "2026-08-31", SEP)).toBe("none");
  });

  it("void dated exactly on the next period's first day belongs to the next period", () => {
    expect(effect("2026-08-10", "2026-09-01", AUG)).toBe("include");
    expect(effect("2026-08-10", "2026-09-01", SEP)).toBe("reverse_in_period");
  });

  it("a document dated on the period's first and last day is in the period", () => {
    expect(effect("2026-08-01", null, AUG)).toBe("include");
    expect(effect("2026-08-31", null, AUG)).toBe("include");
    expect(effect("2026-09-01", null, AUG)).toBe("none");
  });

  it("a draft voided without ever being posted never counts in any period", () => {
    expect(effect("2026-08-10", null, AUG, true)).toBe("none");
    expect(effect("2026-08-10", "2026-09-05", SEP, true)).toBe("none");
    expect(effect("2026-08-10", null, SEP, true)).toBe("none");
  });

  it("a void dated before its own document (bad data) takes effect on the document date, never reverses twice", () => {
    expect(effect("2026-08-10", "2026-07-01", AUG)).toBe("exclude");
    expect(effect("2026-08-10", "2026-07-01", SEP)).toBe("none");
  });

  it("accepts stored Dates (UTC calendar day) as well as YYYY-MM-DD strings", () => {
    expect(
      vatDocumentEffectForPeriod({
        documentDate: new Date("2026-08-10T00:00:00Z"),
        voidedOn: new Date("2026-09-29T00:00:00Z"),
        periodStart: new Date("2026-09-01T00:00:00Z"),
        periodEnd: new Date("2026-09-30T00:00:00Z"),
      })
    ).toBe("reverse_in_period");
  });

  it("a credit note voided later is the mirror image: positive in the period of the void", () => {
    // the caller negates the (negative) credit-note lines: same effect codes
    expect(effect("2026-08-12", "2026-09-10", AUG)).toBe("include");
    expect(effect("2026-08-12", "2026-09-10", SEP)).toBe("reverse_in_period");
  });
});

describe("uaeCalendarDate (the accounting date of a void)", () => {
  it("is UTC midnight of the UAE calendar day, so the ledger's date::date agrees with the UAE day", () => {
    // 01:30 on 1 October in the UAE is still 30 September in UTC
    expect(uaeCalendarDate(new Date("2026-09-30T21:30:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(uaeCalendarDate(new Date("2026-09-30T19:59:00Z")).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(uaeCalendarDate(new Date("2026-09-30T20:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("selectPeriodSalesDocuments", () => {
  const inv = (id: string, date: string, status: string, voidedOn: string | null = null, extra: object = {}) => ({ id, date, status, voidedOn, ...extra });
  const line = (invoiceId: string, quantity: number, unitPrice = 1000) => ({ invoiceId, quantity, unitPrice, vatRate: 0.05, vatSupplyType: "standard_rated" });
  const invoices = [
    inv("keep", "2026-08-10", "sent"),
    inv("voidLater", "2026-08-11", "void", "2026-09-29"),
    inv("voidSame", "2026-08-12", "void", "2026-08-20"),
    inv("draft", "2026-08-13", "draft"),
    inv("neverPosted", "2026-08-14", "void", null),
    inv("opening", "2026-08-15", "sent", null, { isOpeningBalance: true }),
    inv("cancelledLater", "2026-08-16", "cancelled", "2026-10-02"),
  ];
  const lines = invoices.flatMap((i) => [line(i.id, 1), line(i.id, 2, 500)]);

  it("August: the invoice voided in September is still a supply of August", () => {
    const r = selectPeriodSalesDocuments({ invoices, lines, ...AUG });
    expect(r.invoices.map((i) => [i.id, i.effect])).toEqual([
      ["keep", "include"],
      ["voidLater", "include"],
      ["cancelledLater", "include"],
    ]);
    expect(r.lines.every((l) => l.quantity > 0)).toBe(true);
  });

  it("September: the void is a negative line for every line of the invoice", () => {
    const r = selectPeriodSalesDocuments({ invoices, lines, ...SEP });
    expect(r.invoices.map((i) => [i.id, i.effect])).toEqual([["voidLater", "reverse_in_period"]]);
    expect(r.lines.map((l) => [l.invoiceId, l.quantity, l.unitPrice])).toEqual([
      ["voidLater", -1, 1000],
      ["voidLater", -2, 500],
    ]);
  });

  it("October: the cancellation is reported there", () => {
    const r = selectPeriodSalesDocuments({ invoices, lines, ...OCT });
    expect(r.invoices.map((i) => [i.id, i.effect])).toEqual([["cancelledLater", "reverse_in_period"]]);
  });
});
