// Google Sheets Integration for BookKeep AI
// Uses Replit's Google Sheets connector for authentication

import { google, sheets_v4 } from 'googleapis';

let connectionSettings: any;

async function getAccessToken(): Promise<string> {
  if (connectionSettings && connectionSettings.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
export async function getGoogleSheetsClient(): Promise<sheets_v4.Sheets> {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

export async function isGoogleSheetsConnected(): Promise<boolean> {
  try {
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}

// Create a new spreadsheet
export async function createSpreadsheet(title: string): Promise<string> {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title
      }
    }
  });
  
  return response.data.spreadsheetId || '';
}

// Export data to a spreadsheet
export async function exportToSheet(
  spreadsheetId: string,
  sheetName: string,
  data: (string | number | null)[][]
): Promise<void> {
  const sheets = await getGoogleSheetsClient();
  
  // First, try to add a new sheet with this name
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName
            }
          }
        }]
      }
    });
  } catch (error: any) {
    // Sheet might already exist, that's fine
    if (!error.message?.includes('already exists')) {
      console.log('Note: Sheet may already exist');
    }
  }
  
  // Clear existing data and write new data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: data
    }
  });
}

// Read data from a spreadsheet
export async function readFromSheet(
  spreadsheetId: string,
  range: string
): Promise<any[][]> {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  
  return response.data.values || [];
}

// List all spreadsheets accessible by the user
export async function listSpreadsheets(): Promise<{ id: string; name: string }[]> {
  const accessToken = await getAccessToken();
  
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });
  
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
    fields: 'files(id, name)',
    orderBy: 'modifiedTime desc',
    pageSize: 50
  });
  
  return (response.data.files || []).map(file => ({
    id: file.id || '',
    name: file.name || ''
  }));
}

// Export invoices to Google Sheets
export async function exportInvoicesToSheet(
  invoices: any[],
  spreadsheetId?: string
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;
  
  if (!sheetId) {
    sheetId = await createSpreadsheet(`BookKeep AI - Invoices Export ${new Date().toLocaleDateString()}`);
  }
  
  const headers = [
    'Invoice Number',
    'Customer Name',
    'Customer Email',
    'Customer TRN',
    'Issue Date',
    'Due Date',
    'Subtotal (AED)',
    'VAT Amount (AED)',
    'Total (AED)',
    'Status',
    'Notes'
  ];
  
  const rows = invoices.map(inv => [
    inv.invoiceNumber,
    inv.customerName,
    inv.customerEmail || '',
    inv.customerTrn || '',
    inv.issueDate,
    inv.dueDate,
    Number(inv.subtotal).toFixed(2),
    Number(inv.vatAmount).toFixed(2),
    Number(inv.total).toFixed(2),
    inv.status,
    inv.notes || ''
  ]);
  
  await exportToSheet(sheetId, 'Invoices', [headers, ...rows]);
  
  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`
  };
}

// Export expenses/receipts to Google Sheets
export async function exportExpensesToSheet(
  expenses: any[],
  spreadsheetId?: string
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;
  
  if (!sheetId) {
    sheetId = await createSpreadsheet(`BookKeep AI - Expenses Export ${new Date().toLocaleDateString()}`);
  }
  
  const headers = [
    'Date',
    'Merchant',
    'Description',
    'Category',
    'Amount (AED)',
    'VAT Amount (AED)',
    'Payment Method',
    'Status'
  ];
  
  const rows = expenses.map(exp => [
    exp.date,
    exp.merchant || '',
    exp.description || '',
    exp.category || '',
    Number(exp.amount).toFixed(2),
    Number(exp.vatAmount || 0).toFixed(2),
    exp.paymentMethod || '',
    exp.status || 'pending'
  ]);
  
  await exportToSheet(sheetId, 'Expenses', [headers, ...rows]);
  
  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`
  };
}

// Export journal entries to Google Sheets
export async function exportJournalEntriesToSheet(
  entries: any[],
  spreadsheetId?: string
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;
  
  if (!sheetId) {
    sheetId = await createSpreadsheet(`BookKeep AI - Journal Entries ${new Date().toLocaleDateString()}`);
  }
  
  const headers = [
    'Entry Number',
    'Date',
    'Description',
    'Account Code',
    'Account Name',
    'Debit (AED)',
    'Credit (AED)'
  ];
  
  const rows: (string | number)[][] = [];
  
  for (const entry of entries) {
    if (entry.lines) {
      for (const line of entry.lines) {
        rows.push([
          entry.entryNumber,
          entry.date,
          entry.description || '',
          line.accountCode || '',
          line.accountName || '',
          Number(line.debit || 0).toFixed(2),
          Number(line.credit || 0).toFixed(2)
        ]);
      }
    }
  }
  
  await exportToSheet(sheetId, 'Journal Entries', [headers, ...rows]);
  
  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`
  };
}

// Export Chart of Accounts to Google Sheets
export async function exportChartOfAccountsToSheet(
  accounts: any[],
  spreadsheetId?: string
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;
  
  if (!sheetId) {
    sheetId = await createSpreadsheet(`BookKeep AI - Chart of Accounts ${new Date().toLocaleDateString()}`);
  }
  
  const headers = [
    'Account Code',
    'Account Name (English)',
    'Account Name (Arabic)',
    'Type',
    'Parent Account'
  ];
  
  const rows = accounts.map(acc => [
    acc.code,
    acc.nameEn,
    acc.nameAr || '',
    acc.type,
    acc.parentCode || ''
  ]);
  
  await exportToSheet(sheetId, 'Chart of Accounts', [headers, ...rows]);
  
  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`
  };
}

// Import invoices from a Google Sheet
export async function importInvoicesFromSheet(
  spreadsheetId: string
): Promise<any[]> {
  const sheets = await getGoogleSheetsClient();
  
  // Get all sheets in the spreadsheet
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });
  
  const firstSheet = response.data.sheets?.[0]?.properties?.title;
  if (!firstSheet) {
    throw new Error('No sheets found in spreadsheet');
  }
  
  // Read from first sheet
  const data = await readFromSheet(spreadsheetId, `${firstSheet}!A:K`);
  
  if (data.length < 2) {
    return [];
  }
  
  // Skip header row
  const rows = data.slice(1);
  
  return rows.map(row => ({
    invoiceNumber: row[0]?.toString() || '',
    customerName: row[1]?.toString() || '',
    customerEmail: row[2]?.toString() || '',
    customerTrn: row[3]?.toString() || '',
    issueDate: row[4]?.toString() || new Date().toISOString().split('T')[0],
    dueDate: row[5]?.toString() || new Date().toISOString().split('T')[0],
    subtotal: parseFloat(row[6] as string) || 0,
    vatAmount: parseFloat(row[7] as string) || 0,
    total: parseFloat(row[8] as string) || 0,
    status: row[9]?.toString() || 'draft',
    notes: row[10]?.toString() || ''
  })).filter(inv => inv.subtotal > 0);
}

// Import expenses from a Google Sheet
export async function importExpensesFromSheet(
  spreadsheetId: string
): Promise<any[]> {
  const sheets = await getGoogleSheetsClient();
  
  // Get all sheets in the spreadsheet
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });
  
  const firstSheet = response.data.sheets?.[0]?.properties?.title;
  if (!firstSheet) {
    throw new Error('No sheets found in spreadsheet');
  }
  
  // Read from first sheet
  const data = await readFromSheet(spreadsheetId, `${firstSheet}!A:H`);
  
  if (data.length < 2) {
    return [];
  }
  
  // Skip header row
  const rows = data.slice(1);
  
  return rows.map(row => {
    let date = new Date().toISOString().split('T')[0];
    const dateStr = row[0]?.toString().trim();
    if (dateStr) {
      try {
        // Try to parse various date formats
        // Handles: DD/MM/YY, DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY
        let parsedDate: Date | null = null;
        
        if (dateStr.includes('/')) {
          const parts = dateStr.split('/');
          if (parts.length === 3) {
            let day = parseInt(parts[0], 10);
            let month = parseInt(parts[1], 10);
            let year = parseInt(parts[2], 10);
            
            // Handle 2-digit year
            if (year < 100) {
              year += year < 50 ? 2000 : 1900;
            }
            
            parsedDate = new Date(year, month - 1, day);
          }
        } else if (dateStr.includes('-')) {
          parsedDate = new Date(dateStr);
        } else {
          // Try generic parsing
          parsedDate = new Date(dateStr);
        }
        
        if (parsedDate && !isNaN(parsedDate.getTime())) {
          date = parsedDate.toISOString().split('T')[0];
        }
      } catch (e) {
        // Fall back to today's date
      }
    }
    
    return {
      date,
      merchant: row[1] || '',
      description: row[2] || '',
      category: row[3] || '',
      amount: parseFloat(row[4]) || 0,
      vatAmount: parseFloat(row[5]) || 0,
      paymentMethod: row[6] || '',
      status: row[7] || 'pending'
    };
  }).filter(exp => exp.amount > 0);
}
