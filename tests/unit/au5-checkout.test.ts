import { afterEach, expect, it, vi } from "vitest";

const { openCheckout, getSubscription } = vi.hoisted(() => ({
  openCheckout: vi.fn().mockResolvedValue({ url: "https://checkout.example.test/session" }),
  getSubscription: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: openCheckout } };
  },
}));
vi.mock("../../server/config/env", () => ({
  getEnv: () => ({ STRIPE_SECRET_KEY: "unused-by-provider-double" }),
}));
vi.mock("../../server/storage", () => ({ storage: { getSubscription } }));
vi.mock("../../server/outbox", () => ({ enqueueEmail: vi.fn() }));
vi.mock("../../server/services/connectors/pq", () => ({ pq: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

it("does not create a second recurring agreement for an already subscribed company", async () => {
  vi.stubEnv("STRIPE_PRICE_PROFESSIONAL_MONTHLY", "price_au5_monthly");
  vi.stubEnv("STRIPE_PER_SEAT", "false");
  getSubscription.mockResolvedValue({
    id: "local-subscription",
    planId: "starter",
    status: "active",
    stripeCustomerId: "cus_fixture",
    stripeSubscriptionId: "sub_fixture",
  });
  const { createCheckoutSession } = await import("../../server/services/stripe.service");

  // A conflict is a valid response when the caller must use the plan-change flow.
  // Reusing the existing agreement is also valid. A new subscription checkout is not.
  const attempt = createCheckoutSession(
    "company-fixture",
    "professional",
    "monthly",
    "https://app.example.test/subscription",
    "https://app.example.test/subscription"
  );
  await attempt.catch((error: { status?: number; statusCode?: number }) => {
    expect(error.status ?? error.statusCode).toBe(409);
  });
  expect(openCheckout.mock.calls.map(([params]) => params.mode)).not.toContain("subscription");
});
