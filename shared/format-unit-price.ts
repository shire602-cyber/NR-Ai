// Unit prices are stored as numeric(19,6). Display and serialise them at full
// stored precision, trimmed of trailing zeros but never below 2 decimals
// (33.333333 -> "33.333333", 33.3 -> "33.30", 100 -> "100.00").
// Line amounts and totals are NOT formatted here; they stay at 2dp.

const MIN_DECIMALS = 2;
const MAX_DECIMALS = 6;

export function formatUnitPrice(
  value: number | string | null | undefined,
  options: { grouping?: boolean } = {}
): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString("en-US", {
    minimumFractionDigits: MIN_DECIMALS,
    maximumFractionDigits: MAX_DECIMALS,
    useGrouping: options.grouping === true,
  });
}

export function formatUnitPriceCurrency(
  value: number | string | null | undefined,
  currency: string = "AED",
  options: { grouping?: boolean; locale?: string } = {}
): string {
  if (options.locale) {
    const n = Number(value);
    return new Intl.NumberFormat(options.locale, {
      style: "currency",
      currency,
      minimumFractionDigits: MIN_DECIMALS,
      maximumFractionDigits: MAX_DECIMALS,
    }).format(Number.isFinite(n) ? n : 0);
  }
  return `${currency} ${formatUnitPrice(value, options)}`;
}
