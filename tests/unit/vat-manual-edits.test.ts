import { describe, expect, it } from "vitest";
import { hasRecordedManualEdits, manualSettlementDelta, mergeManualEdits } from "../../server/services/tax-filing-core";

const row = { box12TotalDueTax: 50, box13RecoverableTax: 0, box14PayableTax: 50, box1bDubaiAmount: 1000, box8TotalVat: 3, notes: null };
const ctx = { userId: "u1", now: new Date("2026-09-01T10:00:00Z") };

describe("mergeManualEdits", () => {
  it("records a changed box with its original value", () => {
    const e = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, ctx);
    expect(e?.boxes).toEqual({ box12TotalDueTax: { from: 50, to: 5 } });
    expect(e?.by).toBe("u1");
  });

  it("keeps the FIRST value across several edits and drops a box put back", () => {
    const first = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, ctx)!;
    const second = mergeManualEdits(first, { ...row, box12TotalDueTax: 5 }, { box12TotalDueTax: 7 }, ctx)!;
    expect(second.boxes.box12TotalDueTax).toEqual({ from: 50, to: 7 });
    const back = mergeManualEdits(second, { ...row, box12TotalDueTax: 7 }, { box12TotalDueTax: 50 }, ctx);
    expect(back).toBeNull();
  });

  it("ignores non-box fields, legacy aliases and unchanged values", () => {
    expect(mergeManualEdits(null, row, { notes: "x", box9NetTax: 9, box12TotalDueTax: 50 }, ctx)).toBeNull();
  });

  it("a PATCH that touches nothing keeps the existing log", () => {
    const first = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, ctx)!;
    expect(mergeManualEdits(first, { ...row, box12TotalDueTax: 5 }, { notes: "n" }, ctx)).toEqual(first);
  });
});

describe("manualSettlementDelta / hasRecordedManualEdits", () => {
  it("reads the signed change on box 12 and 13 only", () => {
    const e = mergeManualEdits(null, row, { box12TotalDueTax: 5, box13RecoverableTax: 2, box1bDubaiAmount: 1 }, ctx);
    expect(manualSettlementDelta(e)).toEqual({ outputVat: -45, inputVat: 2 });
    expect(manualSettlementDelta(null)).toEqual({ outputVat: 0, inputVat: 0 });
  });

  it("an adjustment amount counts as a recorded manual adjustment", () => {
    expect(hasRecordedManualEdits(null, 0)).toBe(false);
    expect(hasRecordedManualEdits(null, "12.50")).toBe(true);
    expect(hasRecordedManualEdits(mergeManualEdits(null, row, { box14PayableTax: 1 }, ctx), 0)).toBe(true);
  });
});
