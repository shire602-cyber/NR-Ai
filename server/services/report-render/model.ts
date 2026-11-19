/**
 * Render model shared by the server-side PDF and XLSX writers (W5-A, R11-12, R12-10).
 *
 * A statement builder (statements.ts) turns a server/reporting result into a
 * RenderedReport; pdf.ts and xlsx.ts only lay that model out. Figures are never
 * recomputed here: every number comes from server/reporting (integer fils summed in
 * SQL, converted to AED once) or the VAT engine.
 */

import { formatMoneyAmount } from "../../utils/money-format";
import { calendarParts } from "../../../shared/uae-date";

export type RenderLocale = "en" | "ar";

/** A label in both languages; the company's own language is shown first. */
export interface Bilingual {
  en: string;
  ar: string;
}

export interface RenderColumn {
  key: string;
  header: Bilingual;
  /** Numeric columns are right-aligned and written as numeric XLSX cells. */
  numeric?: boolean;
  /** Relative width weight for the PDF table (default 1). */
  weight?: number;
}

export type RenderRowStyle = "normal" | "heading" | "subtotal" | "total";

export interface RenderRow {
  cells: Record<string, string | number | null>;
  style?: RenderRowStyle;
}

export interface RenderTable {
  title?: Bilingual;
  columns: RenderColumn[];
  rows: RenderRow[];
}

/** How a report's figures are sourced (R12-13): ledger = posted journal lines. */
export type RenderDataBasis = "ledger" | "documents" | "snapshot_proxy";

export interface RenderedReport {
  /** Stable id, matches the report catalog id where one exists. */
  id: string;
  title: Bilingual;
  /** "1 Jan 2026 – 31 Mar 2026" / "As of 31 Mar 2026". */
  period: string;
  basis: RenderDataBasis;
  tables: RenderTable[];
  /** Footnotes (balance checks, labels such as "estimate"). */
  notes: Bilingual[];
}

export interface RenderCompany {
  id: string;
  name: string;
  legalName: string | null;
  trn: string | null;
  address: string | null;
  locale: RenderLocale;
}

export function label(locale: RenderLocale, text: Bilingual): string {
  return locale === "ar" ? text.ar : text.en;
}

/** "English / العربية" in the company's language order. */
export function bilingualLabel(locale: RenderLocale, text: Bilingual): string {
  return locale === "ar" ? `${text.ar} / ${text.en}` : `${text.en} / ${text.ar}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatIsoDate(iso: string): string {
  const p = calendarParts(iso);
  if (!p) return iso;
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Arabic counterpart of formatIsoDate: "18 نوفمبر 2026" (Latin digits, as in the app). */
export function formatIsoDateAr(iso: string): string {
  const p = calendarParts(iso);
  if (!p) return iso;
  return `${p.day} ${MONTHS_AR[p.month - 1]} ${p.year}`;
}

/** A date for a note in both languages: { en: "18 Nov 2026", ar: "18 نوفمبر 2026" }. */
export function bilingualDate(iso: string): Bilingual {
  return { en: formatIsoDate(iso), ar: formatIsoDateAr(iso) };
}

/**
 * Money inside note text (B12), through the shared document money formatter
 * (server/utils/money-format.ts): { en: "AED 4,500.00", ar: "4,500.00 درهم" }.
 * Table cells keep formatAmount; this is only for amounts written into sentences.
 */
export function bilingualMoney(amount: number): Bilingual {
  return { en: formatMoneyAmount(amount), ar: `${formatMoneyAmount(amount, "")} درهم` };
}

export function periodLabel(from: string | null, to: string, locale: RenderLocale = "en"): string {
  if (locale === "ar") {
    return from
      ? `${formatIsoDateAr(from)} – ${formatIsoDateAr(to)}`
      : `كما في ${formatIsoDateAr(to)}`;
  }
  return from ? `${formatIsoDate(from)} – ${formatIsoDate(to)}` : `As of ${formatIsoDate(to)}`;
}

export function formatAmount(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(Math.round(value * 100) / 100);
  return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
