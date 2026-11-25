/**
 * X5 (J1 D3): posting into a soft-locked period.
 *
 * The server refuses a write dated inside a soft-locked period with 403 PERIOD_SOFT_LOCKED and
 * says (details.canOverride) whether this user may post it anyway by giving a reason. apiRequest
 * hands such a refusal to `askLockReason`; the mounted PeriodLockReasonDialog asks the user for
 * the reason and the request is replayed once with it in the X-Period-Lock-Reason header
 * (URI-encoded: headers are Latin-1 only and reasons are often Arabic). Without a mounted
 * dialog, or when the user cancels, the original refusal is shown.
 */

export const PERIOD_LOCK_REASON_HEADER = "X-Period-Lock-Reason";
export const MIN_LOCK_REASON_LENGTH = 3;

export interface SoftLockInfo {
  lockedThrough?: string;
}

type Prompter = (info: SoftLockInfo) => Promise<string | null>;

let prompter: Prompter | null = null;

/** The dialog registers itself here; returns an unregister function. */
export function registerLockReasonPrompter(p: Prompter): () => void {
  prompter = p;
  return () => {
    if (prompter === p) prompter = null;
  };
}

/** True when the error body is a soft-lock refusal this user may override with a reason. */
export function isOverridableSoftLock(body: Record<string, unknown> | undefined): boolean {
  if (!body || body.code !== "PERIOD_SOFT_LOCKED") return false;
  const details = (body.details ?? {}) as Record<string, unknown>;
  return details.canOverride === true;
}

/** Ask the user for an override reason; null when nobody can ask or the user cancelled. */
export async function askLockReason(
  body: Record<string, unknown> | undefined
): Promise<string | null> {
  if (!prompter || !isOverridableSoftLock(body)) return null;
  const details = (body?.details ?? {}) as Record<string, unknown>;
  const reason = await prompter({
    lockedThrough: typeof details.lockedThrough === "string" ? details.lockedThrough : undefined,
  });
  const trimmed = reason?.trim() ?? "";
  return trimmed.length >= MIN_LOCK_REASON_LENGTH ? trimmed : null;
}

/** Header value for a reason (URI-encoded so any language survives the Latin-1 header). */
export function encodeLockReason(reason: string): string {
  return encodeURIComponent(reason.trim().slice(0, 500));
}
