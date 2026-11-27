import { mulRate } from "./money";

/** A bill-wide treatment is applied by the header. Older writes also stamped it on the lines. */
export function billLineSupplyType(
  line: { vat_supply_type?: string | null; reverse_charge?: boolean | null },
  wasBillWide: boolean
): string {
  const supplyType = line.vat_supply_type || "standard_rated";
  if (wasBillWide && line.reverse_charge && supplyType === "reverse_charge")
    return "standard_rated";
  if (line.reverse_charge && supplyType === "standard_rated") return "reverse_charge";
  return supplyType;
}

export function billLineAmount(
  quantity: number,
  unitPriceFils: number,
  saved?: { quantity: number; unitPriceFils: number; amountFils: number }
): number {
  if (saved && quantity === saved.quantity) {
    if (unitPriceFils === saved.unitPriceFils) return saved.amountFils;
    const roundedAmount = quantity > 0 ? mulRate(saved.unitPriceFils, quantity) : 0;
    if (saved.unitPriceFils > 0 && saved.amountFils !== roundedAmount) {
      // When storage rounded the quantity, infer it from the recorded net and original price.
      return saved.amountFils === 0
        ? 0
        : mulRate(unitPriceFils, saved.amountFils / saved.unitPriceFils);
    }
  }
  return quantity > 0 ? mulRate(unitPriceFils, quantity) : 0;
}
