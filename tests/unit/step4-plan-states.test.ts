// @vitest-environment jsdom
/**
 * STEP4 finisher: one state rule {trial running, ended} x {no choice, chosen, activation
 * requested} drives Settings > Billing, the trial banner, the plan-lock banner and the plan-limit
 * dialog (en + ar). Each state has one call to action and true dates; the sign-up step keeps its
 * accessible names, and the P2 polish (focus, funnel source, flash, read-only forms, one trial-end
 * rule, UTC pin) is pinned here as behaviour.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRIAL_LIMITS, planFeatures, resolveEntitlement } from "../../shared/plans";
import { TRIAL_DAYS, trialState } from "../../shared/trial";
import { applySignupChange, readSignupPlan } from "../../client/src/components/auth/signup-plan";
import { planCta, planPhase } from "../../client/src/lib/plan-state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// File-level timeout is vitest's default (5 s); per-test overrides cover the two slow cases:

const sub = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  /** Overrides the gate's subscription query (unset = a loaded one built from `state`). */
  query: null as Record<string, unknown> | null,
  canBilling: true,
  user: { id: "u1", isAdmin: false, firmRole: null } as {
    id: string;
    isAdmin?: boolean;
    firmRole?: string | null;
  } | null,
}));
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => sub.state,
  useCompanySubscription: () =>
    sub.query ?? {
      data: {
        trialLocked: sub.state.isReadOnly,
        entitlement: {
          chosenPlan: sub.state.chosenPlan,
          activationRequestedAt: sub.state.activationRequestedAt,
        },
      },
      isPending: false,
      isLoadingError: false,
      fetchStatus: "idle",
      error: null,
      refetch: () => {},
    },
  usePlanChoiceActions: () => ({
    choose: { isPending: false, mutate: () => {} },
    activate: { isPending: false, mutate: () => {} },
  }),
}));
vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: sub.user }),
}));
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", companies: [] }),
}));
vi.mock("../../client/src/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => sub.canBilling, gate: () => ({}) }),
}));

let container: HTMLDivElement;
let root: Root;

const chosen = {
  planId: "professional",
  billingCycle: "monthly",
  source: "signup_picked",
  chosenAt: "2026-11-19T08:00:00Z",
  price: 119,
};
const REQUESTED = "2026-11-19T08:30:00Z";

type PhaseName =
  | "running-none"
  | "running-chosen"
  | "running-chosen-warn"
  | "running-requested"
  | "ended-none"
  | "ended-chosen"
  | "ended-requested";

/** The subscription hook's data for one state. */
function stateFor(name: PhaseName): Record<string, unknown> {
  const ended = name.startsWith("ended");
  const trial = ended
    ? trialState(new Date(Date.now() - 20 * 86400_000))
    : trialState(new Date(Date.now() - (name === "running-chosen-warn" ? 12 : 4) * 86400_000));
  const withChoice = !name.endsWith("none");
  const requested = name.endsWith("requested");
  return {
    tierName: "enterprise",
    isLoading: false,
    enforcement: true,
    checkoutAvailable: false,
    planState: ended ? "expired" : "trial",
    isReadOnly: ended,
    entitlement: {
      state: ended ? "expired" : "trial",
      planId: ended ? null : "enterprise",
      storedPlanId: "free",
      features: ended ? {} : planFeatures("enterprise"),
      limits: TRIAL_LIMITS,
    },
    trial,
    subscription: { id: "s1", planId: "free", status: "active", billingCycle: "monthly" },
    usage: undefined,
    planLoading: false,
    loadError: null,
    isPaused: false,
    refreshError: null,
    retryLoad: () => {},
    usageState: { loaded: true, loadError: null, refreshError: null, retry: () => {} },
    chosenPlan: withChoice ? chosen : null,
    activationRequestedAt: requested ? REQUESTED : null,
    canWrite: () => false,
    getRequiredTier: () => "professional",
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
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  window.history.replaceState(null, "", "/invoices");
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sub.canBilling = true;
  sub.user = { id: "u1", isAdmin: false, firmRole: null };
  sub.state = stateFor("running-none");
  sub.query = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll("[data-radix-portal]").forEach((n) => n.remove());
});

const clean = (v: string | null | undefined) =>
  (v ?? "").replace(/[⁦-⁩‎‏]/g, "").replace(/\s+/g, " ");
const q = (id: string, within: ParentNode = container) =>
  within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = (el: ParentNode = container) => clean(el.textContent);

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  await act(async () => useI18n.getState().setLocale(locale));
}

function render(node: ReturnType<typeof createElement>) {
  return act(async () => {
    root.render(createElement(QueryClientProvider, { client: new QueryClient() }, node));
  });
}

// ── the rule itself ─────────────────────────────────────────────────────────────────────────

describe("the plan-state rule", () => {
  it("maps {trial running, ended} x {none, chosen, requested} to one CTA each", () => {
    const at = REQUESTED;
    const cases = [
      [{ trialEnded: false, chosen: false }, "running-none", "choose"],
      [{ trialEnded: false, chosen: true }, "running-chosen", "activate"],
      [
        { trialEnded: false, chosen: true, activationRequestedAt: at },
        "running-requested",
        "see-plan",
      ],
      [{ trialEnded: true, chosen: false }, "ended-none", "choose"],
      [{ trialEnded: true, chosen: true }, "ended-chosen", "activate"],
      [
        { trialEnded: true, chosen: true, activationRequestedAt: at },
        "ended-requested",
        "see-plan",
      ],
      // A request with no choice cannot exist; it reads as no choice.
      [{ trialEnded: true, chosen: false, activationRequestedAt: at }, "ended-none", "choose"],
    ] as const;
    for (const [input, key, cta] of cases) {
      const phase = planPhase(input);
      expect(phase.key).toBe(key);
      expect(planCta(phase)).toBe(cta);
    }
  });
});

// ── the trial banner, six states, en + ar ───────────────────────────────────────────────────

describe.each(["en", "ar"] as const)("trial banner states (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));

  async function banner(name: PhaseName) {
    const s = stateFor(name) as {
      trial: unknown;
      chosenPlan: unknown;
      activationRequestedAt: string | null;
    };
    const { TrialBanner } = await import("../../client/src/components/TrialBanner");
    await render(
      createElement(TrialBanner, {
        trial: s.trial as never,
        chosen: s.chosenPlan as never,
        activationRequestedAt: s.activationRequestedAt,
      })
    );
    return q("trial-banner")!;
  }
  const L = (en: string, ar: string) => (locale === "en" ? en : ar);

  it.each(["running-none", "running-chosen", "running-requested"] as const)(
    "%s: true days-left copy, one CTA, never 'Choose a plan' to someone who chose",
    async (name) => {
      const el = await banner(name);
      const body = text(el);
      expect(el.getAttribute("data-plan-phase")).toBe(name);
      expect(el.querySelectorAll("a, button")).toHaveLength(1);
      expect(body).not.toContain(L("stay read-only", "للقراءة فقط"));
      if (name === "running-none") {
        expect(body).toContain(
          L(
            "Choose the plan for after your trial, then activate it to keep working.",
            "اختر الخطة التي تريدها بعد الفترة التجريبية ثم فعّلها لتواصل العمل."
          )
        );
        expect(q("trial-see-plans")!.textContent).toBe(L("See plans", "عرض الخطط"));
      } else {
        expect(body).not.toContain(L("Choose a plan", "اختر خطة"));
        expect(q("trial-see-plans")!.textContent).toBe(L("See plan", "عرض الخطة"));
      }
      if (name === "running-chosen") {
        expect(body).toContain(
          L("You chose Professional. Activate it before", "اخترت الخطة الاحترافية. فعّلها قبل")
        );
      }
      if (name === "running-requested") {
        expect(body).toContain(L("Activation requested on", "طُلب التفعيل في"));
        expect(body).toContain(L("We'll confirm by email.", "سنؤكد لك بالبريد الإلكتروني."));
        expect(body).not.toContain(L("Activate Professional", "فعّل الخطة الاحترافية"));
      }
    }
  );

  it("running + chosen, last days: one button, 'Activate Professional'", async () => {
    sub.state = stateFor("running-chosen-warn");
    const el = await banner("running-chosen-warn");
    expect(q("trial-activate")!.textContent).toBe(
      L("Activate Professional", "فعّل الخطة الاحترافية")
    );
    expect(el.querySelectorAll("a, button")).toHaveLength(1);
    expect(text(el)).toContain(L("keep adding records", "لمواصلة إضافة السجلات"));
  });

  it("ended + no choice: locked until a plan is activated; one 'Choose a plan'", async () => {
    const el = await banner("ended-none");
    expect(el.getAttribute("data-trial-state")).toBe("ended");
    expect(text(el)).toContain(
      L(
        "read-only until you choose and activate a paid plan",
        "للقراءة فقط حتى تختار خطة مدفوعة وتفعّلها"
      )
    );
    expect(q("trial-contact-us")!.textContent).toBe(L("Choose a plan", "اختر خطة"));
    expect(el.querySelectorAll("a, button")).toHaveLength(1);
  });

  it("ended + chosen: a true past tense, no 'stays open until', one 'Activate' and no 'Choose a plan'", async () => {
    const el = await banner("ended-chosen");
    const body = text(el);
    expect(body).toContain(L("Your trial ended on", "انتهت فترتك التجريبية في"));
    expect(body).toContain(
      L("read-only until Professional is activated", "حتى تفعيل الخطة الاحترافية")
    );
    expect(body).not.toContain(L("stays open", "مفتوحة"));
    expect(body).not.toContain(L("Choose a plan", "اختر خطة"));
    expect(q("trial-activate")!.textContent).toBe(
      L("Activate Professional", "فعّل الخطة الاحترافية")
    );
    expect(el.querySelectorAll("a, button")).toHaveLength(1);
  });

  it("ended + requested: 'Activation requested on {date}. We'll confirm by email.' and no Activate", async () => {
    const el = await banner("ended-requested");
    const body = text(el);
    const { formatDate } = await import("../../client/src/lib/format-date");
    expect(body).toContain(
      L(
        `Activation requested on ${formatDate(REQUESTED, locale)}. We'll confirm by email.`,
        `طُلب التفعيل في ${formatDate(REQUESTED, locale)}. سنؤكد لك بالبريد الإلكتروني.`
      )
    );
    expect(body).toContain(
      L("stays read-only until we activate your plan", "للقراءة فقط حتى نفعّل خطتك")
    );
    expect(body).not.toContain(L("Activate Professional", "فعّل الخطة الاحترافية"));
    expect(el.querySelectorAll("a, button")).toHaveLength(1);
    expect(el.querySelector("a")!.textContent).toBe(L("See plan", "عرض الخطة"));
  });
});

// ── the plan-lock banner and the plan-limit dialog ─────────────────────────────────────────

describe.each(["en", "ar"] as const)("trial lock screen and plan-limit dialog (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));
  const L = (en: string, ar: string) => (locale === "en" ? en : ar);

  const cases = [
    {
      name: "ended-none" as const,
      body: L(
        "Choose and activate a paid plan to make changes.",
        "اختر خطة مدفوعة وفعّلها لإجراء تغييرات."
      ),
      cta: L("Choose a plan", "اختر خطة"),
    },
    {
      name: "ended-chosen" as const,
      body: L("Activate Professional to make changes.", "فعّل الخطة الاحترافية لإجراء تغييرات."),
      cta: L("Activate Professional", "فعّل الخطة الاحترافية"),
    },
    {
      name: "ended-requested" as const,
      body: L("We received your activation request.", "استلمنا طلب التفعيل."),
      cta: L("See plan", "عرض الخطة"),
    },
  ];

  it.each(cases)(
    "read-only banner, $name: keeps workspace records visible and offers billing and support",
    async ({ name, body, cta }) => {
      sub.state = stateFor(name);
      const { TrialAccessGate } =
        await import("../../client/src/components/billing/TrialAccessGate");
      await render(
        createElement(TrialAccessGate, {
          children: createElement("div", null, "Workspace records"),
        })
      );
      const el = q("trial-readonly-banner")!;
      expect(el.querySelector("h2")?.textContent).toBe(
        L("Your 14-day trial has ended", "انتهت تجربتك المجانية لمدة 14 يومًا")
      );
      expect(text(el)).toContain(body);
      expect(text(el)).toContain(L("Your data is saved.", "بياناتك محفوظة."));
      expect(text()).toContain("Workspace records");
      const links = el.querySelectorAll("a");
      expect(links).toHaveLength(2);
      expect(links[0].textContent).toBe(cta);
      expect(links[1].getAttribute("href")).toBe("mailto:support@muhasib.ai");
    }
  );

  it("mounts only the billing content at /subscription while locked", async () => {
    sub.state = stateFor("ended-none");
    window.history.replaceState(null, "", "/subscription");
    const { TrialAccessGate } = await import("../../client/src/components/billing/TrialAccessGate");
    await render(
      createElement(TrialAccessGate, {
        children: createElement("div", null, "Workspace records"),
        billing: createElement("div", null, "Billing recovery"),
      })
    );
    expect(text()).toContain("Billing recovery");
    expect(text()).not.toContain("Workspace records");
  });

  it.each(cases)(
    "limit dialog, $name: never asks someone who chose to choose",
    async ({ name, cta }) => {
      sub.state = stateFor(name);
      const { PlanLimitDialog } =
        await import("../../client/src/components/billing/PlanLimitDialog");
      const { PLAN_LIMIT_EVENT } = await import("../../client/src/lib/plan-limit");
      await render(createElement(PlanLimitDialog));
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(PLAN_LIMIT_EVENT, { detail: { code: "PLAN_REQUIRED" } })
        );
      });
      const dialog = document.querySelector<HTMLElement>('[data-testid="plan-limit-dialog"]')!;
      expect(dialog).not.toBeNull();
      const body = text(dialog);
      if (name === "ended-none") {
        expect(body).toContain(
          L("Choose and activate a paid plan to make changes.", "اختر خطة مدفوعة وفعّلها")
        );
      } else {
        expect(body).not.toContain(L("Choose a plan", "اختر خطة"));
        const action = dialog.querySelector<HTMLElement>(
          '[data-testid="plan-limit-activate"], [data-testid="plan-limit-see-plan"]'
        )!;
        expect(action.textContent).toBe(cta);
      }
      if (name === "ended-chosen") {
        expect(body).toContain(L("Activate Professional to make changes", "فعّل الخطة الاحترافية"));
      }
      if (name === "ended-requested") {
        expect(body).toContain(L("Activation requested on", "طُلب التفعيل في"));
        expect(body).toContain(L("We'll confirm by email.", "سنؤكد لك بالبريد الإلكتروني."));
      }
    }
  );
});

// ── the gate while the plan is unknown ─────────────────────────────────────────────────────
// Real React Query behaviour for these states: trial-access-gate-load-states.test.ts.

describe("trial gate when the first plan load fails", () => {
  async function gate(path: string, refetch: () => void) {
    window.history.replaceState(null, "", path);
    sub.query = {
      data: undefined,
      isPending: false,
      isLoadingError: true,
      fetchStatus: "idle",
      error: Object.assign(new Error("boom"), { status: 503 }),
      refetch,
    };
    const { TrialAccessGate } = await import("../../client/src/components/billing/TrialAccessGate");
    await render(
      createElement(TrialAccessGate, {
        children: createElement("div", null, "Workspace records"),
        billing: createElement("div", null, "Billing recovery"),
      })
    );
    expect(text()).not.toContain("Workspace records");
    expect(text()).not.toContain("Billing recovery");
    expect(text()).not.toContain("boom");
  }

  it("on /subscription shows the Billing error and retries the query", async () => {
    const refetch = vi.fn();
    await gate("/subscription", refetch);
    const error = q("subscription-load-error")!;
    await act(async () => error.querySelector("button")!.click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("elsewhere keeps the workspace closed with the access-check screen", async () => {
    await gate("/invoices", () => {});
    expect(q("trial-recovery-layout")).not.toBeNull();
    expect(q("subscription-load-error")).toBeNull();
  });
});

// ── Settings > Billing ──────────────────────────────────────────────────────────────────────

describe.each(["en", "ar"] as const)("Settings > Billing states (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));
  const L = (en: string, ar: string) => (locale === "en" ? en : ar);

  async function page(name: PhaseName) {
    sub.state = stateFor(name);
    const { default: Subscription } = await import("../../client/src/pages/Subscription");
    await render(createElement(Subscription));
  }

  it("a failed plan load shows a translated error with Retry, not an empty plan page", async () => {
    const retry = vi.fn();
    sub.state = {
      ...stateFor("running-none"),
      planState: null,
      entitlement: null,
      trial: null,
      subscription: undefined,
      loadError: Object.assign(new Error("boom"), { status: 500 }),
      retryLoad: retry,
    };
    const { default: Subscription } = await import("../../client/src/pages/Subscription");
    await render(createElement(Subscription));
    const err = q("subscription-load-error");
    expect(err).not.toBeNull();
    expect(text(err!)).toContain(L("Try again", "أعد المحاولة"));
    expect(text()).not.toContain("boom");
    expect(q("plan-choose-professional")).toBeNull();
    const btn = err!.querySelector("button")!;
    await act(async () => btn.click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("running + chosen: honest 'choosing alone does not keep you working', sentence-form billing, trial caps", async () => {
    await page("running-chosen");
    const body = text();
    expect(body).toContain(L("You chose Professional.", "اخترت الخطة الاحترافية."));
    expect(body).toContain(
      L(
        "Choosing it doesn't keep you working on its own. Activate it before your trial ends on",
        "الاختيار وحده لا يُبقي عملك مستمرًا. فعّلها قبل انتهاء فترتك التجريبية في"
      )
    );
    // The billing cycle reads as a sentence ("billed monthly"), never the capitalised label.
    expect(body).toContain(L("AED 119, billed monthly", "تُدفع شهريًا"));
    expect(body).not.toContain("billed Monthly");
    expect(body).not.toContain("فوترة شهري");
    // "Every feature" plus a line with the trial caps, from the shared constants.
    expect(body).toContain(
      L("Every feature is open during the trial.", "كل الميزات متاحة خلال الفترة التجريبية.")
    );
    expect(q("trial-caps")!.textContent).toContain(
      L(
        `up to ${TRIAL_LIMITS.maxCompanies} companies, ${TRIAL_LIMITS.aiCreditsPerMonth} AI credits and ${TRIAL_LIMITS.maxStorageMb / 1024} GB of storage`,
        "حتى 3 شركات"
      )
    );
    expect(q("button-activate-plan")).not.toBeNull();
    expect(q("button-see-plans")).toBeNull();
  });

  it("running + requested: the badge, the confirmation promise and a true 'open until' date", async () => {
    await page("running-requested");
    const block = q("activation-requested")!;
    expect(text(block)).toContain(L("Activation requested on", "طُلب التفعيل في"));
    expect(text(block)).toContain(L("We'll confirm by email.", "سنؤكد لك بالبريد الإلكتروني."));
    expect(text(block)).toContain(
      L("Your books stay fully open until", "تبقى دفاترك مفتوحة بالكامل حتى")
    );
    expect(q("button-activate-plan")).toBeNull();
  });

  it("ended + requested: locked until plan activation, never 'stays open until <past date>'", async () => {
    await page("ended-requested");
    const block = q("activation-requested")!;
    expect(text(block)).toContain(
      L(
        "Your workspace stays read-only until we activate your plan. Your data is saved.",
        "تبقى مساحة عملك للقراءة فقط حتى نفعّل خطتك. بياناتك محفوظة."
      )
    );
    expect(text()).not.toContain(L("stay fully open", "مفتوحة بالكامل"));
    // Once requested, nothing on the page tells the customer to activate (or choose) again.
    expect(text()).not.toContain(L("Activate Professional", "فعّل الخطة الاحترافية"));
    // (The plan grid's own "Choose a plan" heading stays: no button asks for it.)
    const buttons = [...container.querySelectorAll("button, a")].map((b) => b.textContent ?? "");
    expect(buttons.some((b) => b.trim() === L("Choose a plan", "اختر خطة"))).toBe(false);
    expect(q("button-activate-plan")).toBeNull();
    expect(q("button-choose-plan")).toBeNull();
    expect(q("button-see-plans")).toBeNull();
  });

  it("ended + chosen: past tense, one Activate, no 'Choose a plan' button", async () => {
    await page("ended-chosen");
    const body = text();
    expect(body).toContain(L("Your trial ended on", "انتهت فترتك التجريبية في"));
    expect(body).toContain(
      L(
        "Activate Professional to add records again.",
        "فعّل الخطة الاحترافية لتعود إلى إضافة السجلات."
      )
    );
    expect(body).not.toContain(L("It starts after your trial ends", "تبدأ بعد انتهاء"));
    expect(body).not.toContain(
      L("Choose a plan and activate it to add", "اختر خطة وفعّلها لإضافة")
    );
    expect(q("button-activate-plan")).not.toBeNull();
    expect(q("button-choose-plan")).toBeNull();
    expect(q("button-see-plans")).toBeNull();
    const activates = [...container.querySelectorAll("button")].filter((b) =>
      (b.textContent ?? "").includes(L("Activate Professional", "فعّل الخطة الاحترافية"))
    );
    expect(activates).toHaveLength(1);
  });

  it("ended + no choice: one 'See plans' CTA, no duplicate 'Choose a plan'", async () => {
    await page("ended-none");
    expect(q("button-see-plans-choice")).not.toBeNull();
    expect(q("button-choose-plan")).toBeNull();
    expect(q("button-see-plans")).toBeNull();
  });
});

// ── sign-up step: accessible names, sticky Continue, focus, funnel source, flash ───────────

describe.each(["en", "ar"] as const)("sign-up plan step (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));

  it("each radio's accessible name is the plan name; the description carries price and audience", async () => {
    const { PlanChoiceList } = await import("../../client/src/components/billing/PlanChoiceList");
    const { PLANS } = await import("../../client/src/components/marketing/plans");
    await render(
      createElement(PlanChoiceList, {
        value: "professional",
        cycle: "monthly",
        onChange: () => {},
        labelledBy: "x",
      })
    );
    const { useI18n } = await import("../../client/src/lib/i18n");
    const t = useI18n.getState().t ?? ({} as Record<string, string>);
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(3);
    radios.forEach((radio, i) => {
      const nameEl = document.getElementById(radio.getAttribute("aria-labelledby")!)!;
      const plan = PLANS[i];
      expect(nameEl.textContent!.length).toBeLessThan(24);
      // The name never contains the price, the badge or the bullets.
      expect(clean(nameEl.textContent)).not.toMatch(/\d/);
      const described = clean(
        radio
          .getAttribute("aria-describedby")!
          .split(" ")
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      );
      expect(described).toMatch(new RegExp(`${[59, 119, 229][i]}`));
      expect(described.length).toBeGreaterThan(nameEl.textContent!.length);
      if (plan.featured) expect(radio.getAttribute("aria-describedby")).toContain("-pop-");
    });
    void t;
  });

  it("Continue is a bar that sticks at every width (the 1440x900 laptop keeps it in view)", async () => {
    const { SignupPlanStep } = await import("../../client/src/components/auth/SignupPlanStep");
    await render(
      createElement(SignupPlanStep, {
        planId: "professional",
        cycle: "monthly",
        onPlanChange: () => {},
        onCycleChange: () => {},
        onContinue: () => {},
      })
    );
    const bar = q("signup-continue-bar")!;
    const classes = bar.className.split(/\s+/);
    // jsdom cannot lay out a page: the real viewport check is the e2e 'signup' flow at 1440x900.
    expect(classes).toContain("sticky");
    expect(classes).toContain("bottom-0");
    expect(classes.some((c) => c.startsWith("max-sm:sticky"))).toBe(false);
    // "Every feature" with a caption of the trial caps from the shared constants.
    expect(text(q("signup-plan-step")!)).toContain(
      locale === "en" ? "days of every feature, free" : "مع كل الميزات"
    );
    expect(q("signup-trial-caps")!.textContent).toContain(
      locale === "en" ? "3 companies, 100 AI credits and 1 GB of storage" : "100"
    );
  });
});

describe("sign-up funnel source and URL step", () => {
  it("a cycle-only change does not record 'picked'; a plan change does", () => {
    const start = readSignupPlan("");
    expect(start.source).toBe("signup_default");
    const yearly = applySignupChange(start, { cycle: "yearly" });
    expect(yearly).toMatchObject({
      cycle: "yearly",
      planId: start.planId,
      source: "signup_default",
    });
    expect(applySignupChange(yearly, { planId: "starter" })).toMatchObject({
      planId: "starter",
      source: "signup_picked",
    });
    // The same plan again is not a pick; a pricing link keeps its source on a cycle change.
    expect(applySignupChange(start, { planId: start.planId })).toBe(start);
    const fromLink = readSignupPlan("?plan=starter&cycle=monthly");
    expect(applySignupChange(fromLink, { cycle: "yearly" }).source).toBe("pricing_link");
  });
});

// ── Register page: forward focus and the signed-in redirect without a flash ────────────────

describe("/register page behaviour", () => {
  async function mount(search: string, ready: () => boolean) {
    window.history.replaceState(null, "", `/register${search}`);
    const i18n = await import("../../client/src/lib/i18n");
    i18n.setPublicBootScope("/register");
    await i18n.loadLocaleForPath("en", "/register");
    await act(async () => i18n.useI18n.getState().setLocale("en"));
    const { default: PublicProviders } =
      await import("../../client/src/components/marketing/PublicProviders");
    const { default: Register } = await import("../../client/src/pages/Register");
    await act(async () =>
      root.render(createElement(PublicProviders, null, createElement(Register)))
    );
    const deadline = Date.now() + 8000;
    while (!ready() && Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
  }

  it("browser Forward into step 2 puts focus on its heading, not on <body>", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 401 })) as typeof fetch;
    await mount("", () => !!q("signup-plan-step"));
    await act(async () => q("button-signup-continue")!.click());
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(q("signup-plan-step")).not.toBeNull();
    await act(async () => {
      window.history.forward();
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(q("signup-plan-summary")).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("a signed-in visitor with ?plan= never sees step 2 flash before the redirect", async () => {
    window.localStorage.setItem("muhasib_auth_hint", "1");
    let release: (r: Response) => void = () => {};
    let first = true;
    globalThis.fetch = vi.fn(() => {
      // Only the first answer (the session probe) is held; the refresh attempt answers at once.
      if (!first) return Promise.resolve(new Response("{}", { status: 401 }));
      first = false;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as typeof fetch;
    await mount("?plan=starter&cycle=yearly", () => !!q("register-session-check"));
    // While the session answer is pending, neither step is painted.
    expect(q("register-session-check")).not.toBeNull();
    expect(q("signup-plan-step")).toBeNull();
    expect(q("signup-plan-summary")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    // An answer of "not signed in" releases the page.
    await act(async () => release(new Response("{}", { status: 401 })));
    const deadline = Date.now() + 5000;
    while (q("register-session-check") && Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(q("register-session-check")).toBeNull();
    expect(q("signup-plan-summary")).not.toBeNull();
  });
});

// ── read-only workspace: write forms render disabled under the lock banner ────────────────

describe("read-only forms", () => {
  async function mountForms() {
    const { ReadOnlyForms } = await import("../../client/src/components/billing/ReadOnlyForms");
    await render(
      createElement(
        "div",
        null,
        createElement(ReadOnlyForms),
        createElement(
          "form",
          { "data-testid": "write-form" },
          createElement("input", { "data-testid": "f-input" }),
          createElement("select", { "data-testid": "f-select" }),
          createElement("button", { type: "submit", "data-testid": "f-save" }, "Save draft"),
          createElement("button", { type: "button", "data-testid": "button-cancel-x" }, "Cancel")
        ),
        createElement(
          "form",
          { role: "search", "data-testid": "search-form" },
          createElement("input", { "data-testid": "s-input" })
        )
      )
    );
  }

  it("disables create/edit forms when the trial has ended, leaves search alone, and restores them", async () => {
    sub.state = stateFor("ended-chosen");
    await mountForms();
    expect((q("f-input") as HTMLInputElement).disabled).toBe(true);
    expect((q("f-save") as HTMLButtonElement).disabled).toBe(true);
    expect(q("write-form")!.getAttribute("data-plan-locked")).toBe("true");
    expect((q("s-input") as HTMLInputElement).disabled).toBe(false);
    // Leaving the form still works.
    expect((q("button-cancel-x") as HTMLButtonElement).disabled).toBe(false);
    // Plan restored: everything the lock disabled is enabled again.
    sub.state = { ...stateFor("running-chosen"), canWrite: () => true };
    await mountForms();
    expect((q("f-input") as HTMLInputElement).disabled).toBe(false);
    expect((q("f-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves forms open on the always-open pages (billing, settings) and during the trial", async () => {
    sub.state = stateFor("ended-chosen");
    window.history.replaceState(null, "", "/subscription");
    await mountForms();
    expect((q("f-input") as HTMLInputElement).disabled).toBe(false);
    window.history.replaceState(null, "", "/invoices");
    sub.state = { ...stateFor("running-chosen"), canWrite: () => true };
    await mountForms();
    expect((q("f-save") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("read-only forms follow what the server gates", () => {
  const field = (id: string) => createElement("input", { "data-testid": id });
  /** A form like the app's dialogs: fields, a Save, and a Cancel with no test id. */
  const dialogForm = (cancel = "Cancel") =>
    createElement(
      "form",
      { "data-testid": "form" },
      field("f-input"),
      createElement("button", { type: "submit", "data-testid": "f-save" }, "Save"),
      createElement("button", { type: "button", "data-testid": "f-cancel" }, cancel),
      createElement("button", { type: "button", role: "tab", "data-testid": "f-tab" }, "Preview")
    );
  async function mountAt(path: string, form = dialogForm()) {
    window.history.replaceState(null, "", path);
    const { ReadOnlyForms } = await import("../../client/src/components/billing/ReadOnlyForms");
    await render(createElement("div", null, createElement(ReadOnlyForms), form));
  }
  const disabled = (id: string) => (q(id) as HTMLInputElement).disabled;

  beforeEach(() => {
    sub.state = stateFor("ended-chosen");
  });

  it.each(["/feedback", "/team", "/integrations", "/notification-preferences"])(
    "%s stays open: the server accepts those writes after the trial",
    async (route) => {
      await mountAt(route);
      expect(disabled("f-input")).toBe(false);
      expect(disabled("f-save")).toBe(false);
    }
  );

  it("an NR admin's customer dialog stays usable although the admin's own trial ended", async () => {
    sub.user = { id: "a1", isAdmin: true, firmRole: null };
    for (const route of ["/admin/clients", "/firm/clients", "/invoices"]) {
      await mountAt(route);
      expect(disabled("f-input")).toBe(false);
      expect(disabled("f-save")).toBe(false);
      expect(disabled("f-cancel")).toBe(false);
    }
    // The console routes are open for everyone, Cancel included, even a non-admin on /admin.
    sub.user = { id: "u1", isAdmin: false, firmRole: null };
    await mountAt("/admin/clients");
    expect(disabled("f-input")).toBe(false);
    expect(disabled("f-cancel")).toBe(false);
  });

  it("firm staff are never locked", async () => {
    sub.user = { id: "f1", isAdmin: false, firmRole: "firm_admin" };
    await mountAt("/invoices/new");
    expect(disabled("f-input")).toBe(false);
  });

  it("invoices/new stays locked, but Cancel (no test id, en and ar) and the tabs still work", async () => {
    await mountAt("/invoices/new");
    expect(disabled("f-input")).toBe(true);
    expect(disabled("f-save")).toBe(true);
    expect(disabled("f-cancel")).toBe(false);
    expect(disabled("f-tab")).toBe(false);
    await mountAt("/invoices/new", dialogForm("إلغاء"));
    expect(disabled("f-input")).toBe(true);
    expect(disabled("f-cancel")).toBe(false);
  });

  it("the assistant page is locked like the server's AI refusal", async () => {
    await mountAt("/assistant");
    expect(disabled("f-input")).toBe(true);
    expect(disabled("f-save")).toBe(true);
  });

  it("a gated feature page is locked on a plan that lacks it, and open when the plan has it", async () => {
    sub.state = { ...stateFor("running-chosen"), canWrite: () => false };
    await mountAt("/payroll");
    expect(disabled("f-input")).toBe(true);
    sub.state = { ...stateFor("running-chosen"), canWrite: () => true };
    await mountAt("/payroll");
    expect(disabled("f-input")).toBe(false);
  });

  it(
    "every locked page maps to a rule the server enforces (shared gate lists)",
    async () => {
      const { CORE_ROUTE_MODULES } = await import("../../shared/plan-gates");
      const { PLAN_ROUTE_FEATURES } = await import("../../client/src/lib/plan-routes");
      const { featureForRequest } = await import("../../server/middleware/featureGate");
      const id = "11111111-1111-4111-8111-111111111111";
      for (const [prefix, module] of CORE_ROUTE_MODULES) {
        const viaCompany = featureForRequest("POST", `/api/companies/${id}/${module}`);
        const viaRow = featureForRequest("PUT", `/api/${module}/${id}`);
        expect(viaCompany ?? viaRow, `${prefix} -> ${module}`).not.toBeNull();
      }
      const samples: Record<string, string> = {
        payroll: `companies/${id}/payroll/x`,
        fixedAssets: `companies/${id}/fixed-assets`,
        budgets: `companies/${id}/budget-plans`,
        monthEnd: `companies/${id}/month-end/x`,
        costCenters: `companies/${id}/cost-centers`,
        purchaseOrders: `companies/${id}/purchase-orders`,
        expenseClaims: `companies/${id}/expense-claims`,
        corporateTax: `companies/${id}/corporate-tax/x`,
        apiAccess: `companies/${id}/api-keys`,
        recurringInvoices: `companies/${id}/recurring-invoices`,
        aiAssistant: "ai/chat",
      };
      for (const [prefix, feature] of PLAN_ROUTE_FEATURES) {
        expect(featureForRequest("POST", `/api/${samples[feature]}`), prefix).toBe(feature);
      }
    },
    30000 // dynamic-import chain may take up to ~10 s on cold transforms; 30 s is the ceiling
  );
});

describe("ended + no choice says choose AND activate", () => {
  it("the dashboard banner, the lock alert, the plan card and the plan block (en + ar)", async () => {
    const both = (en: string, ar: string) => ({ en, ar });
    const needles = [
      both("choose and activate a paid plan", "تختار خطة مدفوعة وتفعّلها"),
      both("Your workspace is read-only.", "مساحة عملك للقراءة فقط."),
      both(
        "Choose and activate a paid plan to make changes.",
        "اختر خطة مدفوعة وفعّلها لإجراء تغييرات."
      ),
      both("Choose a plan and activate it to add records again", "اختر خطة وفعّلها لتعود"),
    ];
    for (const locale of ["en", "ar"] as const) {
      await setLocale(locale);
      sub.state = stateFor("ended-none");
      const { TrialBanner } = await import("../../client/src/components/TrialBanner");
      await render(createElement(TrialBanner));
      expect(text(q("trial-banner")!)).toContain(needles[0][locale]);
      const { default: Subscription } = await import("../../client/src/pages/Subscription");
      await render(createElement(Subscription));
      const page = text();
      expect(page).toContain(needles[1][locale]); // top alert
      expect(page).toContain(needles[2][locale]); // plan card
      expect(text(q("subscription-chosen-plan")!)).toContain(needles[3][locale]); // plan block
      expect(page).not.toContain(
        locale === "en"
          ? "Choose the plan you want after your trial"
          : "اختر الخطة التي تريدها بعد فترتك"
      );
    }
    await setLocale("en");
  });
});

describe("pending activation request", () => {
  it("offers no 'choose' button for another plan while a request is pending (no silent cancel)", async () => {
    sub.state = stateFor("running-requested");
    const { default: Subscription } = await import("../../client/src/pages/Subscription");
    await render(createElement(Subscription));
    expect(container.querySelector('[data-testid^="plan-choose-"]')).toBeNull();
    expect(q("plan-switch-pending-starter")).not.toBeNull();
    expect(q("plan-switch-pending-enterprise")).not.toBeNull();
    expect(q("plan-chosen-professional")).not.toBeNull();
    sub.state = stateFor("running-chosen");
    await render(createElement(Subscription));
    expect(q("plan-choose-starter")).not.toBeNull();
    expect(q("plan-switch-pending-starter")).toBeNull();
  });
});

describe("read-only dashboard actions", () => {
  async function hero() {
    const { DashboardHero } = await import("../../client/src/pages/dashboard/DashboardHero");
    const m = {
      t: {} as Record<string, string>,
      locale: "en",
      stats: null,
      periodChoice: "month",
      setPeriodChoice: () => {},
      companyName: "Acme",
    };
    await render(createElement(DashboardHero, { m: m as never }));
  }
  it("leads to the plan action instead of the locked 'New invoice'", async () => {
    sub.state = stateFor("ended-chosen");
    await hero();
    const link = q("button-quick-invoice")!;
    expect(link.getAttribute("href")).toBe("/subscription#after-trial");
    expect(link.textContent).toContain("Activate");
    sub.state = stateFor("ended-none");
    await hero();
    expect(q("button-quick-invoice")!.getAttribute("href")).toBe("/subscription");
    sub.state = { ...stateFor("running-chosen"), isReadOnly: false };
    await hero();
    expect(q("button-quick-invoice")!.getAttribute("href")).toBe("/invoices?new=1");
  });
});

describe("Arabic catalogs spell tanween one way", () => {
  it("no catalog string uses alif + fathatan (write fathatan + alif: شهريًا, not شهرياً)", () => {
    const dir = path.join(process.cwd(), "client/src/locales");
    const files = [
      ...readdirSync(path.join(dir, "ar")).map((f) => path.join(dir, "ar", f)),
      ...readdirSync(path.join(dir, "ar-catalog")).map((f) => path.join(dir, "ar-catalog", f)),
    ].filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const f of files) {
      const hits = readFileSync(f, "utf8").match(/[ء-هي]اً/g);
      if (hits) bad.push(`${path.basename(f)}: ${hits.length}`);
    }
    expect(bad).toEqual([]);
  });
});

// ── dates, locale text and the process zone ───────────────────────────────────────────────

describe("one trial-end rule", () => {
  it("the banner's state and the gate agree on a trial that is not a whole number of days", () => {
    const start = new Date("2026-11-01T10:00:00Z");
    const end = new Date("2026-11-14T22:00:00Z"); // 13.5 days: an admin-set end
    const now = new Date("2026-11-14T21:00:00Z"); // one hour before the end
    const state = trialState(start, now, TRIAL_DAYS, end)!;
    const gate = resolveEntitlement(
      { planId: "free", trialStartedAt: start, trialEndsAt: end },
      now
    );
    expect(state.endsAt).toBe(end.toISOString());
    expect(gate.trialEndsAt).toBe(state.endsAt);
    expect(state.ended).toBe(gate.state === "expired");
    expect(state.daysLeft).toBe(1);
    // Past the end both agree it ended.
    const later = new Date("2026-11-14T22:00:01Z");
    expect(trialState(start, later, TRIAL_DAYS, end)!.ended).toBe(true);
    expect(
      resolveEntitlement({ planId: "free", trialStartedAt: start, trialEndsAt: end }, later).state
    ).toBe("expired");
    // No stored end: start + TRIAL_DAYS in both.
    const dflt = trialState(start, now)!;
    expect(dflt.endsAt).toBe(new Date(start.getTime() + TRIAL_DAYS * 86400_000).toISOString());
    expect(resolveEntitlement({ planId: "free", trialStartedAt: start }, now).trialEndsAt).toBe(
      dflt.endsAt
    );
  });
});

describe("catalog copy", () => {
  const read = (lang: string, file: string) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), `client/src/locales/${lang}/${file}.json`), "utf8")
    ) as Record<string, string>;

  it("the onboarding note takes the trial length and the Settings label from constants and the catalog", async () => {
    const { formatMessage } = await import("../../client/src/lib/i18n");
    for (const lang of ["en", "ar"] as const) {
      const note = read(lang, "onboarding")["onboarding.trialStartedNote"];
      expect(note).toContain("{days}");
      expect(note).not.toMatch(/\b14\b/);
      const billing = read(lang, "components")["components.ui.settingsNav.billing"];
      const phrase = read(lang, "marketing")["marketing.prPlanPhrase_professional"];
      const out = formatMessage(note, { days: TRIAL_DAYS, plan: phrase, billing });
      expect(out).toContain(String(TRIAL_DAYS));
      expect(out).toContain(billing);
      expect(out).toContain(phrase);
    }
    // The Arabic path names the nav label exactly.
    expect(read("ar", "onboarding")["onboarding.trialStartedNote"]).toContain("{billing}");
    expect(read("ar", "components")["components.ui.settingsNav.billing"]).toBe("الفوترة والاشتراك");
  });

  it("Arabic plan names in sentences use the phrase forms and one spelling for the adverbs", () => {
    const ar = read("ar", "marketing");
    expect(ar["marketing.prPlanPhrase_starter"]).toBe("خطة المبتدئ");
    expect(ar["marketing.prPlanPhrase_professional"]).toBe("الخطة الاحترافية");
    expect(ar["marketing.prPlanPhrase_enterprise"]).toBe("خطة المؤسسات");
    for (const file of ["marketing", "pages", "components", "onboarding"]) {
      const body = JSON.stringify(read("ar", file));
      // One tanween spelling (شهريًا, never شهرياً): letter + fathatan + alif.
      expect(body).not.toMatch(/[\u0621-\u0647\u064A]\u0627\u064B/);
    }
    // Both per-period labels under a price and the sentences use the same adverbs.
    expect(ar["marketing.pricingPerMonth"]).toBe("شهريًا");
    expect(ar["marketing.pricingPerYear"]).toBe("سنويًا");
    // One "days left" phrasing: the banner's second line is built from marketing.trialDaysLeft.
    expect(ar).not.toHaveProperty("marketing.trialThenPlan");
  });

  it("every state's keys exist in en and ar", () => {
    const keys = [
      ["marketing", "marketing.trialChosenLine"],
      ["marketing", "marketing.trialEndedChosen"],
      ["marketing", "marketing.trialActivationRequested"],
      ["marketing", "marketing.trialRequestedReadOnly"],
      ["marketing", "marketing.signupTrialCaps"],
      ["pages", "pages.subscriptionChosenRunning"],
      ["pages", "pages.subscriptionChosenEnded"],
      ["pages", "pages.subscriptionBilled_monthly"],
      ["pages", "pages.subscriptionBilled_yearly"],
      ["pages", "pages.subscriptionTrialOpen"],
      ["pages", "pages.subscriptionExpiredSafe"],
      ["components", "components.planLockBodyChosen"],
      ["components", "components.planLimitBodyChosen"],
      ["components", "components.planUntilThenReadable"],
    ] as const;
    for (const [file, key] of keys) {
      for (const lang of ["en", "ar"]) {
        expect(read(lang, file)[key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});

describe("the server process runs in UTC", () => {
  it("pins TZ=UTC at startup even when the host says Asia/Dubai, so timestamp columns never shift", () => {
    const tsxBin = path.join(process.cwd(), "node_modules/.bin/tsx");
    const script =
      "import './server/config/pin-timezone'; console.log(JSON.stringify({ tz: process.env.TZ, offset: new Date(2026, 0, 1, 12).getTimezoneOffset(), iso: new Date('2026-11-19 10:00:00').toISOString() }));";
    const spawnEnv = { ...process.env, TZ: "Asia/Dubai" };
    const result =
      process.platform === "win32"
        ? spawnSync("cmd", ["/c", tsxBin + ".cmd", "-e", script], {
            env: spawnEnv,
            encoding: "utf8",
            cwd: process.cwd(),
          })
        : spawnSync(tsxBin, ["-e", script], {
            env: spawnEnv,
            encoding: "utf8",
            cwd: process.cwd(),
          });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr ?? String(result.status));
    const out = result.stdout;
    expect(JSON.parse(out.trim().split("\n").pop()!)).toEqual({
      tz: "UTC",
      offset: 0,
      // A zone-less timestamp read as local time stays the same wall time in UTC.
      iso: "2026-11-19T10:00:00.000Z",
    });
  }, 15000); // spawnSync startup + cold tsx transforms can take up to ~10 s

  it("the Dockerfile and both compose files set TZ=UTC", () => {
    // Source inspection: the container configs have no behaviour to run in a unit test.
    const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
    expect(read("Dockerfile")).toMatch(/^ENV TZ=UTC$/m);
    expect(read("docker-compose.prod.yml")).toMatch(/TZ: UTC/);
    expect(read("docker-compose.yml")).toMatch(/TZ=UTC/);
    expect(read("docs/release/DEPLOY-RUNBOOK.md")).toContain("TZ=UTC");
  });
});
