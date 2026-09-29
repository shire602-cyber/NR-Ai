import { describe, expect, it } from "vitest";
import {
  selectPeriodSalesDocuments,
  vatDocumentEffectForPeriod,
} from "../../server/services/vat-document-effect";
import {
  uaeDayEndMs,
  voidedDocumentNeverDeclared,
  type FiledVatReturnRecord,
} from "../../server/services/vat-void-history";

// A sale that an OLD-rule return already left out (because the invoice was void when that return
// was prepared) was never declared, so its later void must not be deducted a second time.
// The deciding fact is whether the document was ever DECLARED in a filed return.

const at = (iso: string) => Date.parse(iso);
const CUTOVER = at("2026-09-20T10:00:00.000Z");

const JUL = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };
const AUG = { periodStart: "2026-08-01", periodEnd: "2026-08-31" };

const julReturn = (recordedAtMs: number | null): FiledVatReturnRecord => ({ ...JUL, recordedAtMs });

const neverDeclared = (over: Partial<Parameters<typeof voidedDocumentNeverDeclared>[0]> = {}) =>
  voidedDocumentNeverDeclared({
    documentDate: "2026-07-10",
    voidedOn: "2026-08-05",
    voidedAtMs: at("2026-08-05T08:00:00.000Z"),
    filedReturns: [julReturn(at("2026-08-20T09:00:00.000Z"))],
    cutoverMs: CUTOVER,
    ...over,
  });

describe("voidedDocumentNeverDeclared", () => {
  it("(a) old-rule return recorded after the void: the void was already in when it was prepared -> never declared", () => {
    expect(neverDeclared()).toBe(true);
  });

  it("(b) return recorded BEFORE the void (old rule): the document was live -> declared", () => {
    expect(neverDeclared({ filedReturns: [julReturn(at("2026-08-01T09:00:00.000Z"))] })).toBe(false);
  });

  it("(c) return recorded at or after the cutover (new rule): the date rule included the document -> declared", () => {
    expect(neverDeclared({ filedReturns: [julReturn(at("2026-09-21T09:00:00.000Z"))] })).toBe(false);
    // exactly at the cutover counts as new rule
    expect(neverDeclared({ filedReturns: [julReturn(CUTOVER)] })).toBe(false);
  });

  it("(d) no filed return covers the document date: live computation -> declared (not 'never declared')", () => {
    expect(neverDeclared({ filedReturns: [] })).toBe(false);
    expect(neverDeclared({ filedReturns: [{ periodStart: "2026-06-01", periodEnd: "2026-06-30", recordedAtMs: at("2026-07-05T00:00:00Z") }] })).toBe(false);
  });

  it("a return recorded one millisecond before the cutover is still old rule", () => {
    expect(neverDeclared({ filedReturns: [julReturn(CUTOVER - 1)], voidedAtMs: at("2026-08-05T08:00:00.000Z") })).toBe(true);
  });

  it("missing timestamp on a legacy return: treated as recorded at cutover-1ms, after any void made before the cutover (never deduct in doubt)", () => {
    expect(neverDeclared({ filedReturns: [julReturn(null)] })).toBe(true);
    // a void made AFTER the cutover cannot have been left out by the old rule
    expect(neverDeclared({ filedReturns: [julReturn(null)], voidedOn: "2026-09-25", voidedAtMs: at("2026-09-25T08:00:00Z") })).toBe(false);
  });

  it("a void on exactly the last day of the document's period is the same period: not applicable", () => {
    expect(neverDeclared({ voidedOn: "2026-07-31", voidedAtMs: at("2026-07-31T08:00:00Z") })).toBe(false);
  });

  it("same instant: return recorded at the very instant of the void counts as on or after the void", () => {
    const v = at("2026-08-05T08:00:00.000Z");
    expect(neverDeclared({ voidedAtMs: v, filedReturns: [julReturn(v)] })).toBe(true);
    expect(neverDeclared({ voidedAtMs: v, filedReturns: [julReturn(v - 1)] })).toBe(false);
  });

  it("only a calendar day known for the void: the end of that UAE day is used", () => {
    // return recorded 2026-08-05 15:00 UAE (11:00Z) before the end of the void day -> declared
    expect(neverDeclared({ voidedAtMs: null, filedReturns: [julReturn(at("2026-08-05T11:00:00Z"))] })).toBe(false);
    // recorded after the UAE day is over (2026-08-05T20:00:00Z is 00:00 on the 6th in UAE) -> never declared
    expect(neverDeclared({ voidedAtMs: null, filedReturns: [julReturn(at("2026-08-05T20:00:00Z"))] })).toBe(true);
    expect(uaeDayEndMs("2026-08-05")).toBe(at("2026-08-05T19:59:59.999Z"));
  });

  it("amendments: the EARLIEST filing time decides", () => {
    const original = julReturn(at("2026-08-01T09:00:00Z")); // before the void: the document was declared
    const amendment = julReturn(at("2026-08-25T09:00:00Z"));
    expect(neverDeclared({ filedReturns: [amendment, original] })).toBe(false);
    // original after the void, amendment later still: never declared
    expect(neverDeclared({ filedReturns: [julReturn(at("2026-08-20T09:00:00Z")), amendment] })).toBe(true);
  });

  it("void date before its own document (bad data) counts as the document date, same period", () => {
    expect(neverDeclared({ voidedOn: "2026-07-01", voidedAtMs: null })).toBe(false);
  });

  it("voided credit note: same decision", () => {
    expect(neverDeclared({ documentDate: "2026-07-15" })).toBe(true);
    expect(neverDeclared({ documentDate: "2026-07-15", filedReturns: [julReturn(at("2026-08-01T00:00:00Z"))] })).toBe(false);
  });
});

describe("vatDocumentEffectForPeriod with a document that was never declared", () => {
  const base = { documentDate: "2026-07-10", voidedOn: "2026-08-05" };
  it("its own period leaves it out, the void's period reports nothing", () => {
    expect(vatDocumentEffectForPeriod({ ...base, ...JUL, neverDeclared: true })).toBe("exclude");
    expect(vatDocumentEffectForPeriod({ ...base, ...AUG, neverDeclared: true })).toBe("none");
  });
  it("without the flag behaviour is unchanged (include / reverse_in_period)", () => {
    expect(vatDocumentEffectForPeriod({ ...base, ...JUL })).toBe("include");
    expect(vatDocumentEffectForPeriod({ ...base, ...AUG })).toBe("reverse_in_period");
  });
  it("a document declared and voided later still reverses, a voided credit note comes back positive", () => {
    const invoices = [
      { id: "inv", date: "2026-07-10", status: "void", voidedOn: "2026-08-05", neverDeclared: false },
      { id: "cn", date: "2026-07-12", status: "void", voidedOn: "2026-08-06", neverDeclared: false },
      { id: "hist", date: "2026-07-14", status: "void", voidedOn: "2026-08-07", neverDeclared: true },
    ];
    const lines = [
      { invoiceId: "inv", quantity: 1 },
      { invoiceId: "cn", quantity: -1 },
      { invoiceId: "hist", quantity: 1 },
    ];
    const aug = selectPeriodSalesDocuments({ invoices, lines, ...AUG });
    expect(aug.invoices.map((i) => [i.id, i.effect])).toEqual([["inv", "reverse_in_period"], ["cn", "reverse_in_period"]]);
    expect(aug.lines.map((l) => [l.invoiceId, l.quantity])).toEqual([["inv", -1], ["cn", 1]]);
    const jul = selectPeriodSalesDocuments({ invoices, lines, ...JUL });
    expect(jul.invoices.map((i) => i.id)).toEqual(["inv", "cn"]);
  });
});
