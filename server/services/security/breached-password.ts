/**
 * Breached-password check (R17-24).
 *
 *   BREACHED_PASSWORD_CHECK=range   k-anonymity range API (Have I Been Pwned compatible):
 *                                   only the first 5 hex chars of the SHA-1 leave the
 *                                   server; the suffix list is compared locally. When the
 *                                   API is unreachable the offline list is used instead.
 *   BREACHED_PASSWORD_CHECK=offline default: the bundled list of the 10,000 most common
 *                                   passwords (server/assets/common-passwords.txt)
 *   BREACHED_PASSWORD_CHECK=off     no check beyond the password policy
 *
 * The password itself is never logged or sent anywhere.
 */
import { createHash } from "node:crypto";
import { createLogger } from "../../config/logger";
import { isCommonPassword } from "../../auth";
import { breachedPasswordMode, breachedPasswordRangeUrl } from "./config";

const log = createLogger("breached-password");

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | null = null;

/** Tests only: replace the HTTP client used for the range API (null restores fetch). */
export function __setBreachedPasswordFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl;
}

export interface BreachCheckResult {
  breached: boolean;
  /** Which source answered. */
  source: "range_api" | "offline_list" | "disabled";
  /** Times seen in the range corpus (range API only). */
  count?: number;
  /** True when the range API failed and the offline list answered instead. */
  fellBack?: boolean;
}

export const BREACHED_PASSWORD_MESSAGE =
  "This password has appeared in a known data breach. Choose a different password.";

async function rangeLookup(password: string): Promise<number> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init));
  const res = await doFetch(`${breachedPasswordRangeUrl()}${prefix}`, {
    method: "GET",
    headers: { "Add-Padding": "true", "User-Agent": "muhasib-password-check" },
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) throw new Error(`range API status ${res.status}`);
  const text = await res.text();
  for (const line of text.split(/\r?\n/)) {
    const [hashSuffix, count] = line.trim().split(":");
    if (hashSuffix && hashSuffix.toUpperCase() === suffix) return Number(count) || 1;
  }
  return 0;
}

export async function checkBreachedPassword(password: string): Promise<BreachCheckResult> {
  const mode = breachedPasswordMode();
  if (mode === "off") return { breached: false, source: "disabled" };
  if (mode === "range") {
    try {
      const count = await rangeLookup(password);
      return { breached: count > 0, source: "range_api", count };
    } catch (err) {
      log.warn({ err: (err as Error).message }, "Range API unavailable; using offline list");
      return { breached: isCommonPassword(password), source: "offline_list", fellBack: true };
    }
  }
  return { breached: isCommonPassword(password), source: "offline_list" };
}

export function breachedPasswordStatus(): { mode: ReturnType<typeof breachedPasswordMode> } {
  return { mode: breachedPasswordMode() };
}
