import { mulRate, sumFils } from "./money";

/** Legacy flags carry reverse charge without saying whether it came from the header. */
export function billLineSupplyType(line: {
  vat_supply_type?: string | null;
  reverse_charge?: boolean | null;
}): string {
  const supplyType = line.vat_supply_type || "standard_rated";
  if (line.reverse_charge && supplyType === "standard_rated") return "reverse_charge";
  return supplyType;
}

/** Bills predating line VAT can still carry the full recorded tax on their header. */
export function hasHeaderOnlyBillVat(headerVatFils: number, lineVatFils: readonly number[]) {
  return headerVatFils > 0 && lineVatFils.every((vat) => vat === 0);
}

/** A reverse-charge marker also applies to VAT stored solely on a historical bill's header. */
export function billReverseChargeVat(
  headerVatFils: number,
  lines: readonly { vatFils: number; reverseCharge: boolean }[]
): number {
  const reverseChargeLines = lines.filter((line) => line.reverseCharge);
  if (
    reverseChargeLines.length &&
    hasHeaderOnlyBillVat(
      headerVatFils,
      lines.map((l) => l.vatFils)
    )
  ) {
    return headerVatFils;
  }
  return sumFils(reverseChargeLines.map((line) => line.vatFils));
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
