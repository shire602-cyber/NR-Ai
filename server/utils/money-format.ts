/**
 * Shared server money formatter for documents (PDFs, emails): "AED 1,234.50".
 *
 * Wraps shared/money.ts#formatFils so the server prints amounts the same way as
 * the client (digit grouping, exactly 2 decimals, half-up to the fil). Amounts
 * from numeric columns may arrive as numbers or decimal strings; a value that is
 * not a finite amount prints as 0.00 rather than "NaN".
 */
import { formatFils, tryToFils } from "../../shared/money";

export function formatMoneyAmount(
  amount: number | string | null | undefined,
  currency: string = "AED"
): string {
  const fils = tryToFils(amount ?? 0, { rounding: "halfUp" }) ?? 0;
  return formatFils(fils, { currency });
}
