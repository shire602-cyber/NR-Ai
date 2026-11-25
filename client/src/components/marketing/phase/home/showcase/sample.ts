/**
 * Sample data for the homepage feature showcase. Everything here is fictional and shown under a
 * "Sample data" label. Money is integer fils. Mock-product labels are `{en, ar}` pairs so the
 * mock UI follows the page language; page copy lives in the marketing catalog.
 */
import type { SiteLocale } from "../../routes";

export type Pair = Record<SiteLocale, string>;

export const pick = (pair: Pair, locale: SiteLocale) => pair[locale];

/* ---------- 1. Receipt ---------- */
export const RECEIPT_LINES: readonly { id: string; label: Pair; fils: number }[] = [
  { id: "r1", label: { en: "A4 paper x 5", ar: "ورق A4 × 5" }, fils: 17_500 },
  { id: "r2", label: { en: "Printer toner", ar: "حبر طابعة" }, fils: 7_500 },
];
export const RECEIPT_MERCHANT: Pair = { en: "Gulf Stationery Trading", ar: "الخليج للقرطاسية" };
export const RECEIPT_DATE = "17/11/2026";
export const RECEIPT_SUBTOTAL_FILS = 25_000;
export const RECEIPT_VAT_FILS = 1_250;
export const RECEIPT_TOTAL_FILS = 26_250;
export const RECEIPT_FIELDS: readonly { id: string; label: Pair; value: Pair }[] = [
  { id: "merchant", label: { en: "Merchant", ar: "المورّد" }, value: RECEIPT_MERCHANT },
  {
    id: "date",
    label: { en: "Date", ar: "التاريخ" },
    value: { en: RECEIPT_DATE, ar: RECEIPT_DATE },
  },
  {
    id: "category",
    label: { en: "Category", ar: "التصنيف" },
    value: { en: "Office supplies", ar: "مستلزمات مكتبية" },
  },
];
export const RECEIPT_LABELS = {
  subtotal: { en: "Subtotal", ar: "قبل الضريبة" },
  vat: { en: "VAT 5% (recoverable)", ar: "ضريبة 5% (قابلة للاسترداد)" },
  total: { en: "Total", ar: "الإجمالي" },
  status: { en: "Ready to review", ar: "جاهز للمراجعة" },
} as const satisfies Record<string, Pair>;

/* ---------- 2. Bilingual invoice ---------- */
export const INVOICE_SAMPLE = {
  number: "INV-2001",
  customer: { en: "Al Noor Retail FZCO", ar: "النور للتجزئة ش.م.ح." } as Pair,
  lines: [
    {
      id: "l1",
      item: { en: "Design consultation", ar: "استشارة تصميم" } as Pair,
      qty: 4,
      unitFils: 45_000,
    },
    {
      id: "l2",
      item: { en: "Office fit-out supplies", ar: "مستلزمات تجهيز المكتب" } as Pair,
      qty: 10,
      unitFils: 12_000,
    },
  ],
} as const;
export const INVOICE_LABELS = {
  title: { en: "Tax invoice", ar: "فاتورة ضريبية" },
  billTo: { en: "Bill to", ar: "فاتورة إلى" },
  item: { en: "Item", ar: "البند" },
  qty: { en: "Qty", ar: "الكمية" },
  amount: { en: "Amount", ar: "المبلغ" },
  subtotal: { en: "Subtotal", ar: "المجموع قبل الضريبة" },
  vat: { en: "VAT 5%", ar: "ضريبة القيمة المضافة 5%" },
  total: { en: "Total (AED)", ar: "الإجمالي (درهم)" },
} as const satisfies Record<string, Pair>;

/* ---------- 3. VAT 201 ---------- */
export const VAT_BOX_LABELS: Record<"box1b" | "box4" | "box8" | "box9" | "box14", Pair> = {
  box1b: { en: "1b  Standard-rated sales", ar: "1ب  مبيعات بالنسبة الأساسية" },
  box4: { en: "4  Zero-rated sales", ar: "4  مبيعات بنسبة الصفر" },
  box8: { en: "8  Total sales", ar: "8  إجمالي المبيعات" },
  box9: { en: "9  Standard-rated expenses", ar: "9  مصروفات بالنسبة الأساسية" },
  box14: { en: "14  VAT payable", ar: "14  الضريبة المستحقة" },
};
export const VAT_HEADINGS = {
  amount: { en: "Amount", ar: "المبلغ" },
  vat: { en: "VAT", ar: "الضريبة" },
  review: { en: "Prepare and review in Muhasib", ar: "الإعداد والمراجعة في محاسب" },
  submit: { en: "Submit in EmaraTax", ar: "التقديم عبر EmaraTax" },
  period: { en: "Q4 2026", ar: "الربع الرابع 2026" },
} as const satisfies Record<string, Pair>;

/* ---------- 4. Bank CSV ---------- */
export const BANK_LABELS = {
  file: { en: "bank-statement.csv", ar: "bank-statement.csv" },
  csv: { en: "Imported from CSV", ar: "مستورد من ملف CSV" },
  matched: { en: "Matched", ar: "مطابَق" },
  review: { en: "Needs review", ar: "بحاجة إلى مراجعة" },
} as const satisfies Record<string, Pair>;
export const BANK_SAMPLE: readonly {
  id: string;
  date: string;
  text: Pair;
  amountFils: number;
  match: Pair | null;
}[] = [
  {
    id: "b1",
    date: "20/11",
    text: { en: "Al Noor Retail FZCO", ar: "النور للتجزئة" },
    amountFils: 315_000,
    match: { en: "INV-2001", ar: "INV-2001" },
  },
  {
    id: "b2",
    date: "19/11",
    text: { en: "Dhow Logistics LLC", ar: "الداو للخدمات اللوجستية" },
    amountFils: 840_000,
    match: { en: "INV-2002", ar: "INV-2002" },
  },
  {
    id: "b3",
    date: "18/11",
    text: { en: "Etisalat UAE", ar: "اتصالات الإمارات" },
    amountFils: -126_000,
    match: { en: "BILL-118", ar: "BILL-118" },
  },
  {
    id: "b4",
    date: "16/11",
    text: { en: "Transfer ref 88213", ar: "تحويل مرجع 88213" },
    amountFils: -50_000,
    match: null,
  },
];

/* ---------- 5. Payroll and WPS ---------- */
export const PAYROLL_LABELS = {
  run: { en: "Payroll run, November 2026", ar: "مسيّر الرواتب، نوفمبر 2026" },
  employee: { en: "Employee", ar: "الموظف" },
  net: { en: "Net pay", ar: "صافي الراتب" },
  file: { en: "WPS SIF file", ar: "ملف SIF لنظام حماية الأجور" },
  ready: { en: "Ready to download", ar: "جاهز للتنزيل" },
  edr: { en: "Employee record", ar: "سجل موظف" },
  scr: { en: "Salary control record", ar: "سجل ضبط الرواتب" },
  total: { en: "Total", ar: "الإجمالي" },
} as const satisfies Record<string, Pair>;
export const PAYROLL_EMPLOYEES: readonly { id: string; name: Pair; netFils: number }[] = [
  { id: "e1", name: { en: "Employee A", ar: "الموظف أ" }, netFils: 650_000 },
  { id: "e2", name: { en: "Employee B", ar: "الموظف ب" }, netFils: 480_000 },
  { id: "e3", name: { en: "Employee C", ar: "الموظف ج" }, netFils: 395_000 },
];

/* ---------- 6. Reports ---------- */
export const REPORT_TABS: readonly { id: string; label: Pair }[] = [
  { id: "pl", label: { en: "Profit and loss", ar: "الأرباح والخسائر" } },
  { id: "bs", label: { en: "Balance sheet", ar: "الميزانية" } },
  { id: "cf", label: { en: "Cash flow", ar: "التدفق النقدي" } },
  { id: "ag", label: { en: "Ageing", ar: "أعمار الديون" } },
];
export const REPORT_LABELS = {
  revenue: { en: "Revenue", ar: "الإيرادات" },
  expenses: { en: "Expenses", ar: "المصروفات" },
  ageing: { en: "Receivables ageing", ar: "أعمار الذمم المدينة" },
} as const satisfies Record<string, Pair>;
/** Six months, AED thousands. */
export const REPORT_REVENUE = [52, 58, 55, 66, 72, 81] as const;
export const REPORT_EXPENSES = [41, 44, 46, 47, 52, 55] as const;
export const REPORT_AGEING: readonly { id: string; label: Pair; share: number }[] = [
  { id: "a0", label: { en: "Current", ar: "حالي" }, share: 62 },
  { id: "a1", label: { en: "1-30", ar: "1-30" }, share: 24 },
  { id: "a2", label: { en: "31-60", ar: "31-60" }, share: 10 },
  { id: "a3", label: { en: "60+", ar: "+60" }, share: 4 },
];

/* ---------- 7. Inventory and cash sales ---------- */
export const STOCK_LABELS = {
  taxSeries: { en: "Tax invoices", ar: "الفواتير الضريبية" },
  cashSeries: { en: "Cash sales", ar: "المبيعات النقدية" },
  next: { en: "Next number", ar: "الرقم التالي" },
  item: { en: "Item", ar: "الصنف" },
  onHand: { en: "On hand", ar: "المتوفر" },
  value: { en: "Value", ar: "القيمة" },
} as const satisfies Record<string, Pair>;
export const STOCK_SERIES = [
  { id: "tax", label: STOCK_LABELS.taxSeries, numbers: ["INV-2001", "INV-2002", "INV-2003"] },
  { id: "cash", label: STOCK_LABELS.cashSeries, numbers: ["CS-0001", "CS-0002", "CS-0003"] },
] as const;
export const STOCK_ITEMS: readonly { id: string; name: Pair; qty: number; valueFils: number }[] = [
  {
    id: "s1",
    name: { en: "Copy paper, 500 sheets", ar: "ورق تصوير، 500 ورقة" },
    qty: 120,
    valueFils: 360_000,
  },
  { id: "s2", name: { en: "Toner cartridge", ar: "خرطوشة حبر" }, qty: 14, valueFils: 210_000 },
  { id: "s3", name: { en: "Desk organiser", ar: "منظّم مكتب" }, qty: 36, valueFils: 90_000 },
];

/* ---------- Migration steps ---------- */
export const MIGRATION_SAMPLE = {
  files: ["customers.csv", "suppliers.csv", "balances.csv"],
  mapping: [
    {
      id: "m1",
      from: { en: "Client name", ar: "اسم العميل" } as Pair,
      to: { en: "Customer", ar: "العميل" } as Pair,
    },
    {
      id: "m2",
      from: { en: "Tax no.", ar: "الرقم الضريبي" } as Pair,
      to: { en: "TRN", ar: "TRN" } as Pair,
    },
    {
      id: "m3",
      from: { en: "Balance", ar: "الرصيد" } as Pair,
      to: { en: "Opening balance", ar: "الرصيد الافتتاحي" } as Pair,
    },
  ],
  check: {
    debit: { en: "Debits", ar: "المدين" } as Pair,
    credit: { en: "Credits", ar: "الدائن" } as Pair,
    balanced: { en: "Balanced", ar: "متوازن" } as Pair,
    fils: 1_250_000,
  },
} as const;
