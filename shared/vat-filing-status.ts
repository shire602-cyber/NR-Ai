export const VAT_RECORDED_STATUSES: readonly string[] = ["filed", "paid", "accepted", "amended"];

/** A return finalised in the app still needs to be filed in EmaraTax. */
export function isVatFilingRecorded(status: string, reference?: string | null): boolean {
  return !!reference?.trim() && VAT_RECORDED_STATUSES.includes(status);
}
