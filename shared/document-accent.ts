/**
 * Document accent ("Ledger" family, Fable spec 2.8). Client-safe: no runtime imports.
 *
 * The accent is only ever used for the 2 pt top rule, section labels and the amount-due row of a
 * customer document (PDF and its HTML twin), so no colour can flood a header again. The default
 * is "Emerald ink" (brand-700); custom template colours stay possible.
 */
export const DOCUMENT_ACCENT_DEFAULT = "#0B5F45";

export const DOCUMENT_ACCENT_PRESETS = [
  { id: "emerald", hex: "#0B5F45", label: { en: "Emerald ink", ar: "حبر زمردي" } },
  { id: "graphite", hex: "#1F2733", label: { en: "Graphite", ar: "جرافيت" } },
  { id: "navy", hex: "#1E2F5C", label: { en: "Navy", ar: "كحلي" } },
  { id: "maroon", hex: "#6B1F2A", label: { en: "Maroon", ar: "عنابي" } },
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Colours that were form defaults before the Ledger family (the template editor's "#1a56db" and
 * the PDFs' hard-coded royal blue). A template still carrying one never chose it, so it prints
 * with the current default.
 */
const LEGACY_DEFAULTS = new Set(["#1A56DB", "#1E40AF"]);

/** Relative luminance (WCAG 2.x) of a #RRGGBB colour. */
export function hexLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The accent to print: a valid #RRGGBB template colour, else the default. A colour too light to
 * carry white text (contrast below 4.5:1) falls back to the default so the amount-due row stays
 * readable.
 */
export function resolveDocumentAccent(color: string | null | undefined): string {
  if (!color || !HEX.test(color) || LEGACY_DEFAULTS.has(color.toUpperCase())) {
    return DOCUMENT_ACCENT_DEFAULT;
  }
  const contrastWithWhite = 1.05 / (hexLuminance(color) + 0.05);
  return contrastWithWhite >= 4.5 ? color.toUpperCase() : DOCUMENT_ACCENT_DEFAULT;
}
