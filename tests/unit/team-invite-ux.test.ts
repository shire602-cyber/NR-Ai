// @vitest-environment jsdom
/**
 * Team management and user invitation screens: derived "expired" filter, load-error states,
 * localized delete confirm, member search and in-app email validation (English and Arabic).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, onlineManager } from "@tanstack/react-query";
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

// The on-demand dialog chunks: the real retry loader runs, but each import attempt can be held or
// made to fail the way a browser reports a chunk it could not fetch.
const chunk = vi.hoisted(() => ({
  attempts: 0,
  fail: false,
  gate: null as Promise<void> | null,
  reload: [] as unknown[],
}));
vi.mock("../../client/src/lib/lazyWithReload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/src/lib/lazyWithReload")>();
  const loadWithChunkRetry: typeof actual.loadWithChunkRetry = (factory, opts) => {
    chunk.reload.push(opts.reload);
    return actual.loadWithChunkRetry(
      async () => {
        chunk.attempts += 1;
        await chunk.gate;
        if (chunk.fail) throw new TypeError("Failed to fetch dynamically imported module: /x.js");
        return factory();
      },
      { ...opts, delayMs: 0 }
    );
  };
  return { ...actual, loadWithChunkRetry };
});

let container: HTMLDivElement;
let root: Root;
let routes: Array<[string, () => { status?: number; body: unknown }]> = [];
/** Requests whose URL matches a pattern wait for the promise before they answer. */
let holds: Array<[string, Promise<void>]> = [];
const seenUrls: string[] = [];

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
  holds = [];
  seenUrls.length = 0;
  Object.assign(chunk, { attempts: 0, fail: false, gate: null, reload: [] });
  localStorage.setItem("muhasib_auth_hint", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      seenUrls.push(`${method} ${url}`);
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      for (const [pattern, gate] of holds) if (new RegExp(pattern).test(url)) await gate;
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
  onlineManager.setOnline(true);
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "onLine");
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

/** Mount without clearing the shared client, so a test can seed cached data first. */
async function mountKeepingCache(el: ReturnType<typeof createElement>) {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: queryClient }, el));
  });
  await flush();
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function goOnline() {
  await act(async () => onlineManager.setOnline(true));
  await flush();
}

function hold(pattern: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  holds.push([pattern, gate]);
  return release;
}

/**
 * A 5xx read is retried with backoff in the app; a test that counts requests turns that off for
 * its own run and puts the defaults back with the returned function.
 */
async function withoutRetries() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const previous = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({ ...previous, queries: { ...previous.queries, retry: false } });
  return () => queryClient.setDefaultOptions(previous);
}

const hits = (pattern: string) => seenUrls.filter((u) => new RegExp(pattern).test(u)).length;

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

  const invitationsRoute = (body: unknown[]) =>
    routes.push(["GET /api/admin/invitations", () => ({ body })]);

  it("a paused first fetch shows the offline state, not 'no invitations', then loads on reconnect", async () => {
    invitationsRoute([invite("a", "live@example.com", "pending", 3)]);
    onlineManager.setOnline(false);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));

    expect(container.querySelector('[data-testid="invitations-offline"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="invitations-empty"]')).toBeNull();
    expect(container.querySelector('[data-testid="invitations-load-error"]')).toBeNull();
    expect(hits("/api/admin/invitations")).toBe(0);

    await goOnline();
    expect(container.querySelector('[data-testid="invitations-offline"]')).toBeNull();
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("live@")]);
  });

  it("shows loading, not the empty copy, while the first online fetch is in flight", async () => {
    invitationsRoute([]);
    const release = hold("/api/admin/invitations");
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    expect(container.querySelector('[data-testid="invitations-loading"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="invitations-empty"]')).toBeNull();

    release();
    await flush();
    expect(container.querySelector('[data-testid="invitations-loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="invitations-empty"]')?.textContent).toBe(
      "No invitations sent yet"
    );
  });

  it("keeps cached rows when a refresh is paused offline", async () => {
    invitationsRoute([invite("a", "live@example.com", "pending", 3)]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    expect(rows()).toHaveLength(1);

    onlineManager.setOnline(false);
    const { queryClient } = await import("../../client/src/lib/queryClient");
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
    });
    await flush();
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('[data-testid="invitations-offline"]')).toBeNull();
    expect(container.querySelector('[data-testid="invitations-empty"]')).toBeNull();
  });

  it("treats whitespace-only search as no filter, for matching and the empty state", async () => {
    invitationsRoute([
      invite("a", "live@example.com", "pending", 3),
      invite("b", "other@example.com", "pending", 3),
    ]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    const search = container.querySelector(
      '[data-testid="input-search-invites"]'
    ) as HTMLInputElement;
    await typeInto(search, "   ");
    expect(rows()).toHaveLength(2);
    await typeInto(search, " zzz ");
    expect(rows()).toHaveLength(0);
    expect(container.querySelector('[data-testid="invitations-empty"]')?.textContent).toBe(
      "No invitations match your filters"
    );
  });

  it("whitespace-only search on an empty list says 'none yet', not 'no matches'", async () => {
    invitationsRoute([]);
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await typeInto(
      container.querySelector('[data-testid="input-search-invites"]') as HTMLInputElement,
      "   "
    );
    expect(container.querySelector('[data-testid="invitations-empty"]')?.textContent).toBe(
      "No invitations sent yet"
    );
  });

  const clickCopyLink = async () => {
    await openMenu(
      container.querySelector('[data-testid="button-actions-invite-a"]') as HTMLElement
    );
    const copy = document.querySelector('[role="menuitem"]') as HTMLElement;
    await act(async () => copy.click());
    await flush();
  };

  it("shows the same invite URL in a selected read-only field when the clipboard rejects", async () => {
    invitationsRoute([invite("a", "live@example.com", "pending", 3)]);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await clickCopyLink();

    const expected = `${window.location.origin}/register?invite=tok-a`;
    expect(writeText).toHaveBeenCalledWith(expected);
    const field = document.querySelector(
      '[data-testid="input-invite-link-manual"]'
    ) as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(expected);
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe("Invitation link");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(expected.length);
  });

  it("does not open the manual-copy field when the clipboard write succeeds", async () => {
    invitationsRoute([invite("a", "live@example.com", "pending", 3)]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { default: UserInvitations } = await import("../../client/src/pages/UserInvitations");
    await mount(createElement(UserInvitations));
    await clickCopyLink();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="input-invite-link-manual"]')).toBeNull();
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
    const restoreRetries = await withoutRetries();
    let teamCalls = 0;
    routes.push([
      "GET .*/team$",
      () => {
        teamCalls += 1;
        if (teamCalls === 1) return { body: [1, 2, 3].map(member) };
        // A transient server failure: a 404 on a company-scoped read means access was lost, and the
        // query cache then deliberately drops the cached rows (see queryReadState).
        return { status: 500, body: { message: "boom" } };
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
    restoreRetries();
  });

  it("keeps cached invitations and the retry control visible when a refresh fails", async () => {
    const restoreRetries = await withoutRetries();
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
        // Transient failure (not a 404, which means access was lost and drops the cached rows).
        return { status: 500, body: { message: "boom" } };
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
    restoreRetries();
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

  const TEAM_KEY = ["/api/companies", "c-1", "team"];
  const INVITES_KEY = [...TEAM_KEY, "invitations"];
  const pendingInvite = {
    id: "inv1",
    email: "pending@example.com",
    role: "viewer",
    status: "pending",
    expiresAt: new Date(Date.now() + 3 * DAY).toISOString(),
    sendCount: 1,
  };
  const has = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) !== null;

  /** Fresh client with access (and optionally the roster) already cached, then mount offline/online. */
  async function seed(opts: { team?: unknown }) {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { companyAccessQueryKey } = await import("../../client/src/lib/auth");
    queryClient.clear();
    queryClient.setQueryData(companyAccessQueryKey("c-1"), ACCESS);
    if (opts.team !== undefined) queryClient.setQueryData(TEAM_KEY, opts.team);
    return queryClient;
  }

  it("a paused first roster fetch shows offline, not 'no team members', then loads on reconnect", async () => {
    routes.push(["GET .*/team$", () => ({ body: [1, 2].map(member) })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    onlineManager.setOnline(false);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));

    expect(has("team-offline")).toBe(true);
    expect(container.textContent).not.toContain("No other team members");
    expect(has("team-load-error")).toBe(false);
    expect(hits("/team$")).toBe(0);

    await goOnline();
    expect(has("team-offline")).toBe(false);
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(2);
  });

  it("shows the roster empty copy only after a successful empty response", async () => {
    routes.push(["GET .*/team$", () => ({ body: [] })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const release = hold("/team$");
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    expect(container.textContent).not.toContain("No other team members");
    release();
    await flush();
    expect(container.textContent).toContain("No other team members");
  });

  it("keeps cached roster rows when a refresh is paused offline", async () => {
    const queryClient = await seed({ team: [1, 2, 3].map(member) });
    queryClient.setQueryData(INVITES_KEY, []);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mountKeepingCache(createElement(TeamManagement));
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(3);

    onlineManager.setOnline(false);
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: TEAM_KEY, exact: true });
    });
    await flush();
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(3);
    expect(has("team-offline")).toBe(false);
    expect(container.textContent).not.toContain("No other team members");
  });

  it("a paused first invitations fetch shows offline, not the empty copy, then loads on reconnect", async () => {
    routes.push(["GET .*/team/invitations", () => ({ body: [pendingInvite] })]);
    const queryClient = await seed({ team: [member(1)] });
    expect(queryClient.getQueryData(TEAM_KEY)).toBeDefined();
    onlineManager.setOnline(false);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mountKeepingCache(createElement(TeamManagement));

    expect(has("team-invitations-offline")).toBe(true);
    expect(has("team-invitations-empty")).toBe(false);
    expect(has("invitations-load-error")).toBe(false);
    expect(hits("/team/invitations")).toBe(0);

    await goOnline();
    expect(has("team-invitations-offline")).toBe(false);
    expect(has("invitation-inv1")).toBe(true);
  });

  it("shows loading, not the empty copy, while the first online invitations fetch is in flight", async () => {
    routes.push(["GET .*/team/invitations", () => ({ body: [] })]);
    const release = hold("/team/invitations");
    await seed({ team: [member(1)] });
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mountKeepingCache(createElement(TeamManagement));

    expect(has("team-invitations-loading")).toBe(true);
    expect(has("team-invitations-empty")).toBe(false);

    release();
    await flush();
    expect(has("team-invitations-loading")).toBe(false);
    expect(has("team-invitations-empty")).toBe(true);
  });

  it("keeps cached invitations when a refresh is paused offline", async () => {
    const queryClient = await seed({ team: [member(1)] });
    queryClient.setQueryData(INVITES_KEY, [pendingInvite]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mountKeepingCache(createElement(TeamManagement));
    expect(has("invitation-inv1")).toBe(true);

    onlineManager.setOnline(false);
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: INVITES_KEY, exact: true });
    });
    await flush();
    expect(has("invitation-inv1")).toBe(true);
    expect(has("team-invitations-offline")).toBe(false);
    expect(has("team-invitations-empty")).toBe(false);
  });

  it("treats whitespace-only member search as no filter", async () => {
    routes.push(["GET .*/team$", () => ({ body: [1, 2, 3, 4, 5, 6].map(member) })]);
    routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    const { default: TeamManagement } = await import("../../client/src/pages/TeamManagement");
    await mount(createElement(TeamManagement));
    await typeInto(
      container.querySelector('[data-testid="input-search-members"]') as HTMLInputElement,
      "   "
    );
    expect(container.querySelectorAll('[data-testid^="member-m"]')).toHaveLength(6);
    expect(has("members-no-match")).toBe(false);
  });
});

const DIALOG_PAGES = [
  {
    name: "TeamManagement",
    page: () => import("../../client/src/pages/TeamManagement"),
    arrange: () => {
      routes.push([
        "GET .*/team$",
        () => ({
          body: [
            {
              id: "m1",
              userId: "u1",
              companyId: "c-1",
              role: "viewer",
              createdAt: new Date().toISOString(),
              user: { id: "u1", email: "person1@example.com", name: "Person 1" },
            },
          ],
        }),
      ]);
      routes.push(["GET .*/team/me", () => ({ body: ACCESS })]);
    },
    trigger: "button-view-permissions",
    status: "permissions-dialog",
    row: '[data-testid="member-m1"]',
    dialog: '[role="dialog"]',
  },
  {
    name: "UserInvitations",
    page: () => import("../../client/src/pages/UserInvitations"),
    arrange: () => {
      routes.push([
        "GET /api/admin/invitations",
        () => ({ body: [invite("a", "live@example.com", "pending", 3)] }),
      ]);
    },
    trigger: "button-send-invite",
    status: "invite-dialog",
    row: '[data-testid="row-invite-a"]',
    dialog: '[data-testid="button-submit-invite"]',
  },
];

describe.each(DIALOG_PAGES)(
  "$name on-demand dialog",
  { timeout: 30_000 },
  ({ page, arrange, trigger, status, row, dialog }) => {
    const find = (selector: string) => document.querySelector(selector) as HTMLElement | null;
    const byId = (testId: string) => find(`[data-testid="${testId}"]`);

    async function open() {
      arrange();
      const { default: Page } = await page();
      await mount(createElement(Page));
      expect(find(row)).not.toBeNull();
    }

    async function click(testId: string) {
      await act(async () => byId(testId)!.click());
      await flush();
    }

    /** Run what lets the import proceed, and keep act open until the module has loaded. */
    async function dialogAppears(start: () => void) {
      await act(async () => {
        start();
        await vi.dynamicImportSettled();
      });
      expect(find(dialog)).not.toBeNull();
    }

    async function pressEscape() {
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      await flush();
    }

    const setBrowserOnline = (online: boolean) =>
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });

    it("imports only on request, shows a pending status once, and keeps the loaded dialog", async () => {
      let release!: () => void;
      chunk.gate = new Promise<void>((resolve) => (release = resolve));
      await open();
      expect(chunk.attempts).toBe(0);
      expect(byId(`${status}-loading`)).toBeNull();

      await click(trigger);
      expect(byId(`${status}-loading`)?.getAttribute("role")).toBe("status");
      expect(byId(`${status}-loading`)?.textContent).toBe("Loading…");
      expect(find(dialog)).toBeNull();
      expect(find(row)).not.toBeNull();
      await click(trigger);
      expect(chunk.attempts).toBe(1);

      await dialogAppears(release);
      expect(byId(`${status}-loading`)).toBeNull();

      await pressEscape();
      expect(find(dialog)).toBeNull();
      // Already loaded: reopening needs neither the network nor another import.
      setBrowserOnline(false);
      await click(trigger);
      expect(find(dialog)).not.toBeNull();
      expect(byId(`${status}-error`)).toBeNull();
      expect(chunk.attempts).toBe(1);
    });

    it.each(["retry", "reopen"] as const)(
      "keeps rows usable after a failed import and recovers on %s",
      async (how) => {
        chunk.fail = true;
        await open();
        await click(trigger);

        expect(byId(`${status}-error`)?.textContent).toContain("Could not load this data");
        expect(byId(`${status}-loading`)).toBeNull();
        expect(find(dialog)).toBeNull();
        expect(find(row)).not.toBeNull();
        // The first try plus the loader's one automatic re-try, never with a page reload.
        expect(chunk.attempts).toBe(2);

        chunk.fail = false;
        let release!: () => void;
        chunk.gate = new Promise<void>((resolve) => (release = resolve));
        await click(how === "retry" ? `${status}-retry` : trigger);
        expect(byId(`${status}-loading`)).not.toBeNull();
        expect(byId(`${status}-error`)).toBeNull();
        if (how === "retry") expect(document.activeElement).toBe(byId(trigger));

        await dialogAppears(release);
        expect(byId(`${status}-loading`)).toBeNull();
        expect(find(row)).not.toBeNull();
        expect(chunk.reload).toEqual([false, false]);
      }
    );

    it.each(["en", "ar"] as const)(
      "does not import while the browser is offline, then loads on retry (%s)",
      async (locale) => {
        await setLocale(locale);
        await open();
        setBrowserOnline(false);
        await click(trigger);

        const error = byId(`${status}-error`);
        expect(error?.getAttribute("role")).toBe("alert");
        if (locale === "ar") expect(error!.textContent).toMatch(/[؀-ۿ]/);
        else expect(error!.textContent).toContain("You are offline");
        await click(`${status}-retry`);
        expect(byId(`${status}-error`)).not.toBeNull();
        expect(chunk.attempts).toBe(0);
        expect(find(dialog)).toBeNull();
        expect(find(row)).not.toBeNull();

        setBrowserOnline(true);
        await dialogAppears(() => byId(`${status}-retry`)!.click());
        expect(byId(`${status}-error`)).toBeNull();
        expect(chunk.attempts).toBe(1);
        expect(find(row)).not.toBeNull();
      }
    );
  }
);
