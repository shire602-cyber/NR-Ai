// Fixed-asset register (as of a day) and depreciation schedule (posted months plus a projection to the end of life).
// Read-only. The register's totals are tied to the ledger: cost on 1290 less accumulated depreciation on 1240.

import { dubaiDaySql, dubaiDayTextSql } from "./vat-dubai-day";
import { pool } from "../db";
import { AppError } from "../errors";
import { calculateDepreciation } from "./fixed-asset-depreciation-math";

const num = (v: unknown): number => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RegisterRow {
  assetId: string;
  number: string | null;
  name: string;
  category: string;
  purchaseDate: string;
  cost: number;
  accumulated: number;
  nbv: number;
  status: string;
  onLedger: boolean;
}

export interface AssetRegister {
  asOf: string;
  rows: RegisterRow[];
  totals: { cost: number; accumulated: number; nbv: number };
  glTie: { gl1290: number; gl1240: number; difference: number; needsCapitalization: Array<{ assetId: string; number: string | null; name: string; cost: number }> };
}

export async function assetRegister(companyId: string, asOf: string): Promise<AssetRegister> {
  const assets = await pool.query(
    `SELECT fa.id, fa.asset_number, fa.asset_name, fa.category, ${dubaiDayTextSql("fa.purchase_date")} AS purchase_day, fa.purchase_cost::float8 AS cost, fa.status,
            fa.disposal_date, fa.needs_capitalization_je,
            COALESCE((SELECT SUM(ds.amount) FROM depreciation_schedules ds
                       LEFT JOIN journal_entries dje ON dje.id = ds.journal_entry_id
                       WHERE ds.asset_id = fa.id
                         AND COALESCE(${dubaiDaySql("dje.date")}, (make_date(ds.period_year, ds.period_month, 1) + interval '1 month - 1 day')::date) <= $2::date), 0)::float8 AS accumulated
       FROM fixed_assets fa
      WHERE fa.company_id = $1 AND ${dubaiDaySql("fa.purchase_date")} <= $3::date
        AND (fa.status IS DISTINCT FROM 'disposed' OR fa.disposal_date IS NULL OR ${dubaiDaySql("fa.disposal_date")} > $3::date)
      ORDER BY fa.purchase_date, fa.asset_number NULLS LAST, fa.asset_name`,
    [companyId, asOf, asOf]
  );
  const rows: RegisterRow[] = assets.rows.map((a: any) => {
    const cost = round2(num(a.cost));
    const accumulated = round2(num(a.accumulated));
    const disposedLater = a.status === "disposed";
    return {
      assetId: a.id,
      number: a.asset_number,
      name: a.asset_name,
      category: a.category,
      purchaseDate: a.purchase_day,
      cost,
      accumulated,
      nbv: round2(cost - accumulated),
      status: disposedLater ? "active" : (a.status ?? "active"),
      onLedger: a.needs_capitalization_je !== true,
    };
  });
  const onLedger = rows.filter((r) => r.onLedger);
  const totals = {
    cost: round2(onLedger.reduce((s, r) => s + r.cost, 0)),
    accumulated: round2(onLedger.reduce((s, r) => s + r.accumulated, 0)),
    nbv: round2(onLedger.reduce((s, r) => s + r.nbv, 0)),
  };

  const gl = await pool.query(
    `SELECT a.code, COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS net
       FROM accounts a
       LEFT JOIN journal_lines jl ON jl.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted' AND ${dubaiDaySql("je.date")} <= $2::date
      WHERE a.company_id = $1 AND a.code IN ('1290', '1240') AND (jl.id IS NULL OR je.id IS NOT NULL)
      GROUP BY a.code`,
    [companyId, asOf]
  );
  const byCode = new Map<string, number>(gl.rows.map((r: any) => [r.code, num(r.net)]));
  const gl1290 = round2(byCode.get("1290") ?? 0);
  const gl1240 = round2(-(byCode.get("1240") ?? 0));
  return {
    asOf,
    rows,
    totals,
    glTie: {
      gl1290,
      gl1240,
      difference: round2(totals.nbv - (gl1290 - gl1240)),
      needsCapitalization: rows.filter((r) => !r.onLedger).map((r) => ({ assetId: r.assetId, number: r.number, name: r.name, cost: r.cost })),
    },
  };
}

export interface ScheduleRow {
  assetId: string;
  number: string | null;
  name: string;
  year: number;
  month: number;
  amount: number;
  accumulated: number;
  nbv: number;
  projected: boolean;
  /** Booked in a catch-up journal because the month lies in a closed or locked period. */
  catchUp: boolean;
  journalEntryId: string | null;
}

const MAX_PROJECTED_MONTHS = 600;

/** Posted depreciation within [from, to] and, with projectToEnd, the months still to come until each asset reaches salvage. */
export async function depreciationSchedule(companyId: string, args: { from?: string; to?: string; projectToEnd: boolean }): Promise<ScheduleRow[]> {
  const assets = await pool.query(
    `SELECT id, asset_number, asset_name, category, ${dubaiDayTextSql("purchase_date")} AS purchase_day, purchase_cost, salvage_value, useful_life_years, depreciation_method, status
       FROM fixed_assets WHERE company_id = $1 ORDER BY purchase_date, asset_name`,
    [companyId]
  );
  const posted = await pool.query(
    `SELECT asset_id, period_year, period_month, amount::float8 AS amount, catch_up, journal_entry_id
       FROM depreciation_schedules WHERE company_id = $1 ORDER BY asset_id, period_year, period_month`,
    [companyId]
  );
  const byAsset = new Map<string, any[]>();
  for (const p of posted.rows as any[]) byAsset.set(p.asset_id, [...(byAsset.get(p.asset_id) ?? []), p]);

  const key = (y: number, m: number) => y * 100 + m;
  const fromKey = args.from ? key(Number(args.from.slice(0, 4)), Number(args.from.slice(5, 7))) : 0;
  const toKey = args.to ? key(Number(args.to.slice(0, 4)), Number(args.to.slice(5, 7))) : 999_999;
  const out: ScheduleRow[] = [];

  for (const a of assets.rows as any[]) {
    const cost = num(a.purchase_cost);
    let accumulated = 0;
    let months = 0;
    let lastKey = 0;
    for (const p of byAsset.get(a.id) ?? []) {
      accumulated = round2(accumulated + num(p.amount));
      months++;
      lastKey = key(p.period_year, p.period_month);
      if (lastKey >= fromKey && lastKey <= toKey) {
        out.push({ assetId: a.id, number: a.asset_number, name: a.asset_name, year: p.period_year, month: p.period_month, amount: round2(num(p.amount)), accumulated, nbv: round2(cost - accumulated), projected: false, catchUp: p.catch_up === true, journalEntryId: p.journal_entry_id ?? null });
      }
    }
    if (!args.projectToEnd || a.status === "disposed") continue;

    const pd = new Date(`${a.purchase_day}T00:00:00Z`);
    a.purchase_date = pd;
    let y = lastKey ? Math.floor(lastKey / 100) : pd.getUTCFullYear();
    let m = lastKey ? lastKey % 100 : pd.getUTCMonth() + 1;
    if (lastKey) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    for (let i = 0; i < MAX_PROJECTED_MONTHS; i++) {
      const calc = calculateDepreciation({ ...a, accumulated_depreciation: accumulated }, y, m, months);
      if (calc.skipped || calc.monthlyDepreciation <= 0) break;
      if (key(y, m) > toKey) break;
      accumulated = calc.newAccumulatedDepreciation;
      months++;
      if (key(y, m) >= fromKey) {
        out.push({ assetId: a.id, number: a.asset_number, name: a.asset_name, year: y, month: m, amount: calc.monthlyDepreciation, accumulated, nbv: calc.newNetBookValue, projected: true, catchUp: false, journalEntryId: null });
      }
      if (calc.fullyDepreciated) break; // the last charge brings the asset to salvage
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return out.sort((x, z) => x.year * 100 + x.month - (z.year * 100 + z.month) || (x.name ?? "").localeCompare(z.name ?? ""));
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function registerCsv(r: AssetRegister): string {
  const rows: unknown[][] = [
    ["Asset register", r.asOf],
    [],
    ["Number", "Name", "Category", "Purchase date", "Cost", "Accumulated depreciation", "Net book value", "Status", "On ledger"],
    ...r.rows.map((x) => [x.number ?? "", x.name, x.category, x.purchaseDate, x.cost, x.accumulated, x.nbv, x.status, x.onLedger ? "yes" : "no"]),
    [],
    ["Total (on ledger)", "", "", "", r.totals.cost, r.totals.accumulated, r.totals.nbv],
    ["Ledger 1290 less 1240", "", "", "", r.glTie.gl1290, r.glTie.gl1240, r.glTie.gl1290 - r.glTie.gl1240],
    ["Difference", "", "", "", "", "", r.glTie.difference],
  ];
  return "\uFEFF" + rows.map((x) => x.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function scheduleCsv(rows: ScheduleRow[]): string {
  const all: unknown[][] = [
    ["Number", "Name", "Year", "Month", "Depreciation", "Accumulated", "Net book value", "Projected"],
    ...rows.map((x) => [x.number ?? "", x.name, x.year, x.month, x.amount, x.accumulated, x.nbv, x.projected ? "yes" : "no"]),
  ];
  return "\uFEFF" + all.map((x) => x.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function assertDay(v: unknown, name: string): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AppError({ message: `${name} must be YYYY-MM-DD`, statusCode: 400, code: "VALIDATION_ERROR" });
  return v;
}
