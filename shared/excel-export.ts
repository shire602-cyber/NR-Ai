export const EXCEL_EXPORT_LIMITS = {
  worksheets: 100,
  rowsPerWorksheet: 5_000,
  columnsPerWorksheet: 100,
  renderedCells: 200_000,
  requestBytes: 10 * 1024 * 1024,
} as const;

type WorksheetDimensions = { columns: readonly unknown[]; rows: readonly unknown[] };

/** Empty cells and header cells still contribute to workbook rendering work. */
export function excelWorkbookCellCount(sheets: readonly WorksheetDimensions[]): number {
  return sheets.reduce((count, { columns, rows }) => count + columns.length * (rows.length + 1), 0);
}

export function supportsExcelWorkbookSize(sheets: readonly WorksheetDimensions[]): boolean {
  return (
    sheets.length >= 1 &&
    sheets.length <= EXCEL_EXPORT_LIMITS.worksheets &&
    sheets.every(
      ({ columns, rows }) =>
        columns.length >= 1 &&
        columns.length <= EXCEL_EXPORT_LIMITS.columnsPerWorksheet &&
        rows.length <= EXCEL_EXPORT_LIMITS.rowsPerWorksheet
    ) &&
    excelWorkbookCellCount(sheets) <= EXCEL_EXPORT_LIMITS.renderedCells
  );
}
