export type VatRowCategory =
  | "standard_sale"
  | "tourist_refund"
  | "reverse_charge_output"
  | "zero_rated_sale"
  | "exempt_sale"
  | "import"
  | "import_adjustment"
  | "standard_expense"
  | "reverse_charge_input"
  | "manual_adjustment";

export const vatRowCategories: Array<{ value: VatRowCategory; label: string }> = [
  { value: "standard_sale", label: "Standard sales by emirate" },
  { value: "tourist_refund", label: "Tourist refunds" },
  { value: "reverse_charge_output", label: "Reverse charge output" },
  { value: "zero_rated_sale", label: "Zero-rated supplies" },
  { value: "exempt_sale", label: "Exempt supplies" },
  { value: "import", label: "Imports" },
  { value: "import_adjustment", label: "Import adjustments" },
  { value: "standard_expense", label: "Standard expenses" },
  { value: "reverse_charge_input", label: "Reverse charge input" },
  { value: "manual_adjustment", label: "Manual adjustment" },
];

export const vatEmirates = [
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "dubai", label: "Dubai" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
];

export const vat201CopyGroups = [
  {
    title: "Box 1 Standard-Rated Supplies",
    fields: [
      ["box1aAbuDhabiAmount", "1a Abu Dhabi amount"],
      ["box1aAbuDhabiVat", "1a Abu Dhabi VAT"],
      ["box1aAbuDhabiAdj", "1a Abu Dhabi adjustment"],
      ["box1bDubaiAmount", "1b Dubai amount"],
      ["box1bDubaiVat", "1b Dubai VAT"],
      ["box1bDubaiAdj", "1b Dubai adjustment"],
      ["box1cSharjahAmount", "1c Sharjah amount"],
      ["box1cSharjahVat", "1c Sharjah VAT"],
      ["box1cSharjahAdj", "1c Sharjah adjustment"],
      ["box1dAjmanAmount", "1d Ajman amount"],
      ["box1dAjmanVat", "1d Ajman VAT"],
      ["box1dAjmanAdj", "1d Ajman adjustment"],
      ["box1eUmmAlQuwainAmount", "1e UAQ amount"],
      ["box1eUmmAlQuwainVat", "1e UAQ VAT"],
      ["box1eUmmAlQuwainAdj", "1e UAQ adjustment"],
      ["box1fRasAlKhaimahAmount", "1f RAK amount"],
      ["box1fRasAlKhaimahVat", "1f RAK VAT"],
      ["box1fRasAlKhaimahAdj", "1f RAK adjustment"],
      ["box1gFujairahAmount", "1g Fujairah amount"],
      ["box1gFujairahVat", "1g Fujairah VAT"],
      ["box1gFujairahAdj", "1g Fujairah adjustment"],
    ],
  },
  {
    title: "Boxes 2-8 Outputs",
    fields: [
      ["box2TouristRefundAmount", "2 Tourist refund amount"],
      ["box2TouristRefundVat", "2 Tourist refund VAT"],
      ["box3ReverseChargeAmount", "3 Reverse charge amount"],
      ["box3ReverseChargeVat", "3 Reverse charge VAT"],
      ["box4ZeroRatedAmount", "4 Zero-rated amount"],
      ["box5ExemptAmount", "5 Exempt amount"],
      ["box6ImportsAmount", "6 Imports amount"],
      ["box6ImportsVat", "6 Imports VAT"],
      ["box7ImportsAdjAmount", "7 Import adjustment amount"],
      ["box7ImportsAdjVat", "7 Import adjustment VAT"],
      ["box8TotalAmount", "8 Total output amount"],
      ["box8TotalVat", "8 Total output VAT"],
      ["box8TotalAdj", "8 Total output adjustment"],
    ],
  },
  {
    title: "Boxes 9-14 Inputs And Net VAT",
    fields: [
      ["box9ExpensesAmount", "9 Standard expenses amount"],
      ["box9ExpensesVat", "9 Standard expenses input VAT"],
      ["box9ExpensesAdj", "9 Standard expenses adjustment"],
      ["box10ReverseChargeAmount", "10 Reverse charge input amount"],
      ["box10ReverseChargeVat", "10 Reverse charge input VAT"],
      ["box11TotalAmount", "11 Total input amount"],
      ["box11TotalVat", "11 Total recoverable VAT"],
      ["box11TotalAdj", "11 Total input adjustment"],
      ["box12TotalDueTax", "12 Total due tax"],
      ["box13RecoverableTax", "13 Total recoverable tax"],
      ["box14PayableTax", "14 Payable tax"],
    ],
  },
] as const;

export interface ParsedVatPasteRow {
  rowCategory: VatRowCategory;
  vat201Box?: string | null;
  invoiceNumber: string | null;
  documentDate: string | null;
  counterpartyName: string | null;
  counterpartyTrn: string | null;
  emirate: string | null;
  taxableAmount: number;
  vatAmount: number;
  grossAmount: number;
  adjustmentAmount: number;
  status: "approved";
  sourceMethod: "import";
  notes: string | null;
  auditReason: string;
}

function compactKey(value: string | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[#.()]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function keySlug(value: string | undefined) {
  return compactKey(value).replace(/ /g, "_");
}

function parseDelimitedVatLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim());
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function moneyFromCell(value: string | undefined) {
  return evaluateAmountExpression(value);
}

function dateFromCell(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return raw;
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Evaluate an amount the user typed, allowing simple arithmetic so the field
 * doubles as a calculator: "7800+1850" → 9650, "100*1.05" → 105, "(20+5)/2" →
 * 12.5. Strips AED / currency symbols, thousands separators and spaces, and
 * accepts Arabic-Indic digits. Supports + - * / and parentheses with a small
 * recursive-descent parser (no eval). Anything malformed returns 0.
 */
export function evaluateAmountExpression(input: string | number | null | undefined): number {
  if (typeof input === "number") return Number.isFinite(input) ? roundMoney(input) : 0;
  const raw = String(input ?? "").trim();
  if (!raw) return 0;

  // Normalise Arabic-Indic digits and the Arabic decimal/thousands marks.
  const ARABIC = "٠١٢٣٤٥٦٧٨٩";
  let s = raw
    .replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)))
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/aed|د\.إ|dhs?/gi, "")
    .replace(/[,،٬\s]/g, "");
  if (!s) return 0;

  // Only digits, decimal points and the four operators / parentheses are valid.
  // Anything else is malformed → 0 (no eval, no guessing a number out of junk).
  if (!/^[0-9+\-*/().]+$/.test(s)) return 0;

  let i = 0;
  const parseExpression = (): number => {
    let value = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (s[i] === "*" || s[i] === "/") {
      const op = s[i++];
      const rhs = parseFactor();
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  };
  const parseFactor = (): number => {
    if (s[i] === "+") {
      i++;
      return parseFactor();
    }
    if (s[i] === "-") {
      i++;
      return -parseFactor();
    }
    if (s[i] === "(") {
      i++;
      const v = parseExpression();
      if (s[i] !== ")") throw new Error("unbalanced");
      i++;
      return v;
    }
    let num = "";
    while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
    if (num === "" || num === ".") throw new Error("bad number");
    const n = Number(num);
    if (!Number.isFinite(n)) throw new Error("bad number");
    return n;
  };

  try {
    const result = parseExpression();
    if (i !== s.length) return 0; // trailing garbage → reject
    return Number.isFinite(result) ? roundMoney(result) : 0;
  } catch {
    return 0;
  }
}

export function normalizeVatRowCategory(value: string | undefined): VatRowCategory {
  const normalized = keySlug(value);
  const match = vatRowCategories.find(
    (category) => category.value === normalized || keySlug(category.label) === normalized
  );
  if (match) return match.value;
  if (
    normalized.includes("reverse") &&
    normalized.includes("charge") &&
    normalized.includes("input")
  )
    return "reverse_charge_input";
  if (normalized.includes("reverse") && normalized.includes("charge"))
    return "reverse_charge_output";
  if (normalized.includes("zero")) return "zero_rated_sale";
  if (normalized.includes("exempt")) return "exempt_sale";
  if (normalized.includes("import") && normalized.includes("adjust")) return "import_adjustment";
  if (normalized.includes("import")) return "import";
  if (normalized.includes("sale") || normalized.includes("output")) return "standard_sale";
  return "standard_expense";
}

export function vatRowCategoryLabel(value: string | undefined) {
  return vatRowCategories.find((category) => category.value === value)?.label ?? value ?? "Unknown";
}

const headerAliases: Record<string, string[]> = {
  category: ["category", "row category", "vat category", "source category", "type"],
  vat201Box: ["vat 201 box", "vat box", "fta box", "box"],
  invoiceNumber: [
    "invoice no",
    "invoice number",
    "invoice",
    "bill no",
    "document no",
    "doc no",
    "sr number",
    "sr. number",
    "serial number",
    "reference",
    "ref",
  ],
  documentDate: ["date", "invoice date", "bill date", "document date", "doc date"],
  counterpartyName: [
    "customer vendor",
    "customer/vendor",
    "customer",
    "vendor",
    "supplier",
    "counterparty",
    "party",
    "name",
  ],
  counterpartyTrn: [
    "trn",
    "tax registration number",
    "counterparty trn",
    "supplier trn",
    "customer trn",
  ],
  emirate: ["emirate", "place of supply", "place", "pos"],
  taxableAmount: ["taxable", "taxable amount", "net amount", "net", "amount before vat", "amount"],
  vatAmount: ["vat", "vat amount", "tax amount", "output vat", "input vat"],
  grossAmount: ["gross", "gross amount", "total", "invoice total", "bill total"],
  adjustmentAmount: ["adjustment", "adjustment amount", "adj"],
  notes: ["notes", "description", "memo", "remarks"],
};

function headerIndex(headerCells: string[], field: keyof typeof headerAliases) {
  const aliases = new Set(headerAliases[field].map(compactKey));
  return headerCells.findIndex((cell) => aliases.has(compactKey(cell)));
}

function hasRecognisedVatHeader(cells: string[]) {
  const keys = Object.keys(headerAliases) as Array<keyof typeof headerAliases>;
  return keys.some((key) => headerIndex(cells, key) >= 0);
}

function pickCell(
  cells: string[],
  headerCells: string[] | null,
  field: keyof typeof headerAliases,
  fallbackIndex: number
) {
  if (headerCells) {
    const index = headerIndex(headerCells, field);
    return index >= 0 ? cells[index] : undefined;
  }
  return cells[fallbackIndex];
}

export function parseVatPasteRows(text: string, defaultEmirate: string): ParsedVatPasteRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = parseDelimitedVatLine(lines[0]);
  const headerCells = hasRecognisedVatHeader(firstCells) ? firstCells : null;
  const rows = headerCells ? lines.slice(1) : lines;

  return rows
    .map((line) => {
      const cells = parseDelimitedVatLine(line);
      const taxableAmount = moneyFromCell(pickCell(cells, headerCells, "taxableAmount", 6));
      const vatAmount = moneyFromCell(pickCell(cells, headerCells, "vatAmount", 7));
      const adjustmentAmount = moneyFromCell(pickCell(cells, headerCells, "adjustmentAmount", 10));
      const explicitGross = moneyFromCell(pickCell(cells, headerCells, "grossAmount", 8));
      const grossAmount = explicitGross || taxableAmount + vatAmount + adjustmentAmount;

      return {
        rowCategory: normalizeVatRowCategory(pickCell(cells, headerCells, "category", 0)),
        vat201Box: pickCell(cells, headerCells, "vat201Box", 11) || null,
        invoiceNumber: pickCell(cells, headerCells, "invoiceNumber", 1) || null,
        documentDate: dateFromCell(pickCell(cells, headerCells, "documentDate", 2)),
        counterpartyName: pickCell(cells, headerCells, "counterpartyName", 3) || null,
        counterpartyTrn: pickCell(cells, headerCells, "counterpartyTrn", 4) || null,
        emirate: pickCell(cells, headerCells, "emirate", 5) || defaultEmirate || null,
        taxableAmount,
        vatAmount,
        grossAmount,
        adjustmentAmount,
        status: "approved" as const,
        sourceMethod: "import" as const,
        notes: pickCell(cells, headerCells, "notes", 9) || null,
        auditReason: "Bulk pasted by bookkeeper",
      };
    })
    .filter(
      (row) =>
        row.invoiceNumber ||
        row.counterpartyName ||
        row.taxableAmount ||
        row.vatAmount ||
        row.grossAmount
    );
}
