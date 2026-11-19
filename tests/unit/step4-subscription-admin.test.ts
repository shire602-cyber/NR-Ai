// @vitest-environment jsdom
/**
 * STEP4: the plan a customer chose, after sign-up. Settings > Billing (en + ar): "You chose
 * Professional", the Your-choice / Choose actions during the trial, the activation request and its
 * pending state, a viewer, a paid company, an expired trial; the NR admin's plan control (the
 * customer's choice, preselected, applied in one click) and the Trials card on the Overview tab.
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
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => sub.state,
  usePlanChoiceActions: () => ({
    choose: {
      isPending: false,
      mutate: (body: unknown, o?: { onSuccess?: () => void }) => {
        void Promise.resolve(sub.apiRequest("PUT", "/chosen-plan", body)).then(() =>
          o?.onSuccess?.()
        );
      },
    },
    activate: {
      isPending: false,
      mutate: () => void sub.apiRequest("POST", "/activation-request", {}),
    },
  }),
}));
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

import { TRIAL_LIMITS, planFeatures } from "../../shared/plans";
import { trialState } from "../../shared/trial";

let container: HTMLDivElement;
let root: Root;

const chosen = {
  planId: "professional",
  billingCycle: "monthly",
  source: "signup_picked",
  chosenAt: "2026-11-19T08:00:00Z",
  price: 119,
};

function trialState_(extra: Record<string, unknown> = {}): Record<string, unknown> {
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
    usage: undefined,
    chosenPlan: chosen,
    activationRequestedAt: null,
    ...extra,
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
  window.history.replaceState(null, "", "/subscription");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  sub.canBilling = true;
  sub.apiRequest.mockReset();
  sub.apiRequest.mockResolvedValue({});
  sub.state = trialState_();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const text = () => (container.textContent ?? "").replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ");

async function setLocale(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  await act(async () => useI18n.getState().setLocale(locale));
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

describe.each(["en", "ar"] as const)("Settings > Billing, chosen plan (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));

  it("says what was chosen, that it starts when activated, and that nothing is charged yet", async () => {
    await renderSubscription();
    const block = q("subscription-chosen-plan")!;
    expect(block).not.toBeNull();
    const body = block.textContent!.replace(/[⁦-⁩]/g, "");
    expect(body).toContain(locale === "en" ? "You chose Professional." : "اخترت الاحترافية.");
    expect(body).toContain(locale === "en" ? "when you activate it" : "عند تفعيلها");
    expect(body).toContain("119");
    expect(body).toContain(
      locale === "en" ? "Nothing is charged until you activate it." : "لا يُحصَّل أي مبلغ"
    );
    // The date is formatted by the shared formatter, not typed.
    const { formatDate } = await import("../../client/src/lib/format-date");
    expect(body).toContain(formatDate((sub.state.trial as { endsAt: string }).endsAt, locale));
    expect(q("plan-chosen-professional")).not.toBeNull();
    expect((q("plan-chosen-professional") as HTMLButtonElement).disabled).toBe(true);
    expect(q("plan-choose-starter")).not.toBeNull();
    expect(q("plan-contact-starter")).toBeNull();
  });

  it("choosing another plan sends the page's billing cycle to the chosen-plan route", async () => {
    await renderSubscription();
    await act(async () => {
      q("subscription-cycle-yearly")!.click();
    });
    await act(async () => {
      q("plan-choose-starter")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(sub.apiRequest).toHaveBeenCalledWith("PUT", "/chosen-plan", {
      planId: "starter",
      billingCycle: "yearly",
    });
    expect(document.body.textContent).toContain(
      locale === "en" ? "Saved: Starter after your trial" : "تم الحفظ"
    );
  });

  it("Activate posts the request; once requested it shows the date and the pending state", async () => {
    await renderSubscription();
    await act(async () => {
      q("button-activate-plan")!.click();
    });
    expect(sub.apiRequest).toHaveBeenCalledWith("POST", "/activation-request", {});
    act(() => root.unmount());
    root = createRoot(container);
    sub.state = trialState_({ activationRequestedAt: "2026-11-20T08:00:00Z" });
    await renderSubscription();
    expect(q("activation-requested")).not.toBeNull();
    expect(q("button-activate-plan")).toBeNull();
    expect(text()).toContain(
      locale === "en" ? "Activation requested on 20 Nov 2026" : "طُلب التفعيل في 20"
    );
  });

  it("with no choice it asks to choose; a viewer sees disabled actions; a paid company sees no choice", async () => {
    sub.state = trialState_({ chosenPlan: null });
    await renderSubscription();
    expect(q("subscription-chosen-plan")!.textContent).toContain(
      locale === "en" ? "Choose the plan you want after your trial." : "اختر الخطة"
    );
    expect(q("plan-chosen-professional")).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    sub.canBilling = false;
    sub.state = trialState_();
    await renderSubscription();
    expect((q("plan-choose-starter") as HTMLButtonElement).disabled).toBe(true);
    expect((q("button-activate-plan") as HTMLButtonElement).disabled).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    sub.canBilling = true;
    sub.state = trialState_({
      planState: "active",
      trial: null,
      entitlement: {
        state: "active",
        planId: "starter",
        storedPlanId: "starter",
        features: planFeatures("starter"),
        limits: {},
      },
    });
    await renderSubscription();
    expect(q("subscription-chosen-plan")).toBeNull();
  });

  it("after the trial the chosen card offers Activate and the page says books are read-only", async () => {
    sub.state = trialState_({
      planState: "expired",
      entitlement: { state: "expired", planId: null, storedPlanId: "free", features: {} },
      trial: trialState(new Date(Date.now() - 30 * 86400_000)),
    });
    await renderSubscription();
    expect(q("plan-activate-professional")).not.toBeNull();
    expect(q("plan-activate-professional")!.textContent).toContain(
      locale === "en" ? "Activate Professional" : "فعّل"
    );
    expect(q("trial-banner")!.getAttribute("data-trial-state")).toBe("ended");
  });
});

describe.each(["en", "ar"] as const)("admin plan control and trials card (%s)", (locale) => {
  beforeEach(async () => setLocale(locale));

  it("shows the customer's choice, preselects it and applies it in one click", async () => {
    sub.apiRequest.mockImplementation(async (method: string) =>
      method === "GET"
        ? {
            state: "trial",
            planId: "enterprise",
            trialEndsAt: "2026-12-03T00:00:00Z",
            chosenPlan: { ...chosen, planId: "starter", billingCycle: "yearly" },
            activationRequestedAt: "2026-11-20T08:00:00Z",
          }
        : { state: "active", planId: "starter", storedPlanId: "starter", trialEndsAt: null }
    );
    const { AdminPlanControl } =
      await import("../../client/src/components/billing/AdminPlanControl");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(AdminPlanControl, { companyId: "c9" })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const choice = q("admin-plan-customer-choice")!.textContent!;
    expect(choice).toContain(locale === "en" ? "Starter" : "المبتدئ");
    expect(q("admin-plan-activation")).not.toBeNull();
    const apply = q("admin-plan-apply-chosen")!;
    expect(apply.textContent).toContain(locale === "en" ? "Apply Starter (Yearly)" : "تطبيق");
    await act(async () => {
      apply.click();
    });
    expect(sub.apiRequest).toHaveBeenCalledWith("PUT", "/api/admin/companies/c9/plan", {
      planId: "starter",
      billingCycle: "yearly",
    });
  });

  it("no choice reads 'No plan chosen yet' with no Apply-chosen button", async () => {
    sub.apiRequest.mockResolvedValue({
      state: "trial",
      planId: "enterprise",
      trialEndsAt: "2026-12-03T00:00:00Z",
      chosenPlan: null,
      activationRequestedAt: null,
    });
    const { AdminPlanControl } =
      await import("../../client/src/components/billing/AdminPlanControl");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(AdminPlanControl, { companyId: "c9" })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(q("admin-plan-customer-choice")!.textContent).toContain(
      locale === "en" ? "No plan chosen yet" : "لم تُختر خطة بعد"
    );
    expect(q("admin-plan-apply-chosen")).toBeNull();
  });

  it("the trials card lists companies with their choice and request, and opens one", async () => {
    sub.apiRequest.mockResolvedValue({
      trials: [
        {
          companyId: "c1",
          companyName: "Acme Trading",
          ownerName: "Sara",
          ownerEmail: "sara@acme.ae",
          trialEndsAt: "2026-12-03T00:00:00Z",
          trialEnded: false,
          chosenPlan: { planId: "professional", billingCycle: "monthly" },
          activationRequestedAt: "2026-11-20T08:00:00Z",
        },
      ],
    });
    const { AdminTrialsCard } = await import("../../client/src/components/billing/AdminTrialsCard");
    const onOpen = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(AdminTrialsCard, { onOpen })
        )
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(q("admin-trials")!.textContent).toContain("Acme Trading");
    expect(q("admin-trials")!.textContent).toContain(
      locale === "en" ? "Professional" : "الاحترافية"
    );
    await act(async () => {
      q("admin-trial-open-c1")!.click();
    });
    expect(onOpen).toHaveBeenCalledWith("c1");
  });
});
