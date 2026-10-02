// The totals of a VAT 201 (boxes 8, 11, 12, 13 and 14) shown on the return screen. ONE definition, the server's:
//   box 12 = box 8 VAT + box 8 adjustment, box 13 = box 11 VAT + box 11 adjustment, box 14 = 12 - 13
// (server/services/vat-return-payload.service.ts, vat-adjustments.ts). Adjustments (manual VAT journals) are part of
// boxes 12-14: leaving them out made the screen say refund 4,577.50 where the stored return said 2,617.50.

const EMIRATE_PREFIXES = ["box1aAbuDhabi", "box1bDubai", "box1cSharjah", "box1dAjman", "box1eUmmAlQuwain", "box1fRasAlKhaimah", "box1gFujairah"] as const;

export interface Vat201Totals {
  box8Amount: number;
  box8Vat: number;
  box8Adj: number;
  box11Amount: number;
  box11Vat: number;
  box11Adj: number;
  box12: number;
  box13: number;
  box14: number;
}

type Boxes = Record<string, unknown>;

const fils = (v: unknown): number => Math.round((Number(v) || 0) * 100);
const money = (f: number): number => f / 100;
const sum = (vals: unknown[]): number => vals.reduce<number>((s, v) => s + fils(v), 0);

/** Totals worked out from the box values on screen (live while a preparer edits), adjustments included. */
export function computeVat201Totals(d: Boxes): Vat201Totals {
  const box8Amount = sum([
    ...EMIRATE_PREFIXES.map((p) => d[`${p}Amount`]),
    d.box2TouristRefundAmount, d.box3ReverseChargeAmount, d.box4ZeroRatedAmount, d.box5ExemptAmount, d.box6ImportsAmount, d.box7ImportsAdjAmount,
  ]);
  const box8Vat = sum([
    ...EMIRATE_PREFIXES.map((p) => d[`${p}Vat`]),
    d.box2TouristRefundVat, d.box3ReverseChargeVat, d.box6ImportsVat, d.box7ImportsAdjVat,
  ]);
  const box8Adj = sum(EMIRATE_PREFIXES.map((p) => d[`${p}Adj`]));
  const box11Amount = sum([d.box9ExpensesAmount, d.box10ReverseChargeAmount]);
  const box11Vat = sum([d.box9ExpensesVat, d.box10ReverseChargeVat]);
  const box11Adj = fils(d.box9ExpensesAdj);
  const box12 = box8Vat + box8Adj;
  const box13 = box11Vat + box11Adj;
  return {
    box8Amount: money(box8Amount), box8Vat: money(box8Vat), box8Adj: money(box8Adj),
    box11Amount: money(box11Amount), box11Vat: money(box11Vat), box11Adj: money(box11Adj),
    box12: money(box12), box13: money(box13), box14: money(box12 - box13),
  };
}

/** The totals exactly as the stored return holds them; null when the return does not carry them (a blank worksheet). */
export function storedVat201Totals(r: Boxes | null | undefined): Vat201Totals | null {
  if (!r || r.box12TotalDueTax == null || r.box13RecoverableTax == null || r.box14PayableTax == null) return null;
  const n = (v: unknown) => money(fils(v));
  return {
    box8Amount: n(r.box8TotalAmount), box8Vat: n(r.box8TotalVat), box8Adj: n(r.box8TotalAdj),
    box11Amount: n(r.box11TotalAmount), box11Vat: n(r.box11TotalVat), box11Adj: n(r.box11TotalAdj),
    box12: n(r.box12TotalDueTax), box13: n(r.box13RecoverableTax), box14: n(r.box14PayableTax),
  };
}

/**
 * What the screen shows: the stored return's own totals while the boxes are as stored (so it can never differ from the stored
 * return, hand-edited totals included), the live computation (with adjustments) once a preparer has changed a box.
 */
export function vat201TotalsForScreen(d: Boxes, stored: Vat201Totals | null | undefined, pristine: boolean): Vat201Totals {
  return stored && pristine ? stored : computeVat201Totals(d);
}
