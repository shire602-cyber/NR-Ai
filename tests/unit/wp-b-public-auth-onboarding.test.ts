// @vitest-environment jsdom
/**
 * WP-B (Fable design spec 3.1–3.4): pricing reads as the landing page's sibling and takes every
 * figure from the shared plan data; auth errors are inline (never a corner toast); the OAuth
 * callback and an expired verification link have their own states; customer onboarding is three
 * screens. Renders the real components and reads back what a visitor sees.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

async function render(el: ReturnType<typeof createElement>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, el));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

const text = () => (container.textContent ?? "").replace(/\s+/g, " ");

describe("[WP-B] plan data", () => {
  it("computes yearly prices from the shared plan module (never hard-coded)", async () => {
    const { PLANS, COMPARE_GROUPS, planPrice, yearlySaving, YEARLY_FREE } =
      await import("../../client/src/components/marketing/plans");
    const shared = await import("../../shared/plans");
    expect(PLANS.map((p) => p.id)).toEqual([...shared.PAID_PLAN_IDS]);
    for (const plan of PLANS) {
      expect(planPrice(plan, "monthly")).toBe(shared.PLAN_MONTHLY_PRICES[plan.id]);
      expect(planPrice(plan, "yearly")).toBe(shared.PLAN_MONTHLY_PRICES[plan.id] * 10);
      expect(yearlySaving(plan)).toBe(shared.PLAN_MONTHLY_PRICES[plan.id] * 2);
    }
    expect(YEARLY_FREE).toBe(2);
    // Spec 3.1: at most six bullets per plan, at most 24 comparison rows.
    for (const plan of PLANS) expect(plan.bulletKeys.length).toBeLessThanOrEqual(6);
    expect(COMPARE_GROUPS.flatMap((g) => g.rows).length).toBeLessThanOrEqual(24);
  });
});

describe("[WP-B] /pricing", () => {
  async function renderPricing() {
    const { default: Pricing } = await import("../../client/src/pages/Pricing");
    await render(createElement(Pricing));
  }

  it("uses the landing's section system: line eyebrow, one H1, FAQ and closing band", async () => {
    await renderPricing();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe(
      "One plan for where your books are today."
    );
    expect(container.querySelector(".mk-eyebrow")?.textContent).toBe("Pricing");
    expect(container.querySelector("#mk-cta-title")).not.toBeNull();
    expect(text()).toContain("Questions about plans and billing.");
    expect(text()).not.toMatch(/Frequently Asked Questions|Complete Feature Comparison/);
    // The accountant band links to the accounting services page.
    expect(
      container.querySelector("[data-testid=link-accounting-services]")?.getAttribute("href")
    ).toBe("/services");
  });

  it("has one primary plan CTA (the featured card) and states the saving note", async () => {
    await renderPricing();
    const featured = container.querySelector("[data-testid=card-plan-professional]");
    expect(featured?.getAttribute("data-featured")).toBe("true");
    expect(featured?.textContent).toContain("Most popular");
    expect(text()).toContain("Pay yearly and get 2 months free.");
    expect(text()).not.toMatch(/coming soon|A-Cube|Complyance/i);
  });

  it("collapses comparison groups but keeps their rows in the table", async () => {
    await renderPricing();
    const tax = [...container.querySelectorAll(".mk-ptable__group button")].find(
      (b) => b.textContent === "Tax and compliance"
    ) as HTMLButtonElement;
    expect(tax.getAttribute("aria-expanded")).toBe("false");
    const row = () =>
      [...container.querySelectorAll("table.mk-ptable tr")].find((r) =>
        r.textContent?.startsWith("Corporate tax (9%)")
      ) as HTMLTableRowElement;
    expect(row().hidden).toBe(true);
    await act(async () => tax.click());
    expect(row().hidden).toBe(false);
  });

  it("puts the currency after the figure in Arabic", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await renderPricing();
    const price = container.querySelector("[data-testid=card-plan-starter] .mk-tier__price");
    expect(price?.children[0]?.textContent).toBe("59");
    expect(price?.children[1]?.textContent).toBe("د.إ");
  });
});

describe("[WP-B] auth", () => {
  it("shows wrong credentials inline above the form, not as a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("/api/auth/login")
          ? new Response(JSON.stringify({ code: "INVALID_CREDENTIALS" }), { status: 401 })
          : new Response(JSON.stringify({ providers: [] }), { status: 200 })
      )
    );
    const { LoginForm } = await import("../../client/src/components/auth/LoginForm");
    await render(createElement(LoginForm, { onSuccess: () => undefined }));
    const set = (sel: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(sel)!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    await act(async () => {
      set("[data-testid=input-email]", "nobody@example.com");
      set("[data-testid=input-password]", "wrongpass1");
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid=button-login]")!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    const alert = container.querySelector("[data-testid=login-error]");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("Invalid email or password");
    // No card chrome and no icon in the submit button.
    expect(container.querySelector("[data-testid=button-login] svg")).toBeNull();
    expect(container.querySelector(".rounded-xl.border.bg-card")).toBeNull();
  });

  it("gives a failed social sign-in its own state in English and Arabic", async () => {
    vi.doMock("../../client/src/lib/auth", async () => ({
      ...(await vi.importActual<object>("../../client/src/lib/auth")),
      probeCurrentUser: async () => null,
    }));
    const { default: AuthCallback } = await import("../../client/src/pages/AuthCallback");
    await render(createElement(AuthCallback));
    expect(container.querySelector("[data-testid=auth-callback-failed]")?.textContent).toContain(
      "We could not sign you in"
    );
    expect(
      container.querySelector("[data-testid=button-callback-sign-in]")?.getAttribute("href")
    ).toBe("/login");
    act(() => root.unmount());
    root = createRoot(container);
    const { useI18n } = await import("../../client/src/lib/i18n");
    act(() => useI18n.getState().setLocale("ar"));
    await render(createElement(AuthCallback));
    expect(container.querySelector("[data-testid=auth-callback-failed]")?.textContent).toContain(
      "تعذّر تسجيل دخولك"
    );
    vi.doUnmock("../../client/src/lib/auth");
  });

  it("shows an expired verification link as its own state, not the sign-in form", async () => {
    window.history.replaceState({}, "", "/verify-email");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 401 }))
    );
    const { default: Login } = await import("../../client/src/pages/Login");
    await render(createElement(Login));
    expect(container.querySelector("[data-testid=text-verify-email]")?.textContent).toContain(
      "This link has expired"
    );
    expect(container.querySelector("[data-testid=input-password]")).toBeNull();
  });

  it("never mentions email delivery set-up after a reset request", async () => {
    const { t } = await import("../../client/src/lib/i18n");
    for (const loc of ["en", "ar"] as const) {
      const body = (t[loc] as Record<string, string>)["marketing.forgotDoneBody"];
      expect(body).toContain("{email}");
      expect(body).not.toMatch(/deliver|provider|set up|إعداد/i);
    }
  });
});

describe("[WP-B] onboarding", () => {
  it("is three screens with one step counter and a single progress line", async () => {
    const { OnboardingShell } = await import("../../client/src/pages/onboarding/OnboardingShell");
    await render(createElement(OnboardingShell, { step: 2, total: 3, children: null }));
    expect(container.querySelector("[data-testid=onboarding-step-count]")?.textContent).toBe(
      "Step 2 of 3"
    );
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  it("opening balances deep-link to the import wizard at the cut-over date", async () => {
    const { openingBalancesHref, FIRST_TASK_HREF } =
      await import("../../client/src/pages/onboarding/first-task");
    expect(openingBalancesHref("2026-12-01")).toBe("/import?kind=trial_balance&cutover=2026-12-01");
    expect(openingBalancesHref(null)).toBe("/import?kind=trial_balance");
    expect(FIRST_TASK_HREF.invoice).toBe("/invoices?new=1");
  });
});

describe("[WP-B] marketing scope", () => {
  // Source inspection on purpose: a CSS custom property that shadows a shared token only shows
  // up as a wrong colour at paint time, which jsdom does not compute.
  it("does not redefine the shared semantic tokens inside .mk-root", () => {
    const css = readFileSync("client/src/components/marketing/marketing.css", "utf8");
    for (const token of ["success", "warning", "danger", "info", "primary", "background"]) {
      expect(css, token).not.toMatch(new RegExp(`^\\s*--${token}(-subtle)?\\s*:`, "m"));
    }
  });
});
