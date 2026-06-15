import ExcelJS from "exceljs";
import { apiRequest } from "./queryClient";
import { apiUrl } from "./api";
import { getAuthHeaders } from "./auth";
import { withCsrfHeader } from "./csrf";

// Shape of one row in the OCR-format Excel export. Matches the server-side
// schema in `server/services/excel-export.service.ts` so the request body and
// the workbook columns stay in sync.
export interface OcrExportRow {
  date: string | null;
  vendor: string | null;
  invoiceNumber: string | null;
  amount: number | string | null;
  vat: number | string | null;
  currency?: string | null;
}

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExportData {
  columns: ExportColumn[];
  rows: Record<string, any>[];
  sheetName?: string;
}

export async function exportToExcel(data: ExportData[], filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();

  data.forEach((sheet) => {
    const sheetName = (sheet.sheetName || "Sheet1").substring(0, 31);
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.columns = sheet.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width || 15,
    }));
    worksheet.getRow(1).font = { bold: true };
    sheet.rows.forEach((row) => worksheet.addRow(row));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  await triggerBlobDownload(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${filename}.xlsx`
  );
}

export async function exportToGoogleSheets(
  data: ExportData[],
  title: string,
  companyId: string
): Promise<{ success: boolean; spreadsheetUrl?: string; error?: string }> {
  try {
    const sheetsData = data.map((sheet) => ({
      name: sheet.sheetName || "Sheet1",
      headers: sheet.columns.map((col) => col.header),
      rows: sheet.rows.map((row) =>
        sheet.columns.map((col) => {
          const value = row[col.key];
          return value !== undefined && value !== null ? String(value) : "";
        })
      ),
    }));

    const response = await apiRequest("POST", `/api/integrations/google-sheets/export/custom`, {
      companyId,
      title,
      sheets: sheetsData,
    });

    const result = await response.json();
    return {
      success: true,
      spreadsheetUrl: result.url,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to export to Google Sheets",
    };
  }
}

// Pull the filename out of a Content-Disposition header. Falls back to the
// supplied default if the header is missing or malformed.
function filenameFromContentDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match ? decodeURIComponent(match[1]) : fallback;
}

async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function postForBlob(
  url: string,
  body: unknown,
  fallbackFilename: string
): Promise<{ blob: Blob; filename: string }> {
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };
  if (!headers.Authorization) {
    headers = await withCsrfHeader("POST", headers);
  }

  const res = await fetch(apiUrl(url), {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const json = await res.json();
      message = json.message || json.error || message;
    } catch {
      /* binary body — keep status */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    fallbackFilename
  );
  return { blob, filename };
}

async function getForBlob(
  url: string,
  fallbackFilename: string
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(apiUrl(url), {
    method: "GET",
    credentials: "include",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const json = await res.json();
      message = json.message || json.error || message;
    } catch {
      /* binary body — keep status */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(
    res.headers.get("Content-Disposition"),
    fallbackFilename
  );
  return { blob, filename };
}

// Download an .xlsx file containing the supplied OCR-extracted rows. Uses the
// server-side workbook builder so formatting (bold headers, currency cells,
// totals row) stays consistent across in-flight and bulk exports.
export async function downloadOcrExcel(
  rows: OcrExportRow[],
  options: { filename?: string } = {}
): Promise<void> {
  const { blob, filename } = await postForBlob(
    "/api/ocr/export-excel",
    { rows, filename: options.filename },
    "muhasib-ocr-receipts.xlsx"
  );
  await triggerBlobDownload(blob, filename);
}

// Bulk-export saved receipts for a company as .xlsx via the server. Pass
// `ids` to filter to a subset, or omit it to export every saved receipt.
export async function downloadReceiptsExcel(
  companyId: string,
  options: { ids?: string[] } = {}
): Promise<void> {
  const { blob, filename } = await postForBlob(
    `/api/companies/${companyId}/receipts/export-excel`,
    options.ids ? { ids: options.ids } : {},
    "muhasib-receipts.xlsx"
  );
  await triggerBlobDownload(blob, filename);
}

export async function downloadReportPackRunExcel(companyId: string, runId: string): Promise<void> {
  const { blob, filename } = await getForBlob(
    `/api/companies/${companyId}/report-pack-runs/${encodeURIComponent(runId)}/export`,
    "report-pack-run.xlsx"
  );
  await triggerBlobDownload(blob, filename);
}

// Convert the in-flight OCR data shape used by the Receipts page into the
// row shape expected by the server. The Amount column is tax-EXCLUSIVE: prefer
// the OCR-extracted subtotal, otherwise derive it from total - vatAmount.
export function ocrDataToExportRow(data: {
  merchant?: string;
  date?: string;
  invoiceNumber?: string | null;
  total?: number;
  subtotal?: number;
  vatAmount?: number;
  currency?: string;
}): OcrExportRow {
  let amount: number | null = null;
  if (typeof data.subtotal === "number" && Number.isFinite(data.subtotal)) {
    amount = data.subtotal;
  } else if (
    typeof data.total === "number" &&
    Number.isFinite(data.total) &&
    typeof data.vatAmount === "number" &&
    Number.isFinite(data.vatAmount)
  ) {
    amount = parseFloat((data.total - data.vatAmount).toFixed(2));
  } else if (typeof data.total === "number" && Number.isFinite(data.total)) {
    amount = data.total;
  }

  return {
    date: data.date ?? null,
    vendor: data.merchant ?? null,
    invoiceNumber: data.invoiceNumber ?? null,
    amount,
    vat: data.vatAmount ?? null,
    currency: data.currency ?? "AED",
  };
}

export function formatDateForExport(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatCurrencyForExport(
  amount: number | null | undefined,
  currency = "AED"
): string {
  if (amount === null || amount === undefined) return "";
  return `${currency} ${amount.toFixed(2)}`;
}

export function prepareInvoicesForExport(invoices: any[], _locale: string = "en"): ExportData {
  return {
    sheetName: "Invoices",
    columns: [
      { header: "Invoice #", key: "number", width: 15 },
      { header: "Date", key: "date", width: 12 },
      { header: "Customer", key: "customerName", width: 25 },
      { header: "Customer TRN", key: "customerTrn", width: 18 },
      { header: "Subtotal", key: "subtotal", width: 15 },
      { header: "VAT Amount", key: "vatAmount", width: 15 },
      { header: "Total", key: "total", width: 15 },
      { header: "Status", key: "status", width: 12 },
    ],
    rows: invoices.map((inv) => ({
      number: inv.number,
      date: formatDateForExport(inv.date),
      customerName: inv.customerName,
      customerTrn: inv.customerTrn || "",
      subtotal: inv.subtotal?.toFixed(2) || "0.00",
      vatAmount: inv.vatAmount?.toFixed(2) || "0.00",
      total: inv.total?.toFixed(2) || "0.00",
      status: inv.status,
    })),
  };
}

export function prepareReceiptsForExport(receipts: any[], _locale: string = "en"): ExportData {
  return {
    sheetName: "Expenses",
    columns: [
      { header: "Date", key: "date", width: 12 },
      { header: "Merchant", key: "merchant", width: 25 },
      { header: "Category", key: "category", width: 18 },
      { header: "Amount", key: "amount", width: 15 },
      { header: "VAT Amount", key: "vatAmount", width: 15 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Status", key: "status", width: 12 },
    ],
    rows: receipts.map((r) => ({
      date: formatDateForExport(r.date),
      merchant: r.merchant || "",
      category: r.category || "",
      amount: r.amount?.toFixed(2) || "0.00",
      vatAmount: r.vatAmount?.toFixed(2) || "0.00",
      currency: r.currency || "AED",
      status: r.postedToJournal ? "Posted" : "Pending",
    })),
  };
}

export function prepareProfitLossForExport(profitLoss: any): ExportData {
  const rows: any[] = [];

  rows.push({ account: "REVENUE", code: "", amount: "" });
  profitLoss?.revenue?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || "",
      amount: item.amount?.toFixed(2) || "0.00",
    });
  });
  rows.push({
    account: "Total Revenue",
    code: "",
    amount: profitLoss?.totalRevenue?.toFixed(2) || "0.00",
  });

  rows.push({ account: "", code: "", amount: "" });
  rows.push({ account: "EXPENSES", code: "", amount: "" });
  profitLoss?.expenses?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || "",
      amount: item.amount?.toFixed(2) || "0.00",
    });
  });
  rows.push({
    account: "Total Expenses",
    code: "",
    amount: profitLoss?.totalExpenses?.toFixed(2) || "0.00",
  });

  rows.push({ account: "", code: "", amount: "" });
  rows.push({
    account: "NET PROFIT",
    code: "",
    amount: profitLoss?.netProfit?.toFixed(2) || "0.00",
  });

  return {
    sheetName: "Profit & Loss",
    columns: [
      { header: "Account", key: "account", width: 30 },
      { header: "Code", key: "code", width: 10 },
      { header: "Amount (AED)", key: "amount", width: 15 },
    ],
    rows,
  };
}

export function prepareBalanceSheetForExport(balanceSheet: any): ExportData {
  const rows: any[] = [];

  rows.push({ account: "ASSETS", code: "", amount: "" });
  balanceSheet?.assets?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || "",
      amount: item.amount?.toFixed(2) || "0.00",
    });
  });
  rows.push({
    account: "Total Assets",
    code: "",
    amount: balanceSheet?.totalAssets?.toFixed(2) || "0.00",
  });

  rows.push({ account: "", code: "", amount: "" });
  rows.push({ account: "LIABILITIES", code: "", amount: "" });
  balanceSheet?.liabilities?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || "",
      amount: item.amount?.toFixed(2) || "0.00",
    });
  });
  rows.push({
    account: "Total Liabilities",
    code: "",
    amount: balanceSheet?.totalLiabilities?.toFixed(2) || "0.00",
  });

  rows.push({ account: "", code: "", amount: "" });
  rows.push({ account: "EQUITY", code: "", amount: "" });
  balanceSheet?.equity?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || "",
      amount: item.amount?.toFixed(2) || "0.00",
    });
  });
  rows.push({
    account: "Total Equity",
    code: "",
    amount: balanceSheet?.totalEquity?.toFixed(2) || "0.00",
  });

  return {
    sheetName: "Balance Sheet",
    columns: [
      { header: "Account", key: "account", width: 30 },
      { header: "Code", key: "code", width: 10 },
      { header: "Amount (AED)", key: "amount", width: 15 },
    ],
    rows,
  };
}

export function prepareVATSummaryForExport(vatSummary: any): ExportData {
  return {
    sheetName: "VAT Summary",
    columns: [
      { header: "Description", key: "description", width: 30 },
      { header: "Amount (AED)", key: "amount", width: 15 },
    ],
    rows: [
      { description: "Period", amount: vatSummary?.period || "" },
      { description: "", amount: "" },
      { description: "Sales (Excl. VAT)", amount: vatSummary?.salesSubtotal?.toFixed(2) || "0.00" },
      { description: "Output VAT (5%)", amount: vatSummary?.salesVAT?.toFixed(2) || "0.00" },
      { description: "", amount: "" },
      {
        description: "Purchases (Excl. VAT)",
        amount: vatSummary?.purchasesSubtotal?.toFixed(2) || "0.00",
      },
      { description: "Input VAT (5%)", amount: vatSummary?.purchasesVAT?.toFixed(2) || "0.00" },
      { description: "", amount: "" },
      { description: "Net VAT Payable", amount: vatSummary?.netVATPayable?.toFixed(2) || "0.00" },
    ],
  };
}

function amountForExport(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function prepareVAT201ReturnForExport(vatReturn: any): ExportData[] {
  const period =
    vatReturn?.periodStart && vatReturn?.periodEnd
      ? `${formatDateForExport(vatReturn.periodStart)} - ${formatDateForExport(vatReturn.periodEnd)}`
      : "";

  const boxes = [
    {
      box: "1a",
      description: "Abu Dhabi standard-rated supplies",
      amount: vatReturn?.box1aAbuDhabiAmount,
      vat: vatReturn?.box1aAbuDhabiVat,
      adjustment: vatReturn?.box1aAbuDhabiAdj,
    },
    {
      box: "1b",
      description: "Dubai standard-rated supplies",
      amount: vatReturn?.box1bDubaiAmount,
      vat: vatReturn?.box1bDubaiVat,
      adjustment: vatReturn?.box1bDubaiAdj,
    },
    {
      box: "1c",
      description: "Sharjah standard-rated supplies",
      amount: vatReturn?.box1cSharjahAmount,
      vat: vatReturn?.box1cSharjahVat,
      adjustment: vatReturn?.box1cSharjahAdj,
    },
    {
      box: "1d",
      description: "Ajman standard-rated supplies",
      amount: vatReturn?.box1dAjmanAmount,
      vat: vatReturn?.box1dAjmanVat,
      adjustment: vatReturn?.box1dAjmanAdj,
    },
    {
      box: "1e",
      description: "Umm Al Quwain standard-rated supplies",
      amount: vatReturn?.box1eUmmAlQuwainAmount,
      vat: vatReturn?.box1eUmmAlQuwainVat,
      adjustment: vatReturn?.box1eUmmAlQuwainAdj,
    },
    {
      box: "1f",
      description: "Ras Al Khaimah standard-rated supplies",
      amount: vatReturn?.box1fRasAlKhaimahAmount,
      vat: vatReturn?.box1fRasAlKhaimahVat,
      adjustment: vatReturn?.box1fRasAlKhaimahAdj,
    },
    {
      box: "1g",
      description: "Fujairah standard-rated supplies",
      amount: vatReturn?.box1gFujairahAmount,
      vat: vatReturn?.box1gFujairahVat,
      adjustment: vatReturn?.box1gFujairahAdj,
    },
    {
      box: "2",
      description: "Tax refunds provided to tourists",
      amount: vatReturn?.box2TouristRefundAmount,
      vat: vatReturn?.box2TouristRefundVat,
      adjustment: 0,
    },
    {
      box: "3",
      description: "Supplies subject to reverse charge",
      amount: vatReturn?.box3ReverseChargeAmount,
      vat: vatReturn?.box3ReverseChargeVat,
      adjustment: 0,
    },
    {
      box: "4",
      description: "Zero-rated supplies",
      amount: vatReturn?.box4ZeroRatedAmount,
      vat: 0,
      adjustment: 0,
    },
    {
      box: "5",
      description: "Exempt supplies",
      amount: vatReturn?.box5ExemptAmount,
      vat: 0,
      adjustment: 0,
    },
    {
      box: "6",
      description: "Goods imported into the UAE",
      amount: vatReturn?.box6ImportsAmount,
      vat: vatReturn?.box6ImportsVat,
      adjustment: 0,
    },
    {
      box: "7",
      description: "Import adjustments",
      amount: vatReturn?.box7ImportsAdjAmount,
      vat: vatReturn?.box7ImportsAdjVat,
      adjustment: 0,
    },
    {
      box: "8",
      description: "Total tax due",
      amount: vatReturn?.box8TotalAmount,
      vat: vatReturn?.box8TotalVat,
      adjustment: vatReturn?.box8TotalAdj,
    },
    {
      box: "9",
      description: "Standard-rated expenses",
      amount: vatReturn?.box9ExpensesAmount,
      vat: vatReturn?.box9ExpensesVat,
      adjustment: vatReturn?.box9ExpensesAdj,
    },
    {
      box: "10",
      description: "Input tax subject to reverse charge",
      amount: vatReturn?.box10ReverseChargeAmount,
      vat: vatReturn?.box10ReverseChargeVat,
      adjustment: 0,
    },
    {
      box: "11",
      description: "Total recoverable tax",
      amount: vatReturn?.box11TotalAmount,
      vat: vatReturn?.box11TotalVat,
      adjustment: vatReturn?.box11TotalAdj,
    },
    {
      box: "12",
      description: "Total due tax for the period",
      amount: vatReturn?.box12TotalDueTax,
      vat: "",
      adjustment: "",
    },
    {
      box: "13",
      description: "Total recoverable tax for the period",
      amount: vatReturn?.box13RecoverableTax,
      vat: "",
      adjustment: "",
    },
    {
      box: "14",
      description: "Payable tax or refundable tax",
      amount: vatReturn?.box14PayableTax,
      vat: "",
      adjustment: "",
    },
  ];

  return [
    {
      sheetName: "VAT 201 Summary",
      columns: [
        { header: "Field", key: "field", width: 34 },
        { header: "Value", key: "value", width: 32 },
      ],
      rows: [
        { field: "Period", value: period },
        { field: "Due Date", value: formatDateForExport(vatReturn?.dueDate) },
        { field: "Status", value: vatReturn?.status || "" },
        { field: "FTA Reference", value: vatReturn?.ftaReferenceNumber || "" },
        { field: "Total Output Tax", value: amountForExport(vatReturn?.box12TotalDueTax) },
        { field: "Recoverable Input Tax", value: amountForExport(vatReturn?.box13RecoverableTax) },
        {
          field: "Net VAT Payable / Refundable",
          value: amountForExport(vatReturn?.box14PayableTax),
        },
        { field: "Prepared At", value: formatDateForExport(new Date()) },
        {
          field: "Review Note",
          value: "Review source documents and portal values before filing.",
        },
      ],
    },
    {
      sheetName: "VAT 201 Boxes",
      columns: [
        { header: "Box", key: "box", width: 8 },
        { header: "Description", key: "description", width: 42 },
        { header: "Amount (AED)", key: "amount", width: 16 },
        { header: "VAT (AED)", key: "vat", width: 16 },
        { header: "Adjustment (AED)", key: "adjustment", width: 18 },
      ],
      rows: boxes.map((box) => ({
        box: box.box,
        description: box.description,
        amount: box.amount === "" ? "" : amountForExport(box.amount),
        vat: box.vat === "" ? "" : amountForExport(box.vat),
        adjustment: box.adjustment === "" ? "" : amountForExport(box.adjustment),
      })),
    },
    {
      sheetName: "Review Checklist",
      columns: [
        { header: "Check", key: "check", width: 44 },
        { header: "Status", key: "status", width: 18 },
      ],
      rows: [
        { check: "TRN and legal name reviewed", status: "" },
        { check: "Sales and credit notes reviewed", status: "" },
        { check: "Expense VAT recoverability reviewed", status: "" },
        { check: "Reverse charge and import boxes reviewed", status: "" },
        { check: "Portal filing completed externally where required", status: "" },
      ],
    },
  ];
}

export function prepareCorporateTaxReturnForExport(taxReturn: any): ExportData[] {
  const periodStart = taxReturn?.taxPeriodStart ?? taxReturn?.periodStart;
  const periodEnd = taxReturn?.taxPeriodEnd ?? taxReturn?.periodEnd;
  const taxRate = Number(taxReturn?.taxRate ?? 0.09);
  const taxableAmount =
    taxReturn?.taxableAmount ??
    Math.max(0, Number(taxReturn?.taxableIncome ?? 0) - Number(taxReturn?.exemptionThreshold ?? 0));

  return [
    {
      sheetName: "Corporate Tax Summary",
      columns: [
        { header: "Field", key: "field", width: 34 },
        { header: "Value", key: "value", width: 28 },
      ],
      rows: [
        {
          field: "Tax Period",
          value:
            periodStart && periodEnd
              ? `${formatDateForExport(periodStart)} - ${formatDateForExport(periodEnd)}`
              : "",
        },
        { field: "Status", value: taxReturn?.status || "draft" },
        { field: "Total Revenue", value: amountForExport(taxReturn?.totalRevenue) },
        { field: "Total Expenses", value: amountForExport(taxReturn?.totalExpenses) },
        { field: "Total Deductions", value: amountForExport(taxReturn?.totalDeductions) },
        { field: "Taxable Income", value: amountForExport(taxReturn?.taxableIncome) },
        { field: "Exemption Threshold", value: amountForExport(taxReturn?.exemptionThreshold) },
        { field: "Taxable Amount Above Threshold", value: amountForExport(taxableAmount) },
        { field: "Tax Rate", value: `${(taxRate * 100).toFixed(2)}%` },
        { field: "Tax Payable", value: amountForExport(taxReturn?.taxPayable) },
        { field: "Journal Entries Processed", value: taxReturn?.journalEntriesProcessed ?? "" },
        {
          field: "Review Note",
          value: "Review adjustments and supporting schedules before filing.",
        },
      ],
    },
    {
      sheetName: "Preparation Checklist",
      columns: [
        { header: "Check", key: "check", width: 46 },
        { header: "Status", key: "status", width: 18 },
      ],
      rows: [
        { check: "Financial statements tied to ledger", status: "" },
        { check: "Non-deductible expenses reviewed", status: "" },
        { check: "Exempt income and relief positions reviewed", status: "" },
        { check: "Taxable person and period details reviewed", status: "" },
        { check: "Portal filing completed externally where required", status: "" },
      ],
    },
  ];
}
