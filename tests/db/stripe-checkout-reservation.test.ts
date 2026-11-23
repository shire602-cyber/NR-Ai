import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { useHarness } from "./harness";

const h = useHarness();
const stripe = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: stripe.createSession, list: stripe.listSessions } };
  },
}));

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), STRIPE_SECRET_KEY: "fixture" }) };
});

it("[PR93-6] atomically reserves one first checkout per company and reopens it after abandonment", async () => {
  const t = await h.createTenant();
  const companyId = t.company.id;
  await h.sql(
    "UPDATE subscriptions SET stripe_customer_id = 'fixture-customer', trial_ends_at = now() + interval '4 days' WHERE company_id = $1",
    [companyId]
  );
  const { createCheckoutSession, PLAN_PRICE_MAP } =
    await import("../../server/services/stripe.service");
  const oldPrice = PLAN_PRICE_MAP.starter.monthly;
  PLAN_PRICE_MAP.starter.monthly = "fixture-price";
  const checkout = () =>
    createCheckoutSession(
      companyId,
      "starter",
      "monthly",
      "https://example.test/success",
      "https://example.test/cancel"
    );

  // Both calls reach Stripe with the same local reservation state before either runs the SQL update.
  let callers = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  stripe.listSessions.mockImplementation(async function* () {
    if (++callers === 2) release();
    await bothRead;
    yield* [];
  });
  stripe.createSession.mockResolvedValue({ url: "https://checkout.example.test" });
  try {
    const results = await Promise.allSettled([checkout(), checkout()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "STRIPE_CHECKOUT_IN_PROGRESS" },
    });
    expect(stripe.createSession).toHaveBeenCalledTimes(1);
    const first = stripe.createSession.mock.calls[0][0] as Stripe.Checkout.SessionCreateParams;
    expect(first.subscription_data?.trial_end).toBeDefined();
    const [company] = await h.sql<{ expires: number }>(
      "SELECT extract(epoch FROM stripe_first_checkout_expires_at)::integer AS expires FROM companies WHERE id = $1",
      [companyId]
    );
    expect(company.expires).toBe(first.expires_at);
    await expect(checkout()).rejects.toMatchObject({ code: "STRIPE_CHECKOUT_IN_PROGRESS" });

    vi.spyOn(Date, "now").mockReturnValue((company.expires + 1) * 1000);
    stripe.listSessions.mockReturnValue([
      { mode: "subscription", status: "expired", metadata: first.metadata },
    ]);
    await expect(checkout()).resolves.toBe("https://checkout.example.test");
    expect(stripe.createSession).toHaveBeenCalledTimes(2);
  } finally {
    PLAN_PRICE_MAP.starter.monthly = oldPrice;
    vi.restoreAllMocks();
  }
});
