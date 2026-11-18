// @vitest-environment jsdom
/**
 * X6b: the free trial (TRIAL_DAYS, no card), the pricing page (monthly / quarterly / yearly,
 * Most popular, comparison grid) and the subscription page (trial banner, Contact us while checkout
 * is not configured, viewer cannot upgrade, AI credits agree). Renders the real pages and reads back
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
import { TRIAL_DAYS, trialState } from "../../shared/trial";

let container: HTMLDivElement;
let root: Root;

function freshState(): Record<string, unknown> {
  return {
    tierName: "free",
    isLoading: false,
    enforcement: false,
    checkoutAvailable: false,
    trial: trialState(new Date(Date.now() - 4 * 86400_000)),
    subscription: { id: "s1", planId: "free", status: "active", billingCycle: "monthly" },
    usage: {
      invoices: { used: 7, limit: 20 },
      receipts: { used: 3, limit: 20 },
      aiCredits: { used: 10, limit: 10 },
      users: { used: 1, limit: 1 },
      storage: { used: 12.5, limit: 500 },
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

  it("switches monthly, quarterly and yearly prices on the plan cards", async () => {
    await renderPricing();
    const price = () =>
      container.querySelector("[data-testid=card-plan-starter] .mk-tier__price")?.textContent ?? "";
    expect(price()).toContain("49");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid=billing-cycle-quarterly]")!.click();
    });
    expect(price()).toContain("44");
    expect(container.querySelector("[data-testid=card-plan-starter]")?.textContent).toContain(
      "every 3 months"
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid=billing-cycle-yearly]")!.click();
    });
    expect(price()).toContain("39");
    expect(container.querySelector("[data-testid=card-plan-starter]")?.textContent).toContain(
      "a year"
    );
  });

  it("has a tick/cross feature comparison grid", async () => {
    await renderPricing();
    expect(container.querySelectorAll("table.mk-ptable tbody tr").length).toBeGreaterThan(20);
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
    expect(el?.textContent).toBe(`${TRIAL_DAYS - 4} days left in your free trial`);
    expect(container.querySelector("[data-testid=trial-contact-us]")).toBeNull();
  });

  it("says the trial has ended with a Contact us mailto, and does not lock anything", async () => {
    const el = await banner(trialState(new Date(Date.now() - 30 * 86400_000)));
    expect(el?.getAttribute("data-trial-state")).toBe("ended");
    expect(el?.textContent).toContain("Your trial has ended — contact us to choose a plan");
    expect(container.querySelector("[data-testid=trial-contact-us]")?.getAttribute("href")).toMatch(
      /^mailto:support@muhasib\.ai/
    );
  });

  it("renders nothing for a paid company", async () => {
    expect(await banner(null)).toBeNull();
  });
});

describe("/subscription", () => {
  it("shows the trial banner and the free plan card agrees with the table: 10 AI credits", async () => {
    await renderSubscription();
    expect(container.querySelector("[data-testid=trial-banner]")).not.toBeNull();
    // WP-E: the plan grid is the site's PlanCard (spec 3.15); the free card is on the page and the
    // comparison table carries the AI-credit figure.
    expect(container.querySelector("[data-testid=card-plan-free]")).not.toBeNull();
    const row = [...container.querySelectorAll("tr")].find((r) =>
      r.querySelector("td")?.textContent?.startsWith("AI credits/month")
    );
    expect(row?.querySelectorAll("td")[1]?.textContent).toBe("10");
    expect(getTierLimits("free").aiCreditsPerMonth).toBe(10);
  });

  it("shows invoices, receipts and seats as not enforced yet, and AI credits and storage as hard limits", async () => {
    await renderSubscription();
    const notes = [...container.querySelectorAll("[data-testid=usage-offer-note]")].map(
      (n) => n.textContent
    );
    expect(notes).toEqual([
      "Not enforced yet (plan limit: 20)",
      "Not enforced yet (plan limit: 20)",
      "Not enforced yet (plan limit: 1)",
    ]);
    expect(text()).toContain("10 / 10");
    expect(text()).toContain("12.5 MB / 500 MB");
  });

  it("aligns plan features with /pricing: AI receipt reading arrives later, e-invoicing with provider", async () => {
    await renderSubscription();
    // WP-E: plan cards are the shared PlanCard; the claims live in the comparison table.
    const cells = (label: string) =>
      [...container.querySelectorAll("tr")].find((r) =>
        r.querySelector("td")?.textContent?.startsWith(label)
      )?.textContent ?? "";
    // Fable P3: the row uses the pricing page wording, not "OCR ... Coming soon".
    expect(cells("AI receipt reading")).toContain("Arrives later");
    expect(text()).not.toContain("Coming soon");
    expect(cells("E-invoicing")).toContain("With provider");
    expect(text()).not.toContain("E-invoicing XML workflow");
  });

  it("replaces Upgrade with 'Contact us to upgrade' (mailto) while checkout is not configured", async () => {
    await renderSubscription();
    const link = container.querySelector<HTMLAnchorElement>("a[data-testid=plan-contact-starter]");
    expect(link?.textContent).toBe("Contact us to upgrade");
    expect(link?.getAttribute("href")).toMatch(/^mailto:support@muhasib\.ai\?subject=/);
    expect(container.querySelector("[data-testid^=plan-upgrade-]")).toBeNull();
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
