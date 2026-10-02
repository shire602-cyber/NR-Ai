import { describe, expect, it } from "vitest";
import { EMIRATE_LABELS, STATUS_LABELS, emirateLabel, localizeEnumCell, statusLabel, vatRowCategoryText } from "../../client/src/lib/enum-labels";
import { EMIRATE_BOXES, emirateRows, emirateRowsTie } from "../../client/src/lib/vat-emirates";
import { vatRowCategories, vatEmirates } from "../../shared/vat-workpaper-grid";

describe("enum labels", () => {
  it("every emirate the VAT code knows has an Arabic and an English label", () => {
    for (const e of vatEmirates) {
      expect(EMIRATE_LABELS[e.value], e.value).toBeTruthy();
      expect(emirateLabel(e.value, "ar")).toMatch(/[؀-ۿ]/);
      expect(emirateLabel(e.value, "en")).toBe(e.label);
    }
  });

  it("every workpaper row category is translated", () => {
    for (const c of vatRowCategories) expect(vatRowCategoryText(c.value, "ar"), c.value).toMatch(/[؀-ۿ]/);
  });

  it("return, period and document statuses read in Arabic, and an unknown slug is shown as written", () => {
    for (const s of ["draft", "ready", "pending_review", "submitted", "accepted", "filed", "approved", "excluded", "issued", "overdue", "monthly", "quarterly"]) {
      expect(statusLabel(s, "ar"), s).toMatch(/[؀-ۿ]/);
      expect(STATUS_LABELS[s].en.length).toBeGreaterThan(0);
    }
    expect(statusLabel("Quarterly", "ar")).toBe("ربع سنوي");
    expect(statusLabel("something_new", "ar")).toBe("something_new");
    expect(statusLabel(null, "ar")).toBe("");
  });

  it("report cells: only emirate and status-like columns are translated, and text already in Arabic is left alone", () => {
    expect(localizeEnumCell("emirate", "sharjah", "ar")).toBe("الشارقة");
    expect(localizeEnumCell("status", "issued", "ar")).toBe("صادر");
    expect(localizeEnumCell("status", "الشارقة", "ar")).toBe("الشارقة");
    expect(localizeEnumCell("customer", "sharjah", "ar")).toBe("sharjah");
    expect(localizeEnumCell("emirate", "sharjah", "en")).toBe("Sharjah");
    expect(localizeEnumCell("amount", 5, "ar")).toBe(5);
  });
});

describe("box 1 by emirate", () => {
  const boxes = {
    box1aAbuDhabiAmount: 5400,
    box1aAbuDhabiVat: 270,
    box1bDubaiAmount: 12835,
    box1bDubaiVat: 641.75,
    box1cSharjahAmount: 0,
    box1cSharjahVat: 0,
  };

  it("lists only the emirates with supplies, in box order", () => {
    const rows = emirateRows(boxes);
    expect(rows.map((r) => r.box)).toEqual(["1a", "1b"]);
    expect(rows[1]).toMatchObject({ slug: "dubai", amount: 12835, vat: 641.75 });
  });

  it("an emirate that only has an adjustment still shows", () => {
    expect(emirateRows({ box1gFujairahAdj: -50 }).map((r) => r.box)).toEqual(["1g"]);
  });

  it("reads strings and ignores junk without producing NaN", () => {
    const rows = emirateRows({ box1bDubaiAmount: "100.50", box1bDubaiVat: "5.03", box1aAbuDhabiAmount: "x" });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(100.5);
    expect(emirateRows(null)).toEqual([]);
  });

  it("covers all seven boxes and the rows tie to the single standard-rated figure", () => {
    expect(EMIRATE_BOXES.map((e) => e.box)).toEqual(["1a", "1b", "1c", "1d", "1e", "1f", "1g"]);
    expect(emirateRowsTie(emirateRows(boxes), 18235, 911.75)).toBe(true);
    expect(emirateRowsTie(emirateRows(boxes), 17570, 878.5)).toBe(false);
  });
});
