/**
 * Classifier for the Arabic runtime crawl (R18-02 / R18-11).
 *
 * A visible text line rendered while the UI is in Arabic is "English" when,
 * after removing allow-listed tokens, it still contains a Latin word of two or
 * more letters. Allow-listed: brand / product names, numbers and number-like
 * tokens (Q1, FY2026, 12px), ALL-CAPS acronyms of 2-6 letters (AED, VAT, TRN,
 * IBAN, PDF, CSV, WPS, FTA, ...), TRN/IBAN-like codes, e-mail addresses,
 * URLs/hosts, document numbers (INV-0001) and any extra tokens the caller
 * passes (seeded user data such as a company name).
 *
 * Shared by tests/e2e/arabic-runtime-crawl.mjs and the unit guard
 * tests/unit/arabic-runtime-classifier.test.ts.
 */

export const BRAND_ALLOWLIST = [
  "Muhasib",
  "Muhasib.ai",
  ".ai",
  "NR",
  "NRA",
  "Stripe",
  "Shopify",
  "Google",
  "Google Sheets",
  "Sheets",
  "WhatsApp",
  "Excel",
  "Peppol",
  "OpenPeppol",
  "EmaraTax",
  "Telr",
  "N-Genius",
  "OpenAI",
  "Zoho",
  "QuickBooks",
  "Xero",
  "Microsoft",
  "Outlook",
  "Gmail",
  "Apple",
  "iOS",
  "Android",
  // Provider, browser and format proper nouns that stay Latin inside Arabic sentences.
  "A-Cube",
  "Lean Technologies",
  "Tarabut Gateway",
  "Wio Bank",
  "Wio Business",
  "Resend",
  "Chrome",
  "Safari",
  "Firefox",
  "Linux",
  "Windows",
  "macOS",
  "Google Authenticator",
  "Microsoft Authenticator",
  "Authenticator",
  "WebP",
  "xlsx",
  "OpenAPI",
  "Webhook",
  "Webhooks",
  "webhook",
  "webhooks",
  "mof.gov.ae",
  "NR Accounting",
  "Ctrl",
  "Cmd",
  "Esc",
  "Enter",
  "Tab",
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/g;
const HOST_LIKE = /\b[\w-]+\.(?:ai|com|ae|net|org|io|app)\b\S*/g;
// INV-0001, BILL-2026-0003, QT-12, JE-7
const DOC_NUMBER = /\b[A-Z]{1,6}-[\w-]*\d[\w-]*\b/g;
// tokens containing a digit: Q1, H2, FY2026, 12px, 3x, 2026-11-16, AE070331234567890123456
const DIGIT_TOKEN = /\b[\w-]*\d[\w-]*\b/g;
// ALL-CAPS acronyms (AED, VAT, TRN, IBAN, XLSX, PINT, UBL) incl. plural "TRNs"
const ACRONYM = /\b[A-Z]{2,6}s?\b/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove allow-listed fragments from a line and return what is left. */
export function stripAllowlisted(line, extraAllow = []) {
  let out = ` ${line} `;
  const phrases = [...extraAllow, ...BRAND_ALLOWLIST]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    out = out.replace(new RegExp(`(^|[^A-Za-z])${escapeRegExp(phrase)}(?![A-Za-z])`, "g"), "$1 ");
  }
  return out
    .replace(EMAIL, " ")
    .replace(URL_LIKE, " ")
    .replace(HOST_LIKE, " ")
    .replace(DOC_NUMBER, " ")
    .replace(DIGIT_TOKEN, " ")
    .replace(ACRONYM, " ");
}

/** True when `line` still carries English words after allow-listing. */
export function isEnglishLine(line, extraAllow = []) {
  const rest = stripAllowlisted(line, extraAllow);
  return /[A-Za-z]{2,}/.test(rest);
}

/** Split innerText into trimmed, non-empty, de-duplicated-in-order lines. */
export function toLines(text) {
  return String(text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/** Count lines, English lines and return the English ones (first `limit`). */
export function classifyLines(lines, extraAllow = [], limit = 200) {
  const english = lines.filter((line) => isEnglishLine(line, extraAllow));
  return { total: lines.length, english: english.length, samples: english.slice(0, limit) };
}
