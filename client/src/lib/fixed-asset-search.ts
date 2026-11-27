/** Search over the fixed-asset register: pure so the list screen and its test share one rule. */
export interface SearchableAsset {
  asset_name: string;
  asset_name_ar?: string | null;
  asset_number?: string | null;
  serial_number?: string | null;
  category: string;
  location?: string | null;
}

/**
 * Matches name (English or Arabic), asset/serial number, location, and the category both by its
 * stored key ("Vehicles") and by the label the reader sees (Arabic "المركبات"). Surrounding
 * whitespace is ignored, so a pasted " laptop " still finds the row.
 */
export function matchesAssetSearch(
  asset: SearchableAsset,
  rawQuery: string,
  categoryLabel?: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return [
    asset.asset_name,
    asset.asset_name_ar,
    asset.asset_number,
    asset.serial_number,
    asset.location,
    asset.category,
    categoryLabel,
  ].some((v) => !!v && v.toLowerCase().includes(q));
}
