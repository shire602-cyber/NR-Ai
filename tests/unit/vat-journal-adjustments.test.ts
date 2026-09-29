import { describe, expect, it } from "vitest";
import {
  applyJournalAdjustmentsToBoxes,
  outputAdjustmentBoxForEmirate,
  summariseVatJournalAdjustments,
  vatAccountTouchedByLines,
  type VatJournalLineRow,
} from "../../server/services/vat-adjustments";

// A manual journal that touches the output or input VAT accounts is a VAT ADJUSTMENT: it belongs in
// the return's adjustment columns (with the journal number and description), so the return and the
// ledger agree without anyone hand-editing a box.

const row = (over: Partial<VatJournalLineRow>): VatJournalLineRow => ({
  entryId: "e1",
  entryNumber: "JE-001",
  description: "Correct over-declared output VAT",
  date: "2026-08-20",
  accountCode: "2020",
  debit: 0,
  credit: 0,
  ...over,
});

describe("summariseVatJournalAdjustments", () => {
  it("Dr output VAT 50 reduces the output tax by 50, in the company's own emirate box", () => {
    const s = summariseVatJournalAdjustments([row({ debit: 50 })], "dubai");
    expect(s.outputAdjustment).toBe(-50);
    expect(s.inputAdjustment).toBe(0);
    expect(s.outputBox).toBe("box1bDubaiAdj");
    expect(s.lines).toEqual([
      { entryId: "e1", entryNumber: "JE-001", description: "Correct over-declared output VAT", date: "2026-08-20", side: "output", box: "box1bDubaiAdj", amount: -50 },
    ]);
  });

  it("Cr output VAT increases it; Dr input VAT increases recoverable tax (box 9 adjustment)", () => {
    const s = summariseVatJournalAdjustments(
      [row({ credit: 20 }), row({ entryId: "e2", entryNumber: "JE-002", accountCode: "1050", debit: 30, description: "Recover missed input VAT" })],
      "sharjah"
    );
    expect(s.outputAdjustment).toBe(20);
    expect(s.inputAdjustment).toBe(30);
    expect(s.outputBox).toBe("box1cSharjahAdj");
    expect(s.lines.map((l) => [l.entryNumber, l.side, l.box, l.amount])).toEqual([
      ["JE-001", "output", "box1cSharjahAdj", 20],
      ["JE-002", "input", "box9ExpensesAdj", 30],
    ]);
  });

  it("one entry touching both accounts gives one line per side; several lines of one side are summed", () => {
    const s = summariseVatJournalAdjustments(
      [row({ debit: 10 }), row({ debit: 5 }), row({ accountCode: "1050", credit: 4 })],
      "abu_dhabi"
    );
    expect(s.lines).toHaveLength(2);
    expect(s.outputAdjustment).toBe(-15);
    expect(s.inputAdjustment).toBe(-4);
  });

  it("an entry without a description is still reported (with an empty description), never dropped", () => {
    const s = summariseVatJournalAdjustments([row({ debit: 5, description: null })], "dubai");
    expect(s.lines[0].description).toBe("");
    expect(s.outputAdjustment).toBe(-5);
  });

  it("sums to the fils and ignores lines of other accounts", () => {
    const s = summariseVatJournalAdjustments([row({ debit: 0.1 }), row({ debit: 0.2 }), row({ accountCode: "4010", credit: 99 })], "dubai");
    expect(s.outputAdjustment).toBe(-0.3);
  });

  it("every emirate has its own adjustment column; an unknown one falls back to Dubai like the return does", () => {
    expect(outputAdjustmentBoxForEmirate("abu_dhabi")).toBe("box1aAbuDhabiAdj");
    expect(outputAdjustmentBoxForEmirate("ajman")).toBe("box1dAjmanAdj");
    expect(outputAdjustmentBoxForEmirate("umm_al_quwain")).toBe("box1eUmmAlQuwainAdj");
    expect(outputAdjustmentBoxForEmirate("ras_al_khaimah")).toBe("box1fRasAlKhaimahAdj");
    expect(outputAdjustmentBoxForEmirate("fujairah")).toBe("box1gFujairahAdj");
    expect(outputAdjustmentBoxForEmirate("mars")).toBe("box1bDubaiAdj");
  });

  it("no adjustments: nothing changes", () => {
    const s = summariseVatJournalAdjustments([], "dubai");
    expect(s).toMatchObject({ lines: [], outputAdjustment: 0, inputAdjustment: 0 });
  });
});

describe("applyJournalAdjustmentsToBoxes", () => {
  const base = { box1bDubaiVat: 100, box8TotalVat: 100, box9ExpensesVat: 20, box11TotalVat: 20, box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };

  it("puts the adjustments in the adjustment columns and flows them into boxes 8, 11, 12, 13 and 14", () => {
    const s = summariseVatJournalAdjustments([row({ debit: 50 }), row({ entryId: "e2", accountCode: "1050", debit: 10 })], "dubai");
    const r = applyJournalAdjustmentsToBoxes(base, s);
    expect(r.box1bDubaiAdj).toBe(-50);
    expect(r.box8TotalAdj).toBe(-50);
    expect(r.box9ExpensesAdj).toBe(10);
    expect(r.box11TotalAdj).toBe(10);
    expect(r.box12TotalDueTax).toBe(50);
    expect(r.box13RecoverableTax).toBe(30);
    expect(r.box14PayableTax).toBe(20);
    // the VAT columns themselves are untouched
    expect(r.box8TotalVat).toBe(100);
    expect(r.box9ExpensesVat).toBe(20);
  });

  it("returns the boxes unchanged when there is nothing to adjust", () => {
    expect(applyJournalAdjustmentsToBoxes(base, summariseVatJournalAdjustments([], "dubai"))).toEqual(base);
  });
});

describe("vatAccountTouchedByLines", () => {
  const accounts = new Map([
    ["a-out", { code: "2020", type: "liability", isVatAccount: true, vatType: "output" }],
    ["a-in", { code: "1050", type: "asset", isVatAccount: true, vatType: "input" }],
    ["a-rev", { code: "4010", type: "income", isVatAccount: false, vatType: null }],
    ["a-flag", { code: "2999", type: "liability", isVatAccount: true, vatType: "output" }],
  ]);
  it("is true when any line uses an output or input VAT account", () => {
    expect(vatAccountTouchedByLines([{ accountId: "a-rev" }, { accountId: "a-out" }], accounts)).toBe(true);
    expect(vatAccountTouchedByLines([{ accountId: "a-in" }], accounts)).toBe(true);
    expect(vatAccountTouchedByLines([{ accountId: "a-flag" }], accounts)).toBe(true);
  });
  it("is false for ordinary accounts or unknown ids", () => {
    expect(vatAccountTouchedByLines([{ accountId: "a-rev" }, { accountId: "missing" }], accounts)).toBe(false);
  });
});
