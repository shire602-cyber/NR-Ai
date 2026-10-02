// XLSX renderer (Phase 8 D4): one sheet through buildGenericWorkbook (excel-export.service.ts), right-to-left for Arabic.

import type { ReportColumn, ReportResult } from "../../../shared/report-result";
import { buildGenericWorkbook } from "../../services/excel-export.service";
import { labelOf, titleOf, totalsCells, type Lang } from "./common";

const numFmt = (c: ReportColumn): string | undefined =>
  c.type === "percent" ? '0.00"%"' : c.type === "number" ? "#,##0.##" : c.type === "money" ? "#,##0.00" : undefined;

export async function renderXlsx(result: ReportResult, lang: Lang): Promise<Buffer> {
  const rows = result.rows.map((r) => ({ ...r.cells }));
  const totals = totalsCells(result, lang);
  if (totals) rows.push({ ...totals });
  const title = titleOf(result, lang);
  return buildGenericWorkbook(
    [
      {
        sheetName: title.slice(0, 31),
        columns: result.columns.map((c) => ({
          header: labelOf(c, lang),
          key: c.key,
          numFmt: numFmt(c),
          width: c.type === "text" ? 30 : c.type === "date" ? 14 : 18,
        })),
        rows,
      },
    ],
    { title, rightToLeft: lang === "ar" }
  );
}
