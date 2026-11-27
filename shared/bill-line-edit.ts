import { mulRate } from "./money";

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

/**
 * The current writer stores the line's own treatment in the enum and always writes a false
 * line flag. A historical true flag can encode either inherited or explicit reverse charge.
 */
export function isLegacyBill(
  headerVatFils: number,
  lines: readonly { vatFils: number; reverse_charge?: boolean | null }[],
  customs?: { isImport?: boolean | null; declaredVatFils: number }
): boolean {
  // Migration 0096 defaulted these fields to false and zero on historical bills.
  const hasDeclaredImportVat =
    customs?.isImport === true && lines.length > 0 && headerVatFils === customs.declaredVatFils;
  return (
    lines.some((line) => line.reverse_charge === true) ||
    (!hasDeclaredImportVat &&
      hasHeaderOnlyBillVat(
        headerVatFils,
        lines.map((line) => line.vatFils)
      ))
  );
}

export function isBillWideReverseCharge(
  reverseCharge?: boolean | null,
  isImport?: boolean | null
): boolean {
  return reverseCharge === true || isImport === true;
}

export function hasStoredBillQuantityPrecision(quantity: number): boolean {
  return quantity > 0 && quantity < 100_000_000 && /^\d+(?:\.\d{1,2})?$/.test(String(quantity));
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
