// The lines stored on a recurring invoice template: the items with their line discounts, plus at most one shipping
// line. The scheduler derives the generated invoice from these exactly like a hand-made one (shared/sales-line-math),
// so what is stored here is what every generated invoice carries.

export interface TemplateItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountType?: "percent" | "amount" | null;
  discountValue?: number | string | null;
}

export function buildTemplateLines(
  items: TemplateItemInput[],
  shipping: { amount: number | string; vatRate: number },
  shippingDescription: string
): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = items.map((line) => {
    const { discountType, discountValue, ...rest } = line;
    const value = discountValue === "" || discountValue === null || discountValue === undefined ? null : Number(discountValue);
    return discountType && value !== null && value > 0 ? { ...rest, discountType, discountValue: value } : { ...rest };
  });
  const amount = shipping.amount === "" ? 0 : Number(shipping.amount);
  if (amount > 0) {
    lines.push({ description: shippingDescription, quantity: 1, unitPrice: amount, vatRate: shipping.vatRate, lineKind: "shipping" });
  }
  return lines;
}

/** Split stored template lines back into the editor's items and shipping fields. */
export function splitTemplateLines<T extends { lineKind?: string }>(lines: T[]): { items: T[]; shipping: T | null } {
  return {
    items: lines.filter((l) => l?.lineKind !== "shipping"),
    shipping: lines.find((l) => l?.lineKind === "shipping") ?? null,
  };
}
