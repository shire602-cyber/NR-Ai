import { normalizeForLabelMatching } from "./arabic-text";
import { uaeToday } from "./uae-date";
import { roundHalfUp } from "./money";
import {
  amountMismatchMessage,
  hasVatFigure,
  reconcileReceiptAmounts,
  vatDerivedMessage,
  vatDerivedSource,
} from "./receipt-amounts";
import {
  deriveConfidenceBand,
  type ConfidenceBand,
  type ValidationIssue,
} from "./receipt-confidence";

export const UNKNOWN_RECEIPT_MERCHANT = "Unknown Merchant";

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

/**
 * True when the receipt prints an explicit zero VAT line ("VAT 0% AED 0.00"). `findFirstAmount`
 * skips zero amounts, so without this an explicit zero reads as "no VAT figure" and gets worked
 * back at 5%.
 */
function hasExplicitZeroVat(text: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (/\d/.test(match[1] ?? "") && parseAmount(match[1]) === 0) return true;
    }
  }
  return false;
}

function findLargestLikelyAmount(lines: string[]): number {
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
  const normalizedText = normalizeForLabelMatching(displayText);
  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackDate = options.fallbackDate || uaeToday();

  const AMT = `(?:${CUR})?\\s*(-?\\d[\\d,]*\\.?\\d{0,2})`;
  const total = findFirstAmount(normalizedText, [
    /\b(?:grand\s+total|net\s+payable|amount\s+due|total\s+due|balance\s+due|total\s+amount|total)\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    new RegExp(
      `(?:المبلغ الاجمالي|الاجمالي الكلي|المجموع الكلي|المبلغ المستحق|صافي المبلغ|الاجمالي|اجمالي المبلغ|اجمالي)(?!\\s*(?:الفرعي|الضريبه|الضريبة|ضريبة))[^\\d-]{0,30}${AMT}`,
      "g"
    ),
    /\b(?:AED|DHS?|USD|EUR|GBP|SAR)\s*(-?\d[\d,]*\.?\d{0,2})\s*(?:grand\s+total|net\s+payable|total)?\b/gi,
    new RegExp(
      `(\\d[\\d,]*\\.?\\d{0,2})\\s*${CUR}?\\s*(?:المبلغ الاجمالي|الاجمالي الكلي|المجموع الكلي|الاجمالي|اجمالي)(?!\\s*(?:الفرعي|الضريبه|الضريبة|ضريبة))`,
      "g"
    ),
  ]);
  const fallbackTotal = total || findLargestLikelyAmount(lines);
  const subtotal = findFirstAmount(normalizedText, [
    /\b(?:sub\s*total|subtotal|amount\s+before\s+(?:vat|tax)|net\s+amount|taxable\s+amount|excl\.?\s*vat)\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    new RegExp(
      `(?:المجموع الفرعي|الاجمالي الفرعي|المبلغ قبل الضريبة|المبلغ الخاضع للضريبة|المبلغ بدون ضريبة)[^\\d-]{0,30}${AMT}`,
      "g"
    ),
  ]);
  const vatPatterns = [
    // The optional "5%" label must be consumed so the percentage is never read as the VAT amount.
    /\b(?:vat|tax|gst)\b(?:\s*@?\s*\d+(?:\.\d+)?\s*%)?[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    new RegExp(
      `(?:ضريبة القيمة المضافة|ضريبه القيمه المضافه|الضريبة|ضريبة)(?:\\s*@?\\s*5\\s*%)?[^\\d-]{0,30}${AMT}`,
      "g"
    ),
    /\b5\s*%\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
  ];
  const vatAmount = findFirstAmount(normalizedText, vatPatterns);
  // An explicit zero VAT line is a zero-rated receipt: no 5% back-calculation, no VAT_DERIVED.
  const vatRate =
    vatAmount === 0 && fallbackTotal > 0 && hasExplicitZeroVat(normalizedText, vatPatterns) ? 0 : 5;

  // Integer-fils reconciliation (half-up) so subtotal + VAT === total exactly.
  const {
    subtotal: derivedSubtotal,
    vatAmount: derivedVat,
    total: derivedTotal,
    mismatch: amountsMismatch,
  } = reconcileReceiptAmounts({
    subtotal,
    vatAmount,
    total: fallbackTotal,
    vatPercentage: vatRate,
  });
  const validationIssues: ValidationIssue[] = [];
  if (amountsMismatch) {
    validationIssues.push({
      code: "AMOUNT_MISMATCH",
      severity: "error",
      message: amountMismatchMessage(
        derivedSubtotal,
        derivedVat,
        derivedTotal,
        vatRate,
        hasVatFigure(vatAmount)
      ),
    });
  }
  // A total-only receipt has its VAT worked back at 5%; flag it so it goes to review.
  const vatDerivedFrom = vatDerivedSource({
    subtotal,
    vatAmount,
    total: fallbackTotal,
    vatPercentage: vatRate,
  });
  if (vatDerivedFrom) {
    validationIssues.push({
      code: "VAT_DERIVED",
      severity: "warning",
      message: vatDerivedMessage(derivedVat, vatRate, vatDerivedFrom),
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
    vatPercentage: 5,
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
