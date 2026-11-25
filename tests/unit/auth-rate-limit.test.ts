import jwt from "jsonwebtoken";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { isCredentialAuthPath, parseTrustProxy } from "../../server/middleware/security";
import {
  LockoutTracker,
  SlidingWindowStore,
  rateLimitIdentity,
} from "../../server/middleware/rateLimit";

describe("auth rate-limit scoping", () => {
  it("counts credential-bearing attempts", () => {
    expect(isCredentialAuthPath("/login")).toBe(true);
    expect(isCredentialAuthPath("/register")).toBe(true);
    expect(isCredentialAuthPath("/forgot-password")).toBe(true);
    expect(isCredentialAuthPath("/reset-password")).toBe(true);
    expect(isCredentialAuthPath("/reset-password/abc123")).toBe(true);
    expect(isCredentialAuthPath("/change-password")).toBe(true);
    expect(isCredentialAuthPath("/Login/")).toBe(true);
  });

  it("R17-06: exempts session reads and token plumbing that fire on every page load", () => {
    // Counting these used to exhaust the 5/min budget before the user even
    // submitted the login form, locking the whole app behind 429s.
    expect(isCredentialAuthPath("/me")).toBe(false);
    expect(isCredentialAuthPath("/refresh")).toBe(false);
    expect(isCredentialAuthPath("/refresh-token")).toBe(false);
    expect(isCredentialAuthPath("/logout")).toBe(false);
    expect(isCredentialAuthPath("/oauth/providers")).toBe(false);
    expect(isCredentialAuthPath("/oauth/google")).toBe(false);
  });

  it("does not treat lookalike prefixes as credential paths", () => {
    expect(isCredentialAuthPath("/login-history")).toBe(false);
    expect(isCredentialAuthPath("/registerable")).toBe(false);
  });
});

describe("R17-06 sliding window store", () => {
  it("does not record hits that are already over the limit", async () => {
    const store = new SlidingWindowStore(2);
    store.init({ windowMs: 60_000 } as never);
    expect((await store.increment("k")).totalHits).toBe(1);
    expect((await store.increment("k")).totalHits).toBe(2);
    for (let i = 0; i < 10; i++) expect((await store.increment("k")).totalHits).toBe(3);
    // Only the two accepted hits are stored, so the budget recovers on time.
    await store.decrement("k");
    expect((await store.increment("k")).totalHits).toBe(2);
  });
});

describe("R01-12 lockout tracker", () => {
  it("locks after 5 failures in 15 minutes and unlocks on time despite retries", () => {
    const t = new LockoutTracker([
      { max: 5, windowMs: 15 * 60_000 },
      { max: 10, windowMs: 60 * 60_000 },
    ]);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(t.recordFailure("k", t0 + i).lockedNow).toBe(false);
    expect(t.recordFailure("k", t0 + 4).lockedNow).toBe(true);
    expect(t.status("k", t0 + 60_000).locked).toBe(true);
    // Locked attempts are not recorded by callers; status alone decides.
    expect(t.status("k", t0 + 15 * 60_000 + 1).locked).toBe(false);
    expect(t.status("other", t0).locked).toBe(false);
  });

  it("escalates to the 1 hour rule after 10 failures", () => {
    const t = new LockoutTracker([
      { max: 5, windowMs: 15 * 60_000 },
      { max: 10, windowMs: 60 * 60_000 },
    ]);
    const t0 = 5_000_000;
    for (let i = 0; i < 5; i++) t.recordFailure("k", t0 + i);
    const later = t0 + 16 * 60_000;
    for (let i = 0; i < 5; i++) t.recordFailure("k", later + i);
    expect(t.status("k", later + 20 * 60_000).locked).toBe(true);
    expect(t.status("k", t0 + 61 * 60_000).locked).toBe(false);
  });
});

describe("R01-09 trust proxy parsing", () => {
  it("parses hop counts and refuses trust-everything", () => {
    expect(parseTrustProxy(undefined)).toMatchObject({ value: 1 });
    expect(parseTrustProxy(undefined).warning).toBeTruthy();
    expect(parseTrustProxy("0").value).toBe(false);
    expect(parseTrustProxy("false").value).toBe(false);
    expect(parseTrustProxy("2").value).toBe(2);
    expect(parseTrustProxy("true")).toMatchObject({ value: 1 });
    expect(parseTrustProxy("loopback, 10.0.0.0/8").value).toBe("loopback, 10.0.0.0/8");
  });
});

describe("R01-10 rate-limit identity", () => {
  const secret = process.env.JWT_SECRET!;
  const req = (headers: Record<string, string>, url = "/api/x") =>
    ({ headers, ip: "203.0.113.5", originalUrl: url, url, query: {} }) as unknown as Request;

  it("keys signed access tokens by user and other requests by IP", () => {
    const access = jwt.sign({ userId: "u1", type: "access" }, secret);
    const refresh = jwt.sign({ userId: "u1", type: "refresh" }, secret);
    const cid = "11111111-1111-4111-8111-111111111111";
    expect(
      rateLimitIdentity(req({ authorization: `Bearer ${access}` }, `/api/companies/${cid}/x`)).key
    ).toBe("u:u1");
    expect(
      rateLimitIdentity(req({ authorization: `Bearer ${access}` }, "/api/firm/clients")).key
    ).toBe("u:u1");
    expect(rateLimitIdentity(req({ authorization: `Bearer ${refresh}` })).key).toBe(
      "ip:203.0.113.5"
    );
    expect(rateLimitIdentity(req({ authorization: "Bearer forged" })).key).toBe("ip:203.0.113.5");
    expect(rateLimitIdentity(req({})).key).toBe("ip:203.0.113.5");
  });
});
