/** Text filter for the saved-receipts list: merchant, category and amount, case/diacritic-insensitive. */
type SearchableReceipt = {
  merchant?: string | null;
  category?: string | null;
  amount?: number | string | null;
};

/** Display label for a stored (English) receipt category; unknown categories show as stored. */
const RECEIPT_CATEGORY_KEYS: Record<string, string> = {
  "Office Supplies": "pageLabels.officeSupplies",
  Meals: "pages.receiptsCategoryMeals",
  Travel: "pages.travel",
  Utilities: "pages.utilities",
  Marketing: "pageLabels.marketing",
  Equipment: "pages.equipment",
  Communication: "pageLabels.communication",
  "Professional Services": "pages.professionalServices",
  Insurance: "pages.insurance",
  Maintenance: "pages.maintenance",
  Rent: "pages.receiptsCategoryRent",
  Other: "pages.other",
};

export function receiptCategoryLabel(t: Record<string, string>, category: string): string {
  const key = RECEIPT_CATEGORY_KEYS[category];
  return (key && t[key]) || category;
}

const normalise = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[ً-ٰٟ]/g, "")
    .toLowerCase()
    .trim();

export function matchesReceiptSearch(
  receipt: SearchableReceipt,
  query: string,
  t: Record<string, string>
): boolean {
  const needle = normalise(query);
  if (!needle) return true;
  const haystack = normalise(
    [
      receipt.merchant,
      receipt.category,
      receipt.amount != null ? String(receipt.amount) : "",
      receipt.category && receiptCategoryLabel(t, receipt.category),
    ]
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(needle);
}
