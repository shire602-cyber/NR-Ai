// The `state` of a bank-feed link: a signed, short-lived token that ties one Link session to one company and user.
// It travels through the browser, so it is an HMAC, never trusted without verification: every step after the session
// (list accounts, create connection) must present it, and the entity id the browser reports is checked against the
// company's own provider customer separately.

import crypto from "crypto";

export const STATE_TTL_MS = 15 * 60 * 1000;

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string): string => Buffer.from(s, "base64url").toString("utf8");
const mac = (payload: string, secret: string): string => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

export function signFeedState(args: { companyId: string; userId: string; secret: string; now?: number }): string {
  const issued = args.now ?? Date.now();
  const payload = b64(JSON.stringify({ c: args.companyId, u: args.userId, e: issued + STATE_TTL_MS, i: issued }));
  return `${payload}.${mac(payload, args.secret)}`;
}

export function verifyFeedState(
  state: unknown,
  expected: { companyId: string; userId: string; secret: string; now?: number }
): { ok: true } | { ok: false; reason: "malformed" | "signature" | "expired" | "company" | "user" } {
  if (typeof state !== "string" || state.length > 1000) return { ok: false, reason: "malformed" };
  const [payload, sig, extra] = state.split(".");
  if (!payload || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const want = mac(payload, expected.secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let body: { c?: string; u?: string; e?: number };
  try {
    body = JSON.parse(unb64(payload));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof body.e !== "number" || body.e < (expected.now ?? Date.now())) return { ok: false, reason: "expired" };
  if (body.c !== expected.companyId) return { ok: false, reason: "company" };
  if (body.u !== expected.userId) return { ok: false, reason: "user" };
  return { ok: true };
}

/** The UTC day the session started (the `i` of a state already checked by verifyFeedState); null when unreadable. */
export function stateIssuedDay(state: unknown): string | null {
  if (typeof state !== "string") return null;
  try {
    const body = JSON.parse(unb64(state.split(".")[0]));
    return typeof body.i === "number" ? new Date(body.i).toISOString().slice(0, 10) : null;
  } catch {
    return null;
  }
}
