// The signed OAuth `state` of the Connect onboarding: HMAC over company, user, nonce and expiry, so the callback
// (a browser redirect from the provider, carrying no session) can prove who started the connection and that it was
// started less than 10 minutes ago. Pure module.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const STATE_TTL_MS = 10 * 60 * 1000;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signState(args: { companyId: string; userId: string; secret: string; now?: number; nonce?: string }): string {
  const now = args.now ?? Date.now();
  const payload = b64(JSON.stringify({ c: args.companyId, u: args.userId, n: args.nonce ?? randomBytes(12).toString("hex"), e: now + STATE_TTL_MS }));
  const mac = createHmac("sha256", args.secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export type StateCheck =
  | { ok: true; companyId: string; userId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyState(state: string, secret: string, now: number = Date.now()): StateCheck {
  const [payload, mac, extra] = String(state ?? "").split(".");
  if (!payload || !mac || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  try {
    const parsed = JSON.parse(unb64(payload));
    if (typeof parsed.c !== "string" || typeof parsed.u !== "string" || typeof parsed.e !== "number") return { ok: false, reason: "malformed" };
    if (parsed.e < now) return { ok: false, reason: "expired" };
    return { ok: true, companyId: parsed.c, userId: parsed.u };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** What is stored on the pending connection, so one state can be used once. */
export const hashState = (state: string): string => createHash("sha256").update(state).digest("hex");
