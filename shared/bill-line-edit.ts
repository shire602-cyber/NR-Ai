import { mulRate } from "./money";

/** Legacy flags carry reverse charge without saying whether it came from the header. */
export function billLineSupplyType(
  line: { vat_supply_type?: string | null; reverse_charge?: boolean | null },
  billWideReverseCharge = false
): string {
  const supplyType = line.vat_supply_type || "standard_rated";
  if (!billWideReverseCharge && line.reverse_charge && supplyType === "standard_rated") {
    return "reverse_charge";
  }
  return supplyType;
}

/** Bills predating line VAT can still carry the full recorded tax on their header. */
export function hasHeaderOnlyBillVat(headerVatFils: number, lineVatFils: readonly number[]) {
  return headerVatFils > 0 && lineVatFils.every((vat) => vat === 0);
}

/**
 * Earlier writers also set the line flag for explicit reverse charge and bill-wide treatment.
 * Only a flag without either source of treatment is ambiguous.
 */
export function isLegacyBill(
  headerVatFils: number,
  lines: readonly {
    vatFils: number;
    vat_supply_type?: string | null;
    reverse_charge?: boolean | null;
  }[],
  header?: { isImport?: boolean | null; reverseCharge?: boolean | null; declaredVatFils: number }
): boolean {
  // Migration 0096 defaulted these fields to false and zero on historical bills.
  const hasDeclaredImportVat =
    header?.isImport === true && lines.length > 0 && headerVatFils === header.declaredVatFils;
  return (
    (!isBillWideReverseCharge(header?.reverseCharge, header?.isImport) &&
      lines.some(
        (line) => line.reverse_charge === true && line.vat_supply_type !== "reverse_charge"
      )) ||
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
