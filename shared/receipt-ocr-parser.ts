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
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  rawText: string;
  confidence: number;
};

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

function round2(value: number): number {
  return Number.isFinite(value) ? parseFloat(value.toFixed(2)) : 0;
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
    // UAE receipts are normally day-first. If the first value cannot be a day,
    // fall back to month-first.
    const day = first > 12 ? first : first;
    const month = first > 12 ? second : second;
    const parsed = toIsoDate(year, month, day);
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

  return fallbackDate;
}

function extractInvoiceNumber(text: string): string | null {
  const patterns = [
    /\b(?:invoice|inv|receipt|bill|ref|reference|transaction|txn)\s*(?:no\.?|number|#|:)?\s*([A-Z0-9][A-Z0-9\-/_]{2,40})\b/i,
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
  if (/\bUSD\b|\$/.test(upper)) return "USD";
  if (/\bEUR\b|€/.test(upper)) return "EUR";
  if (/\bGBP\b|£/.test(upper)) return "GBP";
  if (/\bSAR\b/.test(upper)) return "SAR";
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

function findLargestLikelyAmount(lines: string[]): number {
  const amounts: number[] = [];
  for (const line of lines) {
    const hasAmountSignal = /\b(aed|dhs?|total|amount|payable|cash|card|vat|tax)\b/i.test(line);
    const lineAmounts = Array.from(
      line.matchAll(/(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi)
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
    .filter((line) => /[A-Za-z]/.test(line))
    .filter((line) => !SKIP_MERCHANT_LINE.test(line))
    .filter((line) => !/^\W*\d/.test(line));

  return (candidates[0] || lines[0] || "Unknown Merchant").slice(0, 200);
}

export function parseReceiptOcrText(
  text: string,
  options: { fallbackDate?: string } = {}
): ParsedReceiptOcr {
  const rawText = String(text || "");
  const normalizedText = rawText.replace(/\r/g, "\n");
  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackDate = options.fallbackDate || new Date().toISOString().slice(0, 10);

  const total = findFirstAmount(normalizedText, [
    /\b(?:grand\s+total|net\s+payable|amount\s+due|total\s+due|balance\s+due|total\s+amount|total)\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    /\b(?:AED|DHS?|USD|EUR|GBP|SAR)\s*(-?\d[\d,]*\.?\d{0,2})\s*(?:grand\s+total|net\s+payable|total)?\b/gi,
  ]);
  const fallbackTotal = total || findLargestLikelyAmount(lines);
  const subtotal = findFirstAmount(normalizedText, [
    /\b(?:sub\s*total|subtotal|amount\s+before\s+(?:vat|tax)|net\s+amount|taxable\s+amount|excl\.?\s*vat)\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
  ]);
  const vatAmount = findFirstAmount(normalizedText, [
    /\b(?:vat|tax|gst)(?:\s*@?\s*5\s*%)?\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
    /\b5\s*%\b[^\d-]{0,30}(?:AED|DHS?|USD|EUR|GBP|SAR)?\s*(-?\d[\d,]*\.?\d{0,2})/gi,
  ]);

  const derivedSubtotal =
    subtotal > 0
      ? subtotal
      : vatAmount > 0 && fallbackTotal > 0
        ? round2(fallbackTotal - vatAmount)
        : fallbackTotal > 0
          ? round2(fallbackTotal / 1.05)
          : 0;
  const derivedVat =
    vatAmount > 0 ? vatAmount : fallbackTotal > 0 ? round2(fallbackTotal - derivedSubtotal) : 0;
  const derivedTotal =
    fallbackTotal > 0
      ? fallbackTotal
      : derivedSubtotal > 0
        ? round2(derivedSubtotal + derivedVat)
        : 0;

  let confidence = 0.35;
  if (derivedTotal > 0) confidence += 0.15;
  if (derivedVat > 0) confidence += 0.1;
  if (extractInvoiceNumber(normalizedText)) confidence += 0.05;
  if (lines.length >= 3) confidence += 0.05;

  return {
    merchant: extractMerchant(lines),
    date: parseDate(normalizedText, fallbackDate),
    invoiceNumber: extractInvoiceNumber(normalizedText),
    subtotal: derivedSubtotal,
    vatPercentage: 5,
    vatAmount: derivedVat,
    total: derivedTotal,
    currency: extractCurrency(normalizedText),
    category: "Other",
    lineItems: [],
    rawText,
    confidence: Math.min(0.75, confidence),
  };
}
