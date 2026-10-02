/** Helpers for the data export and company deletion screens. Pure, so they are unit tested. */

export type ExportStatus = "queued" | "running" | "ready" | "failed" | "expired";

export interface ExportRow {
  id: string;
  status: ExportStatus;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
}

export type DeletionStatus = "awaiting_firm" | "pending" | "restored" | "purged" | "erased" | "cancelled";

export interface DeletionRow {
  id: string;
  companyId: string;
  companyName: string | null;
  status: DeletionStatus;
  reason: string | null;
  requestedAt: string;
  purgeAfter: string | null;
  restoredAt: string | null;
  purgedAt: string | null;
}

export const RESTORE_WINDOW_DAYS = 30;
export const RETENTION_YEARS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isExportActive = (status: ExportStatus): boolean => status === "queued" || status === "running";

/** Poll only while a job is moving; an idle page makes no requests. */
export function exportPollInterval(rows: readonly ExportRow[] | undefined): number | false {
  return rows?.some((r) => isExportActive(r.status)) ? 3000 : false;
}

/** A ready export can be downloaded until its link expires (checked against the clock as well as the status). */
export function canDownloadExport(row: ExportRow, now: number = Date.now()): boolean {
  if (row.status !== "ready") return false;
  return !row.expiresAt || Date.parse(row.expiresAt) > now;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Whole days from `now` until `iso`, never negative; null when there is no date. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / DAY_MS));
}

/** Deletions the user can still act on: waiting for the firm, or inside the 30-day window. */
export function actionableDeletions(rows: readonly DeletionRow[] | undefined, now: number = Date.now()): DeletionRow[] {
  return (rows ?? []).filter((r) => r.status === "awaiting_firm" || (r.status === "pending" && (!r.purgeAfter || Date.parse(r.purgeAfter) > now)));
}

/** Deletion state of one company: the actionable request, if any. */
export function deletionFor(rows: readonly DeletionRow[] | undefined, companyId: string | undefined, now: number = Date.now()): DeletionRow | undefined {
  return actionableDeletions(rows, now).find((r) => r.companyId === companyId);
}

/** Server `code`s from the deletion endpoint, mapped to message keys. */
export function deletionErrorKey(code: string | undefined): "reauth" | "password" | "code" | "name" | "exists" | "owner" | "generic" {
  switch (code) {
    case "REAUTH_REQUIRED":
      return "reauth";
    case "PASSWORD_INVALID":
      return "password";
    case "TOTP_INVALID":
    case "TOTP_REPLAYED":
      return "code";
    case "CONFIRM_NAME_MISMATCH":
      return "name";
    case "DELETION_ALREADY_REQUESTED":
      return "exists";
    case "OWNER_REQUIRED":
      return "owner";
    default:
      return "generic";
  }
}

/** The delete button stays disabled until the typed name matches exactly (trimmed) and a password is present. */
export function canSubmitDeletion(input: { typedName: string; companyName: string; password: string; needsCode: boolean; code: string }): boolean {
  if (input.typedName.trim() !== input.companyName.trim() || !input.companyName.trim()) return false;
  if (!input.password) return false;
  if (input.needsCode && !/^\d{6}$/.test(input.code)) return false;
  return true;
}
