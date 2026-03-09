// Google Sheets Integration for BookKeep AI
// Supports two authentication modes:
//   1. Google Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
//   2. OAuth2 with refresh token (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN)

import { google, sheets_v4 } from 'googleapis';
import type { JWT, OAuth2Client } from 'google-auth-library';

// ---------------------------------------------------------------------------
// Authentication helpers
// ---------------------------------------------------------------------------

/**
 * Determine which credential set is available and return an authenticated
 * Google Auth client.  Service-account credentials take priority because they
 * do not expire in the same way as user OAuth tokens.
 */
function getAuthClient(): JWT | OAuth2Client {
  // --- Service Account path ---
  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (saEmail && saKey) {
    // The private key in env vars typically has literal "\n" – convert to real newlines.
    const formattedKey = saKey.replace(/\\n/g, '\n');

    const jwtClient = new google.auth.JWT(
      saEmail,
      undefined,
      formattedKey,
      [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    );

    return jwtClient;
  }

  // --- OAuth2 refresh-token path ---
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  throw new Error(
    'Google Sheets credentials not configured. ' +
    'Provide either GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, ' +
    'or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN.',
  );
}

// ---------------------------------------------------------------------------
// Core client helpers
// ---------------------------------------------------------------------------

export async function getGoogleSheetsClient(): Promise<sheets_v4.Sheets> {
  const auth = getAuthClient();

  // For JWT (service account) we need to authorize once to obtain a token.
  if ('authorize' in auth) {
    await (auth as JWT).authorize();
  }

  return google.sheets({ version: 'v4', auth });
}

export async function isGoogleSheetsConnected(): Promise<boolean> {
  try {
    const sheets = await getGoogleSheetsClient();
    // Make a lightweight call to verify the credentials are valid.
    await sheets.spreadsheets.create({
      requestBody: { properties: { title: '__connection_test__' } },
      fields: 'spreadsheetId',
    }).then(async (res) => {
      // Clean up the test spreadsheet silently.
      const auth = getAuthClient();
      if ('authorize' in auth) await (auth as JWT).authorize();
      const drive = google.drive({ version: 'v3', auth });
      if (res.data.spreadsheetId) {
        await drive.files.delete({ fileId: res.data.spreadsheetId }).catch(() => {});
      }
    });
    return true;
  } catch (err) {
    console.warn('[GoogleSheets] Connection check failed:', (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Spreadsheet CRUD
// ---------------------------------------------------------------------------

// Create a new spreadsheet
export async function createSpreadsheet(title: string): Promise<string> {
  const sheets = await getGoogleSheetsClient();

  const response = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title,
      },
    },
  });

  return response.data.spreadsheetId || '';
}

// Export data to a spreadsheet
export async function exportToSheet(
  spreadsheetId: string,
  sheetName: string,
  data: (string | number | null)[][],
): Promise<void> {
  const sheets = await getGoogleSheetsClient();

  // First, try to add a new sheet with this name
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  } catch (error: any) {
    // Sheet might already exist, that's fine
    if (!error.message?.includes('already exists')) {
      console.log('[GoogleSheets] Note: Sheet may already exist');
    }
  }

  // Clear existing data and write new data
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: data,
    },
  });
}

// Read data from a spreadsheet
export async function readFromSheet(
  spreadsheetId: string,
  range: string,
): Promise<any[][]> {
  const sheets = await getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values || [];
}

// List all spreadsheets accessible by the authenticated user / service account
export async function listSpreadsheets(): Promise<{ id: string; name: string }[]> {
  const auth = getAuthClient();
  if ('authorize' in auth) await (auth as JWT).authorize();

  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
    fields: 'files(id, name)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });

  return (response.data.files || []).map((file) => ({
    id: file.id || '',
    name: file.name || '',
  }));
}

// ---------------------------------------------------------------------------
// Domain-specific export helpers
// ---------------------------------------------------------------------------

// Export invoices to Google Sheets
export async function exportInvoicesToSheet(
  invoices: any[],
  spreadsheetId?: string,
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;

  if (!sheetId) {
    sheetId = await createSpreadsheet(
      `BookKeep AI - Invoices Export ${new Date().toLocaleDateString()}`,
    );
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
    'Notes',
  ];

  const rows = invoices.map((inv) => [
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
    inv.notes || '',
  ]);

  await exportToSheet(sheetId, 'Invoices', [headers, ...rows]);

  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

// Export expenses/receipts to Google Sheets
export async function exportExpensesToSheet(
  expenses: any[],
  spreadsheetId?: string,
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;

  if (!sheetId) {
    sheetId = await createSpreadsheet(
      `BookKeep AI - Expenses Export ${new Date().toLocaleDateString()}`,
    );
  }

  const headers = [
    'Date',
    'Merchant',
    'Description',
    'Category',
    'Amount (AED)',
    'VAT Amount (AED)',
    'Payment Method',
    'Status',
  ];

  const rows = expenses.map((exp) => [
    exp.date,
    exp.merchant || '',
    exp.description || '',
    exp.category || '',
    Number(exp.amount).toFixed(2),
    Number(exp.vatAmount || 0).toFixed(2),
    exp.paymentMethod || '',
    exp.status || 'pending',
  ]);

  await exportToSheet(sheetId, 'Expenses', [headers, ...rows]);

  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

// Export journal entries to Google Sheets
export async function exportJournalEntriesToSheet(
  entries: any[],
  spreadsheetId?: string,
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;

  if (!sheetId) {
    sheetId = await createSpreadsheet(
      `BookKeep AI - Journal Entries ${new Date().toLocaleDateString()}`,
    );
  }

  const headers = [
    'Entry Number',
    'Date',
    'Description',
    'Account Code',
    'Account Name',
    'Debit (AED)',
    'Credit (AED)',
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
          Number(line.credit || 0).toFixed(2),
        ]);
      }
    }
  }

  await exportToSheet(sheetId, 'Journal Entries', [headers, ...rows]);

  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

// Export Chart of Accounts to Google Sheets
export async function exportChartOfAccountsToSheet(
  accounts: any[],
  spreadsheetId?: string,
): Promise<{ spreadsheetId: string; url: string }> {
  let sheetId = spreadsheetId;

  if (!sheetId) {
    sheetId = await createSpreadsheet(
      `BookKeep AI - Chart of Accounts ${new Date().toLocaleDateString()}`,
    );
  }

  const headers = [
    'Account Code',
    'Account Name (English)',
    'Account Name (Arabic)',
    'Type',
    'Parent Account',
  ];

  const rows = accounts.map((acc) => [
    acc.code,
    acc.nameEn,
    acc.nameAr || '',
    acc.type,
    acc.parentCode || '',
  ]);

  await exportToSheet(sheetId, 'Chart of Accounts', [headers, ...rows]);

  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

// Export custom data to Google Sheets (for filtered/custom exports from frontend)
export async function exportCustomDataToSheet(
  title: string,
  sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[],
): Promise<{ spreadsheetId: string; url: string }> {
  const sheetId = await createSpreadsheet(title);

  for (const sheet of sheets) {
    await exportToSheet(sheetId, sheet.name, [sheet.headers, ...sheet.rows]);
  }

  return {
    spreadsheetId: sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
  };
}

// ---------------------------------------------------------------------------
// Domain-specific import helpers
// ---------------------------------------------------------------------------

// Import invoices from a Google Sheet
export async function importInvoicesFromSheet(
  spreadsheetId: string,
): Promise<any[]> {
  const sheets = await getGoogleSheetsClient();

  // Get all sheets in the spreadsheet
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
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

  return rows
    .map((row) => ({
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
      notes: row[10]?.toString() || '',
    }))
    .filter((inv) => inv.subtotal > 0);
}

// Import expenses from a Google Sheet
export async function importExpensesFromSheet(
  spreadsheetId: string,
): Promise<any[]> {
  const sheets = await getGoogleSheetsClient();

  // Get all sheets in the spreadsheet
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
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

  return rows
    .map((row) => {
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
        status: row[7] || 'pending',
      };
    })
    .filter((exp) => exp.amount > 0);
}
