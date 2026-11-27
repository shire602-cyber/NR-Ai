/** The server explains a match with fixed English phrases; each one has a catalog label. */
const REASON_KEYS: Record<string, string> = {
  "Exact amount match": "banking.suggest.reason.exactAmount",
  "Amount within 1%": "banking.suggest.reason.amount1",
  "Amount within 5%": "banking.suggest.reason.amount5",
  "Same date": "banking.suggest.reason.sameDate",
  "Within 1 day": "banking.suggest.reason.day1",
  "Within 3 days": "banking.suggest.reason.day3",
  "Within 7 days": "banking.suggest.reason.day7",
  "Reference number match": "banking.suggest.reason.reference",
  "Strong description match": "banking.suggest.reason.descStrong",
  "Partial description match": "banking.suggest.reason.descPartial",
  "Weak description match": "banking.suggest.reason.descWeak",
  "Entry on this bank account": "banking.suggest.reason.sameAccount",
};

/** Translate the server's "; "-joined English match reasons into catalog text (unknown phrases are dropped). */
export function translateMatchReasons(raw: string, tt: Record<string, string>): string {
  return raw
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (REASON_KEYS[r] ? tt[REASON_KEYS[r]] : null))
    .filter(Boolean)
    .join(" · ");
}
