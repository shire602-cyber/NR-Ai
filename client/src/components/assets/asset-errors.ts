// What the person is told when the server refuses an asset: above all the closed-year case, which used to fail without a word.

import { ApiError } from "@/lib/queryClient";
import { messages } from "./AssetFromBillDialog.i18n";

type Tr = ReturnType<typeof messages.useT>;

/** "03/2024" out of the server's "Cannot post to locked period (03/2024)"; null when the text has no period. */
export function lockedPeriodOf(message: string): string | null {
  const m = /locked period \((\d{2}\/\d{4})\)/i.exec(message);
  return m ? m[1] : null;
}

/** A clear message for the asset errors the screens know; null for anything else. */
export function assetErrorText(tr: Tr, err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details as { year?: number | string; period?: string } | undefined;
  if (err.code === "ASSET_IN_CLOSED_YEAR") return tr("errClosedYear", { period: String(details?.year ?? details?.period ?? "") });
  const period = lockedPeriodOf(err.message);
  if (err.status === 403 && period) return tr("errLockedPeriod", { period });
  if (err.code === "LINK_INVALID") return tr("errLinkInvalid");
  return null;
}

/** The notice for an asset that was added but could not be posted: a closed year or a locked month. Null when all is well. */
export function assetWarningText(tr: Tr, res: unknown): string | null {
  const warnings = (res as { warnings?: Array<{ code: string; year?: number }> } | null)?.warnings;
  const w = warnings?.find((x) => x.code === "ASSET_IN_CLOSED_YEAR" || x.code === "ASSET_PERIOD_LOCKED_NO_POSTING");
  if (!w) return null;
  return w.code === "ASSET_IN_CLOSED_YEAR" ? tr("warnClosedYear", { period: String(w.year ?? "") }) : tr("warnLockedPeriod");
}
