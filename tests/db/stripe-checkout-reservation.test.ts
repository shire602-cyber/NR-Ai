import { expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { useHarness } from "./harness";

const h = useHarness();
const stripe = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  retrieveSubscription: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: stripe.createSession, list: stripe.listSessions } };
    subscriptions = { retrieve: stripe.retrieveSubscription };
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
  const { createCheckoutSession, handleWebhookEvent, PLAN_PRICE_MAP } =
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

    const retry = stripe.createSession.mock.calls[1][0] as Stripe.Checkout.SessionCreateParams;
    const completed = {
      id: "fixture-completed-session",
      mode: "subscription",
      status: "complete",
      customer: "fixture-customer",
      subscription: "fixture-subscription",
      metadata: retry.metadata,
    };
    stripe.listSessions.mockReturnValue([completed]);
    stripe.retrieveSubscription.mockResolvedValue({
      id: completed.subscription,
      customer: completed.customer,
      metadata: retry.subscription_data?.metadata,
      status: "active",
      current_period_start: company.expires,
      current_period_end: company.expires + 30 * 86_400,
      items: { data: [{ quantity: 1 }] },
    });
    // Even before the new reservation times out, retry and webhook can race on the same session.
    const [url] = await Promise.all([
      checkout(),
      handleWebhookEvent({
        id: "fixture-checkout-webhook",
        type: "checkout.session.completed",
        data: { object: completed },
      } as unknown as Stripe.Event),
    ]);
    expect(url).toBe("https://example.test/success");
    expect(stripe.createSession).toHaveBeenCalledTimes(2);
    expect(
      await h.sql(
        `SELECT plan_id, status, stripe_subscription_id, stripe_checkout_completed
          FROM subscriptions WHERE company_id = $1`,
        [companyId]
      )
    ).toEqual([
      {
        plan_id: "starter",
        status: "active",
        stripe_subscription_id: "fixture-subscription",
        stripe_checkout_completed: true,
      },
    ]);
  } finally {
    PLAN_PRICE_MAP.starter.monthly = oldPrice;
    vi.restoreAllMocks();
  }
});
