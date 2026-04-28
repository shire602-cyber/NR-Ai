import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildOcrReceiptsWorkbook,
  buildExportFilename,
  receiptToExportRow,
  type OcrExportRow,
} from '../../server/services/excel-export.service';

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS expects an ArrayBuffer; Buffer is structurally compatible.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('excel-export.service', () => {
  const sampleRows: OcrExportRow[] = [
    {
      date: '2026-04-01',
      vendor: 'Carrefour Hypermarket',
      invoiceNumber: 'INV-001',
      amount: 105,
      vat: 5,
      currency: 'AED',
    },
    {
      date: new Date('2026-04-15T00:00:00Z'),
      vendor: 'Office Pro LLC',
      invoiceNumber: null,
      amount: '210.50',
      vat: 10.02,
      currency: 'AED',
    },
  ];

  it('produces a non-empty XLSX buffer', async () => {
    const buf = await buildOcrReceiptsWorkbook(sampleRows);
    expect(buf.length).toBeGreaterThan(1000);
    // XLSX files are ZIP archives — check the magic bytes (PK\x03\x04).
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('writes the expected header row with bold styling', async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];
    const header = sheet.getRow(1);
    const cells = ['Date', 'Vendor', 'Invoice No.', 'Amount', 'VAT'];
    cells.forEach((label, idx) => {
      const cell = header.getCell(idx + 1);
      expect(cell.value).toBe(label);
      const font = cell.font ?? {};
      expect(font.bold).toBe(true);
    });
  });

  it('writes data rows with currency formatting on Amount and VAT columns', async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];

    const firstData = sheet.getRow(2);
    expect(firstData.getCell(1).value).toBe('2026-04-01');
    expect(firstData.getCell(2).value).toBe('Carrefour Hypermarket');
    expect(firstData.getCell(3).value).toBe('INV-001');
    expect(firstData.getCell(4).value).toBe(105);
    expect(firstData.getCell(5).value).toBe(5);
    expect(firstData.getCell(4).numFmt ?? '').toContain('AED');
    expect(firstData.getCell(5).numFmt ?? '').toContain('AED');

    const secondData = sheet.getRow(3);
    // String amount "210.50" should be coerced to a real number.
    expect(secondData.getCell(4).value).toBe(210.5);
    expect(secondData.getCell(5).value).toBe(10.02);
    // Date provided as Date object should be normalised to YYYY-MM-DD.
    expect(secondData.getCell(1).value).toBe('2026-04-15');
    // Null invoice number renders as empty, not the string "null".
    const inv = secondData.getCell(3).value;
    expect(inv === null || inv === '' || inv === undefined).toBe(true);
  });

  it('appends a totals row that sums Amount and VAT', async () => {
    const wb = await loadWorkbook(await buildOcrReceiptsWorkbook(sampleRows));
    const sheet = wb.worksheets[0];
    // 2 data rows + 1 header + 1 totals = row 4
    const totalsRow = sheet.getRow(4);
    expect(String(totalsRow.getCell(3).value)).toBe('Total');
    const amountCell: any = totalsRow.getCell(4).value;
    const vatCell: any = totalsRow.getCell(5).value;
    expect(amountCell?.formula ?? '').toMatch(/SUM\(D2:D3\)/i);
    expect(vatCell?.formula ?? '').toMatch(/SUM\(E2:E3\)/i);
  });

  it('handles an empty rows array without throwing', async () => {
    const buf = await buildOcrReceiptsWorkbook([]);
    expect(buf.length).toBeGreaterThan(500);
    const wb = await loadWorkbook(buf);
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toBe('Date');
    // No data → no totals row added.
    const secondRow = sheet.getRow(2).getCell(1).value;
    expect(secondRow === null || secondRow === undefined || secondRow === '').toBe(true);
  });

  it('respects custom currency in the format code', async () => {
    const wb = await loadWorkbook(
      await buildOcrReceiptsWorkbook([{ ...sampleRows[0], currency: 'usd' }]),
    );
    const sheet = wb.worksheets[0];
    expect(sheet.getRow(2).getCell(4).numFmt ?? '').toContain('USD');
  });

  it('maps a saved receipt to a tax-exclusive Amount, preferring stored subtotal', () => {
    // receipts.amount IS the net subtotal — prefer it even when total is present.
    const row = receiptToExportRow({
      date: '2026-04-12',
      merchant: 'Etisalat',
      invoiceNumber: 'INV-9000',
      amount: 100,
      total: 105,
      vatAmount: 5,
      currency: 'AED',
    });
    expect(row).toEqual({
      date: '2026-04-12',
      vendor: 'Etisalat',
      invoiceNumber: 'INV-9000',
      amount: 100,
      vat: 5,
      currency: 'AED',
    });
  });

  it('derives Amount from total - vatAmount when subtotal is missing', () => {
    const row = receiptToExportRow({
      date: '2026-04-12',
      merchant: 'Etisalat',
      total: 105,
      vatAmount: 5,
    });
    expect(row.amount).toBe(100);
    expect(row.vat).toBe(5);
  });

  it('falls back to amount when total is missing', () => {
    const row = receiptToExportRow({
      date: '2026-04-12',
      merchant: 'Etisalat',
      amount: 50,
      vatAmount: null,
    });
    expect(row.amount).toBe(50);
    expect(row.vat).toBe(null);
    expect(row.currency).toBe('AED');
  });

  it('builds a dated filename with the .xlsx extension', () => {
    const name = buildExportFilename();
    expect(name.endsWith('.xlsx')).toBe(true);
    expect(name).toMatch(/^muhasib-ocr-receipts-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
