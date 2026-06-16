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

export async function exportToExcel(data: ExportData[], filename: string) {
  const { blob, filename: downloadedFilename } = await postForBlob(
    "/api/export/excel",
    { sheets: data, filename },
    `${filename}.xlsx`
  );
  await triggerBlobDownload(blob, downloadedFilename);
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

    const result = await apiRequest("POST", `/api/integrations/google-sheets/export/custom`, {
      companyId,
      title,
      sheets: sheetsData,
    });

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

export function prepareCorporateTaxEstimateForExport(report: any): ExportData[] {
  const taxPayable = Number(report?.taxPayable ?? 0) || 0;
  const taxableIncome = Number(report?.taxableIncome ?? 0) || 0;
  const status =
    taxPayable > 0.005 ? "Tax due" : taxableIncome <= 0 ? "No taxable income" : "Below threshold";

  return [
    {
      sheetName: "Corporate Tax Estimate",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 24 },
      ],
      rows: [
        { metric: "Period start", value: formatDateForExport(report?.periodStart) },
        { metric: "Period end", value: formatDateForExport(report?.periodEnd) },
        { metric: "Total revenue (AED)", value: formatExportAmount(report?.totalRevenue) },
        { metric: "Total expenses (AED)", value: formatExportAmount(report?.totalExpenses) },
        { metric: "Gross profit (AED)", value: formatExportAmount(report?.grossProfit) },
        { metric: "Deductions (AED)", value: formatExportAmount(report?.totalDeductions) },
        { metric: "Taxable income (AED)", value: formatExportAmount(report?.taxableIncome) },
        {
          metric: "Zero-rate band / threshold (AED)",
          value: formatExportAmount(report?.exemptionThreshold),
        },
        {
          metric: "Income above zero-rate band (AED)",
          value: formatExportAmount(report?.taxableAmount),
        },
        { metric: "Tax rate", value: formatExportPercent((Number(report?.taxRate) || 0) * 100) },
        { metric: "Tax payable (AED)", value: formatExportAmount(report?.taxPayable) },
        { metric: "Journal entries processed", value: report?.journalEntriesProcessed ?? 0 },
        { metric: "Status", value: status },
      ],
    },
    {
      sheetName: "Corporate Tax Bridge",
      columns: [
        { header: "Bridge", key: "bridge", width: 34 },
        { header: "Amount (AED)", key: "amount", width: 18 },
        { header: "Note", key: "note", width: 60 },
      ],
      rows: [
        {
          bridge: "Revenue",
          amount: formatExportAmount(report?.totalRevenue),
          note: "Posted income accounts in the selected period.",
        },
        {
          bridge: "Less: expenses",
          amount: formatExportAmount(-(Number(report?.totalExpenses ?? 0) || 0)),
          note: "Posted expense accounts in the selected period.",
        },
        {
          bridge: "Gross profit",
          amount: formatExportAmount(report?.grossProfit),
          note: "Revenue less expenses before tax-specific deductions.",
        },
        {
          bridge: "Less: deductions",
          amount: formatExportAmount(-(Number(report?.totalDeductions ?? 0) || 0)),
          note: "Adjustable in the Corporate Tax workspace.",
        },
        {
          bridge: "Taxable income",
          amount: formatExportAmount(report?.taxableIncome),
          note: "Income before applying the zero-rate band.",
        },
        {
          bridge: "Less: zero-rate band",
          amount: formatExportAmount(-(Number(report?.exemptionThreshold ?? 0) || 0)),
          note: "Threshold returned by the Corporate Tax calculation endpoint.",
        },
        {
          bridge: "Income above zero-rate band",
          amount: formatExportAmount(report?.taxableAmount),
          note: "Positive income above the zero-rate band before applying the returned rate.",
        },
        {
          bridge: "Corporate tax payable",
          amount: formatExportAmount(report?.taxPayable),
          note: "Estimate only; review the Corporate Tax workpaper before filing.",
        },
      ],
    },
  ];
}

export function prepareTrialBalanceForExport(trialBalance: any): ExportData {
  const rows =
    trialBalance?.rows?.map((row: any) => ({
      code: row.accountCode || "",
      account: row.accountName || "",
      type: row.accountType || "",
      debit: row.totalDebit?.toFixed(2) || "0.00",
      credit: row.totalCredit?.toFixed(2) || "0.00",
      balance: row.balance?.toFixed(2) || "0.00",
      foreignCurrency: row.hasForeignLines ? "Yes" : "No",
    })) ?? [];

  rows.push({
    code: "",
    account: "TOTAL",
    type: "",
    debit: trialBalance?.totals?.sumDebits?.toFixed(2) || "0.00",
    credit: trialBalance?.totals?.sumCredits?.toFixed(2) || "0.00",
    balance: trialBalance?.totals?.difference?.toFixed(2) || "0.00",
    foreignCurrency: "",
  });

  return {
    sheetName: "Trial Balance",
    columns: [
      { header: "Code", key: "code", width: 12 },
      { header: "Account", key: "account", width: 30 },
      { header: "Type", key: "type", width: 14 },
      { header: "Debit (AED)", key: "debit", width: 15 },
      { header: "Credit (AED)", key: "credit", width: 15 },
      { header: "Balance (AED)", key: "balance", width: 15 },
      { header: "Foreign Currency Lines", key: "foreignCurrency", width: 22 },
    ],
    rows,
  };
}

function formatExportAmount(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function formatExportPercent(value: unknown): string {
  const percent = Number(value ?? 0);
  return Number.isFinite(percent) ? `${percent.toFixed(2)}%` : "0.00%";
}

export function prepareInvoiceStatusForExport(report: any): ExportData[] {
  return [
    {
      sheetName: "Invoice Status",
      columns: [
        { header: "Status", key: "status", width: 16 },
        { header: "Invoices", key: "count", width: 12 },
        { header: "Value (AED)", key: "amountAed", width: 18 },
      ],
      rows:
        report?.statusSummary?.map((row: any) => ({
          status: row.status,
          count: row.count,
          amountAed: formatExportAmount(row.amountAed),
        })) ?? [],
    },
    {
      sheetName: "Revenue by Customer",
      columns: [
        { header: "Customer", key: "customerName", width: 30 },
        { header: "Invoices", key: "invoiceCount", width: 12 },
        { header: "Value (AED)", key: "amountAed", width: 18 },
      ],
      rows:
        report?.customerRevenue?.map((row: any) => ({
          customerName: row.customerName,
          invoiceCount: row.invoiceCount,
          amountAed: formatExportAmount(row.amountAed),
        })) ?? [],
    },
    {
      sheetName: "Sales by Product Service",
      columns: [
        { header: "Product / Service", key: "productService", width: 34 },
        { header: "Invoices", key: "invoiceCount", width: 12 },
        { header: "Lines", key: "lineCount", width: 10 },
        { header: "Quantity", key: "quantity", width: 14 },
        { header: "Sales (AED)", key: "amountAed", width: 18 },
        { header: "VAT (AED)", key: "vatAed", width: 16 },
        { header: "Average Unit (AED)", key: "averageUnitPriceAed", width: 20 },
        { header: "Supply Types", key: "supplyTypes", width: 28 },
      ],
      rows:
        report?.productServiceRows?.map((row: any) => ({
          productService: row.productService,
          invoiceCount: row.invoiceCount,
          lineCount: row.lineCount,
          quantity: formatExportAmount(row.quantity),
          amountAed: formatExportAmount(row.amountAed),
          vatAed: formatExportAmount(row.vatAed),
          averageUnitPriceAed: formatExportAmount(row.averageUnitPriceAed),
          supplyTypes: Array.isArray(row.supplyTypes) ? row.supplyTypes.join(", ") : "",
        })) ?? [],
    },
    {
      sheetName: "Reminder Routing",
      columns: [
        { header: "Customer", key: "customerName", width: 30 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Invoices", key: "invoiceCount", width: 12 },
        { header: "Outstanding", key: "outstanding", width: 18 },
        { header: "Oldest Days Overdue", key: "maxDaysOverdue", width: 20 },
        { header: "Recommended Level", key: "recommendedLevel", width: 18 },
      ],
      rows:
        report?.overdueCustomerRows?.map((row: any) => ({
          customerName: row.customerName,
          currency: row.currency,
          invoiceCount: row.invoiceCount,
          outstanding: formatExportAmount(row.outstanding),
          maxDaysOverdue: row.maxDaysOverdue,
          recommendedLevel: row.recommendedLevel,
        })) ?? [],
    },
    {
      sheetName: "Invoice Detail",
      columns: [
        { header: "Invoice", key: "number", width: 18 },
        { header: "Customer", key: "customerName", width: 30 },
        { header: "Issue Date", key: "date", width: 14 },
        { header: "Due Date", key: "dueDate", width: 14 },
        { header: "Status", key: "status", width: 14 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Amount", key: "total", width: 16 },
        { header: "AED Value", key: "amountAed", width: 16 },
      ],
      rows:
        report?.invoices?.map((invoice: any) => ({
          number: invoice.number,
          customerName: invoice.customerName,
          date: formatDateForExport(invoice.date),
          dueDate: formatDateForExport(invoice.dueDate),
          status: invoice.status,
          currency: invoice.currency || "AED",
          total: formatExportAmount(invoice.total),
          amountAed: formatExportAmount(invoice.baseCurrencyAmount ?? invoice.total),
        })) ?? [],
    },
  ];
}

function receiptExportRate(receipt: any): number {
  const rate = Number(receipt?.exchangeRate ?? 1);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

function receiptSubtotalExportAed(receipt: any): number {
  const base = Number(receipt?.baseCurrencyAmount ?? 0);
  if (Number.isFinite(base) && Math.abs(base) > 0.005) return base;
  return (Number(receipt?.amount) || 0) * receiptExportRate(receipt);
}

function receiptVatExportAed(receipt: any): number {
  return (Number(receipt?.vatAmount) || 0) * receiptExportRate(receipt);
}

function expenseSummaryRows(rows: any[] = []) {
  return rows.map((row: any) => ({
    label: row.label,
    receiptCount: row.receiptCount,
    subtotalAed: formatExportAmount(row.subtotalAed),
    vatAed: formatExportAmount(row.vatAed),
    totalAed: formatExportAmount(row.totalAed),
    unpostedCount: row.unpostedCount,
    autoPostedCount: row.autoPostedCount,
  }));
}

export function prepareExpenseReportsForExport(report: any): ExportData[] {
  return [
    {
      sheetName: "Expenses by Vendor",
      columns: [
        { header: "Vendor", key: "label", width: 30 },
        { header: "Receipts", key: "receiptCount", width: 12 },
        { header: "Subtotal (AED)", key: "subtotalAed", width: 18 },
        { header: "VAT (AED)", key: "vatAed", width: 16 },
        { header: "Total (AED)", key: "totalAed", width: 18 },
        { header: "Unposted", key: "unpostedCount", width: 12 },
        { header: "Auto-posted", key: "autoPostedCount", width: 14 },
      ],
      rows: expenseSummaryRows(report?.byVendor),
    },
    {
      sheetName: "Expenses by Category",
      columns: [
        { header: "Category", key: "label", width: 28 },
        { header: "Receipts", key: "receiptCount", width: 12 },
        { header: "Subtotal (AED)", key: "subtotalAed", width: 18 },
        { header: "VAT (AED)", key: "vatAed", width: 16 },
        { header: "Total (AED)", key: "totalAed", width: 18 },
        { header: "Unposted", key: "unpostedCount", width: 12 },
        { header: "Auto-posted", key: "autoPostedCount", width: 14 },
      ],
      rows: expenseSummaryRows(report?.byCategory),
    },
    {
      sheetName: "Posting Automation",
      columns: [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Value", key: "value", width: 18 },
      ],
      rows: [
        { metric: "Captured receipts", value: report?.receiptCount ?? 0 },
        { metric: "Auto-posted receipts", value: report?.autoPostedReceipts ?? 0 },
        { metric: "Needs posting", value: report?.unpostedReceipts ?? 0 },
        { metric: "Subtotal (AED)", value: formatExportAmount(report?.subtotalAed) },
        { metric: "VAT (AED)", value: formatExportAmount(report?.vatAed) },
        { metric: "Total spend (AED)", value: formatExportAmount(report?.totalAed) },
      ],
    },
    {
      sheetName: "Expense Detail",
      columns: [
        { header: "Vendor", key: "merchant", width: 30 },
        { header: "Date", key: "date", width: 14 },
        { header: "Category", key: "category", width: 22 },
        { header: "Status", key: "status", width: 16 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Subtotal (AED)", key: "subtotalAed", width: 18 },
        { header: "VAT (AED)", key: "vatAed", width: 16 },
        { header: "Total (AED)", key: "totalAed", width: 18 },
      ],
      rows:
        report?.receipts?.map((receipt: any) => {
          const subtotalAed = receiptSubtotalExportAed(receipt);
          const vatAed = receiptVatExportAed(receipt);
          return {
            merchant: receipt.merchant || "Unknown Merchant",
            date: formatDateForExport(receipt.date),
            category: receipt.category || "Uncategorized",
            status: receipt.autoPosted
              ? "Auto-posted"
              : receipt.posted
                ? "Posted"
                : "Needs posting",
            currency: receipt.currency || "AED",
            subtotalAed: formatExportAmount(subtotalAed),
            vatAed: formatExportAmount(vatAed),
            totalAed: formatExportAmount(subtotalAed + vatAed),
          };
        }) ?? [],
    },
  ];
}

export function prepareLedgerReportsForExport(report: any): ExportData[] {
  const totalDebit = Number(report?.totalDebit ?? 0);
  const totalCredit = Number(report?.totalCredit ?? 0);
  const difference = Math.abs(Number(report?.difference ?? totalDebit - totalCredit));

  return [
    {
      sheetName: "Ledger Summary",
      columns: [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Value", key: "value", width: 18 },
      ],
      rows: [
        { metric: "Posted entries", value: report?.entryCount ?? 0 },
        { metric: "Ledger lines", value: report?.lineCount ?? 0 },
        { metric: "Active accounts", value: report?.accountCount ?? 0 },
        { metric: "Total debit (AED)", value: formatExportAmount(totalDebit) },
        { metric: "Total credit (AED)", value: formatExportAmount(totalCredit) },
        { metric: "Difference (AED)", value: formatExportAmount(difference) },
        { metric: "Balance status", value: difference < 0.005 ? "Balanced" : "Review required" },
        { metric: "Manual/no-source entries", value: report?.reviewEntries ?? 0 },
        { metric: "Foreign currency lines", value: report?.foreignCurrencyLines ?? 0 },
      ],
    },
    {
      sheetName: "Account Activity",
      columns: [
        { header: "Account Code", key: "accountCode", width: 16 },
        { header: "Account", key: "accountName", width: 30 },
        { header: "Type", key: "accountType", width: 16 },
        { header: "Lines", key: "lineCount", width: 10 },
        { header: "Debit (AED)", key: "debit", width: 16 },
        { header: "Credit (AED)", key: "credit", width: 16 },
        { header: "Net Activity (AED)", key: "netActivity", width: 18 },
        { header: "Last Activity", key: "lastActivity", width: 14 },
      ],
      rows:
        report?.accountActivity?.map((row: any) => ({
          accountCode: row.accountCode || "",
          accountName: row.accountName || "",
          accountType: row.accountType || "",
          lineCount: row.lineCount ?? 0,
          debit: formatExportAmount(row.debit),
          credit: formatExportAmount(row.credit),
          netActivity: formatExportAmount(row.netActivity),
          lastActivity: formatDateForExport(row.lastActivity),
        })) ?? [],
    },
    {
      sheetName: "Source Review",
      columns: [
        { header: "Source", key: "source", width: 24 },
        { header: "Entries", key: "entryCount", width: 12 },
        { header: "Lines", key: "lineCount", width: 10 },
        { header: "Amount (AED)", key: "amountAed", width: 16 },
        { header: "Needs Review", key: "needsReview", width: 14 },
      ],
      rows:
        report?.sourceRows?.map((row: any) => ({
          source: row.source || "Unknown",
          entryCount: row.entryCount ?? 0,
          lineCount: row.lineCount ?? 0,
          amountAed: formatExportAmount(row.amountAed),
          needsReview: row.needsReview ? "Yes" : "No",
        })) ?? [],
    },
    {
      sheetName: "Ledger Detail",
      columns: [
        { header: "Date", key: "date", width: 14 },
        { header: "Entry", key: "entryNumber", width: 18 },
        { header: "Account Code", key: "accountCode", width: 16 },
        { header: "Account", key: "accountName", width: 30 },
        { header: "Type", key: "accountType", width: 16 },
        { header: "Memo", key: "memo", width: 32 },
        { header: "Source", key: "source", width: 22 },
        { header: "Debit (AED)", key: "debit", width: 16 },
        { header: "Credit (AED)", key: "credit", width: 16 },
        { header: "Foreign Currency", key: "foreignCurrency", width: 18 },
      ],
      rows:
        report?.lines?.map((line: any) => ({
          date: formatDateForExport(line.date),
          entryNumber: line.entryNumber || "",
          accountCode: line.accountCode || "",
          accountName: line.accountName || "",
          accountType: line.accountType || "",
          memo: line.memo || "",
          source: line.source || "Unknown",
          debit: formatExportAmount(line.debit),
          credit: formatExportAmount(line.credit),
          foreignCurrency: line.hasForeignCurrency ? "Yes" : "No",
        })) ?? [],
    },
  ];
}

export function prepareMonthEndCloseStatusForExport(report: any): ExportData[] {
  return [
    {
      sheetName: "Month-End Close Summary",
      columns: [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 24 },
      ],
      rows: [
        { metric: "Period", value: report?.period ?? "" },
        { metric: "Period start", value: formatDateForExport(report?.periodStart) },
        { metric: "Period end", value: formatDateForExport(report?.periodEnd) },
        { metric: "Readiness %", value: formatExportPercent(report?.readinessPercent) },
        { metric: "Completed checks", value: report?.completedChecks ?? 0 },
        { metric: "Checks needing review", value: report?.reviewChecks ?? 0 },
      ],
    },
    {
      sheetName: "Month-End Checklist",
      columns: [
        { header: "No.", key: "number", width: 8 },
        { header: "Check", key: "title", width: 34 },
        { header: "Status", key: "status", width: 14 },
        { header: "Description", key: "description", width: 48 },
        { header: "Details", key: "details", width: 60 },
      ],
      rows:
        report?.checklist?.map((item: any) => ({
          number: item.id,
          title: item.title,
          status: item.status === "complete" ? "Complete" : "Needs review",
          description: item.description,
          details: item.details ?? "",
        })) ?? [],
    },
  ];
}

export function preparePlanningReportsForExport(report: any): ExportData[] {
  const budget = report?.budget;
  const lowestProjection = report?.lowestProjection;

  return [
    {
      sheetName: "Planning Summary",
      columns: [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 22 },
      ],
      rows: [
        { metric: "Active budget", value: budget?.name || "No approved budget selected" },
        { metric: "Budget total (AED)", value: formatExportAmount(report?.budgetTotal) },
        { metric: "Actual total (AED)", value: formatExportAmount(report?.actualTotal) },
        { metric: "Variance (AED)", value: formatExportAmount(report?.variance) },
        { metric: "Variance %", value: formatExportPercent(report?.variancePercent) },
        { metric: "Over-budget lines", value: report?.overBudgetLines ?? 0 },
        { metric: "Current balance (AED)", value: formatExportAmount(report?.currentBalance) },
        {
          metric: "Projected inflows (AED)",
          value: formatExportAmount(report?.projectedInflows),
        },
        {
          metric: "Projected outflows (AED)",
          value: formatExportAmount(report?.projectedOutflows),
        },
        {
          metric: "Projected ending balance (AED)",
          value: formatExportAmount(report?.projectedEndingBalance),
        },
        { metric: "Cash movement (AED)", value: formatExportAmount(report?.cashMovement) },
        { metric: "Cash warning", value: report?.cashWarning || "On track" },
        {
          metric: "Lowest projected balance (AED)",
          value: lowestProjection ? formatExportAmount(lowestProjection.projectedBalance) : "",
        },
      ],
    },
    {
      sheetName: "Budget Plans",
      columns: [
        { header: "Budget", key: "name", width: 30 },
        { header: "Fiscal Year", key: "fiscalYear", width: 12 },
        { header: "Start Date", key: "startDate", width: 14 },
        { header: "End Date", key: "endDate", width: 14 },
        { header: "Status", key: "status", width: 14 },
        { header: "Total Budget (AED)", key: "totalBudget", width: 18 },
      ],
      rows:
        report?.budgetPlans?.map((plan: any) => ({
          name: plan.name || "",
          fiscalYear: plan.fiscal_year ?? plan.fiscalYear ?? "",
          startDate: formatDateForExport(plan.start_date ?? plan.startDate),
          endDate: formatDateForExport(plan.end_date ?? plan.endDate),
          status: plan.status || "",
          totalBudget: formatExportAmount(plan.total_budget ?? plan.totalBudget),
        })) ?? [],
    },
    {
      sheetName: "Budget Variance",
      columns: [
        { header: "Category", key: "category", width: 24 },
        { header: "Description", key: "description", width: 32 },
        { header: "Budget (AED)", key: "budget", width: 16 },
        { header: "Actual (AED)", key: "actual", width: 16 },
        { header: "Variance (AED)", key: "variance", width: 16 },
        { header: "Variance %", key: "variancePercent", width: 14 },
        { header: "Status", key: "status", width: 16 },
      ],
      rows:
        report?.varianceLines?.map((line: any) => ({
          category: line.category || "",
          description: line.description || "",
          budget: formatExportAmount(line.totals?.budget),
          actual: formatExportAmount(line.totals?.actual),
          variance: formatExportAmount(line.totals?.variance),
          variancePercent: formatExportPercent(line.totals?.variancePercent),
          status: Number(line.totals?.variance ?? 0) < 0 ? "Over budget" : "Within budget",
        })) ?? [],
    },
    {
      sheetName: "Cash Projections",
      columns: [
        { header: "Week", key: "week", width: 10 },
        { header: "Week Start", key: "weekStart", width: 14 },
        { header: "Week End", key: "weekEnd", width: 14 },
        { header: "Expected Inflows (AED)", key: "expectedInflows", width: 22 },
        { header: "Expected Outflows (AED)", key: "expectedOutflows", width: 22 },
        { header: "Projected Balance (AED)", key: "projectedBalance", width: 22 },
      ],
      rows:
        report?.projections?.map((projection: any) => ({
          week: projection.week,
          weekStart: formatDateForExport(projection.weekStart),
          weekEnd: formatDateForExport(projection.weekEnd),
          expectedInflows: formatExportAmount(projection.expectedInflows),
          expectedOutflows: formatExportAmount(projection.expectedOutflows),
          projectedBalance: formatExportAmount(projection.projectedBalance),
        })) ?? [],
    },
    {
      sheetName: "Planning Insights",
      columns: [
        { header: "No.", key: "number", width: 8 },
        { header: "Insight", key: "insight", width: 80 },
      ],
      rows:
        report?.insights?.map((insight: string, index: number) => ({
          number: index + 1,
          insight,
        })) ?? [],
    },
  ];
}

export function prepareBalanceSummaryReportsForExport(report: any): ExportData[] {
  const customers = report?.customers ?? [];
  const vendors = report?.vendors ?? [];
  const inventory = report?.inventory ?? {};
  const inventoryRows = inventory.rows ?? [];
  const fixedAssets = report?.fixedAssets ?? {};
  const fixedAssetRows = fixedAssets.rows ?? [];
  const fixedAssetCategories = fixedAssets.byCategory ?? [];

  return [
    {
      sheetName: "Balance Summary",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 22 },
      ],
      rows: [
        {
          metric: "Customer open balance (AED)",
          value: formatExportAmount(report?.customerOpenAed),
        },
        {
          metric: "Customer overdue balance (AED)",
          value: formatExportAmount(report?.customerOverdueAed),
        },
        { metric: "Customers with balances", value: report?.customerCount ?? 0 },
        { metric: "Vendor open balance (AED)", value: formatExportAmount(report?.vendorOpenAed) },
        {
          metric: "Vendor overdue balance (AED)",
          value: formatExportAmount(report?.vendorOverdueAed),
        },
        { metric: "Vendors with balances", value: report?.vendorCount ?? 0 },
        {
          metric: "Net receivable less payable (AED)",
          value: formatExportAmount(report?.netBalanceAed),
        },
        { metric: "Active inventory products", value: inventory.activeProductCount ?? 0 },
        {
          metric: "Inventory valuation (AED)",
          value: formatExportAmount(inventory.totalStockValueAed),
        },
        { metric: "Inventory review items", value: inventory.reviewCount ?? 0 },
        { metric: "Generated at", value: formatDateForExport(report?.generatedAt) },
      ],
    },
    {
      sheetName: "Inventory Summary",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 22 },
      ],
      rows: [
        { metric: "Products", value: inventory.productCount ?? 0 },
        { metric: "Active products", value: inventory.activeProductCount ?? 0 },
        { metric: "Total units", value: formatExportAmount(inventory.totalUnits) },
        {
          metric: "Stock value (AED)",
          value: formatExportAmount(inventory.totalStockValueAed),
        },
        { metric: "Low-stock products", value: inventory.lowStockCount ?? 0 },
        { metric: "Negative-stock products", value: inventory.negativeStockCount ?? 0 },
        { metric: "Missing-cost products", value: inventory.missingCostCount ?? 0 },
        { metric: "Inventory movements", value: inventory.movementCount ?? 0 },
      ],
    },
    {
      sheetName: "Inventory Valuation",
      columns: [
        { header: "Product", key: "name", width: 30 },
        { header: "SKU", key: "sku", width: 18 },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Active", key: "isActive", width: 10 },
        { header: "Current Stock", key: "currentStock", width: 16 },
        { header: "Unit Cost (AED)", key: "unitCost", width: 18 },
        { header: "Stock Value (AED)", key: "stockValueAed", width: 20 },
        { header: "Low Stock Threshold", key: "lowStockThreshold", width: 20 },
        { header: "Movement Count", key: "movementCount", width: 16 },
        { header: "Review", key: "review", width: 28 },
      ],
      rows: inventoryRows.map((row: any) => ({
        name: row.name || "Unnamed product",
        sku: row.sku || "",
        unit: row.unit || "",
        isActive: row.isActive ? "Yes" : "No",
        currentStock: row.currentStock ?? 0,
        unitCost: formatExportAmount(row.unitCost ?? row.costPrice),
        stockValueAed: formatExportAmount(row.stockValueAed),
        lowStockThreshold: row.lowStockThreshold ?? "",
        movementCount: row.movementCount ?? 0,
        review: row.isNegativeStock
          ? "Negative stock"
          : row.isMissingCost
            ? "Missing cost"
            : row.isLowStock
              ? "Low stock"
              : "",
      })),
    },
    {
      sheetName: "Fixed Asset Summary",
      columns: [
        { header: "Metric", key: "metric", width: 34 },
        { header: "Value", key: "value", width: 22 },
      ],
      rows: [
        { metric: "Active assets", value: fixedAssets.totalAssets ?? 0 },
        { metric: "Total cost (AED)", value: formatExportAmount(fixedAssets.totalCost) },
        {
          metric: "Accumulated depreciation (AED)",
          value: formatExportAmount(fixedAssets.totalAccumulatedDepreciation),
        },
        {
          metric: "Net book value (AED)",
          value: formatExportAmount(fixedAssets.totalNetBookValue),
        },
        { metric: "Disposed assets", value: fixedAssets.disposedAssetCount ?? 0 },
        {
          metric: "Capitalization review items",
          value: fixedAssets.capitalizationReviewCount ?? 0,
        },
        {
          metric: "Depreciation review items",
          value: fixedAssets.depreciationReviewCount ?? 0,
        },
      ],
    },
    {
      sheetName: "Fixed Assets by Category",
      columns: [
        { header: "Category", key: "category", width: 24 },
        { header: "Assets", key: "count", width: 10 },
        { header: "Cost (AED)", key: "totalCost", width: 18 },
        {
          header: "Accumulated Depreciation (AED)",
          key: "totalAccumulatedDepreciation",
          width: 28,
        },
        { header: "Net Book Value (AED)", key: "totalNetBookValue", width: 22 },
      ],
      rows: fixedAssetCategories.map((row: any) => ({
        category: row.category || "Uncategorized",
        count: row.count ?? 0,
        totalCost: formatExportAmount(row.totalCost),
        totalAccumulatedDepreciation: formatExportAmount(row.totalAccumulatedDepreciation),
        totalNetBookValue: formatExportAmount(row.totalNetBookValue),
      })),
    },
    {
      sheetName: "Fixed Asset Register",
      columns: [
        { header: "Asset", key: "assetName", width: 30 },
        { header: "Asset #", key: "assetNumber", width: 16 },
        { header: "Category", key: "category", width: 20 },
        { header: "Purchase Date", key: "purchaseDate", width: 14 },
        { header: "Cost (AED)", key: "purchaseCost", width: 16 },
        { header: "Accumulated Depreciation (AED)", key: "accumulatedDepreciation", width: 28 },
        { header: "Net Book Value (AED)", key: "netBookValue", width: 22 },
        { header: "Status", key: "status", width: 14 },
        { header: "Review", key: "review", width: 32 },
      ],
      rows: fixedAssetRows.map((row: any) => ({
        assetName: row.asset_name || "Unnamed asset",
        assetNumber: row.asset_number || "",
        category: row.category || "Uncategorized",
        purchaseDate: formatDateForExport(row.purchase_date),
        purchaseCost: formatExportAmount(row.purchaseCost ?? row.purchase_cost),
        accumulatedDepreciation: formatExportAmount(
          row.accumulatedDepreciation ?? row.accumulated_depreciation
        ),
        netBookValue: formatExportAmount(row.netBookValue ?? row.net_book_value),
        status: row.status || "",
        review: row.needs_capitalization_je ? "Capitalization journal review" : "",
      })),
    },
    {
      sheetName: "Customer Balances",
      columns: [
        { header: "Customer", key: "name", width: 30 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Invoices", key: "invoiceCount", width: 10 },
        { header: "Open Balance", key: "openBalance", width: 16 },
        { header: "Open Balance (AED)", key: "openBalanceAed", width: 20 },
        { header: "Overdue Balance", key: "overdueBalance", width: 18 },
        { header: "Overdue Balance (AED)", key: "overdueBalanceAed", width: 22 },
        { header: "Max Days Overdue", key: "maxDaysOverdue", width: 18 },
      ],
      rows: customers.map((row: any) => ({
        name: row.name || "Unknown Customer",
        currency: row.currency || "AED",
        invoiceCount: row.invoiceCount ?? 0,
        openBalance: formatExportAmount(row.openBalance),
        openBalanceAed: formatExportAmount(row.openBalanceAed),
        overdueBalance: formatExportAmount(row.overdueBalance),
        overdueBalanceAed: formatExportAmount(row.overdueBalanceAed),
        maxDaysOverdue: row.maxDaysOverdue ?? 0,
      })),
    },
    {
      sheetName: "Vendor Balances",
      columns: [
        { header: "Vendor", key: "name", width: 30 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Bills", key: "billCount", width: 10 },
        { header: "Open Balance", key: "openBalance", width: 16 },
        { header: "Open Balance (AED)", key: "openBalanceAed", width: 20 },
        { header: "Overdue Balance", key: "overdueBalance", width: 18 },
        { header: "Overdue Balance (AED)", key: "overdueBalanceAed", width: 22 },
        { header: "Max Days Overdue", key: "maxDaysOverdue", width: 18 },
      ],
      rows: vendors.map((row: any) => ({
        name: row.name || "Unknown Vendor",
        currency: row.currency || "AED",
        billCount: row.billCount ?? 0,
        openBalance: formatExportAmount(row.openBalance),
        openBalanceAed: formatExportAmount(row.openBalanceAed),
        overdueBalance: formatExportAmount(row.overdueBalance),
        overdueBalanceAed: formatExportAmount(row.overdueBalanceAed),
        maxDaysOverdue: row.maxDaysOverdue ?? 0,
      })),
    },
  ];
}
