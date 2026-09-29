/**
 * Pure building blocks shared by VAT and corporate-tax "filed with evidence":
 * snapshot construction, canonical JSON + SHA-256, per-box differences and
 * validation of the filing record. No I/O, so it is unit-tested directly.
 *
 * Muhasib never transmits to the FTA. A filing record is the user's own record
 * of a return they filed on EmaraTax: reference number, filing date and the
 * FTA's acknowledgement, frozen together with the figures as they were filed.
 */

import { createHash } from "node:crypto";
import { LEGACY_VAT_RETURN_FIELDS } from "./vat-return-payload.service";
import { uaeTodayYmd } from "./vat-period-status.service";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_REFERENCE_LENGTH = 100;

/** Round to fils (half away from zero), tolerant of binary float noise. */
export function toFils(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7));
}
export const fromFils = (fils: number): number => Math.round(fils) / 100;
export const round2 = (value: number): number => fromFils(toFils(value));

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD calendar date of a stored timestamp/string (UTC components, the storage convention). */
export function ymdOf(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

// ─── Canonical JSON + hash ───────────────────────────────────────────────────

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** JSON with recursively sorted keys: the same figures always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function snapshotHash(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

// ─── VAT snapshot ────────────────────────────────────────────────────────────

const LEGACY = new Set<string>(LEGACY_VAT_RETURN_FIELDS);
const BOX_KEY = /^box\d/;

export interface VatSnapshot {
  schemaVersion: number;
  kind: "vat";
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  vatStagger: string | null;
  boxes: Record<string, number>;
  adjustmentAmount: number;
  adjustmentReason: string | null;
}

/** Every canonical VAT 201 box of a vat_returns row, frozen. Legacy aliases are excluded. */
export function buildVatSnapshot(row: Record<string, unknown>): VatSnapshot {
  const boxes: Record<string, number> = {};
  for (const key of Object.keys(row).sort()) {
    if (!BOX_KEY.test(key) || LEGACY.has(key)) continue;
    const n = Number(row[key]);
    boxes[key] = Number.isFinite(n) ? round2(n) : 0;
  }
  const due = row.dueDate as string | Date | null | undefined;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "vat",
    periodStart: ymdOf(row.periodStart as string | Date),
    periodEnd: ymdOf(row.periodEnd as string | Date),
    dueDate: due ? ymdOf(due) : null,
    vatStagger: (row.vatStagger as string | null | undefined) ?? null,
    boxes,
    adjustmentAmount: round2(Number(row.adjustmentAmount ?? 0)),
    adjustmentReason: (row.adjustmentReason as string | null | undefined) ?? null,
  };
}

// ─── Differences ─────────────────────────────────────────────────────────────

export interface BoxDifference {
  box: string;
  filed: number;
  current: number;
  difference: number;
}

/** Boxes whose value differs by at least one fils; a box absent on one side counts as 0. */
export function diffBoxes(
  filed: Record<string, number>,
  current: Record<string, number>
): BoxDifference[] {
  const keys = new Set([...Object.keys(filed), ...Object.keys(current)]);
  const out: BoxDifference[] = [];
  for (const box of [...keys].sort()) {
    const a = toFils(filed[box] ?? 0);
    const b = toFils(current[box] ?? 0);
    if (a === b) continue;
    out.push({ box, filed: fromFils(a), current: fromFils(b), difference: fromFils(b - a) });
  }
  return out;
}

// ─── Stored draft vs the books, at filing time ───────────────────────────────

export type AcceptFigures = "stored" | "recomputed";

export type DraftAssessment =
  | { action: "use_stored"; differences: BoxDifference[] }
  | { action: "use_recomputed"; differences: BoxDifference[] }
  | { action: "refuse"; code: "VAT_RETURN_STALE"; differences: BoxDifference[] };

/**
 * What to file when the stored draft and a fresh computation from the books differ.
 * `differences` are stored (filed) vs recomputed (current), per box.
 *
 *   no difference                  -> the stored draft
 *   never edited by hand           -> silently the recomputed figures (the draft was just stale)
 *   hand-edited                    -> refuse (VAT_RETURN_STALE) until the user chooses
 *   acceptFigures "stored"/"recomputed" -> that choice, always
 */
export function assessDraftFigures(input: {
  stored: Record<string, number>;
  recomputed: Record<string, number>;
  hasManualEdits: boolean;
  acceptFigures?: AcceptFigures | null;
}): DraftAssessment {
  const differences = diffBoxes(input.stored, input.recomputed);
  if (differences.length === 0) return { action: "use_stored", differences };
  if (input.acceptFigures === "stored") return { action: "use_stored", differences };
  if (input.acceptFigures === "recomputed") return { action: "use_recomputed", differences };
  if (input.hasManualEdits) return { action: "refuse", code: "VAT_RETURN_STALE", differences };
  return { action: "use_recomputed", differences };
}

// ─── Manual box edits on a draft ─────────────────────────────────────────────

export interface ManualEdits {
  boxes: Record<string, { from: number; to: number }>;
  at: string;
  by: string | null;
}

/**
 * The edit log after a PATCH: every canonical box whose value now differs from what it was when
 * the log started keeps { from (first value), to (latest) }; a box put back to its original
 * value drops out. Returns null when nothing has been edited (so a clean draft stays clean).
 * Legacy aliases are not user-editable and are ignored.
 */
export function mergeManualEdits(
  existingEdits: ManualEdits | null | undefined,
  existingRow: Record<string, unknown>,
  patch: Record<string, unknown>,
  ctx: { userId: string | null; now?: Date }
): ManualEdits | null {
  const boxes: Record<string, { from: number; to: number }> = { ...(existingEdits?.boxes ?? {}) };
  let touched = false;
  for (const key of Object.keys(patch)) {
    if (!BOX_KEY.test(key) || LEGACY.has(key)) continue;
    const before = toFils(Number(existingRow[key] ?? 0));
    const after = toFils(Number(patch[key] ?? 0));
    if (before === after) continue;
    touched = true;
    const from = boxes[key] ? toFils(boxes[key].from) : before;
    if (from === after) delete boxes[key];
    else boxes[key] = { from: fromFils(from), to: fromFils(after) };
  }
  if (!touched) return existingEdits && Object.keys(existingEdits.boxes ?? {}).length > 0 ? existingEdits : null;
  if (Object.keys(boxes).length === 0) return null;
  return { boxes, at: (ctx.now ?? new Date()).toISOString(), by: ctx.userId };
}

/** Signed change (stored minus computed) the log records on box 12 and box 13. */
export function manualSettlementDelta(edits: ManualEdits | null | undefined): { outputVat: number; inputVat: number } {
  const delta = (box: string) => {
    const e = edits?.boxes?.[box];
    return e ? fromFils(toFils(e.to) - toFils(e.from)) : 0;
  };
  return { outputVat: delta("box12TotalDueTax"), inputVat: delta("box13RecoverableTax") };
}

export const hasRecordedManualEdits = (
  edits: ManualEdits | null | undefined,
  adjustmentAmount: unknown
): boolean => Object.keys(edits?.boxes ?? {}).length > 0 || toFils(Number(adjustmentAmount ?? 0)) !== 0;

// ─── Filing input validation ─────────────────────────────────────────────────

export type FilingInputResult =
  | { ok: true; referenceNumber: string; filedAt: string }
  | { ok: false; status: 400 | 422; code: string; message: string };

const isRealDate = (ymd: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
};

/**
 * Rules for recording a return as filed: a reference number, and a filing date
 * that is a real calendar day, not in the future (UAE day) and not before the
 * end of the period the return covers.
 */
export function validateFilingInput(input: {
  referenceNumber?: unknown;
  filedAt?: unknown;
  periodEnd: string;
  now?: Date;
}): FilingInputResult {
  const reference = typeof input.referenceNumber === "string" ? input.referenceNumber.trim() : "";
  if (!reference) {
    return {
      ok: false, status: 400, code: "FTA_REFERENCE_REQUIRED",
      message: "The FTA reference number from the acknowledgement is required to record a filing.",
    };
  }
  if (reference.length > MAX_REFERENCE_LENGTH) {
    return {
      ok: false, status: 400, code: "FTA_REFERENCE_INVALID",
      message: `The FTA reference number must be at most ${MAX_REFERENCE_LENGTH} characters.`,
    };
  }
  if (input.filedAt === undefined || input.filedAt === null || input.filedAt === "") {
    return { ok: false, status: 400, code: "FILED_AT_REQUIRED", message: "The date the return was filed with the FTA is required." };
  }
  const filedAt = typeof input.filedAt === "string" ? input.filedAt.trim().slice(0, 10) : "";
  if (!isRealDate(filedAt)) {
    return { ok: false, status: 400, code: "FILED_AT_INVALID", message: "The filing date must be a real date in YYYY-MM-DD format." };
  }
  if (filedAt > uaeTodayYmd(input.now)) {
    return { ok: false, status: 422, code: "FILED_AT_IN_FUTURE", message: "The filing date cannot be in the future." };
  }
  if (filedAt < input.periodEnd.slice(0, 10)) {
    return {
      ok: false, status: 422, code: "FILED_AT_BEFORE_PERIOD_END",
      message: "The filing date cannot be before the end of the period the return covers.",
    };
  }
  return { ok: true, referenceNumber: reference, filedAt };
}

// ─── Period months ───────────────────────────────────────────────────────────

/**
 * Last day (YYYY-MM-DD) of every calendar month touched by [startYmd, endYmd].
 * A month_end_close row locks exactly one calendar month, so locking the
 * months of a VAT period means one row per entry returned here.
 */
export function monthEndsInRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let year = Number(startYmd.slice(0, 4));
  let month = Number(startYmd.slice(5, 7)); // 1-12
  const endYear = Number(endYmd.slice(0, 4));
  const endMonth = Number(endYmd.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    out.push(`${year}-${pad(month)}-${pad(lastDay)}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

// ─── Corporate tax snapshot ──────────────────────────────────────────────────

const CT_SNAPSHOT_FIELDS = [
  "totalRevenue",
  "totalExpenses",
  "totalDeductions",
  "taxableIncome",
  "exemptionThreshold",
  "taxRate",
  "taxPayable",
  "lossBroughtForward",
  "lossCarriedForward",
] as const;

export interface CtSnapshot {
  schemaVersion: number;
  kind: "corporate_tax";
  periodStart: string;
  periodEnd: string;
  boxes: Record<string, number>;
  smallBusinessRelief: boolean;
  /** SHA-256 of the workpaper JSON, so a later edit to the workpaper is detectable. */
  workpaperHash: string;
}

/** Every figure of a corporate_tax_returns row, frozen. Tax rate keeps 4 decimals; money is fils. */
export function buildCtSnapshot(row: Record<string, unknown>): CtSnapshot {
  const boxes: Record<string, number> = {};
  for (const key of CT_SNAPSHOT_FIELDS) {
    const n = Number(row[key]);
    const value = Number.isFinite(n) ? n : 0;
    boxes[key] = key === "taxRate" ? Math.round(value * 10000) / 10000 : round2(value);
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    kind: "corporate_tax",
    periodStart: ymdOf(row.taxPeriodStart as string | Date),
    periodEnd: ymdOf(row.taxPeriodEnd as string | Date),
    boxes,
    smallBusinessRelief: row.smallBusinessRelief === true,
    workpaperHash: snapshotHash(row.workpaper ?? null),
  };
}
