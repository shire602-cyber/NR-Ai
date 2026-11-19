// Arabic-aware text helpers shared by the OCR parser, merchant normaliser and
// classifier (R05-12, R05-13, R05-16). Pure functions, no I/O.

const ARABIC_INDIC_ZERO = 0x0660;
const EXT_ARABIC_INDIC_ZERO = 0x06f0;

/** Convert Arabic-Indic / Persian digits and Arabic separators to their ASCII form. */
export function toAsciiDigits(input: string): string {
  return String(input ?? "")
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - EXT_ARABIC_INDIC_ZERO))
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/[٬،]/g, ","); // Arabic thousands separator and comma
}

/** Strip tatweel (kashida) and Arabic diacritics (harakat). */
export function stripArabicMarks(input: string): string {
  return String(input ?? "").replace(/ـ|[ً-ٟ]|ٰ/g, "");
}

/** Normalise alef variants and alef maqsura to the base letters. Length-preserving. */
export function normalizeArabicLetters(input: string): string {
  return String(input ?? "")
    .replace(/[آأإٱ]/g, "ا") // alef variants -> alef
    .replace(/ى/g, "ي"); // alef maqsura -> yeh
}

/**
 * Text prepared for label matching: ASCII digits, no marks, base alef/yeh.
 * Teh marbuta is left alone so labels such as the VAT label stay readable.
 */
export function normalizeForLabelMatching(input: string): string {
  return normalizeArabicLetters(stripArabicMarks(toAsciiDigits(input)));
}

export function containsArabic(input: string): boolean {
  return /[؀-ۿ]/.test(input);
}

// Legal-form suffixes that carry no identity.
const LATIN_SUFFIX =
  /\b(ltd|llc|inc|fzc|fzco|fz-llc|l\.l\.c\.?|trading|co\.?|company|corp(?:oration)?|gmbh|sa)\b/g;
// Arabic: "ذ.م.م" (LLC), "شركة" (company), "مؤسسة" (establishment) after normalisation.
const ARABIC_SUFFIX = /(?:^|\s)(?:ش\s?ذ\s?م\s?م|ذ\s?م\s?م|شركه|مؤسسه)(?=\s|$)/g;

/**
 * Merchant key used for rules / Naive Bayes / duplicate matching.
 * Keeps Latin letters, digits and Arabic letters; normalises alef/yeh/teh marbuta,
 * strips tatweel and diacritics. Latin output is identical to the original normaliser.
 */
export function normalizeMerchantKey(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = toAsciiDigits(String(raw)).toLowerCase();
  s = s.replace(LATIN_SUFFIX, "");
  s = normalizeArabicLetters(stripArabicMarks(s)).replace(/ة/g, "ه"); // teh marbuta -> heh
  s = s.replace(/[^a-z0-9؀-ۿ\s]/g, " ");
  s = s.replace(ARABIC_SUFFIX, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Tokens for the statistical classifier; includes Arabic words. */
export function tokenizeMerchantText(text: string): string[] {
  return normalizeArabicLetters(stripArabicMarks(toAsciiDigits(String(text ?? "")).toLowerCase()))
    .replace(/ة/g, "ه")
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Search key for names: lower case, ASCII digits, no marks, alef/yeh/teh-marbuta folded and the
 * leading definite article "ال" dropped from each word, so "النور", "نور" and "النُّور" match.
 */
export function normalizeSearchText(input: string | null | undefined): string {
  const base = normalizeArabicLetters(stripArabicMarks(toAsciiDigits(String(input ?? ""))))
    .toLowerCase()
    .replace(/ة/g, "ه");
  return base
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

/** Does `haystack` contain every word of `query` (after `normalizeSearchText`)? */
export function matchesSearchText(
  query: string | null | undefined,
  ...haystacks: Array<string | null | undefined>
): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const hay = haystacks.map(normalizeSearchText).join(" ");
  return q.split(" ").every((w) => hay.includes(w));
}
