/**
 * Column mappers for the export layouts of Xero, QuickBooks Online, Zoho
 * Books and Wafeq (plus a generic template). Headers are matched
 * case-insensitively after stripping `*`, punctuation and spacing, so
 * "*ContactName", "Contact Name" and "contact_name" are the same column.
 * Fixtures for each layout live in tests/fixtures/import/.
 */
import { parse } from "csv-parse/sync";

export const IMPORT_KINDS = [
  "chart_of_accounts",
  "trial_balance",
  "customers",
  "vendors",
  "items",
  "open_invoices",
  "open_bills",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const SOURCE_SYSTEMS = ["xero", "quickbooks", "zoho", "wafeq", "generic"] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const normHeader = (h: string): string =>
  h
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, "");

type FieldAliases = Record<string, string[]>;

/** Canonical field -> header aliases (normalised), all systems merged; order = priority. */
export const FIELD_ALIASES: Record<ImportKind, FieldAliases> = {
  chart_of_accounts: {
    code: ["code", "accountcode", "account", "accountno", "accountnumber", "number"],
    name: ["name", "accountname", "fullname", "accountnameen", "nameen"],
    nameAr: ["namearabic", "accountnamearabic", "namear", "arabicname"],
    type: ["type", "accounttype", "detailtype", "category"],
    subType: ["subtype", "accountsubtype"],
    description: ["description", "accountdescription", "notes"],
  },
  trial_balance: {
    code: ["accountcode", "code", "accountno", "accountnumber", "account"],
    name: ["accountname", "name", "account", "fullname"],
    debit: ["debit", "debitytd", "debityeartodate", "debitbalance", "dr", "netdebit"],
    credit: ["credit", "creditytd", "credityeartodate", "creditbalance", "cr", "netcredit"],
    balance: ["balance", "netbalance", "closingbalance"],
  },
  customers: {
    name: ["contactname", "displayname", "customer", "customername", "name", "companyname"],
    email: ["emailaddress", "email", "emailid", "mainemail"],
    phone: ["phonenumber", "phone", "mobile", "mobilephone", "workphone"],
    trn: ["taxnumber", "taxregistrationnumber", "trn", "taxregno", "vatnumber", "taxid"],
    address: ["poaddressline1", "billingaddress", "address", "billingstreet", "addressline1"],
    city: ["pocity", "city", "billingcity"],
    country: ["pocountry", "country", "billingcountry"],
  },
  vendors: {
    name: [
      "contactname",
      "displayname",
      "vendor",
      "vendorname",
      "supplier",
      "suppliername",
      "name",
      "companyname",
    ],
    email: ["emailaddress", "email", "emailid"],
    phone: ["phonenumber", "phone", "mobile", "workphone"],
    trn: ["taxnumber", "taxregistrationnumber", "trn", "taxregno", "vatnumber", "taxid"],
    address: ["poaddressline1", "address", "billingaddress", "addressline1"],
    iban: ["iban", "bankaccountnumber"],
  },
  items: {
    name: ["itemname", "productservicename", "name", "item", "productname"],
    sku: ["itemcode", "sku", "code", "productcode"],
    salePrice: ["salesunitprice", "salesprice", "rate", "sellingprice", "price", "unitprice"],
    costPrice: ["purchasesunitprice", "cost", "purchaserate", "purchaseprice", "costprice"],
    description: ["salesdescription", "description", "salesdescriptionen"],
    type: ["type", "itemtype", "producttype"],
  },
  open_invoices: {
    number: ["invoicenumber", "num", "number", "invoiceno", "invoice"],
    date: ["invoicedate", "date", "issuedate", "transactiondate"],
    dueDate: ["duedate", "due"],
    contactName: ["contactname", "customer", "customername", "name"],
    total: ["total", "amount", "invoicetotal", "totalamount"],
    amountDue: ["amountdue", "openbalance", "balance", "balancedue", "due", "outstanding"],
    currency: ["currency", "currencycode"],
    exchangeRate: ["exchangerate", "currencyrate", "fxrate", "rate"],
  },
  open_bills: {
    number: ["billnumber", "invoicenumber", "num", "number", "billno", "reference"],
    date: ["billdate", "invoicedate", "date", "transactiondate"],
    dueDate: ["duedate", "due"],
    contactName: ["contactname", "vendor", "vendorname", "supplier", "suppliername", "name"],
    total: ["total", "amount", "billtotal", "totalamount"],
    amountDue: ["amountdue", "openbalance", "balance", "balancedue", "due", "outstanding"],
    currency: ["currency", "currencycode"],
    exchangeRate: ["exchangerate", "currencyrate", "fxrate", "rate"],
  },
};

/** Required canonical fields per kind (trial balance: debit/credit OR balance). */
export const REQUIRED_FIELDS: Record<ImportKind, string[]> = {
  chart_of_accounts: ["code", "name", "type"],
  trial_balance: ["code"],
  customers: ["name"],
  vendors: ["name"],
  items: ["name"],
  open_invoices: ["number", "date", "contactName", "total"],
  open_bills: ["number", "date", "contactName", "total"],
};

export interface ParsedFile {
  headers: string[];
  mapping: Record<string, string>; // canonical -> original header
  unmapped: string[];
  records: Array<Record<string, string>>; // canonical -> raw value
}

/** Parse CSV text and map headers onto canonical fields. */
export function parseImportCsv(kind: ImportKind, text: string): ParsedFile {
  const rows: string[][] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  // Report exports (trial balance) often start with title lines; the header row is the
  // first row that maps at least the required fields.
  const aliases = FIELD_ALIASES[kind];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const norm = rows[i].map(normHeader);
    const hits = REQUIRED_FIELDS[kind].every((f) => aliases[f].some((a) => norm.includes(a)));
    if (hits) {
      headerIdx = i;
      break;
    }
  }
  const headers = rows[headerIdx] ?? [];
  const norm = headers.map(normHeader);
  const mapping: Record<string, string> = {};
  const used = new Set<number>();
  for (const [field, list] of Object.entries(aliases)) {
    for (const alias of list) {
      const idx = norm.findIndex((h, i) => h === alias && !used.has(i));
      if (idx >= 0) {
        mapping[field] = headers[idx];
        used.add(idx);
        break;
      }
    }
  }
  const index = new Map(headers.map((h, i) => [h, i]));
  const records: Array<Record<string, string>> = [];
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row.some((c) => c && c.trim())) continue;
    const rec: Record<string, string> = {};
    for (const [field, header] of Object.entries(mapping))
      rec[field] = row[index.get(header)!] ?? "";
    records.push(rec);
  }
  const unmapped = headers.filter((_, i) => !used.has(i));
  return { headers, mapping, unmapped, records };
}

/** "1,234.50", "(1,234.50)", "AED 1234.5", "-12" -> fils (integer). null when blank/invalid. */
export function moneyToFils(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[A-Za-z\s,]/g, "").replace(/[^\d.-]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) return null; // more precision than fils
  const fils = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -fils : fils;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Dates as exported by the four systems: 2026-01-31, 31/01/2026 (Xero/Wafeq,
 * day first), 01/31/2026 (QuickBooks US, month first), 31 Jan 2026, 31-Jan-2026.
 */
export function parseImportDate(raw: string | undefined, system: SourceSystem): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const monthFirst = system === "quickbooks" ? a <= 12 : a <= 12 && b > 12;
    return monthFirst ? iso(y, a, b) : iso(y, b, a);
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface MappedAccountType {
  type: "asset" | "liability" | "equity" | "income" | "expense";
  subType: string;
}

/** Source account type -> internal type + sub type. */
export function mapAccountType(raw: string, accountName = ""): MappedAccountType | null {
  const t = raw.trim().toLowerCase();
  const n = accountName.trim().toLowerCase();
  // Xero exports the A/R and A/P control accounts with type "Current Asset" / "Current Liability".
  if (/^accounts receivable$|^trade debtors$/.test(n) && /asset/.test(t)) {
    return { type: "asset", subType: "receivable" };
  }
  if (/^accounts payable$|^trade creditors$/.test(n) && /liabilit/.test(t)) {
    return { type: "liability", subType: "payable" };
  }
  const table: Array<[RegExp, MappedAccountType]> = [
    [/^cash( on hand)?$|petty cash/, { type: "asset", subType: "cash" }],
    [/^bank|cash and cash equivalents|^cash/, { type: "asset", subType: "bank" }],
    [
      /accounts receivable|\(a\/r\)|^receivables?$|trade receivable|debtors/,
      { type: "asset", subType: "receivable" },
    ],
    [/inventory|stock/, { type: "asset", subType: "inventory" }],
    [
      /fixed asset|non-current asset|noncurrent asset|property|plant|equipment/,
      { type: "asset", subType: "fixed_asset" },
    ],
    [
      /prepayment|current asset|other asset|^asset/,
      { type: "asset", subType: "other_current_asset" },
    ],
    [
      /accounts payable|\(a\/p\)|^payables?$|trade payable|creditors/,
      { type: "liability", subType: "payable" },
    ],
    [
      /non-current liabilit|long term liabilit|long-term liabilit/,
      { type: "liability", subType: "long_term_liability" },
    ],
    [/liabilit|credit card|tax|vat|gst/, { type: "liability", subType: "current_liability" }],
    [/retained/, { type: "equity", subType: "retained_earnings" }],
    [/drawing|dividend/, { type: "equity", subType: "drawings" }],
    [/equity|capital/, { type: "equity", subType: "owner_equity" }],
    [
      /direct cost|cost of (goods|sales)|cogs|cost of revenue/,
      { type: "expense", subType: "cost_of_sales" },
    ],
    [/other income|other revenue|interest income/, { type: "income", subType: "other_income" }],
    [/revenue|sales|income/, { type: "income", subType: "operating_revenue" }],
    [/depreciation|amorti/, { type: "expense", subType: "depreciation" }],
    [/other expense/, { type: "expense", subType: "other_expense" }],
    [/expense|overhead|cost/, { type: "expense", subType: "operating_expense" }],
  ];
  for (const [rx, mapped] of table) if (rx.test(t)) return mapped;
  return null;
}

/** QuickBooks trial balances carry "1000 Cash" in one column; split the code off. */
export function splitCodeAndName(
  code: string,
  name: string | undefined
): { code: string; name: string } {
  const c = code.trim();
  // Xero report exports: "Bank Accounts (1020)".
  const paren = /^(.+?)\s*\(([\w.-]+)\)\s*$/.exec(c);
  if (paren && (!name || name.trim() === c)) return { code: paren[2], name: paren[1].trim() };
  const m = /^(\d[\w.-]*)\s+[-–:]?\s*(.+)$/.exec(c);
  if (m && (!name || name.trim() === c)) return { code: m[1], name: m[2] };
  return { code: c, name: (name ?? "").trim() };
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Template CSV (generic layout) for a kind. */
export function templateCsv(kind: ImportKind): string {
  const headers: Record<ImportKind, string[]> = {
    chart_of_accounts: ["Code", "Name", "Name (Arabic)", "Type", "Description"],
    trial_balance: ["Account Code", "Account Name", "Debit", "Credit"],
    customers: ["Name", "Email", "Phone", "TRN", "Address", "City", "Country"],
    vendors: ["Name", "Email", "Phone", "TRN", "Address", "IBAN"],
    items: ["Name", "SKU", "Sales Price", "Cost", "Description", "Type"],
    open_invoices: [
      "Invoice Number",
      "Invoice Date",
      "Due Date",
      "Customer",
      "Total",
      "Amount Due",
      "Currency",
    ],
    open_bills: [
      "Bill Number",
      "Bill Date",
      "Due Date",
      "Vendor",
      "Total",
      "Amount Due",
      "Currency",
    ],
  };
  return headers[kind].map(csvEscape).join(",") + "\n";
}
