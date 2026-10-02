import { describe, expect, it } from "vitest";
import { STATE_TTL_MS, signFeedState, stateIssuedDay, verifyFeedState } from "../../server/services/bank-feed-state";

const secret = "s".repeat(40);
const base = { companyId: "c1", userId: "u1", secret };

describe("bank feed state", () => {
  it("verifies for the same company and user", () => {
    expect(verifyFeedState(signFeedState(base), base)).toEqual({ ok: true });
  });
  it("refuses another company, another user, a tampered or foreign-signed state", () => {
    const s = signFeedState(base);
    expect(verifyFeedState(s, { ...base, companyId: "c2" })).toEqual({ ok: false, reason: "company" });
    expect(verifyFeedState(s, { ...base, userId: "u2" })).toEqual({ ok: false, reason: "user" });
    expect(verifyFeedState(s, { ...base, secret: "x".repeat(40) })).toEqual({ ok: false, reason: "signature" });
    const [p, sig] = s.split(".");
    expect(verifyFeedState(`${p}x.${sig}`, base).ok).toBe(false);
  });
  it("expires after 15 minutes", () => {
    const now = 1_000_000;
    const s = signFeedState({ ...base, now });
    expect(verifyFeedState(s, { ...base, now: now + STATE_TTL_MS - 1 }).ok).toBe(true);
    expect(verifyFeedState(s, { ...base, now: now + STATE_TTL_MS + 1 })).toEqual({ ok: false, reason: "expired" });
  });
  it("refuses garbage", () => {
    for (const v of [undefined, null, 5, "", "a", "a.b.c", "x".repeat(2000)]) expect(verifyFeedState(v, base).ok).toBe(false);
  });
});

describe("state issued-at", () => {
  it("carries the day the session started, for the narrow entity window", () => {
    const now = Date.parse("2026-10-02T10:00:00Z");
    const s = signFeedState({ ...base, now });
    expect(stateIssuedDay(s)).toBe("2026-10-02");
    expect(stateIssuedDay("garbage")).toBeNull();
  });
});
