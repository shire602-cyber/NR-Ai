// Comparison columns (Phase 8 D4). The current and the comparison run each return rows keyed by `key`; this merges them:
// every comparable column gains `<key>__cmp` (the prior value), `<key>__delta` (current minus prior) and `<key>__pct`
// (null when the prior value is 0). A row only one side has keeps its place by anchoring after the row before it.

import {
  REPORT_CMP_SUFFIX,
  REPORT_DELTA_SUFFIX,
  REPORT_PCT_SUFFIX,
  type ReportColumn,
  type ReportRow,
} from "../../shared/report-result";
import { round2 } from "../services/financial-statements";

type Cells = Record<string, string | number | null>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Columns of the merged result: each comparable column followed by its three comparison columns. */
export function withComparisonColumns(columns: ReportColumn[]): ReportColumn[] {
  const out: ReportColumn[] = [];
  for (const c of columns) {
    out.push(c);
    if (!c.comparable) continue;
    out.push(
      { key: c.key + REPORT_CMP_SUFFIX, label: { en: `${c.label.en} (prior)`, ar: `${c.label.ar} (السابق)` }, type: c.type },
      { key: c.key + REPORT_DELTA_SUFFIX, label: { en: `${c.label.en} change`, ar: `${c.label.ar} التغير` }, type: c.type },
      { key: c.key + REPORT_PCT_SUFFIX, label: { en: `${c.label.en} change %`, ar: `${c.label.ar} التغير %` }, type: "percent" }
    );
  }
  return out;
}

function comparisonCells(columns: ReportColumn[], cur: Cells, prior: Cells): Cells {
  const out: Cells = { ...cur };
  for (const c of columns) {
    if (!c.comparable) continue;
    const a = num(cur[c.key]);
    const b = num(prior[c.key]);
    out[c.key + REPORT_CMP_SUFFIX] = round2(b);
    out[c.key + REPORT_DELTA_SUFFIX] = round2(a - b);
    out[c.key + REPORT_PCT_SUFFIX] = b === 0 ? null : round2(((a - b) / Math.abs(b)) * 100);
  }
  return out;
}

/** A row the current run did not have: names from the prior row, comparable values 0. */
function zeroedRow(columns: ReportColumn[], prior: ReportRow): ReportRow {
  const cells: Cells = { ...prior.cells };
  for (const c of columns) if (c.comparable) cells[c.key] = 0;
  return { ...prior, cells };
}

export function mergeComparison(columns: ReportColumn[], current: ReportRow[], prior: ReportRow[]): ReportRow[] {
  const priorByKey = new Map(prior.map((r) => [r.key, r]));
  const currentKeys = new Set(current.map((r) => r.key));

  // Order: the current rows, with prior-only rows inserted after the nearest preceding prior row that is placed.
  const ordered: ReportRow[] = [...current];
  const indexOf = (key: string) => ordered.findIndex((r) => r.key === key);
  prior.forEach((row, i) => {
    if (currentKeys.has(row.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = indexOf(prior[j].key);
      if (idx >= 0) {
        at = idx + 1;
        break;
      }
    }
    ordered.splice(at, 0, zeroedRow(columns, row));
  });

  return ordered.map((r) => {
    // A heading carries no figures: it gets no comparison cells either.
    if (r.kind === "section") return r;
    const p = priorByKey.get(r.key);
    return { ...r, cells: comparisonCells(columns, r.cells, p?.cells ?? {}) };
  });
}

export function mergeTotals(
  columns: ReportColumn[],
  current: Cells | undefined,
  prior: Cells | undefined
): Cells | undefined {
  if (!current) return undefined;
  return comparisonCells(columns, current, prior ?? {});
}
