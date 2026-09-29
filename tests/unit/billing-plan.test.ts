import { describe, it, expect } from "vitest";
import {
  TRIAL_DAYS,
  TRIAL_PLAN,
  PAST_DUE_GRACE_DAYS,
  resolveEffectivePlan,
  buildTrialWindow,
  parseGrandfatherDate,
} from "../../server/services/billing-plan";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-29T12:00:00.000Z");

const sub = (over: Record<string, unknown>) => ({
  planId: "professional",
  status: "active",
  currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
  trialEndsAt: null,
  ...over,
});

describe("constants", () => {
  it("advertises a 14 day trial on the professional plan", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(TRIAL_PLAN).toBe("professional");
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
  });
});

describe("resolveEffectivePlan", () => {
  it("active paid subscription resolves to its plan", () => {
    const r = resolveEffectivePlan({ subscription: sub({ planId: "starter" }), now });
    expect(r).toMatchObject({ planId: "starter", state: "paid" });
  });

  it("active free row is free", () => {
    expect(resolveEffectivePlan({ subscription: sub({ planId: "free" }), now })).toMatchObject({
      planId: "free",
      state: "free",
    });
  });

  it("no subscription is free", () => {
    expect(resolveEffectivePlan({ subscription: null, now })).toMatchObject({ planId: "free", state: "free" });
  });

  it("trialing and not expired gets the trial plan with days left", () => {
    const trialEndsAt = new Date(now.getTime() + 3 * DAY + 1000);
    const r = resolveEffectivePlan({ subscription: sub({ status: "trialing", planId: "professional", trialEndsAt }), now });
    expect(r).toMatchObject({ planId: "professional", state: "trial", daysLeft: 4 });
  });

  it("trial boundary: one millisecond before the end is still a trial", () => {
    const trialEndsAt = new Date(now.getTime() + 1);
    const r = resolveEffectivePlan({ subscription: sub({ status: "trialing", trialEndsAt }), now });
    expect(r.state).toBe("trial");
    expect(r.daysLeft).toBe(1);
  });

  it("trial boundary: at the exact instant it ends the trial is over", () => {
    const r = resolveEffectivePlan({ subscription: sub({ status: "trialing", trialEndsAt: new Date(now.getTime()) }), now });
    expect(r).toMatchObject({ planId: "free", state: "trial_expired", daysLeft: 0 });
  });

  it("trialing with no trialEndsAt is treated as expired, never as an endless free upgrade", () => {
    const r = resolveEffectivePlan({ subscription: sub({ status: "trialing", trialEndsAt: null }), now });
    expect(r).toMatchObject({ planId: "free", state: "trial_expired" });
  });

  it("cancelled but paid through keeps the plan until the period ends", () => {
    const ok = resolveEffectivePlan({
      subscription: sub({ status: "cancelled", currentPeriodEnd: new Date(now.getTime() + 5 * DAY) }),
      now,
    });
    expect(ok).toMatchObject({ planId: "professional", state: "paid" });
    const over = resolveEffectivePlan({
      subscription: sub({ status: "cancelled", currentPeriodEnd: new Date(now.getTime() - 1) }),
      now,
    });
    expect(over).toMatchObject({ planId: "free", state: "free" });
  });

  it("past_due keeps the plan for a 7 day grace window, then drops to free", () => {
    const end = new Date(now.getTime() - 6 * DAY);
    expect(resolveEffectivePlan({ subscription: sub({ status: "past_due", currentPeriodEnd: end }), now })).toMatchObject({
      planId: "professional",
      state: "grace",
    });
    const pastGrace = new Date(now.getTime() - PAST_DUE_GRACE_DAYS * DAY);
    expect(
      resolveEffectivePlan({ subscription: sub({ status: "past_due", currentPeriodEnd: pastGrace }), now })
    ).toMatchObject({ planId: "free", state: "free" });
  });

  it("companies created before BILLING_GRANDFATHER_BEFORE are on the top plan", () => {
    const grandfatherBefore = new Date("2026-10-01T00:00:00.000Z");
    const old = resolveEffectivePlan({
      subscription: sub({ planId: "free" }),
      now,
      company: { createdAt: new Date("2026-05-01T00:00:00.000Z"), companyType: "customer" },
      grandfatherBefore,
    });
    expect(old).toMatchObject({ planId: "enterprise", state: "grandfathered" });

    const fresh = resolveEffectivePlan({
      subscription: sub({ planId: "free" }),
      now,
      company: { createdAt: new Date("2026-10-02T00:00:00.000Z"), companyType: "customer" },
      grandfatherBefore,
    });
    expect(fresh.planId).toBe("free");
  });

  it("no grandfather date means no grandfathering", () => {
    const r = resolveEffectivePlan({
      subscription: null,
      now,
      company: { createdAt: new Date("2020-01-01"), companyType: "customer" },
      grandfatherBefore: null,
    });
    expect(r.planId).toBe("free");
  });

  it("firm-managed client companies are covered by the firm and never gated", () => {
    const r = resolveEffectivePlan({
      subscription: null,
      now,
      company: { createdAt: new Date("2020-01-01"), companyType: "client" },
    });
    expect(r).toMatchObject({ planId: "enterprise", state: "managed" });
  });
});

describe("buildTrialWindow", () => {
  it("starts at the company creation time and lasts 14 days", () => {
    const createdAt = new Date("2026-09-01T08:00:00.000Z");
    const w = buildTrialWindow(createdAt);
    expect(w.start.toISOString()).toBe("2026-09-01T08:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-15T08:00:00.000Z");
  });
});

describe("parseGrandfatherDate", () => {
  it("parses an ISO date and ignores blanks and garbage", () => {
    expect(parseGrandfatherDate("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(parseGrandfatherDate("")).toBeNull();
    expect(parseGrandfatherDate(undefined)).toBeNull();
    expect(parseGrandfatherDate("not a date")).toBeNull();
  });
});
