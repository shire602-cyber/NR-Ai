/**
 * WQ3 (9.13): the VAT 201 box each VAT treatment feeds, for Settings > Tax rates.
 *
 * Not a second engine: the map is READ from the VAT engine's own box functions
 * (`salesDelta` / `purchaseDelta` in vat-boxes.ts, the ones `computeVat201` posts every
 * contribution through). Each treatment is probed with a unit amount and the box keys the engine
 * fills are reported, so the page can never disagree with the return.
 */
import {
  EMIRATE_BOX_PREFIX,
  normaliseEmirate,
  purchaseDelta,
  salesDelta,
  type BoxDelta,
  type Emirate,
  type PurchaseKind,
} from "./vat-boxes";
import type { Vat201Family } from "../../shared/vat-classification";
import { STANDARD_VAT_RATES } from "../../shared/vat-classification";
import { vatJurisdictionWithFlag } from "../services/zatca/flag";

export interface VatBoxRef {
  /** "1b", "4", "9" ... */
  box: string;
  part: "amount" | "vat";
  /** Engine key, e.g. "box1bDubaiAmount". */
  key: string;
}

export interface VatTreatmentRow {
  side: "sales" | "purchases";
  treatment: Vat201Family | PurchaseKind;
  /** Rate as a fraction (0.05). Reverse charge / imports: the self-accounted rate. */
  rate: number;
  boxes: VatBoxRef[];
}

export interface VatBoxMap {
  jurisdiction: "AE" | "SA";
  standardRate: number;
  emirate: Emirate | null;
  rows: VatTreatmentRow[];
}

/** "box1bDubaiAmount" -> { box: "1b", part: "amount" }; null for an unknown key. */
export function describeBoxKey(key: string): VatBoxRef | null {
  const m = /^box(\d+)([a-g])?[A-Za-z]*?(Amount|Vat)$/.exec(key);
  if (!m) return null;
  return { box: `${m[1]}${m[2] ?? ""}`, part: m[3] === "Vat" ? "vat" : "amount", key };
}

function boxesOf(delta: BoxDelta): VatBoxRef[] {
  return Object.entries(delta)
    .filter(([, v]) => v !== 0 && v !== undefined)
    .map(([k]) => describeBoxKey(k))
    .filter((b): b is VatBoxRef => !!b);
}

const SALES: Vat201Family[] = [
  "standard",
  "zero_rated",
  "exempt",
  "out_of_scope",
  "reverse_charge",
];
const PURCHASES: PurchaseKind[] = ["standard", "reverse_charge", "import", "not_reportable"];

export function vatBoxMap(company: {
  addressCountry?: string | null;
  emirate?: string | null;
}): VatBoxMap {
  const jurisdiction = vatJurisdictionWithFlag(company.addressCountry);
  const standardRate = STANDARD_VAT_RATES[jurisdiction];
  const emirate = normaliseEmirate(company.emirate ?? null);
  // Box 1 is per emirate: probe with the company's own (Dubai when it is not set yet).
  const probeEmirate: Emirate = emirate ?? ("dubai" as Emirate);
  const rows: VatTreatmentRow[] = [];
  for (const family of SALES) {
    const delta = salesDelta(family, probeEmirate, 100, family === "standard" ? 5 : 0);
    rows.push({
      side: "sales",
      treatment: family,
      rate: family === "standard" ? standardRate : 0,
      boxes: boxesOf(delta),
    });
  }
  for (const kind of PURCHASES) {
    const delta = purchaseDelta(kind, 100, kind === "not_reportable" ? 0 : 5, 5);
    rows.push({
      side: "purchases",
      treatment: kind,
      rate: kind === "not_reportable" ? 0 : standardRate,
      boxes: boxesOf(delta),
    });
  }
  return { jurisdiction, standardRate, emirate, rows };
}

/** All Box 1 rows (one per emirate), for the page's note under standard-rated sales. */
export const BOX1_EMIRATE_ROWS = Object.entries(EMIRATE_BOX_PREFIX).map(([e, prefix]) => ({
  emirate: e as Emirate,
  box: describeBoxKey(`${prefix}Amount`)?.box ?? "1",
}));
