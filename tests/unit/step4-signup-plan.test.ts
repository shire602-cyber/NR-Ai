// @vitest-environment jsdom
/**
 * STEP4: the plan step of sign-up (59 / 119 / 229 AED, 14-day Enterprise trial, no card). Renders
 * the real /register page in English and Arabic: the plan cards and prices, the default plan, the
 * trial date, keyboard selection, the deep link from /pricing, Change / Back, the payload sent to
 * POST /api/auth/register, the OAuth hand-off, invites, the /pricing CTAs, the trial banner and
 * the pure URL / path helpers.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { englishWords } from "../e2e/lib/sweep-checks.mjs";
import { afterTrialPlan, planPrice } from "../../shared/plans";
import { parseSignupPlanFromPath } from "../../shared/validators/plans";
import {
  oauthNextForPlan,
  readSignupPlan,
  signupPlanUrl,
} from "../../client/src/components/auth/signup-plan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const calls: { url: string; body: any }[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  calls.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/register");
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith("/api/auth/register")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.includes("/api/auth/oauth/providers")) {
      return new Response(
        JSON.stringify({ providers: [{ id: "google", label: "Google", configured: true }] }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ message: "no" }), { status: 401 });
  }) as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function settleUntil(done: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(1);
  await settle(2);
}

const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
// Bidi isolates around figures are layout controls, not text a reader sees.
const clean = (v: string | null | undefined) =>
  (v ?? "").replace(/[\u2066-\u2069\u200e\u200f]/g, "").replace(/\s+/g, " ");
const text = () => clean(container.textContent);

async function mountRegister(locale: "en" | "ar", search = "", ready = "signup-plan") {
  window.history.replaceState(null, "", `/register${search}`);
  const i18n = await import("../../client/src/lib/i18n");
  i18n.setPublicBootScope("/register");
  await i18n.loadLocaleForPath(locale, "/register");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
  const { default: PublicProviders } =
    await import("../../client/src/components/marketing/PublicProviders");
  const { default: Register } = await import("../../client/src/pages/Register");
  await act(async () => root.render(createElement(PublicProviders, null, createElement(Register))));
  await settleUntil(
    () =>
      ready === "signup-plan" ? !!q("signup-plan-step") || !!q("signup-plan-summary") : !!q(ready),
    8000
  );
}

const click = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
  });

describe.each(["en", "ar"] as const)("sign-up plan step (%s)", (locale) => {
  it("shows three radio cards with the owner-approved prices, monthly then yearly", async () => {
    await mountRegister(locale);
    expect(q("signup-plan-step")).not.toBeNull();
    expect(container.querySelectorAll('input[type="radio"][name$="-plan"]')).toHaveLength(3);
    const prices = (ids: string[]) => ids.map((id) => q(`plan-price-${id}`)?.textContent ?? "");
    const monthly = prices(["starter", "professional", "enterprise"]);
    expect(monthly[0]).toContain("59");
    expect(monthly[1]).toContain("119");
    expect(monthly[2]).toContain("229");
    await click(q("signup-cycle-yearly"));
    const yearly = prices(["starter", "professional", "enterprise"]);
    expect(yearly[0]).toContain("590");
    expect(yearly[1]).toContain("1,190");
    expect(yearly[2]).toContain("2,290");
    if (locale === "ar") {
      expect(document.documentElement.getAttribute("dir")).toBe("rtl");
      // The currency follows the figure in reading order: "119 د.إ".
      const pro = q("plan-price-professional")!;
      expect(pro.textContent!.indexOf("1,190")).toBeLessThan(pro.textContent!.indexOf("د.إ"));
      // The step itself (the header's language toggle names the other language).
      expect(
        englishWords(clean(q("main-content")?.textContent ?? q("signup-plan-step")!.textContent))
      ).toEqual([]);
    }
  });

  it("selects Professional by default; only the selected card shows its five bullets", async () => {
    await mountRegister(locale);
    const pro = q("radio-plan-professional") as HTMLInputElement;
    expect(pro.checked).toBe(true);
    expect(q("signup-plan-includes-professional")!.querySelectorAll("svg")).toHaveLength(5);
    expect(q("signup-plan-includes-starter")).toBeNull();
    // Selecting another card moves the open list (native radio change).
    await act(async () => {
      (q("radio-plan-starter") as HTMLInputElement).click();
    });
    expect((q("radio-plan-starter") as HTMLInputElement).checked).toBe(true);
    expect(q("signup-plan-includes-professional")).toBeNull();
    expect(q("signup-plan-includes-starter")!.querySelectorAll("svg")).toHaveLength(5);
  });

  it("states the trial end 14 days out and that AED 0 is due today", async () => {
    await mountRegister(locale);
    const { formatDate } = await import("../../client/src/lib/format-date");
    const end = formatDate(new Date(Date.now() + 14 * 86_400_000), locale);
    expect(q("signup-trial-callout")!.textContent).toContain(end);
    expect(q("signup-due-today")!.textContent).toMatch(/0/);
    expect(text()).toMatch(locale === "en" ? /No card needed/ : /دون بطاقة/);
  });

  it("Continue opens step 2 with the plan summary; Change returns with the choice kept", async () => {
    await mountRegister(locale);
    await act(async () => {
      (q("radio-plan-starter") as HTMLInputElement).click();
    });
    await click(q("button-signup-continue"));
    await settle();
    expect(q("signup-plan-step")).toBeNull();
    const summary = q("signup-plan-summary")!.textContent!;
    expect(summary).toContain("59");
    expect(window.location.search).toContain("step=account");
    expect(window.location.search).toContain("plan=starter");
    // Focus moved to the step heading.
    expect(document.activeElement?.tagName).toBe("H1");
    await click(q("button-change-plan"));
    await settle();
    expect(q("signup-plan-step")).not.toBeNull();
    expect((q("radio-plan-starter") as HTMLInputElement).checked).toBe(true);
    expect((document.activeElement as HTMLInputElement)?.type).toBe("radio");
  });

  it("a deep link from /pricing opens step 2 with that plan and cycle (Starter, yearly = 590 a year)", async () => {
    await mountRegister(locale, "?plan=starter&cycle=yearly");
    expect(q("signup-plan-step")).toBeNull();
    const summary = clean(q("signup-plan-summary")!.textContent);
    expect(summary).toContain("590");
    expect(window.location.search).toContain("step=account");
    if (locale === "en") expect(summary).toContain("Starter · AED 590 a year");
  });

  it("an invalid plan or cycle is ignored: step 1 with the default and no error", async () => {
    for (const bad of ["?plan=gold", "?plan=free", "?plan=none", "?cycle=quarterly", "?plan="]) {
      await mountRegister(locale, bad);
      expect(q("signup-plan-step"), bad).not.toBeNull();
      expect((q("radio-plan-professional") as HTMLInputElement).checked, bad).toBe(true);
      expect(container.querySelector('[role="alert"]'), bad).toBeNull();
    }
  });

  it("browser Back from step 2 returns to step 1", async () => {
    await mountRegister(locale);
    await click(q("button-signup-continue"));
    await settle();
    expect(q("signup-plan-summary")).not.toBeNull();
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 60));
    });
    await settle();
    expect(q("signup-plan-step")).not.toBeNull();
    expect((q("radio-plan-professional") as HTMLInputElement).checked).toBe(true);
  });
});

describe("sign-up payload and OAuth hand-off", () => {
  async function fillAndSubmit() {
    const type = (id: string, value: string) => {
      const input = q(id) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    type("input-name", "Sara Ali");
    type("input-email", "sara@example.ae");
    type("input-password", "Str0ng-pass-123");
    await click(q("button-register"));
    await settleUntil(() => calls.some((c) => c.url.endsWith("/api/auth/register")));
    return calls.find((c) => c.url.endsWith("/api/auth/register"))!.body;
  }

  it("untouched default is sent as signup_default with the Professional monthly choice", async () => {
    await mountRegister("en");
    await click(q("button-signup-continue"));
    await settle();
    const body = await fillAndSubmit();
    expect(body).toMatchObject({
      plan: "professional",
      billingCycle: "monthly",
      planSource: "signup_default",
    });
  });

  it("a changed plan is signup_picked; a /pricing deep link is pricing_link", async () => {
    await mountRegister("en");
    await click(q("signup-cycle-yearly"));
    await act(async () => {
      (q("radio-plan-enterprise") as HTMLInputElement).click();
    });
    await click(q("button-signup-continue"));
    await settle();
    expect(await fillAndSubmit()).toMatchObject({
      plan: "enterprise",
      billingCycle: "yearly",
      planSource: "signup_picked",
    });
    act(() => root.unmount());
    container.remove();
    calls.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await mountRegister("en", "?plan=starter&cycle=monthly");
    expect(await fillAndSubmit()).toMatchObject({
      plan: "starter",
      billingCycle: "monthly",
      planSource: "pricing_link",
    });
  });

  it("the Google button carries the choice through the post-sign-in path", async () => {
    await mountRegister("en", "?plan=starter&cycle=yearly");
    await settleUntil(() => !!q("button-oauth-google"));
    const assign = vi.fn();
    const original = Object.getOwnPropertyDescriptor(window, "location")!;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign, search: window.location.search },
    });
    try {
      await click(q("button-oauth-google"));
    } finally {
      Object.defineProperty(window, "location", original);
    }
    expect(assign).toHaveBeenCalled();
    const url = String(assign.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain(
      "next=/dashboard?signup_plan=starter&signup_cycle=yearly&signup_source=pricing_link"
    );
  });

  it("a team invitation shows the invite card and no plan step", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            email: "x@y.ae",
            role: "accountant",
            company: { id: "c1", name: "Acme" },
            accountExists: false,
          }),
          { status: 200 }
        )
    ) as typeof fetch;
    await mountRegister("en", "?teamInvite=tok123", "card-team-invite");
    expect(q("card-team-invite")).not.toBeNull();
    expect(q("signup-plan-step")).toBeNull();
    expect(q("signup-plan-summary")).toBeNull();
  });
});

describe("pure helpers", () => {
  it("readSignupPlan validates plan, cycle and step", () => {
    expect(readSignupPlan("")).toMatchObject({
      planId: "professional",
      cycle: "monthly",
      step: "plan",
      explicit: false,
      source: "signup_default",
    });
    expect(readSignupPlan("?plan=starter&cycle=yearly")).toMatchObject({
      planId: "starter",
      cycle: "yearly",
      step: "account",
      explicit: true,
      source: "pricing_link",
    });
    expect(readSignupPlan("?plan=gold&cycle=quarterly")).toMatchObject({
      planId: "professional",
      cycle: "monthly",
      step: "plan",
    });
    // A repeated parameter is ambiguous, so it is ignored.
    expect(readSignupPlan("?plan=starter&plan=enterprise").explicit).toBe(false);
    expect(readSignupPlan("?step=plan&plan=starter&src=picked")).toMatchObject({
      step: "plan",
      source: "signup_picked",
    });
  });

  it("signupPlanUrl and oauthNextForPlan build the expected paths", () => {
    expect(signupPlanUrl("starter", "monthly")).toBe("/register?plan=starter&cycle=monthly");
    expect(oauthNextForPlan({ planId: "starter", cycle: "yearly", source: "signup_picked" })).toBe(
      "/dashboard?signup_plan=starter&signup_cycle=yearly&signup_source=signup_picked"
    );
  });

  it("parseSignupPlanFromPath accepts only valid, single-valued choices and never throws", () => {
    expect(
      parseSignupPlanFromPath(
        "/dashboard?signup_plan=starter&signup_cycle=yearly&signup_source=signup_picked"
      )
    ).toEqual({ planId: "starter", billingCycle: "yearly", source: "signup_picked" });
    expect(parseSignupPlanFromPath("/dashboard?signup_plan=starter")).toEqual({
      planId: "starter",
      billingCycle: "monthly",
      source: "signup_picked",
    });
    for (const junk of [
      "/dashboard",
      "/dashboard?signup_plan=gold",
      "/dashboard?signup_plan=free",
      "/dashboard?signup_plan=starter&signup_plan=enterprise",
      "/dashboard?signup_plan=%E0%A4%A",
      "https://evil.test/?signup_plan=starter".slice(0, 0),
      "",
      null,
      undefined,
    ]) {
      expect(() => parseSignupPlanFromPath(junk as string)).not.toThrow();
    }
    expect(parseSignupPlanFromPath("/dashboard?signup_plan=gold")).toBeNull();
    expect(
      parseSignupPlanFromPath("/dashboard?signup_plan=starter&signup_plan=enterprise")
    ).toBeNull();
    // An unknown source falls back to picked; "settings" is never accepted from a client.
    expect(parseSignupPlanFromPath("/d?signup_plan=starter&signup_source=settings")?.source).toBe(
      "signup_picked"
    );
  });

  it("afterTrialPlan prices from the one plan module", () => {
    expect(afterTrialPlan({ chosenPlanId: "professional", chosenBillingCycle: "yearly" })).toEqual({
      planId: "professional",
      billingCycle: "yearly",
      price: planPrice("professional", "yearly"),
    });
    expect(afterTrialPlan({ chosenPlanId: "free" })).toBeNull();
    expect(afterTrialPlan({ chosenPlanId: null })).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("/pricing plan cards (%s)", (locale) => {
  it("Starter and Professional start the trial with their plan; Enterprise keeps Talk to us plus a trial link", async () => {
    const i18n = await import("../../client/src/lib/i18n");
    i18n.setPublicBootScope("/pricing");
    await i18n.loadLocale(locale);
    await act(async () => i18n.useI18n.getState().setLocale(locale));
    const { PlanCard } = await import("../../client/src/components/marketing/PlanCard");
    const { PLANS } = await import("../../client/src/components/marketing/plans");
    const { default: PublicProviders } =
      await import("../../client/src/components/marketing/PublicProviders");
    const cards = (cycle: "monthly" | "yearly") =>
      createElement(
        PublicProviders,
        null,
        ...PLANS.map((plan) =>
          createElement(PlanCard, { key: plan.id, plan, cycle, compact: true })
        )
      );
    await act(async () => root.render(cards("monthly")));
    const href = (id: string) => q(id)?.getAttribute("href");
    expect(href("button-plan-starter")).toBe("/register?plan=starter&cycle=monthly");
    expect(href("button-plan-professional")).toBe("/register?plan=professional&cycle=monthly");
    expect(q("button-plan-enterprise")!.tagName).toBe("A");
    expect(href("button-plan-enterprise")).toMatch(/^mailto:/);
    expect(href("link-plan-trial-enterprise")).toBe("/register?plan=enterprise&cycle=monthly");
    await act(async () => root.render(cards("yearly")));
    expect(href("button-plan-professional")).toBe("/register?plan=professional&cycle=yearly");
  });
});

describe.each(["en", "ar"] as const)("trial banner (%s)", (locale) => {
  async function renderBanner(props: Record<string, unknown>) {
    const i18n = await import("../../client/src/lib/i18n");
    await i18n.loadLocale(locale);
    await act(async () => i18n.useI18n.getState().setLocale(locale));
    vi.doMock("../../client/src/hooks/useSubscription", () => ({
      useSubscription: () => ({ trial: null, chosenPlan: null }),
    }));
    const { TrialBanner } = await import("../../client/src/components/TrialBanner");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(TrialBanner, props as never)
        )
      )
    );
  }
  const chosen = {
    planId: "professional",
    billingCycle: "monthly",
    source: "signup_picked",
    chosenAt: null,
    price: 119,
  };
  const trial = (daysLeft: number, ended = false) => ({
    days: 14,
    startedAt: "2026-11-01T00:00:00Z",
    endsAt: "2026-12-03T00:00:00Z",
    daysLeft,
    ended,
  });

  it("running trial with a choice names the plan; the last days ask to activate it", async () => {
    await renderBanner({ trial: trial(12), chosen });
    const banner = q("trial-banner")!;
    expect(banner.textContent).toContain(
      locale === "en" ? "12 days left in your free trial" : "12"
    );
    expect(banner.textContent).toContain(
      locale === "en" ? "You chose Professional. Activate it before" : "اخترت الخطة الاحترافية"
    );
    expect(q("trial-activate")).toBeNull();
    await renderBanner({ trial: trial(2), chosen });
    expect(q("trial-activate")).not.toBeNull();
    expect(q("trial-activate")!.textContent).toContain(
      locale === "en" ? "Activate Professional" : "فعّل"
    );
  });

  it("without a choice it asks to choose; ended with a choice offers activation", async () => {
    await renderBanner({ trial: trial(10), chosen: null });
    expect(q("trial-banner")!.textContent).toContain(
      locale === "en"
        ? "Choose the plan for after your trial"
        : "اختر الخطة التي تريدها بعد الفترة التجريبية"
    );
    await renderBanner({ trial: trial(0, true), chosen });
    expect(q("trial-banner")!.getAttribute("data-trial-state")).toBe("ended");
    expect(q("trial-activate")).not.toBeNull();
  });
});
