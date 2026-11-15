import type { ExportData } from "./export";

export interface Vat201ExportReturn {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  notes?: string | null;
  box1aAbuDhabiAmount: number;
  box1aAbuDhabiVat: number;
  box1aAbuDhabiAdj: number;
  box1bDubaiAmount: number;
  box1bDubaiVat: number;
  box1bDubaiAdj: number;
  box1cSharjahAmount: number;
  box1cSharjahVat: number;
  box1cSharjahAdj: number;
  box1dAjmanAmount: number;
  box1dAjmanVat: number;
  box1dAjmanAdj: number;
  box1eUmmAlQuwainAmount: number;
  box1eUmmAlQuwainVat: number;
  box1eUmmAlQuwainAdj: number;
  box1fRasAlKhaimahAmount: number;
  box1fRasAlKhaimahVat: number;
  box1fRasAlKhaimahAdj: number;
  box1gFujairahAmount: number;
  box1gFujairahVat: number;
  box1gFujairahAdj: number;
  box2TouristRefundAmount: number;
  box2TouristRefundVat: number;
  box3ReverseChargeAmount: number;
  box3ReverseChargeVat: number;
  box4ZeroRatedAmount: number;
  box5ExemptAmount: number;
  box6ImportsAmount: number;
  box6ImportsVat: number;
  box7ImportsAdjAmount: number;
  box7ImportsAdjVat: number;
  box8TotalAmount: number;
  box8TotalVat: number;
  box8TotalAdj: number;
  box9ExpensesAmount: number;
  box9ExpensesVat: number;
  box9ExpensesAdj: number;
  box10ReverseChargeAmount: number;
  box10ReverseChargeVat: number;
  box11TotalAmount: number;
  box11TotalVat: number;
  box11TotalAdj: number;
  box12TotalDueTax: number;
  box13RecoverableTax: number;
  box14PayableTax: number;
  adjustmentAmount?: number | null;
  adjustmentReason?: string | null;
}

export interface Vat201ExportCompany {
  name?: string | null;
  nameAr?: string | null;
  trnVatNumber?: string | null;
}

type Vat201Key = keyof Vat201ExportReturn;

interface Vat201RowDefinition {
  section: string;
  box: string;
  label: string;
  amountKey?: Vat201Key;
  vatKey?: Vat201Key;
  adjustmentKey?: Vat201Key;
}

const VAT201_ROWS: Vat201RowDefinition[] = [
  {
    section: "VAT on sales and all other outputs",
    box: "1a",
    label: "Standard rated supplies in Abu Dhabi",
    amountKey: "box1aAbuDhabiAmount",
    vatKey: "box1aAbuDhabiVat",
    adjustmentKey: "box1aAbuDhabiAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1b",
    label: "Standard rated supplies in Dubai",
    amountKey: "box1bDubaiAmount",
    vatKey: "box1bDubaiVat",
    adjustmentKey: "box1bDubaiAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1c",
    label: "Standard rated supplies in Sharjah",
    amountKey: "box1cSharjahAmount",
    vatKey: "box1cSharjahVat",
    adjustmentKey: "box1cSharjahAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1d",
    label: "Standard rated supplies in Ajman",
    amountKey: "box1dAjmanAmount",
    vatKey: "box1dAjmanVat",
    adjustmentKey: "box1dAjmanAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1e",
    label: "Standard rated supplies in Umm Al Quwain",
    amountKey: "box1eUmmAlQuwainAmount",
    vatKey: "box1eUmmAlQuwainVat",
    adjustmentKey: "box1eUmmAlQuwainAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1f",
    label: "Standard rated supplies in Ras Al Khaimah",
    amountKey: "box1fRasAlKhaimahAmount",
    vatKey: "box1fRasAlKhaimahVat",
    adjustmentKey: "box1fRasAlKhaimahAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "1g",
    label: "Standard rated supplies in Fujairah",
    amountKey: "box1gFujairahAmount",
    vatKey: "box1gFujairahVat",
    adjustmentKey: "box1gFujairahAdj",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "2",
    label: "Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme",
    amountKey: "box2TouristRefundAmount",
    vatKey: "box2TouristRefundVat",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "3",
    label: "Supplies subject to the reverse charge provisions",
    amountKey: "box3ReverseChargeAmount",
    vatKey: "box3ReverseChargeVat",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "4",
    label: "Zero-rated supplies",
    amountKey: "box4ZeroRatedAmount",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "5",
    label: "Exempt supplies",
    amountKey: "box5ExemptAmount",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "6",
    label: "Goods imported into the UAE",
    amountKey: "box6ImportsAmount",
    vatKey: "box6ImportsVat",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "7",
    label: "Adjustments to goods imported into the UAE",
    amountKey: "box7ImportsAdjAmount",
    vatKey: "box7ImportsAdjVat",
  },
  {
    section: "VAT on sales and all other outputs",
    box: "8",
    label: "Total output tax",
    amountKey: "box8TotalAmount",
    vatKey: "box8TotalVat",
    adjustmentKey: "box8TotalAdj",
  },
  {
    section: "VAT on expenses and all other inputs",
    box: "9",
    label: "Standard rated expenses",
    amountKey: "box9ExpensesAmount",
    vatKey: "box9ExpensesVat",
    adjustmentKey: "box9ExpensesAdj",
  },
  {
    section: "VAT on expenses and all other inputs",
    box: "10",
    label: "Supplies subject to reverse charge provisions",
    amountKey: "box10ReverseChargeAmount",
    vatKey: "box10ReverseChargeVat",
  },
  {
    section: "VAT on expenses and all other inputs",
    box: "11",
    label: "Total recoverable tax",
    amountKey: "box11TotalAmount",
    vatKey: "box11TotalVat",
    adjustmentKey: "box11TotalAdj",
  },
  {
    section: "Net VAT due",
    box: "12",
    label: "Total value of due tax for the period",
    vatKey: "box12TotalDueTax",
  },
  {
    section: "Net VAT due",
    box: "13",
    label: "Total value of recoverable tax for the period",
    vatKey: "box13RecoverableTax",
  },
  {
    section: "Net VAT due",
    box: "14",
    label: "Payable tax for the period",
    vatKey: "box14PayableTax",
  },
];

function numberValue(vatReturn: Vat201ExportReturn, key?: Vat201Key): number | null {
  if (!key) return null;
  const value = vatReturn[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function vat201ExportFilename(
  vatReturn: Vat201ExportReturn,
  company: Vat201ExportCompany | null | undefined
): string {
  const companySlug = slug(company?.name || "company") || "company";
  const periodEnd = isoDate(vatReturn.periodEnd) || "period";
  return `vat201-${companySlug}-${periodEnd}`;
}

export function prepareVat201ForExport(
  vatReturn: Vat201ExportReturn,
  company: Vat201ExportCompany | null | undefined
): ExportData[] {
  const periodStart = isoDate(vatReturn.periodStart);
  const periodEnd = isoDate(vatReturn.periodEnd);
  const dueDate = isoDate(vatReturn.dueDate);
  const status = vatReturn.status.replace(/_/g, " ");

  const rows = VAT201_ROWS.map((row) => ({
    section: row.section,
    box: row.box,
    label: row.label,
    amount: numberValue(vatReturn, row.amountKey),
    vat: numberValue(vatReturn, row.vatKey),
    adjustment: numberValue(vatReturn, row.adjustmentKey),
  }));

  return [
    {
      sheetName: "VAT 201 Summary",
      columns: [
        { header: "Section", key: "section", width: 34 },
        { header: "Box", key: "box", width: 10 },
        { header: "Label", key: "label", width: 64 },
        { header: "Amount (AED)", key: "amount", width: 18 },
        { header: "VAT (AED)", key: "vat", width: 18 },
        { header: "Adjustment (AED)", key: "adjustment", width: 18 },
      ],
      rows,
    },
    {
      sheetName: "Filing Notes",
      columns: [
        { header: "Field", key: "field", width: 30 },
        { header: "Value", key: "value", width: 72 },
      ],
      rows: [
        { field: "Company", value: company?.name || "" },
        { field: "Arabic name", value: company?.nameAr || "" },
        { field: "TRN", value: company?.trnVatNumber || "" },
        { field: "Period start", value: periodStart },
        { field: "Period end", value: periodEnd },
        { field: "Due date", value: dueDate },
        { field: "Status", value: status },
        { field: "Net VAT payable", value: numberValue(vatReturn, "box14PayableTax") },
        { field: "Adjustment amount", value: vatReturn.adjustmentAmount ?? "" },
        { field: "Adjustment reason", value: vatReturn.adjustmentReason ?? "" },
        { field: "Notes", value: vatReturn.notes ?? "" },
        {
          field: "Submission note",
          value:
            "Support export only. Review figures and file through the official FTA/EmaraTax channel.",
        },
      ],
    },
  ];
}
