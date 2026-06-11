/**
 * Corporate-tax workpaper grid helpers — shared between the client editor
 * and the server's .xlsx import so the two can never drift (same pattern as
 * shared/vat-workpaper-grid.ts).
 */

export type CtWorkpaperRowType = 'revenue' | 'expense';

export interface CtWorkpaperRow {
  id: string;
  label: string;
  type: CtWorkpaperRowType;
  amount: number;
  notes?: string;
}

export interface CtWorkpaperTotals {
  totalRevenue: number;
  totalExpenses: number;
  profitOrLoss: number;
}

function compactKey(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseDelimitedLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function moneyFromCell(value: string | undefined): number {
  const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function normalizeCtRowType(value: string | undefined): CtWorkpaperRowType {
  const normalized = compactKey(value);
  if (
    normalized.includes('revenue') ||
    normalized.includes('income') ||
    normalized.includes('sales') ||
    normalized === 'rev'
  ) {
    return 'revenue';
  }
  return 'expense';
}

const HEADER_ALIASES: Record<string, string[]> = {
  type: ['type', 'row type', 'category'],
  label: ['label', 'description', 'item', 'line item', 'account', 'name'],
  amount: ['amount', 'amount aed', 'value', 'total'],
  notes: ['notes', 'memo', 'remarks', 'comment'],
};

function headerIndex(headerCells: string[], field: keyof typeof HEADER_ALIASES): number {
  const aliases = new Set(HEADER_ALIASES[field].map(compactKey));
  return headerCells.findIndex((cell) => aliases.has(compactKey(cell)));
}

function hasRecognisedHeader(cells: string[]): boolean {
  return (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).some(
    (key) => headerIndex(cells, key) >= 0,
  );
}

function pickCell(
  cells: string[],
  headerCells: string[] | null,
  field: keyof typeof HEADER_ALIASES,
  fallbackIndex: number,
): string | undefined {
  if (headerCells) {
    const index = headerIndex(headerCells, field);
    return index >= 0 ? cells[index] : undefined;
  }
  return cells[fallbackIndex];
}

/**
 * Parses tab-delimited (Excel paste) or CSV rows into workpaper rows.
 * Column order without headers: type, label, amount, notes.
 */
export function parseCtPasteRows(text: string): CtWorkpaperRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const firstCells = parseDelimitedLine(lines[0]);
  const headerCells = hasRecognisedHeader(firstCells) ? firstCells : null;
  const rows = headerCells ? lines.slice(1) : lines;

  return rows
    .map((line, index) => {
      const cells = parseDelimitedLine(line);
      const label = pickCell(cells, headerCells, 'label', 1) ?? '';
      const amount = moneyFromCell(pickCell(cells, headerCells, 'amount', 2));
      return {
        id: `import-${Date.now()}-${index}`,
        type: normalizeCtRowType(pickCell(cells, headerCells, 'type', 0)),
        label: label || `Imported row ${index + 1}`,
        amount,
        notes: pickCell(cells, headerCells, 'notes', 3) || undefined,
      };
    })
    .filter((row) => row.label.trim().length > 0 && row.amount !== 0);
}

export function computeCtTotals(rows: Array<Pick<CtWorkpaperRow, 'type' | 'amount'>>): CtWorkpaperTotals {
  const totalRevenue = rows
    .filter((row) => row.type === 'revenue')
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const totalExpenses = rows
    .filter((row) => row.type === 'expense')
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    profitOrLoss: Math.round((totalRevenue - totalExpenses) * 100) / 100,
  };
}

/** UAE corporate tax computation from workpaper totals. */
export function computeCtLiability(input: {
  totalRevenue: number;
  totalExpenses: number;
  totalDeductions?: number;
  exemptionThreshold?: number;
  taxRate?: number;
}): {
  taxableIncome: number;
  taxableAmount: number;
  taxPayable: number;
  exemptionThreshold: number;
  taxRate: number;
} {
  const exemptionThreshold = input.exemptionThreshold ?? 375000;
  const taxRate = input.taxRate ?? 0.09;
  const taxableIncome = input.totalRevenue - input.totalExpenses - (input.totalDeductions ?? 0);
  const taxableAmount = Math.max(0, taxableIncome - exemptionThreshold);
  const taxPayable = Math.round(taxableAmount * taxRate * 100) / 100;
  return {
    taxableIncome: Math.round(taxableIncome * 100) / 100,
    taxableAmount: Math.round(taxableAmount * 100) / 100,
    taxPayable,
    exemptionThreshold,
    taxRate,
  };
}
