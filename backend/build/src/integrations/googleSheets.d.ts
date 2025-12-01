import { sheets_v4 } from 'googleapis';
export declare function getGoogleSheetsClient(): Promise<sheets_v4.Sheets>;
export declare function isGoogleSheetsConnected(): Promise<boolean>;
export declare function createSpreadsheet(title: string): Promise<string>;
export declare function exportToSheet(spreadsheetId: string, sheetName: string, data: (string | number | null)[][]): Promise<void>;
export declare function readFromSheet(spreadsheetId: string, range: string): Promise<any[][]>;
export declare function listSpreadsheets(): Promise<{
    id: string;
    name: string;
}[]>;
export declare function exportInvoicesToSheet(invoices: any[], spreadsheetId?: string): Promise<{
    spreadsheetId: string;
    url: string;
}>;
export declare function exportExpensesToSheet(expenses: any[], spreadsheetId?: string): Promise<{
    spreadsheetId: string;
    url: string;
}>;
export declare function exportJournalEntriesToSheet(entries: any[], spreadsheetId?: string): Promise<{
    spreadsheetId: string;
    url: string;
}>;
export declare function exportChartOfAccountsToSheet(accounts: any[], spreadsheetId?: string): Promise<{
    spreadsheetId: string;
    url: string;
}>;
export declare function exportCustomDataToSheet(title: string, sheets: {
    name: string;
    headers: string[];
    rows: (string | number | null)[][];
}[]): Promise<{
    spreadsheetId: string;
    url: string;
}>;
export declare function importInvoicesFromSheet(spreadsheetId: string): Promise<any[]>;
export declare function importExpensesFromSheet(spreadsheetId: string): Promise<any[]>;
