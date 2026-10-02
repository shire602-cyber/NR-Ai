import { describe, expect, it } from "vitest";
import { computeVat201Totals, storedVat201Totals, vat201TotalsForScreen } from "../../client/src/lib/vat201-totals";

// Teardown t4, Q3: the stored return says due 4,950.00, recoverable 7,567.50, refund 2,617.50 (box 1 VAT 2,950 + adjustment
// 2,000; box 9 VAT 7,527.50 + adjustment 40). The screen computed 12-14 WITHOUT the adjustment column and said a refund of
// 4,577.50: a preparer keying EmaraTax from it over-claimed 1,960.

const stored = {
  box1aAbuDhabiAmount: 59000, box1aAbuDhabiVat: 2950, box1aAbuDhabiAdj: 2000,
  box4ZeroRatedAmount: 44070,
  box9ExpensesAmount: 150550, box9ExpensesVat: 7527.5, box9ExpensesAdj: 40,
  box8TotalAmount: 103070, box8TotalVat: 2950, box8TotalAdj: 2000,
  box11TotalAmount: 150550, box11TotalVat: 7527.5, box11TotalAdj: 40,
  box12TotalDueTax: 4950, box13RecoverableTax: 7567.5, box14PayableTax: -2617.5,
};

describe("VAT 201 screen totals", () => {
  it("boxes 12-14 include the adjustment columns: the screen equals the stored return (refund 2,617.50)", () => {
    const t = computeVat201Totals(stored);
    expect([t.box12, t.box13, t.box14]).toEqual([4950, 7567.5, -2617.5]);
    expect([t.box8Adj, t.box11Adj]).toEqual([2000, 40]);
  });

  it("computed from the stored boxes it equals the stored totals, box for box", () => {
    expect(computeVat201Totals(stored)).toEqual(storedVat201Totals(stored));
  });

  it("while the boxes are as stored the screen shows the stored totals themselves (a hand-edited total included)", () => {
    const handEdited = { ...stored, box12TotalDueTax: 4960, box14PayableTax: -2607.5 };
    const t = storedVat201Totals(handEdited);
    expect(vat201TotalsForScreen(handEdited, t, true).box14).toBe(-2607.5);
  });

  it("once a box is changed on screen the totals follow the edit, adjustments still included", () => {
    const edited = { ...stored, box1aAbuDhabiVat: 3000 };
    const t = vat201TotalsForScreen(edited, storedVat201Totals(stored), false);
    expect([t.box12, t.box14]).toEqual([5000, -2567.5]);
  });

  it("a blank worksheet (no stored totals) is computed", () => {
    expect(storedVat201Totals({})).toBeNull();
    expect(vat201TotalsForScreen({ box1bDubaiVat: 50, box1bDubaiAdj: -20 }, null, true).box14).toBe(30);
  });
});
