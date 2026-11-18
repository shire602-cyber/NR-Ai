/**
 * WQ7: the Stripe price-id map is built from the shared plan module (three paid plans, monthly
 * and yearly, no quarterly), read from STRIPE_PRICE_<PLAN>_<CYCLE>.
 */
import { describe, expect, it } from "vitest";
import { BILLING_CYCLES, PAID_PLAN_IDS } from "../../shared/plans";

describe("Stripe price map", () => {
  it("has one price id per paid plan and cycle, from the plan module", async () => {
    for (const id of PAID_PLAN_IDS) {
      for (const cycle of BILLING_CYCLES) {
        process.env[`STRIPE_PRICE_${id.toUpperCase()}_${cycle.toUpperCase()}`] =
          `price_${id}_${cycle}`;
      }
    }
    const { PLAN_PRICE_MAP } = await import("../../server/services/stripe.service");
    expect(PLAN_PRICE_MAP).toEqual({
      starter: { monthly: "price_starter_monthly", yearly: "price_starter_yearly" },
      professional: { monthly: "price_professional_monthly", yearly: "price_professional_yearly" },
      enterprise: { monthly: "price_enterprise_monthly", yearly: "price_enterprise_yearly" },
    });
    expect(Object.keys(PLAN_PRICE_MAP)).not.toContain("free");
  });
});
