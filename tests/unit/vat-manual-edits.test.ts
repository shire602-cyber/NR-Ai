import { describe, expect, it } from "vitest";
import {
  MIN_MANUAL_EDIT_REASON,
  editedFigureKeys,
  hasRecordedManualEdits,
  manualEditReasonProblem,
  manualSettlementDelta,
  mergeManualEdits,
} from "../../server/services/tax-filing-core";

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

describe("a manual edit records who, when and WHY", () => {
  const reasonCtx = { ...ctx, reason: "Client agreed the correction in writing" };

  it("stores the reason, the user, the time and the boxes of each edit", () => {
    const e = mergeManualEdits(null, row, { box12TotalDueTax: 5, box14PayableTax: 5 }, reasonCtx)!;
    expect(e.log).toEqual([
      { at: "2026-09-01T10:00:00.000Z", by: "u1", reason: "Client agreed the correction in writing", boxes: ["box12TotalDueTax", "box14PayableTax"] },
    ]);
  });

  it("each later edit adds its own entry with its own reason", () => {
    const first = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, reasonCtx)!;
    const second = mergeManualEdits(first, { ...row, box12TotalDueTax: 5 }, { box13RecoverableTax: 2 }, { userId: "u2", now: new Date("2026-09-02T10:00:00Z"), reason: "Supplier invoice added" })!;
    expect(second.log).toHaveLength(2);
    expect(second.log![1]).toMatchObject({ by: "u2", reason: "Supplier invoice added", boxes: ["box13RecoverableTax"] });
  });

  it("MIN_MANUAL_EDIT_REASON is 10 characters", () => expect(MIN_MANUAL_EDIT_REASON).toBe(10));

  it("editedFigureKeys lists the boxes (and the adjustment amount) a PATCH would change", () => {
    expect(editedFigureKeys(row, { box12TotalDueTax: 50, box14PayableTax: 49, notes: "x", box9NetTax: 4 })).toEqual(["box14PayableTax"]);
    expect(editedFigureKeys({ ...row, adjustmentAmount: 0 }, { adjustmentAmount: 12 })).toEqual(["adjustmentAmount"]);
    expect(editedFigureKeys(row, { notes: "n" })).toEqual([]);
  });

  describe("manualEditReasonProblem", () => {
    it("no edits, no problem", () => {
      expect(manualEditReasonProblem(null, { adjustmentAmount: 0, adjustmentReason: null })).toBeNull();
    });
    it("every edited box needs a reason of at least 10 characters", () => {
      const withReason = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, reasonCtx);
      expect(manualEditReasonProblem(withReason, { adjustmentAmount: 0, adjustmentReason: null })).toBeNull();
      const short = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, { ...ctx, reason: "too short" });
      expect(manualEditReasonProblem(short, { adjustmentAmount: 0, adjustmentReason: null })?.boxes).toEqual(["box12TotalDueTax"]);
      const none = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, ctx);
      expect(manualEditReasonProblem(none, { adjustmentAmount: 0, adjustmentReason: null })?.boxes).toEqual(["box12TotalDueTax"]);
    });
    it("edits recorded before reasons were required (no log) lack a reason", () => {
      const legacy = { boxes: { box12TotalDueTax: { from: 50, to: 5 } }, at: "2026-08-01T00:00:00Z", by: "u1" };
      expect(manualEditReasonProblem(legacy, { adjustmentAmount: 0, adjustmentReason: "some old reason" })?.boxes).toEqual(["box12TotalDueTax"]);
    });
    it("a later PATCH with only a reason covers the boxes that still lack one", () => {
      const legacy = { boxes: { box12TotalDueTax: { from: 50, to: 5 } }, at: "2026-08-01T00:00:00Z", by: "u1" };
      const covered = mergeManualEdits(legacy, { ...row, box12TotalDueTax: 5 }, { adjustmentReason: "Added the reason afterwards" }, { ...ctx, reason: "Added the reason afterwards" })!;
      expect(manualEditReasonProblem(covered, { adjustmentAmount: 0, adjustmentReason: null })).toBeNull();
    });
    it("a box edited again without a valid reason is uncovered again", () => {
      const first = mergeManualEdits(null, row, { box12TotalDueTax: 5 }, reasonCtx)!;
      const second = mergeManualEdits(first, { ...row, box12TotalDueTax: 5 }, { box12TotalDueTax: 7 }, { ...ctx, reason: "" })!;
      expect(manualEditReasonProblem(second, { adjustmentAmount: 0, adjustmentReason: null })?.boxes).toEqual(["box12TotalDueTax"]);
    });
    it("an adjustment amount needs its reason too", () => {
      expect(manualEditReasonProblem(null, { adjustmentAmount: 12, adjustmentReason: "short" })?.boxes).toEqual(["adjustmentAmount"]);
      expect(manualEditReasonProblem(null, { adjustmentAmount: 12, adjustmentReason: "Long enough reason" })).toBeNull();
    });
  });
});
