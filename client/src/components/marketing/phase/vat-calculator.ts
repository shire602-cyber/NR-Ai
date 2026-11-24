const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

export function parseVatAmount(amount: string): number | undefined {
  const normalized = amount
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replaceAll("٫", ".")
    .replaceAll("٬", ",");

  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [dirhams, fraction = ""] = normalized.replaceAll(",", "").split(".");
  const fils = Number(dirhams) * 100 + Number(fraction.padEnd(2, "0"));
  return fils <= 100_000_000_000_000 ? fils : undefined;
}

export function vatBreakdown(fils: number, mode: string, taxClass: string) {
  const extracting = mode === "extract";
  const vat = taxClass === "standard" ? Math.round((fils * 5) / (extracting ? 105 : 100)) : 0;
  return { net: extracting ? fils - vat : fils, vat, gross: extracting ? fils : fils + vat };
}
