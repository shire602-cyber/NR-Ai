/**
 * A 0% rate is two different supplies on the VAT 201: zero-rated (box 4) and exempt (box 5). The rate alone cannot say which,
 * so every place that offers "0%" offers the two as separate choices, and the choice travels as `vatSupplyType`.
 */
export const VAT_SUPPLY_CHOICES = ["standard_rated", "zero_rated", "exempt"] as const;
export type VatChoice = (typeof VAT_SUPPLY_CHOICES)[number];

export const STANDARD_VAT_RATE = 0.05;

/** The rate and supply type a choice stands for. */
export function vatFieldsOf(choice: VatChoice): { vatRate: number; vatSupplyType: VatChoice } {
  return { vatRate: choice === "standard_rated" ? STANDARD_VAT_RATE : 0, vatSupplyType: choice };
}

/** The choice for a stored rate and supply type. A 0% line with no stated type is zero-rated (never silently exempt). */
export function vatChoiceOf(rate: number | string | null | undefined, supplyType?: string | null): VatChoice {
  const r = Number(rate ?? STANDARD_VAT_RATE);
  if (r > 0) return "standard_rated";
  return supplyType === "exempt" ? "exempt" : "zero_rated";
}

/** Select value for a line: "5", "0:zero_rated" or "0:exempt" (Radix items need string values). */
export function vatSelectValue(rate: number | string | null | undefined, supplyType?: string | null): string {
  const choice = vatChoiceOf(rate, supplyType);
  return choice === "standard_rated" ? "5" : `0:${choice}`;
}

export function vatFromSelectValue(value: string): { vatRate: number; vatSupplyType: VatChoice } {
  if (value === "0:exempt") return vatFieldsOf("exempt");
  if (value === "0:zero_rated" || value === "0") return vatFieldsOf("zero_rated");
  return vatFieldsOf("standard_rated");
}
