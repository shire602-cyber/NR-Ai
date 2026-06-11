import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import {
  computeCtLiability,
  computeCtTotals,
  normalizeCtRowType,
  parseCtPasteRows,
} from '../../shared/ct-workpaper';
import {
  buildCtReturnWorkbook,
  buildCtTemplateWorkbook,
  ctReturnExportFilename,
  parseCtWorkbookRows,
} from '../../server/services/ct-workpaper-export.service';

function fakeReturn() {
  return {
    id: 'ct-1',
    companyId: 'company-1',
    taxPeriodStart: new Date('2026-01-01'),
    taxPeriodEnd: new Date('2026-12-31'),
    totalRevenue: 570000,
    totalExpenses: 270000,
    totalDeductions: 0,
    taxableIncome: 300000,
    exemptionThreshold: 375000,
    taxRate: 0.09,
    taxPayable: 0,
    status: 'draft',
    filedAt: null,
    notes: null,
    createdAt: new Date(),
    workpaper: {
      source: 'manual_workpaper',
      rows: [
        { id: 'r1', type: 'revenue', label: 'Product sales', amount: 450000 },
        { id: 'r2', type: 'revenue', label: 'Service income', amount: 120000 },
        { id: 'e1', type: 'expense', label: 'Salaries', amount: 210000, notes: 'WPS' },
        { id: 'e2', type: 'expense', label: 'Rent', amount: 60000 },
      ],
      totalRevenue: 570000,
      totalExpenses: 270000,
      profitOrLoss: 300000,
      preparedAt: new Date().toISOString(),
    },
  } as any;
}

describe('CT workpaper helpers', () => {
  it('parses pasted rows with bookkeeper-friendly headers', () => {
    const rows = parseCtPasteRows(
      ['type\tdescription\tamount aed\tnotes', 'Income\tConsulting fees\t12,500.00\tQ2'].join('\n'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'revenue', label: 'Consulting fees', amount: 12500, notes: 'Q2' });
  });

  it('defaults unknown types to expense and normalizes revenue aliases', () => {
    expect(normalizeCtRowType('Sales')).toBe('revenue');
    expect(normalizeCtRowType('income')).toBe('revenue');
    expect(normalizeCtRowType('whatever')).toBe('expense');
  });

  it('computes UAE CT liability with the small-business threshold', () => {
    const totals = computeCtTotals(fakeReturn().workpaper.rows);
    expect(totals).toEqual({ totalRevenue: 570000, totalExpenses: 270000, profitOrLoss: 300000 });

    // Profit 300k is below the 375k threshold → zero tax.
    const below = computeCtLiability({ totalRevenue: 570000, totalExpenses: 270000 });
    expect(below.taxPayable).toBe(0);

    // Profit 500k → 9% on the 125k above threshold.
    const above = computeCtLiability({ totalRevenue: 770000, totalExpenses: 270000 });
    expect(above.taxableAmount).toBe(125000);
    expect(above.taxPayable).toBe(11250);
  });
});

describe('CT workbook export', () => {
  it('builds workpaper + computation sheets with the right numbers', async () => {
    const buffer = await buildCtReturnWorkbook(fakeReturn(), {
      name: 'Pearl Trading LLC',
      trnVatNumber: '100123456700003',
    } as any);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const grid = workbook.getWorksheet('CT Workpaper');
    const comp = workbook.getWorksheet('CT Computation');
    expect(grid).toBeDefined();
    expect(comp).toBeDefined();

    const text = (sheet: ExcelJS.Worksheet) => {
      const out: string[] = [];
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: true }, (cell) => out.push(String(cell.value ?? '')));
      });
      return out.join('|');
    };
    expect(text(grid!)).toContain('Product sales');
    expect(text(grid!)).toContain('Salaries');
    expect(text(comp!)).toContain('Corporate tax payable');
    expect(text(comp!)).toContain('375000');
  });

  it('template rows round-trip through the shared parser', async () => {
    const buffer = await buildCtTemplateWorkbook();
    const rows = await parseCtWorkbookRows(buffer);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ type: 'revenue', label: 'Product sales', amount: 450000 });
    expect(rows[2]).toMatchObject({ type: 'expense', label: 'Salaries and wages', amount: 210000 });
  });

  it('derives a clean export filename', () => {
    expect(ctReturnExportFilename(fakeReturn(), { name: 'Pearl Trading LLC' } as any)).toBe(
      'ct-workpaper-pearl-trading-llc-2026-12-31.xlsx',
    );
  });
});
