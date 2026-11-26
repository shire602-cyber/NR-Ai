import { UNKNOWN_RECEIPT_MERCHANT } from "@shared/receipt-ocr-parser";

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

/** Stored values that mean "no merchant" (the current placeholder and the legacy one). */
const UNKNOWN_MERCHANT_VALUES = new Set([UNKNOWN_RECEIPT_MERCHANT, "Unknown"]); // i18n-ignore: stored data value, not UI copy

/** The stored merchant as typed, or "" for blanks and placeholders. Display only. */
export function knownReceiptMerchant(merchant?: string | null): string {
  const raw = merchant ?? "";
  const trimmed = raw.trim();
  return !trimmed || UNKNOWN_MERCHANT_VALUES.has(trimmed) ? "" : raw;
}

export function receiptMerchantLabel(t: Record<string, string>, merchant?: string | null): string {
  return knownReceiptMerchant(merchant) || t["screens.unknownMerchant"];
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
  const merchantLabel = receiptMerchantLabel(t, receipt.merchant);
  const haystack = normalise(
    [
      receipt.merchant,
      receipt.category,
      receipt.amount != null ? String(receipt.amount) : "",
      receipt.category && receiptCategoryLabel(t, receipt.category),
      // The localized "unknown merchant" label shown for blanks and placeholders.
      merchantLabel !== receipt.merchant && merchantLabel,
    ]
      .filter(Boolean)
      .join(" ")
  );
  return haystack.includes(needle);
}
