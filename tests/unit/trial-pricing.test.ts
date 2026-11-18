// @vitest-environment jsdom
/**
 * X6b / WQ7: the free trial (TRIAL_DAYS of the top plan, no card), the pricing page (monthly /
 * yearly = 10 × monthly, Most popular, comparison grid), the subscription page (trial status,
 * Contact us while checkout is not configured, viewer cannot upgrade, limits from the server) and
 * the trial banner (read-only once the trial ends). Renders the real pages and reads back
 * what a visitor sees; replaces the old source-text check of advertised limits.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../server/services/stripe.service", () => ({ isStripeConfigured: () => false }));

const sub = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  canBilling: true,
  apiRequest: vi.fn(),
}));
vi.mock("../../client/src/hooks/useSubscription", () => ({ useSubscription: () => sub.state }));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1" }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => sub.canBilling, gate: () => ({}) }),
}));
vi.mock("../../client/src/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/lib/queryClient")>(
    "../../client/src/lib/queryClient"
  );
  return { ...actual, apiRequest: (...args: unknown[]) => sub.apiRequest(...args) };
});

import { getTierLimits } from "../../server/middleware/featureGate";
import { TRIAL_LIMITS, planFeatures, planPrice } from "../../shared/plans";
import { TRIAL_DAYS, trialState } from "../../shared/trial";

let container: HTMLDivElement;
let root: Root;

function freshState(): Record<string, unknown> {
  return {
    tierName: "enterprise",
    isLoading: false,
    enforcement: true,
    checkoutAvailable: false,
    planState: "trial",
    entitlement: {
      state: "trial",
      planId: "enterprise",
      storedPlanId: "free",
      features: planFeatures("enterprise"),
      limits: TRIAL_LIMITS,
    },
    trial: trialState(new Date(Date.now() - 4 * 86400_000)),
    subscription: { id: "s1", planId: "free", status: "active", billingCycle: "monthly" },
    usage: {
      invoices: { used: 7, limit: -1 },
      receipts: { used: 3, limit: -1 },
      aiCredits: { used: 100, limit: TRIAL_LIMITS.aiCreditsPerMonth },
      users: { used: 4, limit: -1 },
      storage: { used: 12.5, limit: TRIAL_LIMITS.maxStorageMb },
    },
  };
}

beforeAll(async () => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(async () => {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sub.canBilling = true;
  sub.apiRequest.mockReset();
  sub.state = freshState();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

async function renderPricing() {
  const { default: Pricing } = await import("../../client/src/pages/Pricing");
  await act(async () => {
    root.render(createElement(Pricing));
  });
}

async function renderSubscription() {
  const { default: Subscription } = await import("../../client/src/pages/Subscription");
  const { Toaster } = await import("../../client/src/components/ui/toaster");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(Subscription),
        createElement(Toaster)
      )
    );
  });
}

describe("trial state", () => {
  it("counts whole days left from the subscription row and ends without locking anything", () => {
    const start = new Date("2026-11-01T08:00:00Z");
    expect(trialState(start, new Date("2026-11-01T09:00:00Z"))).toMatchObject({
      days: TRIAL_DAYS,
      daysLeft: 14,
      ended: false,
    });
    expect(trialState(start, new Date("2026-11-14T09:00:00Z"))?.daysLeft).toBe(1);
    expect(trialState(start, new Date("2026-11-16T09:00:00Z"))).toMatchObject({
      daysLeft: 0,
      ended: true,
    });
    expect(trialState(null)).toBeNull();
  });

  it("every public trial claim says the same number of days as TRIAL_DAYS", async () => {
    const { t } = await import("../../client/src/lib/i18n");
    for (const loc of ["en", "ar"] as const) {
      for (const key of [
        "marketing.trialClaim",
        "marketing.heroNote",
        "marketing.pricingBody",
        "marketing.pricingTrialFaqAnswer",
        "marketing.pricingFooterNote",
        "marketing.seoPricingDescription",
        "marketing.prBodyTrial",
        "marketing.pricingTitleTrial",
        "marketing.prFaqTrialTopA",
      ]) {
        const days = [...String((t[loc] as Record<string, string>)[key]).matchAll(/\d+/g)].map(
          (m) => Number(m[0])
        );
        expect(days, `${loc} ${key}`).toContain(TRIAL_DAYS);
      }
    }
  });
});

describe("/pricing", () => {
  it("states the trial claim and offers Start free trial on the paid plans", async () => {
    await renderPricing();
    expect(container.querySelector("[data-testid=trial-claim]")?.textContent).toBe(
      `${TRIAL_DAYS}-day free trial, no card required`
    );
    for (const id of ["starter", "professional"]) {
      expect(container.querySelector(`[data-testid=button-plan-${id}]`)?.textContent).toContain(
        "Start free trial"
      );
    }
    expect(text()).not.toMatch(/launch offer/i);
    expect(text()).toContain("Most popular");
  });

  it("switches monthly and yearly prices on the plan cards (yearly = 10 × monthly, no quarterly)", async () => {
    await renderPricing();
    const price = () =>
      container.querySelector("[data-testid=card-plan-starter] .mk-tier__price")?.textContent ?? "";
    expect(price()).toContain(String(planPrice("starter", "monthly")));
    expect(container.querySelector("[data-testid=billing-cycle-quarterly]")).toBeNull();
    expect(container.querySelector("[data-testid=card-plan-free]")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid=billing-cycle-yearly]")!.click();
    });
    expect(planPrice("starter", "yearly")).toBe(planPrice("starter", "monthly") * 10);
    expect(price()).toContain(String(planPrice("starter", "yearly")));
    expect(price()).toContain("per year");
    expect(container.querySelector("[data-testid=card-plan-starter]")?.textContent).toContain(
      "two months free"
    );
  });

  it("has a tick/cross feature comparison grid", async () => {
    await renderPricing();
    expect(container.querySelectorAll("table.mk-ptable tbody tr").length).toBeGreaterThan(15);
    expect(container.querySelector(".mk-ptable__yes")).not.toBeNull();
    expect(container.querySelector(".mk-ptable__no")).not.toBeNull();
  });

  it("reads the trial claim in Arabic", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await renderPricing();
    expect(container.querySelector("[data-testid=trial-claim]")?.textContent).toContain(
      "تجربة مجانية"
    );
  });
});

describe("trial banner", () => {
  async function banner(trial: ReturnType<typeof trialState>) {
    const { TrialBanner } = await import("../../client/src/components/TrialBanner");
    await act(async () => {
      root.render(createElement(TrialBanner, { trial }));
    });
    return container.querySelector("[data-testid=trial-banner]");
  }

  it("counts the days left", async () => {
    const el = await banner(trialState(new Date(Date.now() - 4 * 86400_000)));
    expect(el?.textContent).toContain(`${TRIAL_DAYS - 4} days left in your free trial`);
    expect(container.querySelector("[data-testid=trial-contact-us]")).toBeNull();
  });

  it("says the books are read-only once the trial has ended and links to choosing a plan", async () => {
    const el = await banner(trialState(new Date(Date.now() - 30 * 86400_000)));
    expect(el?.getAttribute("data-trial-state")).toBe("ended");
    expect(el?.textContent).toContain("Your books are read-only until you choose a plan");
    expect(container.querySelector("[data-testid=trial-contact-us]")?.getAttribute("href")).toBe(
      "/subscription"
    );
  });

  it("renders nothing for a paid company", async () => {
    expect(await banner(null)).toBeNull();
  });
});

describe("/subscription", () => {
  it("shows the trial of the top plan, three paid plan cards and no free plan", async () => {
    await renderSubscription();
    expect(container.querySelector("[data-testid=text-current-plan]")?.textContent).toBe(
      "Free trial of Enterprise"
    );
    expect(container.querySelector("[data-testid=trial-banner]")).not.toBeNull();
    for (const id of ["starter", "professional", "enterprise"]) {
      expect(container.querySelector(`[data-testid=card-plan-${id}]`)).not.toBeNull();
    }
    expect(container.querySelector("[data-testid=card-plan-free]")).toBeNull();
    expect(text()).toContain("Every plan includes unlimited users.");
    expect(getTierLimits("starter").maxUsers).toBe(-1);
  });

  it("shows the server's limits with no 'not enforced yet' note", async () => {
    await renderSubscription();
    expect(container.querySelector("[data-testid=usage-offer-note]")).toBeNull();
    expect(text()).not.toMatch(/not enforced/i);
    expect(text()).toContain(`100 / ${TRIAL_LIMITS.aiCreditsPerMonth}`);
    expect(text()).toContain("12.5 MB / 1,024 MB");
    expect(container.querySelector("[data-testid=usage-users]")?.textContent).toContain("unlimited");
  });

  it("compares plans with the pricing page's rows (shared plan module)", async () => {
    await renderSubscription();
    const cells = (label: string) =>
      [...container.querySelectorAll("[data-testid=subscription-compare] tr")].find(
        (r) => r.querySelector("td")?.textContent === label
      );
    const payroll = cells("Payroll and WPS");
    expect(payroll?.querySelectorAll("td").length).toBe(4);
    expect(payroll?.querySelectorAll("td")[1]?.textContent).toContain("Not included");
    expect(payroll?.querySelectorAll("td")[2]?.textContent).toContain("Included");
  });

  it("after the trial: says the books are read-only and asks to choose a plan", async () => {
    sub.state = {
      ...freshState(),
      planState: "expired",
      entitlement: { state: "expired", planId: null, storedPlanId: "free", features: {} },
      trial: trialState(new Date(Date.now() - 30 * 86400_000)),
    };
    await renderSubscription();
    expect(container.querySelector("[data-testid=text-current-plan]")?.textContent).toBe("No plan");
    expect(text()).toContain("Your trial has ended: your books are read-only");
    expect(container.querySelector("[data-testid=button-choose-plan]")).not.toBeNull();
  });

  it("replaces checkout with 'Choose <plan>' (mailto) while checkout is not configured", async () => {
    await renderSubscription();
    const link = container.querySelector<HTMLAnchorElement>("a[data-testid=plan-contact-starter]");
    expect(link?.textContent).toBe("Choose Starter");
    expect(link?.getAttribute("href")).toMatch(/^mailto:support@muhasib\.ai\?subject=/);
    expect(container.querySelector("[data-testid^=plan-upgrade-]")).toBeNull();
    expect(container.querySelector("[data-testid=checkout-contact-note]")).not.toBeNull();
  });

  it("disables the plan buttons and the usage Upgrade for a viewer", async () => {
    sub.canBilling = false;
    sub.state.checkoutAvailable = true;
    await renderSubscription();
    const buttons = [...container.querySelectorAll("button[data-testid^=plan-upgrade-]")];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(
      (container.querySelector("[data-testid=usage-upgrade]") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("surfaces a checkout failure instead of failing silently", async () => {
    const { ApiError } = await import("../../client/src/lib/queryClient");
    sub.state.checkoutAvailable = true;
    sub.apiRequest.mockRejectedValue(
      new ApiError("Payment processing not configured", 503, { code: "STRIPE_NOT_CONFIGURED" })
    );
    await renderSubscription();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid=plan-upgrade-starter]")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Could not start checkout");
    expect(document.body.textContent).toContain("Online checkout is not available yet");
  });
});
