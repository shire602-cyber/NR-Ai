import { describe, expect, it } from "vitest";
import { assessDraftFigures } from "../../server/services/tax-filing-core";

const stored = { box12TotalDueTax: 75, box13RecoverableTax: 20, box14PayableTax: 55 };

describe("assessDraftFigures", () => {
  it("identical figures: use the stored draft, no differences", () => {
    expect(assessDraftFigures({ stored, recomputed: { ...stored }, hasManualEdits: false })).toEqual({
      action: "use_stored",
      differences: [],
    });
  });

  it("books moved and the draft was never edited: replace with the recomputed figures", () => {
    const recomputed = { box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };
    const res = assessDraftFigures({ stored, recomputed, hasManualEdits: false });
    expect(res.action).toBe("use_recomputed");
    expect(res.differences.map((d) => d.box)).toEqual(["box12TotalDueTax", "box14PayableTax"]);
    expect(res.differences[0]).toMatchObject({ filed: 75, current: 100, difference: 25 });
  });

  it("a hand-edited draft that differs is refused unless a choice is made", () => {
    const recomputed = { box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };
    const res = assessDraftFigures({ stored, recomputed, hasManualEdits: true });
    expect(res).toMatchObject({ action: "refuse", code: "VAT_RETURN_STALE" });
    expect(res.differences).toHaveLength(2);
  });

  it("acceptFigures=recomputed on a hand-edited draft takes the books", () => {
    const recomputed = { box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };
    expect(assessDraftFigures({ stored, recomputed, hasManualEdits: true, acceptFigures: "recomputed" }).action).toBe("use_recomputed");
  });

  it("acceptFigures=stored on a hand-edited draft keeps the user's figures", () => {
    const recomputed = { box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };
    expect(assessDraftFigures({ stored, recomputed, hasManualEdits: true, acceptFigures: "stored" }).action).toBe("use_stored");
  });

  it("an explicit acceptFigures=stored on an UNEDITED stale draft is honoured as stored", () => {
    const recomputed = { box12TotalDueTax: 100, box13RecoverableTax: 20, box14PayableTax: 80 };
    expect(assessDraftFigures({ stored, recomputed, hasManualEdits: false, acceptFigures: "stored" }).action).toBe("use_stored");
  });

  it("differences under a fils are ignored", () => {
    const recomputed = { box12TotalDueTax: 75.004, box13RecoverableTax: 20, box14PayableTax: 55 };
    expect(assessDraftFigures({ stored, recomputed, hasManualEdits: true }).action).toBe("use_stored");
  });
});
