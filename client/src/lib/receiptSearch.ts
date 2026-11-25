/** Text filter for the saved-receipts list: merchant, category and amount, case/diacritic-insensitive. */
type SearchableReceipt = {
  merchant?: string | null;
  category?: string | null;
  amount?: number | string | null;
};

const normalise = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .toLowerCase()
    .trim();

export function matchesReceiptSearch(receipt: SearchableReceipt, query: string): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  const haystack = normalise(
    [receipt.merchant, receipt.category, receipt.amount != null ? String(receipt.amount) : ""]
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(needle);
}
