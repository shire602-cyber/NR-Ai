/**
 * VAT 201 box model (W4-E). Pure and isomorphic-safe: no DB, no Express.
 *
 * Every amount is integer fils. A source document contributes fils to boxes; a box is the exact
 * sum of its contributions, and totals (Box 8 / 11 / 12 / 13 / 14) are derived from the already
 * rounded boxes, so the printed boxes always add up to the printed totals (R07-10).
 *
 *   Output side (sales and all other outputs)
 *     Box 1a-1g  standard-rated supplies by emirate of supply   amount | VAT | adjustment
 *     Box 2      tourist refunds paid (reduces output VAT)       amount | VAT  (negative)
 *     Box 3      supplies subject to reverse charge (recipient)  amount | VAT
 *     Box 4      zero-rated supplies                             amount
 *     Box 5      exempt supplies                                 amount
 *     Box 6      goods imported into the UAE                     amount | VAT
 *     Box 7      adjustments to goods imported                   amount | VAT
 *     Box 8      totals                                          amount | VAT | adjustment
 *   Input side (expenses and all other inputs)
 *     Box 9      standard-rated expenses (recoverable VAT)       amount | VAT | adjustment
 *     Box 10     supplies subject to reverse charge incl. imports (recoverable part)
 *     Box 11     totals                                          amount | VAT | adjustment
 *   Net
 *     Box 12 = Box 8 VAT + Box 8 adj; Box 13 = Box 11 VAT + Box 11 adj; Box 14 = 12 - 13.
 *
 * Out-of-scope supplies appear in no box.
 */
import { EMIRATES } from "../../shared/validators/primitives";
import { classifySupply, type Vat201Family } from "../../shared/vat-classification";
import { mulRate } from "../../shared/money";

export type Emirate = (typeof EMIRATES)[number];

export const EMIRATE_BOX_PREFIX: Record<Emirate, string> = {
  abu_dhabi: "box1aAbuDhabi",
  dubai: "box1bDubai",
  sharjah: "box1cSharjah",
  ajman: "box1dAjman",
  umm_al_quwain: "box1eUmmAlQuwain",
  ras_al_khaimah: "box1fRasAlKhaimah",
  fujairah: "box1gFujairah",
};

export const EMIRATE_LABELS: Record<Emirate, { box: string; en: string; ar: string }> = {
  abu_dhabi: { box: "1a", en: "Abu Dhabi", ar: "أبوظبي" },
  dubai: { box: "1b", en: "Dubai", ar: "دبي" },
  sharjah: { box: "1c", en: "Sharjah", ar: "الشارقة" },
  ajman: { box: "1d", en: "Ajman", ar: "عجمان" },
  umm_al_quwain: { box: "1e", en: "Umm Al Quwain", ar: "أم القيوين" },
  ras_al_khaimah: { box: "1f", en: "Ras Al Khaimah", ar: "رأس الخيمة" },
  fujairah: { box: "1g", en: "Fujairah", ar: "الفجيرة" },
};

const BOX1_KEYS = EMIRATES.flatMap((e) => {
  const p = EMIRATE_BOX_PREFIX[e];
  return [`${p}Amount`, `${p}Vat`, `${p}Adj`];
});

/** Every VAT 201 box key, in FTA form order. Names match the vat_returns columns. */
export const VAT201_BOX_KEYS = [
  ...BOX1_KEYS,
  "box2TouristRefundAmount",
  "box2TouristRefundVat",
  "box3ReverseChargeAmount",
  "box3ReverseChargeVat",
  "box4ZeroRatedAmount",
  "box5ExemptAmount",
  "box6ImportsAmount",
  "box6ImportsVat",
  "box7ImportsAdjAmount",
  "box7ImportsAdjVat",
  "box8TotalAmount",
  "box8TotalVat",
  "box8TotalAdj",
  "box9ExpensesAmount",
  "box9ExpensesVat",
  "box9ExpensesAdj",
  "box10ReverseChargeAmount",
  "box10ReverseChargeVat",
  "box11TotalAmount",
  "box11TotalVat",
  "box11TotalAdj",
  "box12TotalDueTax",
  "box13RecoverableTax",
  "box14PayableTax",
] as const;

export type Vat201Key = (typeof VAT201_BOX_KEYS)[number];
export type Vat201Fils = Record<Vat201Key, number>;
export type Vat201Aed = Record<Vat201Key, number>;

export const DERIVED_BOX_KEYS: ReadonlySet<string> = new Set([
  "box8TotalAmount",
  "box8TotalVat",
  "box8TotalAdj",
  "box11TotalAmount",
  "box11TotalVat",
  "box11TotalAdj",
  "box12TotalDueTax",
  "box13RecoverableTax",
  "box14PayableTax",
]);

const KEY_SET: ReadonlySet<string> = new Set(VAT201_BOX_KEYS);
export function isVat201Key(v: unknown): v is Vat201Key {
  return typeof v === "string" && KEY_SET.has(v);
}

/** Keys whose VAT is output tax (they feed Box 12). */
export const OUTPUT_TAX_KEYS: readonly Vat201Key[] = [
  ...EMIRATES.flatMap((e) => [
    `${EMIRATE_BOX_PREFIX[e]}Vat` as Vat201Key,
    `${EMIRATE_BOX_PREFIX[e]}Adj` as Vat201Key,
  ]),
  "box2TouristRefundVat",
  "box3ReverseChargeVat",
  "box6ImportsVat",
  "box7ImportsAdjVat",
];
/** Keys whose VAT is recoverable input tax (they feed Box 13). */
export const INPUT_TAX_KEYS: readonly Vat201Key[] = [
  "box9ExpensesVat",
  "box9ExpensesAdj",
  "box10ReverseChargeVat",
];

export function emptyBoxes(): Vat201Fils {
  return Object.fromEntries(VAT201_BOX_KEYS.map((k) => [k, 0])) as Vat201Fils;
}

export type BoxDelta = Partial<Record<Vat201Key, number>>;

export function addDelta(target: Vat201Fils, delta: BoxDelta, sign = 1): void {
  for (const [k, v] of Object.entries(delta) as Array<[Vat201Key, number]>) {
    if (!v) continue;
    if (!Number.isSafeInteger(v)) throw new Error(`VAT box ${k} received a non-fils value ${v}`);
    if (DERIVED_BOX_KEYS.has(k)) throw new Error(`VAT box ${k} is derived`);
    target[k] += sign * v;
  }
}

/** Output VAT effect (fils) of a delta: what it adds to Box 12. */
export function outputEffect(delta: BoxDelta): number {
  return OUTPUT_TAX_KEYS.reduce((s, k) => s + (delta[k] ?? 0), 0);
}
/** Input VAT effect (fils) of a delta: what it adds to Box 13. */
export function inputEffect(delta: BoxDelta): number {
  return INPUT_TAX_KEYS.reduce((s, k) => s + (delta[k] ?? 0), 0);
}

/** Recompute Box 8 / 11 / 12 / 13 / 14 from the source boxes (all fils, exact). */
export function deriveTotals(src: Vat201Fils): Vat201Fils {
  const b = { ...src };
  let amt = 0;
  let vat = 0;
  let adj = 0;
  for (const e of EMIRATES) {
    const p = EMIRATE_BOX_PREFIX[e];
    amt += b[`${p}Amount` as Vat201Key];
    vat += b[`${p}Vat` as Vat201Key];
    adj += b[`${p}Adj` as Vat201Key];
  }
  amt +=
    b.box2TouristRefundAmount +
    b.box3ReverseChargeAmount +
    b.box4ZeroRatedAmount +
    b.box5ExemptAmount +
    b.box6ImportsAmount +
    b.box7ImportsAdjAmount;
  vat += b.box2TouristRefundVat + b.box3ReverseChargeVat + b.box6ImportsVat + b.box7ImportsAdjVat;
  b.box8TotalAmount = amt;
  b.box8TotalVat = vat;
  b.box8TotalAdj = adj;
  b.box11TotalAmount = b.box9ExpensesAmount + b.box10ReverseChargeAmount;
  b.box11TotalVat = b.box9ExpensesVat + b.box10ReverseChargeVat;
  b.box11TotalAdj = b.box9ExpensesAdj;
  b.box12TotalDueTax = b.box8TotalVat + b.box8TotalAdj;
  b.box13RecoverableTax = b.box11TotalVat + b.box11TotalAdj;
  b.box14PayableTax = b.box12TotalDueTax - b.box13RecoverableTax;
  return b;
}

export function filsToAed(f: number): number {
  const v = f / 100;
  return Object.is(v, -0) ? 0 : v;
}

export function boxesToAed(b: Vat201Fils): Vat201Aed {
  return Object.fromEntries(VAT201_BOX_KEYS.map((k) => [k, filsToAed(b[k])])) as Vat201Aed;
}

export function normaliseEmirate(raw: unknown): Emirate | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, Emirate> = {
    abudhabi: "abu_dhabi",
    rak: "ras_al_khaimah",
    uaq: "umm_al_quwain",
    ummalquwain: "umm_al_quwain",
    rasalkhaimah: "ras_al_khaimah",
  };
  if ((EMIRATES as readonly string[]).includes(v)) return v as Emirate;
  return aliases[v.replace(/_/g, "")] ?? null;
}

// ─── Truth tables ─────────────────────────────────────────────────────────

/**
 * Sales-side mapping: where a supply of `family` lands. `emirate` is required for families that
 * report by emirate (standard and domestic reverse-charge supplies); the caller must have
 * rejected a missing emirate before calling. Out-of-scope returns an empty delta.
 */
export function salesDelta(
  family: Vat201Family,
  emirate: Emirate | null,
  netFils: number,
  vatFils: number
): BoxDelta {
  switch (family) {
    case "standard":
    case "reverse_charge": {
      if (!emirate) throw new Error("salesDelta: emirate required");
      const p = EMIRATE_BOX_PREFIX[emirate];
      // A domestic reverse-charge sale (supplier side) is reported by value with no VAT; the
      // recipient self-accounts for the tax.
      return {
        [`${p}Amount`]: netFils,
        [`${p}Vat`]: family === "standard" ? vatFils : 0,
      } as BoxDelta;
    }
    case "zero_rated":
      return { box4ZeroRatedAmount: netFils };
    case "exempt":
      return { box5ExemptAmount: netFils };
    case "out_of_scope":
      return {};
  }
}

/** True when the family reports by emirate (Box 1a-1g). */
export function familyNeedsEmirate(family: Vat201Family): boolean {
  return family === "standard" || family === "reverse_charge";
}

export type PurchaseKind = "standard" | "reverse_charge" | "import" | "not_reportable";

/**
 * Purchase-side mapping. `vatFils` is the full VAT (output side for reverse charge / imports);
 * `recoverableFils` the part that may be recovered (Box 9 / Box 10).
 */
export function purchaseDelta(
  kind: PurchaseKind,
  netFils: number,
  vatFils: number,
  recoverableFils: number
): BoxDelta {
  switch (kind) {
    case "standard":
      if (recoverableFils === 0) return {};
      return { box9ExpensesAmount: netFils, box9ExpensesVat: recoverableFils };
    case "reverse_charge":
      return {
        box3ReverseChargeAmount: netFils,
        box3ReverseChargeVat: vatFils,
        box10ReverseChargeAmount: recoverableFils > 0 ? netFils : 0,
        box10ReverseChargeVat: recoverableFils,
      };
    case "import":
      return {
        box6ImportsAmount: netFils,
        box6ImportsVat: vatFils,
        box10ReverseChargeAmount: recoverableFils > 0 ? netFils : 0,
        box10ReverseChargeVat: recoverableFils,
      };
    case "not_reportable":
      return {};
  }
}

/** Purchase line classification from the stored supply type (bills, receipts). */
export function purchaseKindFor(input: {
  supplyType?: string | null;
  vatFils: number;
  reverseCharge?: boolean | null;
  isImport?: boolean | null;
  designatedZone?: boolean | null;
}): PurchaseKind {
  if (input.isImport) return "import";
  if (input.reverseCharge) return "reverse_charge";
  const c = classifySupply({
    supplyType: input.supplyType ?? null,
    vatRate: input.vatFils > 0 ? 5 : 0,
  });
  // Designated-zone purchases with no VAT charged are outside the scope of UAE VAT.
  if (input.designatedZone && input.vatFils === 0) return "not_reportable";
  if (c.vat201Family === "standard" && input.vatFils > 0) return "standard";
  return "not_reportable";
}

/** Apply a recoverable percentage (0..100) to fils, half-up, exactly as bill posting does. */
export function recoverableShare(vatFils: number, percent: number): number {
  if (vatFils === 0) return 0;
  if (percent >= 100) return vatFils;
  if (percent <= 0) return 0;
  return mulRate(vatFils, String(percent / 100));
}

/** Convert document-currency fils to AED fils at `rate` (decimal text; "1" is identity). */
export function toBaseFils(docFils: number, rate: string): number {
  if (docFils === 0) return 0;
  if (rate === "1" || Number(rate) === 1) return docFils;
  return mulRate(docFils, rate);
}
