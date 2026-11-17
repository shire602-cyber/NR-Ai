// Display helper for the report catalogue (WP-D).
/**
 * Spec 2.1 (sentence case): catalog labels are written in Title Case in reportCatalog.ts (the single
 * source, also used by exports); the catalogue shows English labels in sentence case. Acronyms
 * (VAT, A/R, FX, WPS…) keep their capitals. Arabic is unaffected.
 */
export function sentenceCase(label: string, locale: string): string {
  if (locale !== "en") return label;
  return label
    .split(" ")
    .map((word, index) => {
      if (index === 0) return word;
      if (/[A-Z].*[A-Z]|\/|&|\d/.test(word)) return word;
      return word.charAt(0).toLowerCase() + word.slice(1);
    })
    .join(" ");
}
