import * as XLSX from 'xlsx';
import { apiRequest } from './queryClient';

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

export function exportToExcel(data: ExportData[], filename: string) {
  const workbook = XLSX.utils.book_new();

  data.forEach((sheet) => {
    const headers = sheet.columns.map(col => col.header);
    const rows = sheet.rows.map(row => 
      sheet.columns.map(col => row[col.key] ?? '')
    );

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    const colWidths = sheet.columns.map(col => ({ wch: col.width || 15 }));
    worksheet['!cols'] = colWidths;

    const sheetName = (sheet.sheetName || 'Sheet1').substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  });

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export async function exportToGoogleSheets(
  data: ExportData[],
  spreadsheetTitle: string,
  companyId: string
): Promise<{ success: boolean; spreadsheetUrl?: string; error?: string }> {
  try {
    const sheetsData = data.map(sheet => ({
      sheetName: sheet.sheetName || 'Sheet1',
      headers: sheet.columns.map(col => col.header),
      rows: sheet.rows.map(row => 
        sheet.columns.map(col => {
          const value = row[col.key];
          return value !== undefined && value !== null ? String(value) : '';
        })
      ),
    }));

    const response = await apiRequest('POST', `/api/integrations/google-sheets/export/custom`, {
      companyId,
      spreadsheetTitle,
      sheets: sheetsData,
    });

    const result = await response.json();
    return {
      success: true,
      spreadsheetUrl: result.spreadsheetUrl,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to export to Google Sheets',
    };
  }
}

export function formatDateForExport(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric' 
  });
}

export function formatCurrencyForExport(amount: number | null | undefined, currency = 'AED'): string {
  if (amount === null || amount === undefined) return '';
  return `${currency} ${amount.toFixed(2)}`;
}

export function prepareInvoicesForExport(invoices: any[], locale: string = 'en'): ExportData {
  return {
    sheetName: 'Invoices',
    columns: [
      { header: 'Invoice #', key: 'number', width: 15 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Customer', key: 'customerName', width: 25 },
      { header: 'Customer TRN', key: 'customerTrn', width: 18 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'VAT Amount', key: 'vatAmount', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
    ],
    rows: invoices.map(inv => ({
      number: inv.number,
      date: formatDateForExport(inv.date),
      customerName: inv.customerName,
      customerTrn: inv.customerTrn || '',
      subtotal: inv.subtotal?.toFixed(2) || '0.00',
      vatAmount: inv.vatAmount?.toFixed(2) || '0.00',
      total: inv.total?.toFixed(2) || '0.00',
      status: inv.status,
    })),
  };
}

export function prepareReceiptsForExport(receipts: any[], locale: string = 'en'): ExportData {
  return {
    sheetName: 'Expenses',
    columns: [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Merchant', key: 'merchant', width: 25 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'VAT Amount', key: 'vatAmount', width: 15 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
    ],
    rows: receipts.map(r => ({
      date: formatDateForExport(r.date),
      merchant: r.merchant || '',
      category: r.category || '',
      amount: r.amount?.toFixed(2) || '0.00',
      vatAmount: r.vatAmount?.toFixed(2) || '0.00',
      currency: r.currency || 'AED',
      status: r.postedToJournal ? 'Posted' : 'Pending',
    })),
  };
}

export function prepareProfitLossForExport(profitLoss: any): ExportData {
  const rows: any[] = [];
  
  rows.push({ account: 'REVENUE', code: '', amount: '' });
  profitLoss?.revenue?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || '',
      amount: item.amount?.toFixed(2) || '0.00',
    });
  });
  rows.push({ 
    account: 'Total Revenue', 
    code: '', 
    amount: profitLoss?.totalRevenue?.toFixed(2) || '0.00' 
  });
  
  rows.push({ account: '', code: '', amount: '' });
  rows.push({ account: 'EXPENSES', code: '', amount: '' });
  profitLoss?.expenses?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || '',
      amount: item.amount?.toFixed(2) || '0.00',
    });
  });
  rows.push({ 
    account: 'Total Expenses', 
    code: '', 
    amount: profitLoss?.totalExpenses?.toFixed(2) || '0.00' 
  });
  
  rows.push({ account: '', code: '', amount: '' });
  rows.push({ 
    account: 'NET PROFIT', 
    code: '', 
    amount: profitLoss?.netProfit?.toFixed(2) || '0.00' 
  });

  return {
    sheetName: 'Profit & Loss',
    columns: [
      { header: 'Account', key: 'account', width: 30 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Amount (AED)', key: 'amount', width: 15 },
    ],
    rows,
  };
}

export function prepareBalanceSheetForExport(balanceSheet: any): ExportData {
  const rows: any[] = [];
  
  rows.push({ account: 'ASSETS', code: '', amount: '' });
  balanceSheet?.assets?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || '',
      amount: item.amount?.toFixed(2) || '0.00',
    });
  });
  rows.push({ 
    account: 'Total Assets', 
    code: '', 
    amount: balanceSheet?.totalAssets?.toFixed(2) || '0.00' 
  });
  
  rows.push({ account: '', code: '', amount: '' });
  rows.push({ account: 'LIABILITIES', code: '', amount: '' });
  balanceSheet?.liabilities?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || '',
      amount: item.amount?.toFixed(2) || '0.00',
    });
  });
  rows.push({ 
    account: 'Total Liabilities', 
    code: '', 
    amount: balanceSheet?.totalLiabilities?.toFixed(2) || '0.00' 
  });
  
  rows.push({ account: '', code: '', amount: '' });
  rows.push({ account: 'EQUITY', code: '', amount: '' });
  balanceSheet?.equity?.forEach((item: any) => {
    rows.push({
      account: item.accountName,
      code: item.accountCode || '',
      amount: item.amount?.toFixed(2) || '0.00',
    });
  });
  rows.push({ 
    account: 'Total Equity', 
    code: '', 
    amount: balanceSheet?.totalEquity?.toFixed(2) || '0.00' 
  });

  return {
    sheetName: 'Balance Sheet',
    columns: [
      { header: 'Account', key: 'account', width: 30 },
      { header: 'Code', key: 'code', width: 10 },
      { header: 'Amount (AED)', key: 'amount', width: 15 },
    ],
    rows,
  };
}

export function prepareVATSummaryForExport(vatSummary: any): ExportData {
  return {
    sheetName: 'VAT Summary',
    columns: [
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount (AED)', key: 'amount', width: 15 },
    ],
    rows: [
      { description: 'Period', amount: vatSummary?.period || '' },
      { description: '', amount: '' },
      { description: 'Sales (Excl. VAT)', amount: vatSummary?.salesSubtotal?.toFixed(2) || '0.00' },
      { description: 'Output VAT (5%)', amount: vatSummary?.salesVAT?.toFixed(2) || '0.00' },
      { description: '', amount: '' },
      { description: 'Purchases (Excl. VAT)', amount: vatSummary?.purchasesSubtotal?.toFixed(2) || '0.00' },
      { description: 'Input VAT (5%)', amount: vatSummary?.purchasesVAT?.toFixed(2) || '0.00' },
      { description: '', amount: '' },
      { description: 'Net VAT Payable', amount: vatSummary?.netVATPayable?.toFixed(2) || '0.00' },
    ],
  };
}
