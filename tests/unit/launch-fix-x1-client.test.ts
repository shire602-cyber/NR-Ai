// @vitest-environment jsdom
/**
 * X1 (J2/J3/J4) client behaviour: the onboarding wizard targets the ACTIVE company, never the
 * first one; non-owner members see an "owner is still setting up" state instead of the owner's
 * form; the TRN given at registration is prefilled and never overwritten by a blank; phone width
 * gets logout and a language switch in the More sheet.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const calls: Array<{ method: string; url: string; body: unknown }> = [];
// What GET /api/companies answers. Saving step 1 invalidates the list and refetches it, so the
// answer must be the list the page was seeded with (an empty object is not a company list).
let companiesReply: unknown[] = [];

const company = (over: Record<string, unknown>) => ({
  id: "c-a",
  name: "Alpha Trading LLC",
  trnVatNumber: "100000000000003",
  onboardingCompleted: true,
  companyType: "customer",
  emirate: "dubai",
  myRole: "owner",
  ...over,
});

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  // A signed-in session. Without the hint the list refetch after saving step 1 answers "Not signed
  // in" (401), which is access lost: the cache drops the seeded companies and the wizard unmounts.
  window.localStorage.setItem("muhasib_auth_hint", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (/\/api\/companies$/.test(url) && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify(companiesReply), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("csrf-token")) {
        return new Response(JSON.stringify({ csrfToken: "t" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderOnboarding(companies: unknown[], activeId: string | null) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { currentUserQueryKey } = await import("../../client/src/hooks/useCurrentUser");
  const { ActiveCompanyProvider } =
    await import("../../client/src/components/ActiveCompanyProvider");
  const { default: Onboarding } = await import("../../client/src/pages/Onboarding");
  const { setActiveCompanyIdRaw } = await import("../../client/src/lib/activeCompany");
  queryClient.clear();
  companiesReply = companies;
  setActiveCompanyIdRaw(activeId);
  queryClient.setQueryData(["/api/companies"], companies);
  queryClient.setQueryData(currentUserQueryKey, {
    id: "u1",
    name: "User",
    email: "u@example.test",
    userType: "customer",
    firmRole: null,
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ActiveCompanyProvider, null, createElement(Onboarding))
      )
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("X1 J4: onboarding targets the active company", () => {
  it("shows and saves the ACTIVE company (not the first) and keeps the existing TRN", async () => {
    const a = company({ id: "c-a", name: "Alpha Trading LLC", onboardingCompleted: true });
    const b = company({
      id: "c-b",
      name: "Beta Foods LLC",
      trnVatNumber: "100999999900003",
      onboardingCompleted: false,
    });
    await renderOnboarding([a, b], "c-b");

    expect(container.textContent).toContain("Beta Foods LLC");
    expect(container.textContent).not.toContain("Alpha Trading LLC");
    const trn = container.querySelector<HTMLInputElement>("[data-testid=express-trn]")!;
    expect(trn.value).toBe("100999999900003");

    // WP-B: three screens. Step 1 saves the company, step 2 is skippable, choosing a first
    // task on step 3 finishes onboarding.
    for (const id of ["onboarding-express", "onboarding-skip", "onboarding-task-explore"]) {
      const button = container.querySelector<HTMLButtonElement>(`[data-testid=${id}]`)!;
      expect(button, id).not.toBeNull();
      await act(async () => {
        button.click();
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    const patch = calls.find((c) => c.method === "PATCH");
    const complete = calls.find((c) => c.url.endsWith("/onboarding/complete"));
    expect(patch?.url).toContain("/api/companies/c-b");
    expect(complete?.url).toContain("/api/companies/c-b/onboarding/complete");
    expect(calls.some((c) => c.url.includes("/api/companies/c-a"))).toBe(false);
    // The TRN is carried (prefilled), never sent blank.
    expect((patch?.body as Record<string, unknown>).trnVatNumber).toBe("100999999900003");
  });

  it("never sends a blank value that would wipe a stored one", async () => {
    const { withoutBlankValues } = await import("../../client/src/lib/companyRole");
    expect(withoutBlankValues({ name: "X", trnVatNumber: "", contactPhone: "  " })).toEqual({
      name: "X",
    });
  });

  it("a viewer never sees the owner's setup form", async () => {
    const a = company({ id: "c-a", onboardingCompleted: false, myRole: "viewer" });
    await renderOnboarding([a], "c-a");
    expect(container.querySelector("[data-testid=onboarding-owner-setting-up]")).not.toBeNull();
    expect(container.querySelector("[data-testid=express-company-name]")).toBeNull();
    expect(container.querySelector("[data-testid=onboarding-express]")).toBeNull();
    expect(
      container.querySelector("[data-testid=onboarding-owner-setting-up-continue]")
    ).not.toBeNull();
  });
});

describe("X1 J2: logout and language reachable at phone width", () => {
  it("the More sheet carries a language switch and a logout in English and Arabic", async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { MobileNav } = await import("../../client/src/components/MobileNav");
    const { useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(MobileNav))
      );
    });
    const more = Array.from(container.querySelectorAll<HTMLButtonElement>(".mobile-nav-tab")).at(
      -1
    )!;
    await act(async () => more.click());
    expect(container.querySelector("[data-testid=mobile-logout]")?.textContent).toBeTruthy();
    const lang = container.querySelector<HTMLButtonElement>(
      "[data-testid=mobile-language-toggle]"
    )!;
    expect(lang.textContent).toContain("العربية");
    await act(async () => lang.click());
    expect(useI18n.getState().locale).toBe("ar");
    expect(container.querySelector("[data-testid=mobile-language-toggle]")?.textContent).toContain(
      "English"
    );
    act(() => useI18n.getState().setLocale("en"));
  });
});
