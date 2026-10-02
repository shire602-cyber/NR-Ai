// Small builders shared by the report definitions (Phase 8 D4).

import type { ReportColumnType, ReportDrillTarget, ReportRow } from "../../../shared/report-result";
import { round2 } from "../../services/financial-statements";
import type { DefColumn, ReportContext } from "../registry";

export const isAr = (ctx: ReportContext): boolean => ctx.params.lang === "ar";

/** Pick the row-text language the request asked for. */
export const pick = (ctx: ReportContext, en: string, ar: string): string => (isAr(ctx) ? ar : en);

/** Account display name in the requested language (Arabic falls back to English). */
export const acctName = (ctx: ReportContext, a: { nameEn: string; nameAr?: string | null }): string =>
  isAr(ctx) && a.nameAr ? a.nameAr : a.nameEn;

type ColOpts = { comparable?: boolean; sum?: boolean };

export const col = (key: string, en: string, ar: string, type: ReportColumnType = "text", opts: ColOpts = {}): DefColumn => ({
  key,
  label: { en, ar },
  type,
  ...opts,
});
export const moneyCol = (key: string, en: string, ar: string, opts: ColOpts = {}): DefColumn => col(key, en, ar, "money", opts);

/** Common labels. */
export const C = {
  code: col("code", "Code", "الرمز"),
  account: col("name", "Account", "الحساب"),
  date: col("date", "Date", "التاريخ", "date"),
  number: col("number", "Number", "الرقم"),
  description: col("description", "Description", "الوصف"),
  customer: col("customer", "Customer", "العميل"),
  vendor: col("vendor", "Vendor", "المورد"),
  status: col("status", "Status", "الحالة"),
  reference: col("reference", "Reference", "المرجع"),
  currency: col("currency", "Currency", "العملة"),
  debit: (opts: ColOpts = { sum: true }) => moneyCol("debit", "Debit", "مدين", opts),
  credit: (opts: ColOpts = { sum: true }) => moneyCol("credit", "Credit", "دائن", opts),
};

export function detail(
  key: string,
  cells: ReportRow["cells"],
  drill?: { target: ReportDrillTarget; id: string },
  depth = 0
): ReportRow {
  return { key, kind: "detail", depth, cells, ...(drill ? { drill } : {}) };
}

export function section(key: string, cells: ReportRow["cells"], depth = 0, drill?: { target: ReportDrillTarget; id: string }): ReportRow {
  return { key, kind: "section", depth, cells, ...(drill ? { drill } : {}) };
}

export function subtotal(key: string, cells: ReportRow["cells"], depth = 0): ReportRow {
  return { key, kind: "subtotal", depth, cells };
}

/** Sum a list of money numbers exactly (fils). */
export function sumMoney(values: Array<number | null | undefined>): number {
  let fils = 0;
  for (const v of values) fils += Math.round((Number(v ?? 0) + Number.EPSILON) * 100);
  return fils / 100;
}

/** Document currency amount converted to AED at the document's rate (rate defaults to 1). */
export const aed = (amount: number, rate: unknown): number => {
  const r = Number(rate);
  return round2(amount * (Number.isFinite(r) && r > 0 ? r : 1));
};

/** Cap SQL: ask for one row more than the cap so run.ts can refuse an oversized report. */
export const capSql = (ctx: ReportContext): string => `LIMIT ${ctx.maxRows + 1}`;
