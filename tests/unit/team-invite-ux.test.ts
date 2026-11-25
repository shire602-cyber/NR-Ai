// @vitest-environment jsdom
/**
 * Team management and user invitation screens: derived "expired" filter, load-error states,
 * localized delete confirm, member search and in-app email validation (English and Arabic).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    company: { id: "c-1", name: "Palm Co", baseCurrency: "AED" },
    companyId: "c-1",
    companies: [{ id: "c-1", name: "Palm Co" }],
    hasNoCompanies: false,
    isLoading: false,
    error: null,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let routes: Array<[string, () => { status?: number; body: unknown }]> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  // jsdom lacks the pointer/scroll APIs Radix Select calls when it opens.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  routes = [];
  localStorage.setItem("muhasib_auth_hint", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [key, fn] of routes) {
        const [m, pattern] = key.split(" ");
        if (m === method && new RegExp(pattern).test(url)) {
          const r = fn();
          return json(r.body, r.status ?? 200);
        }
      }
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(el: ReturnType<typeof createElement>) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  queryClient.clear();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, el));
  });
  await flush();
}

async function setLocale(locale: "en" | "ar") {
  const i18n = await import("../../client/src/lib/i18n");
  await act(async () => i18n.useI18n.getState().setLocale(locale));
}

const DAY = 86_400_000;
const invite = (id: string, email: string, status: string, offsetDays: number) => ({
  id,
  email,
  status,
  role: "client",
  token: `tok-${id}`,
  companyId: null,
  expiresAt: new Date(Date.now() + offsetDays * DAY).toISOString(),
  createdAt: new Date().toISOString(),
});

const ACCESS = {
  role: "owner",
  permissions: ["team.manage", "reports.read"],
  grantableRoles: ["accountant", "viewer"],
  viaFirmAccess: false,
};

const openMenu = async (trigger: HTMLElement) =>
  act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.click();
  });

async function pickStatus(label: string) {
  await openMenu(document.querySelector('[data-testid="select-filter-status"]') as HTMLElement);
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (o) => o.textContent?.trim() === label
  ) as HTMLElement;
  await act(async () => option.click());
}

describe("UserInvitations", { timeout: 30_000 }, () => {
  const rows = () => [...container.querySelectorAll('[data-testid^="row-invite-"]')];

  it("the Expired filter finds lapsed pending invites and Pending excludes them", async () => {
    routes.push([
      "GET /api/admin/invitations",
      () => ({
        body: [
          invite("a", "live@example.com", "pending", 3),
          invite("b", "lapsed@example.com", "pending", -2),
        ],
      }),
    ]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    expect(rows()).toHaveLength(2);
    await pickStatus("Expired");
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("lapsed@")]);
    await pickStatus("Pending");
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("live@")]);
  });

  it.each(["en", "ar"] as const)(
    "shows a retry state, not the empty state, when loading fails (%s)",
    async (locale) => {
      await setLocale(locale);
      routes.push([
        "GET /api/admin/invitations",
        () => ({ status: 404, body: { message: "boom" } }),
      ]);
      const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
      await mount(createElement(UserInvitations));
      expect(container.querySelector('[data-testid="invitations-load-error"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="button-retry-invitations"]')).not.toBeNull();
      if (locale === "ar") expect(container.textContent).toMatch(/[؀-ۿ]/);
    }
  );

  it("asks for delete confirmation in Arabic, not English", async () => {
    await setLocale("ar");
    routes.push([
      "GET /api/admin/invitations",
      () => ({ body: [invite("a", "live@example.com", "pending", 3)] }),
    ]);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await openMenu(
      container.querySelector('[data-testid="button-actions-invite-a"]') as HTMLElement
    );
    const del = [...document.querySelectorAll('[role="menuitem"]')].pop() as HTMLElement;
    await act(async () => del.click());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String((confirmSpy.mock.calls[0] as unknown[])[0])).toMatch(/[؀-ۿ]/);
  });

  it("keeps cached invitation rows and the retry control visible when a refresh fails", async () => {
    let calls = 0;
    routes.push([
      "GET /api/admin/invitations",
      () => {
        calls += 1;
        if (calls === 1) return { body: [invite("a", "live@example.com", "pending", 3)] };
        return { status: 404, body: { message: "boom" } };
      },
    ]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('[data-testid="button-retry-invitations"]')).toBeNull();

    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
    });
    await flush();

    expect(calls).toBe(2);
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("live@")]);
    expect(container.querySelector('[data-testid="button-retry-invitations"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="text-invitations-title"]')).not.toBeNull();
  });

  it("an accepted invite past its expiry date offers no Resend", async () => {
    routes.push([
      "GET /api/admin/invitations",
      () => ({ body: [invite("a", "done@example.com", "accepted", -5)] }),
    ]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await openMenu(
      container.querySelector('[data-testid="button-actions-invite-a"]') as HTMLElement
    );
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((t) => /Resend/i.test(t ?? ""))).toBe(false);
  });
});

describe("TeamManagement", { timeout: 30_000 }, () => {
  const member = (i: number) => ({
    id: `m${i}`,
    userId: `u${i}`,
    companyId: "c-1",
    role: "viewer",
    createdAt: new Date().toISOString(),
    user: { id: `u${i}`, email: `person${i}@example.com`, name: `Person ${i}` },
  });

  it("shows a retry state instead of 'no team members' when the team fails to load", async () => {
    routes.push(["GET .*/team$", () => ({ status: 404, body: { message: "boom" } })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    expect(container.querySelector('[data-testid="team-load-error"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-retry-team"]')).not.toBeNull();
  });

  it("keeps cached members and the retry control visible when a refresh fails", async () => {
    let teamCalls = 0;
    routes.push([
      "GET .*/team$",
      () => {
        teamCalls += 1;
        if (teamCalls === 1) return { body: [1, 2, 3].map(member) };
        return { status: 404, body: { message: "boom" } };
      },
    ]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="button-retry-team"]')).toBeNull();

    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/companies", "c-1", "team"],
        exact: true,
      });
    });
    await flush();

    expect(teamCalls).toBe(2);
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="button-retry-team"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="team-load-error"]')).not.toBeNull();
  });

  it("keeps cached invitations and the retry control visible when a refresh fails", async () => {
    let inviteCalls = 0;
    routes.push(["GET .*/team$", () => ({ body: [member(1)] })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    routes.push([
      "GET .*/team/invitations",
      () => {
        inviteCalls += 1;
        if (inviteCalls === 1) {
          return {
            body: [
              {
                id: "inv1",
                email: "pending@example.com",
                role: "viewer",
                status: "pending",
                expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
                sendCount: 1,
              },
            ],
          };
        }
        return { status: 404, body: { message: "boom" } };
      },
    ]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    expect(container.querySelector('[data-testid="invitation-inv1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-retry-team-invites"]')).toBeNull();

    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/companies", "c-1", "team", "invitations"],
        exact: true,
      });
    });
    await flush();

    expect(inviteCalls).toBe(2);
    expect(container.querySelector('[data-testid="invitation-inv1"]')?.textContent).toContain(
      "pending@example.com"
    );
    expect(container.querySelector('[data-testid="button-retry-team-invites"]')).not.toBeNull();
  });

  it("drops the member filter when the roster shrinks and the search box disappears", async () => {
    let team = [1, 2, 3, 4, 5, 6].map(member);
    routes.push(["GET .*/team$", () => ({ body: team })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    const input = container.querySelector(
      '[data-testid="input-search-members"]'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="members-no-match"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(0);

    team = [1, 2, 3, 4, 5].map(member);
    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/companies", "c-1", "team"],
        exact: true,
      });
    });
    await flush();

    expect(container.querySelector('[data-testid="input-search-members"]')).toBeNull();
    expect(container.querySelector('[data-testid="members-no-match"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(5);
  });

  it("searches a long member list by name or email", async () => {
    routes.push(["GET .*/team$", () => ({ body: [1, 2, 3, 4, 5, 6, 7].map(member) })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    const input = container.querySelector(
      '[data-testid="input-search-members"]'
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "person3@");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(1);
    await act(async () => {
      setter.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="members-no-match"]')).not.toBeNull();
  });

  it.each(["en", "ar"] as const)("rejects a malformed invite email in-app (%s)", async (locale) => {
    await setLocale(locale);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    await act(async () =>
      (container.querySelector('[data-testid="button-invite-member"]') as HTMLElement).click()
    );
    const email = document.querySelector('[data-testid="input-invite-email"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(email, "not-an-email");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (email.closest("form") as HTMLFormElement).requestSubmit());
    const error = document.querySelector("#team-invite-email-error");
    expect(error).not.toBeNull();
    if (locale === "ar") expect(error!.textContent).toMatch(/[؀-ۿ]/);
    const posted = (
      globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.some(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST" && !String(c[0]).includes("csrf")
    );
    expect(posted).toBe(false);
  });
});
