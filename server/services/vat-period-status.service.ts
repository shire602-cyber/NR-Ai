import { AppError } from "../errors";
import { uaeYmdParts } from "../utils/date";

/**
 * Where a VAT period sits relative to "now", judged on UAE calendar days
 * (UTC+4, no DST):
 *  - future: the period has not started yet (rejected everywhere)
 *  - open:   started but its last day is not over (draft preview only)
 *  - closed: the last day is over (can be persisted/filed)
 */
export type VatPeriodClass = "future" | "open" | "closed";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Calendar date (YYYY-MM-DD) of a stored period boundary. Strings keep their
 * date part; Dates use UTC components, matching how period bounds are stored
 * (server/utils/date.ts convention). */
function periodYmd(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** Today's UAE calendar date (YYYY-MM-DD) for a real instant. */
export function uaeTodayYmd(now: Date = new Date()): string {
  const { year, month, day } = uaeYmdParts(now);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function classifyVatPeriod(
  start: string | Date,
  end: string | Date,
  now: Date = new Date()
): VatPeriodClass {
  const today = uaeTodayYmd(now);
  if (periodYmd(start) > today) return "future";
  // The period is only over once its last day has passed.
  if (periodYmd(end) >= today) return "open";
  return "closed";
}

/** Throws a 400 PERIOD_NOT_ENDED unless the period has fully ended. */
export function assertVatPeriodEnded(
  start: string | Date,
  end: string | Date,
  now: Date = new Date()
): void {
  if (classifyVatPeriod(start, end, now) === "closed") return;
  throw new AppError({
    message:
      "This VAT period has not ended yet. It is a draft preview and cannot be saved, submitted or filed until the period is over.",
    statusCode: 400,
    code: "PERIOD_NOT_ENDED",
  });
}

export interface VatPeriodPreviewMeta {
  isDraftPreview: boolean;
  previewAsOf: string | null;
}

export function vatPeriodPreviewMeta(
  start: string | Date,
  end: string | Date,
  now: Date = new Date()
): VatPeriodPreviewMeta {
  const isDraftPreview = classifyVatPeriod(start, end, now) === "open";
  return { isDraftPreview, previewAsOf: isDraftPreview ? uaeTodayYmd(now) : null };
}
