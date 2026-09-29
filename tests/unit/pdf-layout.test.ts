import { describe, it, expect } from "vitest";
import { fitFontSize } from "../../server/services/pdf-layout";

// A measurer where every character is half the font size wide.
function fakeDoc() {
  let size = 0;
  return {
    fontSize(s: number) {
      size = s;
    },
    widthOfString(t: string) {
      return t.length * size * 0.5;
    },
    get size() {
      return size;
    },
  };
}

describe("fitFontSize", () => {
  it("keeps the base size when the text already fits", () => {
    const doc = fakeDoc();
    expect(fitFontSize(doc, "AED 100.00", 63, 9)).toBe(9);
  });

  it("shrinks a six-decimal unit price until it fits on one line", () => {
    const doc = fakeDoc();
    const text = "AED 33.333333"; // 13 characters
    const size = fitFontSize(doc, text, 50, 9);
    expect(size).toBeLessThan(9);
    expect(text.length * size * 0.5).toBeLessThanOrEqual(50);
  });

  it("never goes below the minimum size and leaves the document at it", () => {
    const doc = fakeDoc();
    expect(fitFontSize(doc, "x".repeat(200), 10, 9, 6)).toBe(6);
    expect(doc.size).toBe(6);
  });
});
