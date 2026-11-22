/** A return finalised in the app still needs to be filed in EmaraTax. */
export function isVatFilingRecorded(status: string, reference?: string | null): boolean {
  return (
    status === "filed" ||
    status === "paid" ||
    status === "accepted" ||
    (status === "amended" && !!reference?.trim())
  );
}
