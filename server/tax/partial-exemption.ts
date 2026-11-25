/**
 * A1 (C6): partial exemption, Executive Regulation (Cabinet Decision 52/2017) Art. 55. Pure.
 *
 * 1. Direct attribution: input VAT wholly attributable to taxable supplies (incl. zero-rated) is
 *    recovered in full; input VAT wholly attributable to exempt supplies is not recovered.
 * 2. Residual input VAT (overheads used for both) is apportioned by the standard method:
 *    recoverable share = directly recoverable input VAT / total directly attributable input VAT,
 *    rounded to the nearest whole percentage point. With no directly attributable input VAT,
 *    use the company's provisional ratio (companies.exempt_supply_ratio).
 * 3. The irrecoverable part is posted to the GL as a cost (Dr 5160 / Cr 1050) when the return
 *    is made ready or submitted (vat-partial-exemption.service), so Box 9 / Box 10 tie to 1050.
 *
 * Not implemented here (documented follow-up): the annual adjustment of Art. 55(6), which
 * recomputes the ratio over the tax year and declares the difference in the first return of
 * the next tax year, and FTA-approved special methods.
 *
 * Amounts are integer fils; the apportionment uses exact integer arithmetic, half up.
 */
import { EMIRATES } from "../../shared/validators/primitives";
import { EMIRATE_BOX_PREFIX, type BoxDelta, type Vat201Fils, type Vat201Key } from "./vat-boxes";

export type Attribution = "taxable" | "exempt" | "residual";

export interface PartialExemptionConfig {
  enabled: boolean;
  /** Provisional exempt share (0..1) used when there is no directly attributable input VAT. */
  fallbackExemptRatio: number;
}

export interface PartialExemptionResult {
  enabled: boolean;
  method: "standard" | "provisional" | "none";
  taxableSuppliesFils: number;
  exemptSuppliesFils: number;
  /** Exempt share of supplies (0..1) actually used. */
  exemptSupplyRatio: number;
  recoverableRatio: number;
  grossInputVatFils: number;
  directTaxableFils: number;
  directExemptFils: number;
  residualFils: number;
  /** Irrecoverable input VAT (exempt-attributed + non-recoverable share of residual). */
  apportionedFils: number;
  /** Box deltas that remove the irrecoverable VAT from Box 9 / Box 10 (<= 0). */
  delta: BoxDelta;
  /** Exempt supplies in the period while partial exemption is off: the user should enable it. */
  advisory: "PARTIAL_EXEMPTION_NOT_ENABLED" | null;
  annualAdjustment: { status: "follow_up"; basis: string };
}

/** round(v * num / den) half away from zero, exact. */
function share(v: number, num: number, den: number): number {
  if (v === 0 || num === 0) return 0;
  if (num >= den) return v;
  const neg = v < 0;
  const p = BigInt(Math.abs(v)) * BigInt(num);
  const d = BigInt(den);
  const q = (p * 2n + d) / (2n * d);
  const out = Number(q);
  return neg ? -out : out;
}

export function taxableSupplies(b: Vat201Fils): number {
  let s = b.box4ZeroRatedAmount;
  for (const e of EMIRATES) s += b[`${EMIRATE_BOX_PREFIX[e]}Amount` as Vat201Key];
  return s;
}

export function computePartialExemption(
  boxes: Vat201Fils,
  contributions: Array<{ boxes: BoxDelta; attribution?: Attribution }>,
  config: PartialExemptionConfig
): PartialExemptionResult {
  const taxable = Math.max(0, taxableSupplies(boxes));
  const exempt = Math.max(0, boxes.box5ExemptAmount);
  const gross = boxes.box9ExpensesVat + boxes.box10ReverseChargeVat;
  const byAttr: Record<Attribution, { b9: number; b10: number }> = {
    taxable: { b9: 0, b10: 0 },
    exempt: { b9: 0, b10: 0 },
    residual: { b9: 0, b10: 0 },
  };
  for (const c of contributions) {
    const a = c.attribution ?? "residual";
    byAttr[a].b9 += c.boxes.box9ExpensesVat ?? 0;
    byAttr[a].b10 += c.boxes.box10ReverseChargeVat ?? 0;
  }
  const base: PartialExemptionResult = {
    enabled: config.enabled,
    method: "none",
    taxableSuppliesFils: taxable,
    exemptSuppliesFils: exempt,
    exemptSupplyRatio: 0,
    recoverableRatio: 1,
    grossInputVatFils: gross,
    directTaxableFils: byAttr.taxable.b9 + byAttr.taxable.b10,
    directExemptFils: byAttr.exempt.b9 + byAttr.exempt.b10,
    residualFils: byAttr.residual.b9 + byAttr.residual.b10,
    apportionedFils: 0,
    delta: {},
    advisory: null,
    annualAdjustment: {
      status: "follow_up",
      basis:
        "Executive Regulation Art. 55(6): annual adjustment over the tax year, declared in the first return of the next tax year",
    },
  };
  if (!config.enabled) {
    base.advisory = exempt > 0 && gross !== 0 ? "PARTIAL_EXEMPTION_NOT_ENABLED" : null;
    return base;
  }
  let num: number;
  let den: number;
  const recoverable = Math.max(0, base.directTaxableFils);
  const nonrecoverable = Math.max(0, base.directExemptFils);
  if (recoverable + nonrecoverable > 0) {
    base.method = "standard";
    den = 100;
    num = share(den, recoverable, recoverable + nonrecoverable);
  } else {
    base.method = "provisional";
    const r = Math.min(1, Math.max(0, config.fallbackExemptRatio));
    // ratio as an exact fraction of 1,000,000
    den = 1_000_000;
    num = Math.round((1 - r) * den);
  }
  base.recoverableRatio = den === 0 ? 1 : num / den;
  base.exemptSupplyRatio = 1 - base.recoverableRatio;
  const keep9 = byAttr.taxable.b9 + share(byAttr.residual.b9, num, den);
  const keep10 = byAttr.taxable.b10 + share(byAttr.residual.b10, num, den);
  const irr9 = boxes.box9ExpensesVat - keep9;
  const irr10 = boxes.box10ReverseChargeVat - keep10;
  base.apportionedFils = irr9 + irr10;
  if (irr9 !== 0) base.delta.box9ExpensesVat = -irr9;
  if (irr10 !== 0) base.delta.box10ReverseChargeVat = -irr10;
  return base;
}
