import { normalizeForLabelMatching } from "./arabic-text";
import { uaeToday } from "./uae-date";
import { roundHalfUp } from "./money";
import {
  amountMismatchMessage,
  hasVatFigure,
  reconcileReceiptAmounts,
  vatDerivedMessage,
  vatRateAmountConflictMessage,
  vatDerivedSource,
} from "./receipt-amounts";
import {
  deriveConfidenceBand,
  type ConfidenceBand,
  type ValidationIssue,
} from "./receipt-confidence";

export const UNKNOWN_RECEIPT_MERCHANT = "Unknown Merchant";

/** Start of the review note raised when VAT is printed on a fee line and on its own line. */
const FEE_VAT_AMBIGUOUS_NOTE = "VAT is printed on a fee line";

/**
 * True for the parser's "VAT on a fee line and on its own line" note. It is an AMOUNT_MISMATCH even
 * though subtotal + VAT = total, so a caller that re-checks the figures must not drop it.
 */
export function isFeeVatAmbiguityIssue(issue: { code: string; message: string }): boolean {
  return issue.code === "AMOUNT_MISMATCH" && issue.message.startsWith(FEE_VAT_AMBIGUOUS_NOTE);
}

/** Start of the review note raised when the receipt prints no total and one was calculated. */
const TOTAL_NOT_PRINTED_NOTE = "No total is printed";

/**
 * True for the parser's "no total printed" note. It is an AMOUNT_MISMATCH even though subtotal +
 * VAT = total (the total is calculated), so a caller that re-checks the figures must not drop it.
 */
export function isTotalNotPrintedIssue(issue: { code: string; message: string }): boolean {
  return issue.code === "AMOUNT_MISMATCH" && issue.message.startsWith(TOTAL_NOT_PRINTED_NOTE);
}

export type ParsedReceiptLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ParsedReceiptOcr = {
  merchant: string;
  date: string;
  invoiceNumber: string | null;
  subtotal: number;
  vatPercentage: number;
  vatAmount: number;
  total: number;
  currency: string;
  category: string;
  lineItems: ParsedReceiptLineItem[];
  rawText: string;
  confidence: number;
  /** 15-digit UAE TRN of the supplier when present and well-formed, else null. */
  supplierTrn: string | null;
  /** Set when a TRN-like value was found but failed the format check. */
  supplierTrnIssue: string | null;
  /** Document says "Tax Invoice" / "فاتورة ضريبية". */
  isTaxInvoice: boolean;
  /** Document is explicitly a simplified tax invoice. */
  simplifiedInvoice: boolean;
  /** Reverse-charge wording present, or foreign supplier without TRN/VAT line. */
  reverseChargeSuggested: boolean;
  /** Review routing from the amount check (AMOUNT_MISMATCH when subtotal + VAT != total). */
  confidenceBand: ConfidenceBand;
  reviewReasons: string[];
  reviewReasonCodes: string[];
  validationIssues: ValidationIssue[];
};

/** UAE TRN: exactly 15 digits, FTA-issued numbers start with 100. */
export function validateUaeTrn(raw: string | null | undefined): {
  valid: boolean;
  trn: string | null;
  issue: string | null;
} {
  if (!raw) return { valid: false, trn: null, issue: null };
  const digits = normalizeForLabelMatching(String(raw)).replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return { valid: false, trn: null, issue: "TRN must be numeric" };
  if (digits.length !== 15) {
    return { valid: false, trn: null, issue: `TRN must be 15 digits (got ${digits.length})` };
  }
  if (!digits.startsWith("100")) {
    return { valid: false, trn: null, issue: "TRN must start with 100" };
  }
  return { valid: true, trn: digits, issue: null };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const SKIP_MERCHANT_LINE =
  /\b(receipt|invoice|tax invoice|bill|date|time|trn|vat|total|subtotal|amount|cash|card|tel|phone|www|email)\b/i;
// Arabic equivalents (no \b: JS word boundaries do not apply to Arabic letters).
const SKIP_MERCHANT_LINE_AR =
  /(فاتورة|ايصال|إيصال|التاريخ|الرقم الضريبي|رقم التسجيل|المجموع|الاجمالي|الإجمالي|اجمالي|إجمالي|الضريبة|ضريبة|هاتف|نقدا|نقداً|بطاقة)/;

const AR_MONTHS: Record<string, number> = {
  يناير: 1,
  فبراير: 2,
  مارس: 3,
  ابريل: 4,
  أبريل: 4,
  مايو: 5,
  يونيو: 6,
  يوليو: 7,
  اغسطس: 8,
  أغسطس: 8,
  سبتمبر: 9,
  اكتوبر: 10,
  أكتوبر: 10,
  نوفمبر: 11,
  ديسمبر: 12,
};

const CUR = "(?:AED|DHS?|USD|EUR|GBP|SAR|د\\.?إ|د\\.?ا|درهم)";

function round2(value: number): number {
  return Number.isFinite(value) ? Number(roundHalfUp(value, 2)) : 0;
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/[^\d.,-]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const amount = parseFloat(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? round2(amount) : 0;
}

function normalizeYear(year: number): number {
  if (year < 100) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseDate(text: string, fallbackDate: string): string {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const parsed = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (parsed) return parsed;
  }

  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = normalizeYear(Number(numeric[3]));
    // UAE receipts are normally day-first; fall back to month-first when that
    // reading is not a valid date.
    const parsed = toIsoDate(year, second, first);
    if (parsed) return parsed;

    const monthFirst = toIsoDate(year, first, second);
    if (monthFirst) return monthFirst;
  }

  const named = text.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{2,4})\b/i
  );
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    const parsed = toIsoDate(normalizeYear(Number(named[3])), month, Number(named[1]));
    if (parsed) return parsed;
  }

  const arNamed = text.match(
    /(\d{1,2})\s+(يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)\s+(\d{2,4})/
  );
  if (arNamed) {
    const parsed = toIsoDate(
      normalizeYear(Number(arNamed[3])),
      AR_MONTHS[arNamed[2]],
      Number(arNamed[1])
    );
    if (parsed) return parsed;
  }

  return fallbackDate;
}

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /\b(?:invoice|inv|receipt|bill|ref|reference|transaction|txn)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9][A-Z0-9\-/_]{2,40})\b/i,
    /(?:رقم الفاتورة|رقم الايصال|رقم الإيصال|رقم المرجع)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_]{2,40})/i,
    /\b(?:no\.?|#)\s*([A-Z0-9][A-Z0-9\-/_]{2,40})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].replace(/[.,;:]+$/, "").slice(0, 100);
  }
  return null;
}

function extractCurrency(text: string): string {
  const upper = text.toUpperCase();
  if (/\bUSD\b|\$|دولار/.test(upper)) return "USD";
  if (/\bEUR\b|€|يورو/.test(upper)) return "EUR";
  if (/\bGBP\b|£/.test(upper)) return "GBP";
  if (/\bSAR\b|ر\.\s?س|ريال/.test(upper)) return "SAR";
  return "AED";
}

function findFirstAmount(text: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const amount = parseAmount(match[1]);
      if (amount > 0 && amount < 100000000) return amount;
    }
  }
  return 0;
}

// VAT labels only. Generic "tax" (excise, tourism, municipality, "before tax", "Tax 0 items") is
// deliberately not a VAT label. Arabic teh marbuta and heh spellings are both accepted.
const VAT_LABEL = String.raw`(?:vat|value[ \t]+added[ \t]+tax|ضريب[ةه][ \t]+القيم[ةه][ \t]+المضاف[ةه]|ض\.?[ \t]?ق\.?[ \t]?م\.?|(?:ال)?ضريب[ةه])`;
// A line led by "Incl. VAT" / "Including VAT" / "شامل ضريبة" is the VAT amount included in the total.
const VAT_LINE_START = String.raw`^[ \t*#\-•|:]*(?:(?:total|amount|net|sum|اجمالي|مجموع|المجموع)[ \t]+|(?:incl\.?|including|inclusive[ \t]+of|شامل)[ \t]+)?${VAT_LABEL}[ \t]*`;
// The whole line is the VAT label with a rate and/or an amount.
const VAT_LINE = new RegExp(
  VAT_LINE_START +
    String.raw`(?:%[ \t]*)?(?:@?[ \t]*(\d+(?:[.,]\d+)?)[ \t]*%)?[ \t:]{0,10}(?:${CUR})?[ \t]*(\d+(?:[.,]\d+)?)?[ \t]*(?:${CUR})?[ \t]*$`,
  "i"
);
// A VAT label with a printed rate and a zero amount ("VAT 5% 0.00", "VAT @ 5% : 0.00"), anything after.
const RATE_WITH_ZERO_AMOUNT_LINE = new RegExp(
  VAT_LINE_START +
    String.raw`@?[ \t]*(\d+(?:[.,]\d+)?)[ \t]*%[ \t:]{0,10}(?:${CUR})?[ \t]*0+(?:[.,]0+)?(?![\d.,])`,
  "i"
);
// "VAT 0%" alone on its line: the zero rate is its figure, so the next line is not its amount.
const BARE_ZERO_RATE_LINE = new RegExp(
  `(${VAT_LINE_START}@?[ \t]*0+(?:[.,]0+)?[ \t]*%)[ \t]*(?:${CUR})?[ \t]*$`,
  "gim"
);

// Non-recoverable fees printed next to VAT on hotel and restaurant bills: tourism dirham/tax,
// municipality fee/tax and the service charge line. They are never VAT, so these lines are taken
// out of the text the VAT, subtotal and total readers see ("Tourism tax 10.00" must not become VAT
// 10.00). A fee line is only the label at the start of the line, an optional rate and an amount
// ("TDF-200 cable 100.00", a store named "City Tax Consultants" or a sold "Service fee" item are
// not fees). "Service charge" is the fee; a sold "service fee" item is not.
const FEE_LABEL_SOURCE = [
  String.raw`tourism[ \t]*(?:dirhams?|dhs?|tax(?:es)?|fees?|levy|charges?|chg)(?![a-z])`,
  String.raw`tdf(?![a-z])`,
  String.raw`municipal(?:ity)?[ \t]*(?:tax(?:es)?|fees?|charges?|chg|levy)(?![a-z])`,
  String.raw`munic?[ \t.]+(?:tax|fees?)(?![a-z])`,
  String.raw`(?:service|serv|svc)[ \t.]*(?:charges?|chg)(?![a-z])`,
  String.raw`city[ \t]+tax(?![a-z])`,
  // Definite ("ضريبة السياحة") and indefinite ("ضريبة سياحية", "رسوم سياحية") Arabic forms.
  String.raw`(?:ضريب[ةه]|درهم|رسوم|رسم)[ \t]+(?:ال)?سياح(?:ي[ةه]|[ةه])`,
  String.raw`(?:ضريب[ةه]|رسوم|رسم)[ \t]+(?:ال)?بلدي[ةه]`,
  String.raw`(?:رسوم|رسم)[ \t]+(?:ال)?خدم[ةه]`,
].join("|");
const FEE_LINE = new RegExp(
  String.raw`^[ \t*#\-•|:]*(?:${FEE_LABEL_SOURCE})(?:[ \t]+(?:fees?|tax(?:es)?|charges?|levy))?` +
    // "Tourism Dirham (2 nights) 20.00", "Service charge (VAT incl) 10.00", "... 4 nights 80.00"
    String.raw`(?:[ \t]*\([^)\n]*\))?(?:[ \t]+\d+[ \t]*(?:nights?|nts?)(?![a-z]))?[ \t:.@(]*` +
    String.raw`(?:\d+(?:[.,]\d+)?[ \t]*%\)?)?[ \t:]*(?:${CUR})?[ \t]*(\d[\d,]*(?:\.\d+)?)[ \t]*(?:${CUR})?[ \t]*` +
    String.raw`(?:(${VAT_LABEL}.*))?$`,
  "i"
);

// A line with a fee label anywhere but no digits is a name or address ("City Tax Consultants",
// "Opp. Municipality Tax Office"): not a fee, but its "tax" must not become the VAT label either.
const FEE_NAME_LINE = new RegExp(`(?<![a-z])(?:${FEE_LABEL_SOURCE})`, "i");

// A line that is itself a total/subtotal/VAT label keeps its (next-line) amount even when it
// names a fee ("Total incl service charge" with the figure on the following line).
const AMOUNT_LABEL_LINE = /total|\bvat\b|المجموع|الاجمالي|اجمالي|القيم[ةه] المضاف[ةه]/i;

function lastAmount(text: string): number {
  const withoutRates = text.replace(/\d+(?:[.,]\d+)?[ \t]*%/g, " ");
  const nums = Array.from(withoutRates.matchAll(/\d[\d,]*(?:\.\d+)?/g));
  return nums.length ? parseAmount(nums[nums.length - 1][0]) : 0;
}

/** Splits fee lines (tourism, municipality, service charge) from the rest of the receipt. */
function splitFeeLines(lines: string[]): {
  rest: string[];
  feeTotal: number;
  feeVat: number;
  /** Fee amounts whose own line carries no VAT amount (assumed outside the taxable base). */
  feeNoVat: number;
  feeCount: number;
} {
  const rest: string[] = [];
  let feeTotal = 0;
  let feeVat = 0;
  let feeNoVat = 0;
  let feeCount = 0;
  for (const line of lines) {
    const m = FEE_LINE.exec(line);
    if (m) {
      feeCount += 1;
      feeTotal += parseAmount(m[1]);
      // "Service charge 10% 10.00 VAT 0.50": the VAT printed on the fee line stays VAT.
      const lineVat = m[2] ? lastAmount(m[2]) : 0;
      feeVat += lineVat;
      if (lineVat <= 0) feeNoVat += parseAmount(m[1]);
    } else if (!/\d/.test(line) && FEE_NAME_LINE.test(line) && !AMOUNT_LABEL_LINE.test(line)) {
      // A name or address with a fee phrase and no amount ("Behind Municipality Tax Building").
      continue;
    } else {
      rest.push(line);
    }
  }
  return {
    rest,
    feeTotal: round2(feeTotal),
    feeVat: round2(feeVat),
    feeNoVat: round2(feeNoVat),
    feeCount,
  };
}

function asNumber(raw: string | undefined): number | null {
  return raw === undefined ? null : Number(raw.replace(",", "."));
}

/**
 * What the receipt's VAT lines say when no VAT amount was read:
 * - "zero": an explicit zero VAT line with no positive rate on it (a 0% rate or a 0.00 amount).
 * - "conflict": a positive printed rate next to a zero amount; `rate` is the printed rate.
 */
function readZeroVatLines(
  lines: string[]
): { kind: "zero" } | { kind: "conflict"; rate: number } | null {
  for (const line of lines) {
    const m = RATE_WITH_ZERO_AMOUNT_LINE.exec(line);
    const rate = m ? asNumber(m[1]) : null;
    if (rate !== null && rate > 0) return { kind: "conflict", rate };
  }
  for (const line of lines) {
    const m = VAT_LINE.exec(line);
    if (!m) continue;
    const figures = [asNumber(m[1]), asNumber(m[2])].filter((n): n is number => n !== null);
    if (figures.length > 0 && figures.every((n) => n === 0)) return { kind: "zero" };
  }
  return null;
}

// A change / refund line is money given back, never a total candidate.
const CHANGE_LINE = /\b(?:change|refund)\b|الباقي|المتبقي/i;

function findLargestLikelyAmount(allLines: string[]): number {
  const lines = allLines.filter((line) => !CHANGE_LINE.test(line));
  const amounts: number[] = [];
  for (const line of lines) {
    const hasAmountSignal =
      /\b(aed|dhs?|total|amount|payable|cash|card|vat|tax)\b|درهم|د\.\s?إ|د\.\s?ا|الاجمالي|اجمالي|المبلغ|ضريبة/i.test(
        line
      );
    const lineAmounts = Array.from(
      line.matchAll(new RegExp(`(?:${CUR})?\\s*(-?\\d[\\d,]*\\.?\\d{0,2})`, "gi"))
    )
      .map((match) => parseAmount(match[1]))
      .filter((amount) => amount > 0 && amount < 100000000);
    if (hasAmountSignal) {
      amounts.push(...lineAmounts);
    }
  }
  if (amounts.length === 0) {
    for (const match of lines.join("\n").matchAll(/\b(-?\d[\d,]+\.\d{2})\b/g)) {
      const amount = parseAmount(match[1]);
      if (amount > 0 && amount < 100000000) amounts.push(amount);
    }
  }
  return amounts.length ? Math.max(...amounts) : 0;
}

function extractMerchant(lines: string[]): string {
  const candidates = lines
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line.length >= 3)
    .filter((line) => /[A-Za-z؀-ۿ]/.test(line))
    .filter((line) => !SKIP_MERCHANT_LINE.test(line))
    .filter((line) => !SKIP_MERCHANT_LINE_AR.test(line))
    .filter((line) => !/^\W*\d/.test(line));

  return (candidates[0] || lines[0] || UNKNOWN_RECEIPT_MERCHANT).slice(0, 200);
}

function extractSupplierTrn(text: string): { trn: string | null; issue: string | null } {
  const labelled = text.match(
    /(?:\bTRN\b|tax\s+registration\s+(?:no\.?|number)|\bTIN\b|الرقم الضريبي|رقم التسجيل الضريبي|رقم التسجيل)\s*[:#.-]?\s*(\d[\d\s-]{8,24}\d)/i
  );
  if (!labelled) return { trn: null, issue: null };
  const check = validateUaeTrn(labelled[1]);
  return check.valid ? { trn: check.trn, issue: null } : { trn: null, issue: check.issue };
}

const LINE_ITEM_SKIP =
  /\b(total|subtotal|sub\s*total|vat|tax|trn|date|invoice|receipt|change|cash|card|balance)\b|المجموع|الاجمالي|اجمالي|الضريبة|ضريبة|التاريخ|الرقم الضريبي|فاتورة/i;

/**
 * Bilingual (Arabic/English) line items. Recognises
 *   "<desc> <qty> x <unit> <total>"  and  "<qty> x <desc> <total>" shapes.
 */
export function extractLineItems(lines: string[]): ParsedReceiptLineItem[] {
  const items: ParsedReceiptLineItem[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    if (!line || LINE_ITEM_SKIP.test(line)) continue;

    let m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*[x×*]\s*(\d[\d,]*\.?\d*)\s+(\d[\d,]*\.?\d*)$/i);
    if (m && /[A-Za-z؀-ۿ]/.test(m[1])) {
      const quantity = Number(m[2]);
      items.push({
        description: m[1].trim().slice(0, 200),
        quantity,
        unitPrice: parseAmount(m[3]),
        total: parseAmount(m[4]),
      });
      continue;
    }
    m = line.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(.+?)\s+(\d[\d,]*\.\d{1,2})$/i);
    if (m && /[A-Za-z؀-ۿ]/.test(m[2])) {
      const quantity = Number(m[1]);
      const total = parseAmount(m[3]);
      items.push({
        description: m[2].trim().slice(0, 200),
        quantity,
        unitPrice: quantity > 0 ? round2(total / quantity) : total,
        total,
      });
    }
  }
  return items.slice(0, 100);
}

export function parseReceiptOcrText(
  text: string,
  options: { fallbackDate?: string } = {}
): ParsedReceiptOcr {
  const rawText = String(text || "");
  const displayText = rawText.replace(/\r/g, "\n");
  const displayLines = displayText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Matching copy: Arabic-Indic digits -> ASCII, Arabic decimal separator -> ".",
  // diacritics/tatweel removed, alef/yeh variants normalised. Display lines are kept
  // separately so the merchant keeps its original spelling.
  const normalizedText = normalizeForLabelMatching(displayText).replace(/٪/g, "%");
  const allLines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  // Fee lines never feed the VAT, subtotal or total readers.
  const { rest: lines, feeTotal, feeVat, feeNoVat, feeCount } = splitFeeLines(allLines);
  const matchText = lines.length !== allLines.length ? lines.join("\n") : normalizedText;
  const fallbackDate = options.fallbackDate || uaeToday();

  const AMT = `(?:${CUR})?\\s*(-?\\d[\\d,]*\\.?\\d{0,2})`;
  // A change / refund line ("Total Change 95") is never read as the total.
  const amountsOf = (pattern: RegExp): number[] =>
    Array.from(matchText.matchAll(pattern))
      .filter((match) => {
        const index = match.index ?? 0;
        const lineStart = matchText.lastIndexOf("\n", index) + 1;
        const lineEnd = matchText.indexOf("\n", index);
        return !CHANGE_LINE.test(matchText.slice(lineStart, lineEnd < 0 ? undefined : lineEnd));
      })
      .map((match) => parseAmount(match[1]))
      .filter((amount) => amount > 0 && amount < 100000000);
  // Document precedence. A Grand Total / Net Payable / Total Due line is the receipt's total even
  // when a Sub Total, Net Total or plain Total line comes first (the last one wins: it follows a
  // discount line). Then plain Total / Amount Due lines. "Net Total" is the total only when no such
  // line exists. "Sub Total" / "Sub-Total" and totals "before tax", "excluding VAT" or "exclusive
  // of VAT" (English and Arabic) are net figures, never the total.
  const GRAND_RE =
    /\b(?:grand\s+total|net\s+payable|total\s+due)\b(?!\s*(?:vat|tax|gst)\b)[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi;
  const PLAIN_RE =
    /(?<!\b(?:sub|net)[ \t-]*)\b(?:amount\s+due|balance\s+due|total\s+amount|gross\s+(?:amount|total)|total)\b(?!\s*\(?\s*(?:vat|tax|gst|before|excl\w*|exclusive|without|w\/o|ex[ \t.]+(?:vat|tax))\b)[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi;
  const NET_RE =
    /\bnet[ \t-]*total\b(?!\s*\(?\s*(?:vat|tax|gst|before|excl\w*|exclusive|without|w\/o)\b)[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi;
  const grandTotals = amountsOf(GRAND_RE);
  const plainTotals = amountsOf(PLAIN_RE);
  const netTotals = amountsOf(NET_RE);
  const otherTotalPatterns = [
    new RegExp(
      `(?:المبلغ الاجمالي|الاجمالي الكلي|المجموع الكلي|المبلغ المستحق|صافي المبلغ|الاجمالي|اجمالي المبلغ|اجمالي)(?!\\s*(?:الفرعي|الضريبه|الضريبة|ضريبة|قبل|بدون|دون|غير\\s+شامل))[^\\d-]{0,30}${AMT}`,
      "g"
    ),
    /\b(?:AED|DHS?|USD|EUR|GBP|SAR)\s*(-?\d[\d,]*\.?\d{0,2})\s*(?:grand\s+total|net\s+payable|total)?\b/gi,
    new RegExp(
      `(\\d[\\d,]*\\.?\\d{0,2})\\s*${CUR}?\\s*(?:المبلغ الاجمالي|الاجمالي الكلي|المجموع الكلي|الاجمالي|اجمالي)(?!\\s*(?:الفرعي|الضريبه|الضريبة|ضريبة|قبل|بدون|دون))`,
      "g"
    ),
  ];
  const otherTotal = findFirstAmount(matchText, otherTotalPatterns);
  const subtotal = findFirstAmount(matchText, [
    /\b(?:sub[\s-]*total|(?:amount|total)\s+before\s+(?:vat|tax)|net\s+amount|taxable\s+amount|excl\.?\s*vat|excluding\s+(?:vat|tax)|exclusive\s+of\s+(?:vat|tax))\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    new RegExp(
      `(?:المجموع الفرعي|الاجمالي الفرعي|(?:المبلغ|الاجمالي|المجموع|اجمالي) قبل الضريب[ةه]|المبلغ الخاضع للضريب[ةه]|(?:المبلغ|الاجمالي|المجموع) بدون (?:ال)?ضريب[ةه])[^\\d-]{0,30}${AMT}`,
      "g"
    ),
  ]);
  // "VAT 0%" ending its line must not read the next line's total as its amount.
  const vatSearchText = matchText.replace(BARE_ZERO_RATE_LINE, "$1 0.00");
  const vatPatterns = [
    // The optional "5%" label must be consumed so the percentage is never read as the VAT amount.
    // Not "Before Tax" / "Excl. VAT" (a net figure) and not "TAX INVOICE" / "VAT No" headers.
    // "Incl. VAT 3.00" with no total word is the VAT amount; "Total incl. VAT 105" is the gross total.
    /(?<!\b(?:before|excl\.?|excluding|exclusive\s+of|w\/o|without|ex)\s+)(?<!\b(?:total|amount|payable|due|sum|price|net)\b[^\n\d]{0,25}\b(?:incl?\.?|including|inclusive\s+of|with)\s*\(?\s*)\b(?:vat|tax|gst)\b(?!\s+(?:invoice|receipt|registration|reg\b|number|no\b|id\b|code))(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    // Not "before tax" / "excluding tax" / "including tax" (a net or gross figure, not the VAT).
    new RegExp(
      `(?<!(?:قبل|بدون|دون|غير\\s+شامل)\\s+(?:ال)?)(?<!الخاضع\\s+لل?)(?<!(?:الاجمالي|اجمالي|المجموع|المبلغ|السعر|المستحق)[^\\n\\d]{0,25}(?:شامل|شاملة)\\s+(?:ال)?)(?:ضريب[ةه]\\s+القيم[ةه]\\s+المضاف[ةه]|(?:ال)?ضريب[ةه])(?:\\s*@?\\s*\\d+(?:\\.\\d+)?\\s*%)?[^\\d-]{0,30}${AMT}`,
      "g"
    ),
    /\b5\s*%\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
  ];
  let readVatAmount = findFirstAmount(vatSearchText, vatPatterns);
  // Two different printed VAT figures ("Incl. VAT 3.00" and "VAT 5.00"): keep the smaller so VAT is
  // never over-claimed, and send the receipt to review.
  let vatFiguresConflict = false;
  {
    const inclStart = /^[ \t*#\-•|:]*(?:incl\.?|including|inclusive[ \t]+of|شامل[ةه]?)[ \t]/i;
    const vatLines = vatSearchText.split("\n");
    const firstVat = (picked: string[]) =>
      findFirstAmount(picked.join("\n"), vatPatterns.slice(0, 2));
    const inclAmount = firstVat(vatLines.filter((l) => inclStart.test(l)));
    const plainAmount = firstVat(vatLines.filter((l) => !inclStart.test(l)));
    if (inclAmount > 0 && plainAmount > 0 && Math.abs(inclAmount - plainAmount) > 0.01) {
      vatFiguresConflict = true;
      readVatAmount = Math.min(inclAmount, plainAmount);
    }
  }

  // Resolve the total once VAT and subtotal are known. Several plain Total lines (a discount
  // between them): take the one that is the net line plus the read VAT. A Sub Total with VAT and
  // no total line is the net: total = sub + VAT (flagged below). Never a cash / change figure.
  const plainTotal = (() => {
    if (plainTotals.length <= 1 || readVatAmount <= 0) return plainTotals[0] ?? 0;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.015;
    const fit = plainTotals.find(
      (c) =>
        (subtotal > 0 && near(c, subtotal + readVatAmount)) ||
        plainTotals.some((d) => d !== c && near(c, d + readVatAmount))
    );
    return fit ?? plainTotals[0];
  })();
  const ordinaryTotal =
    grandTotals[grandTotals.length - 1] ?? (plainTotal || netTotals[0] || otherTotal || 0);
  const printedTotal = ordinaryTotal;
  const totalFromSubtotal =
    printedTotal === 0 && subtotal > 0 && readVatAmount > 0 ? round2(subtotal + readVatAmount) : 0;
  const total = printedTotal || totalFromSubtotal;
  const readTotal = total || findLargestLikelyAmount(lines);
  const feesInTotal = feeTotal > 0 && (readTotal === 0 || readTotal > feeTotal) ? feeTotal : 0;

  // A VAT line that prints zero ("VAT 0% AED 0.00", "VAT 0.00") is a read figure, not a missing
  // one, so VAT stays 0 and is never worked back at 5%. A positive printed rate next to a zero
  // amount ("VAT 5% 0.00") contradicts itself: the rate is kept, VAT stays 0 and it goes to review.
  // VAT printed on a fee line ("Service charge 10% 10.00 VAT 0.50") is real VAT.
  // A standalone VAT line is the receipt's VAT total and already includes VAT printed on a fee
  // line. The fee-line VAT is added only when the sum, and not the standalone figure alone, is
  // what fits the taxable base at 5% and the printed total; if neither fits it is left for review.
  let vatAmount = readVatAmount;
  let feeVatAmbiguous = false;
  if (feeVat > 0 && readVatAmount > 0) {
    const fits = (vat: number) =>
      total > 0 &&
      Math.abs(Math.round(vat * 100) - Math.round((((total - vat - feeNoVat) * 5) / 100) * 100)) <=
        1;
    if (!fits(readVatAmount)) {
      const summed = round2(readVatAmount + feeVat);
      if (fits(summed)) vatAmount = summed;
      else feeVatAmbiguous = true;
    }
  } else if (feeVat > 0) {
    vatAmount = feeVat;
  }
  const zeroVatRead = vatAmount === 0 ? readZeroVatLines(lines) : null;
  const vatRate =
    zeroVatRead?.kind === "zero" ? 0 : zeroVatRead?.kind === "conflict" ? zeroVatRead.rate : 5;

  // A printed rate next to a zero amount is not worked into VAT: the 0.00 stays as read.
  const reconcileRate = zeroVatRead?.kind === "conflict" ? 0 : vatRate;

  // Integer-fils reconciliation (half-up) so subtotal + VAT === total exactly. The returned
  // subtotal is total - VAT, so a non-VAT fee (tourism dirham, municipality fee) is part of the net
  // expense that gets booked; only the VAT worked back from the total leaves the fee out.
  const reconcileWith = (sub: number, vat: number, tot: number) =>
    reconcileReceiptAmounts({
      subtotal: sub,
      vatAmount: vat,
      total: tot,
      vatPercentage: reconcileRate,
    });
  // A receipt whose whole total is non-VAT fees ("Tourism dirham 20 / Total 20") has no VAT to work
  // back: the fees are the expense, VAT is 0 and the rate is 0.
  const feeOnly =
    feeTotal > 0 &&
    readTotal > 0 &&
    Math.abs(readTotal - feeTotal) < 0.005 &&
    vatAmount === 0 &&
    subtotal === 0 &&
    zeroVatRead?.kind !== "conflict";
  let amountInput = feeOnly
    ? { subtotal: readTotal, vatAmount: 0, total: readTotal }
    : { subtotal, vatAmount, total: readTotal };
  let reconciled = feeOnly
    ? { subtotal: readTotal, vatAmount: 0, total: readTotal, mismatch: false }
    : reconcileWith(subtotal, vatAmount, readTotal);
  let feeAddedToNet = 0;
  if (feesInTotal > 0 && readTotal > 0 && reconciled.mismatch) {
    // Printed subtotal + VAT = total means the fee is already inside the taxable subtotal and
    // nothing is subtracted (handled by the plain reconciliation above). Otherwise the fee sits
    // on top of the printed subtotal, or, with no VAT printed, VAT is worked back without it.
    if (vatAmount > 0 && subtotal > 0) {
      amountInput = { subtotal: subtotal + feesInTotal, vatAmount, total: readTotal };
      reconciled = reconcileWith(amountInput.subtotal, vatAmount, readTotal);
    } else if (vatAmount === 0) {
      amountInput = { subtotal, vatAmount, total: round2(readTotal - feesInTotal) };
      reconciled = reconcileWith(subtotal, vatAmount, amountInput.total);
      feeAddedToNet = feesInTotal;
    }
  } else if (feesInTotal > 0 && readTotal > 0 && vatAmount === 0 && subtotal === 0) {
    // Total only: VAT is worked back from the total without the fee, the fee stays in the net.
    amountInput = { subtotal, vatAmount, total: round2(readTotal - feesInTotal) };
    reconciled = reconcileWith(subtotal, vatAmount, amountInput.total);
    feeAddedToNet = feesInTotal;
  }
  const derivedSubtotal = round2(reconciled.subtotal + feeAddedToNet);
  const derivedVat = reconciled.vatAmount;
  const derivedTotal = round2(reconciled.total + feeAddedToNet);
  const amountsMismatch = reconciled.mismatch;
  const fallbackTotal = amountInput.total;
  const validationIssues: ValidationIssue[] = [];
  if (feeCount > 0) {
    validationIssues.push({
      code: "NON_VAT_FEE",
      severity: "warning",
      message: `The receipt shows a tourism, municipality or service charge line${feeTotal > 0 ? ` of ${feeTotal.toFixed(2)}` : ""}. Tourism dirham and municipality fees are not VAT and cannot be recovered, so they were kept out of the VAT amount and stay in the expense. A service charge is not VAT itself, but VAT may be charged on it. Check the figures against the receipt.`,
    });
  }
  if (zeroVatRead?.kind === "conflict") {
    validationIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message: vatRateAmountConflictMessage(
        derivedSubtotal,
        derivedVat,
        derivedTotal,
        zeroVatRead.rate
      ),
    });
  } else if (amountsMismatch || feeVatAmbiguous) {
    validationIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message: amountsMismatch
        ? amountMismatchMessage(
            derivedSubtotal,
            derivedVat,
            derivedTotal,
            vatRate,
            hasVatFigure(vatAmount)
          )
        : `${FEE_VAT_AMBIGUOUS_NOTE} (${feeVat.toFixed(2)}) and on its own line (${readVatAmount.toFixed(2)}). The VAT line was used; check whether the fee-line VAT is already included in it.`,
    });
  }
  if (vatFiguresConflict && !validationIssues.some((i) => i.code === "AMOUNT_MISMATCH")) {
    validationIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message: `The receipt prints two different VAT figures (an "Incl. VAT" line and a VAT line). The smaller, ${readVatAmount.toFixed(2)}, was used so VAT is not over-claimed. Check the figures against the receipt.`,
    });
  }
  // A Sub Total with no printed total: the total is calculated (sub total + VAT) or guessed from
  // the largest amount, never read, so it always goes to review.
  if (
    printedTotal === 0 &&
    subtotal > 0 &&
    !validationIssues.some((i) => i.code === "AMOUNT_MISMATCH")
  ) {
    validationIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message: totalFromSubtotal
        ? `${TOTAL_NOT_PRINTED_NOTE}; the total ${derivedTotal.toFixed(2)} was calculated as subtotal ${subtotal.toFixed(2)} + VAT ${readVatAmount.toFixed(2)}. Check the figures: the Sub Total may already include VAT.`
        : `${TOTAL_NOT_PRINTED_NOTE}; the total ${derivedTotal.toFixed(2)} was not read from the receipt (only a Sub Total ${subtotal.toFixed(2)} is printed). Check the total and whether VAT is included.`,
    });
  }
  // A total-only receipt has its VAT worked back at 5%; flag it so it goes to review.
  const vatDerivedFrom = vatDerivedSource({
    subtotal: amountInput.subtotal,
    vatAmount: amountInput.vatAmount,
    total: fallbackTotal,
    vatPercentage: reconcileRate,
  });
  if (vatDerivedFrom) {
    validationIssues.push({
      code: "VAT_DERIVED",
      severity: "warning",
      message: vatDerivedMessage(derivedVat, 5, vatDerivedFrom, true),
    });
  }

  const { trn: supplierTrn, issue: supplierTrnIssue } = extractSupplierTrn(normalizedText);
  const simplifiedInvoice =
    /simplified\s+tax\s+invoice|فاتورة ضريبية مبسطة|فاتوره ضريبيه مبسطه/i.test(normalizedText);
  const isTaxInvoice =
    simplifiedInvoice || /tax\s+invoice|فاتورة ضريبية|فاتوره ضريبيه/i.test(normalizedText);
  const currency = extractCurrency(normalizedText);
  const reverseChargeWording =
    /reverse\s+charge|الاحتساب العكسي|آلية الاحتساب العكسي|الية الاحتساب العكسي/i.test(
      normalizedText
    );
  const reverseChargeSuggested =
    reverseChargeWording || (!supplierTrn && vatAmount === 0 && currency !== "AED");

  let confidence = 0.35;
  if (derivedTotal > 0) confidence += 0.15;
  if (derivedVat > 0) confidence += 0.1;
  if (extractInvoiceNumber(normalizedText)) confidence += 0.05;
  if (lines.length >= 3) confidence += 0.05;
  if (supplierTrn) confidence += 0.05;

  const finalConfidence = Math.min(0.75, confidence);
  const band = deriveConfidenceBand({
    extractionConfidence: finalConfidence,
    issues: validationIssues,
  });

  return {
    merchant: extractMerchant(displayLines),
    date: parseDate(normalizedText, fallbackDate),
    invoiceNumber: extractInvoiceNumber(normalizedText),
    subtotal: derivedSubtotal,
    vatPercentage: feeOnly ? 0 : vatRate,
    vatAmount: derivedVat,
    total: derivedTotal,
    currency,
    category: "Other",
    lineItems: extractLineItems(lines),
    rawText,
    confidence: finalConfidence,
    supplierTrn,
    supplierTrnIssue,
    isTaxInvoice,
    simplifiedInvoice,
    reverseChargeSuggested,
    confidenceBand: band.band,
    reviewReasons: band.reasons,
    reviewReasonCodes: band.reasonCodes,
    validationIssues,
  };
}
