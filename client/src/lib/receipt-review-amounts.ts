import { toFilsInput } from "@/lib/receipt-split";

export function approvedReceiptAmounts(data: {
  subtotal?: number;
  total?: number;
  vatAmount?: number;
}) {
  const parse = (value: number | undefined) =>
    value === undefined || value === null ? undefined : toFilsInput(String(value));
  const vat = parse(data.vatAmount) ?? (data.vatAmount == null ? 0 : null);
  const total = parse(data.total);
  const subtotal = parse(data.subtotal);
  if (vat === null || subtotal === null || total === null) return null;
  const net = subtotal ?? (total === undefined ? 0 : total - vat);
  if (
    !Number.isSafeInteger(net) ||
    !Number.isSafeInteger(vat) ||
    net <= 0 ||
    vat > net ||
    (total !== undefined && total !== net + vat)
  ) {
    return null;
  }
  return { net, vat };
}
