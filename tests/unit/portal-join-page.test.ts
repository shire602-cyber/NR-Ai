// @vitest-environment jsdom
/**
 * STEP5 customer-portal join page, rendered in English and Arabic: every invitation state, the
 * token leaving the address bar, the live password checklist, the terms gate, the inline server
 * error with focus, and no English text nodes in Arabic mode.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PASSWORD } from "../fixtures/credentials/fake-credentials";
import { englishWords } from "../e2e/lib/sweep-checks.mjs";

const TOKEN = "ab".repeat(32);
// The supplier name is the supplier's own data (it may be in either script).
const SUPPLIER = "شركة الوردة";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: Record<string, unknown>,
      public rawMessage: string = message
    ) {
      super(message);
    }
  }
  return { ApiError, apiRequest: vi.fn() };
});

vi.mock("../../client/src/lib/queryClient", () => ({
  ApiError: mocks.ApiError,
  apiRequest: mocks.apiRequest,
  queryClient: new (class {})(),
}));
vi.mock("../../client/src/lib/authSession", () => ({
  establishAuthenticatedSession: vi.fn(async () => ({})),
}));

import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import PortalJoin from "../../client/src/pages/portal/PortalJoin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const invite = (over: Record<string, unknown> = {}) => ({
  status: "pending",
  supplier: { name: SUPPLIER, logoUrl: null, contactEmail: "billing@desertrose.test" },
  customerName: "Al Noor Trading",
  customerNameAr: "النور للتجارة",
  email: "layla@alnoor.test",
  name: "Layla",
  language: "en",
  expiresAt: "2026-12-01T10:00:00Z",
  account: "new",
  signedInAs: null,
  onlinePayment: { available: false },
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(PortalJoin)));
  });
  await flush();
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const byId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function typeInto(id: string, value: string) {
  const el = byId(id) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: HTMLElement | null) {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

function visibleText(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = (n.textContent || "").trim();
    if (v && n.parentElement && !n.parentElement.closest('[lang]:not([lang^="ar"])')) out.push(v);
  }
  return out;
}

function respondWith(handler: (method: string, url: string, body?: unknown) => unknown) {
  mocks.apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    const out = handler(method, url, body);
    if (out instanceof Error) throw out;
    return out;
  });
}

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  mocks.apiRequest.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", `/portal/join#t=${TOKEN}`);
  document.documentElement.dir = "ltr";
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

for (const locale of ["en", "ar"] as const) {
  describe(`STEP5 portal join page (${locale})`, () => {
    beforeEach(() => {
      useI18n.setState({ locale });
    });

    it("strips the token from the address bar, keeps it for this tab only, and shows the form", async () => {
      respondWith(() => invite({ language: locale }));
      await mount();
      expect(window.location.hash).toBe("");
      expect(window.location.href).not.toContain(TOKEN);
      expect(window.sessionStorage.getItem("muhasib.portalInvite")).toBe(TOKEN);
      expect(byId("join-form")).toBeTruthy();
      expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/portal-invitations/lookup", {
        token: TOKEN,
      });
      expect((byId("join-name") as HTMLInputElement).value).toBe("Layla");
      expect(container.textContent).toContain("layla@alnoor.test");
    });

    it("rejects a malformed link without falling back to an earlier invitation", async () => {
      window.sessionStorage.setItem("muhasib.portalInvite", TOKEN);
      window.history.replaceState(null, "", `/portal/join#t=${TOKEN}extra`);
      await mount();
      expect(byId("join-state-invalid")).toBeTruthy();
      expect(window.location.hash).toBe("");
      expect(window.sessionStorage.getItem("muhasib.portalInvite")).toBeNull();
      expect(mocks.apiRequest).not.toHaveBeenCalled();
    });

    it("the checklist updates and Submit needs the terms and a valid password", async () => {
      respondWith(() => invite({ language: locale }));
      await mount();
      const submit = byId("join-submit") as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      await typeInto("join-password", "abc");
      expect(container.querySelector('[data-rule="length"]')!.getAttribute("data-met")).toBe(
        "false"
      );
      await typeInto("join-password", FAKE_PASSWORD);
      for (const rule of ["length", "upper", "lower", "digit"]) {
        expect(container.querySelector(`[data-rule="${rule}"]`)!.getAttribute("data-met")).toBe(
          "true"
        );
      }
      expect(submit.disabled).toBe(true); // terms not ticked yet
      await click(byId("join-terms"));
      expect(submit.disabled).toBe(false);
    });

    it("submits name, password and the terms; a server password error is inline and focused", async () => {
      respondWith((_method, url) =>
        url === "/api/portal-invitations/lookup"
          ? invite({ language: locale })
          : new mocks.ApiError("Too common", 400, {
              code: "VALIDATION_ERROR",
              details: { fields: { password: ["Too common"] } },
            })
      );
      await mount();
      await typeInto("join-password", FAKE_PASSWORD);
      await click(byId("join-terms"));
      await click(byId("join-submit"));
      const post = mocks.apiRequest.mock.calls.find(
        (c) => c[1] === "/api/portal-invitations/accept"
      );
      expect(post?.[0]).toBe("POST");
      expect(post?.[2]).toMatchObject({
        token: TOKEN,
        email: "layla@alnoor.test",
        name: "Layla",
        password: FAKE_PASSWORD,
        acceptTerms: true,
      });
      const alert = container.querySelector("#join-password-error");
      expect(alert?.textContent).toBe("Too common");
      expect(alert?.getAttribute("role")).toBe("alert");
      await flush(30);
      expect(document.activeElement?.id).toBe("join-password");
    });

    it("renders each invitation state with its own screen", async () => {
      const cases: Array<[number, Record<string, unknown>, string]> = [
        [404, { code: "PORTAL_INVITE_INVALID" }, "join-state-invalid"],
        [
          410,
          { code: "PORTAL_INVITE_EXPIRED", supplier: { name: SUPPLIER, contactEmail: "a@b.test" } },
          "join-state-expired",
        ],
        [
          410,
          { code: "PORTAL_INVITE_REVOKED", supplier: { name: SUPPLIER } },
          "join-state-revoked",
        ],
        [410, { code: "PORTAL_INVITE_ACCEPTED" }, "join-state-accepted"],
        [429, { code: "PORTAL_RATE_LIMITED" }, "join-state-throttled"],
        [500, { code: "INTERNAL" }, "join-state-error"],
      ];
      for (const [status, body, testId] of cases) {
        respondWith(() => new mocks.ApiError("x", status, body));
        await mount();
        expect(byId(testId), `${status} ${testId}`).toBeTruthy();
        expect(container.querySelector("h1")).toBeTruthy();
        if (locale === "ar") {
          const english = visibleText().filter((l) => englishWords(l).length > 0);
          expect(english, testId).toEqual([]);
        }
        await act(async () => root.unmount());
        container.remove();
        window.sessionStorage.setItem("muhasib.portalInvite", TOKEN);
      }
    });

    it("existing account, signed in with the same email, and signed in as someone else", async () => {
      respondWith(() => invite({ account: "existing", language: locale }));
      await mount();
      expect(byId("join-existing")).toBeTruthy();
      expect(byId("join-form")).toBeNull();
      await act(async () => root.unmount());
      container.remove();

      window.sessionStorage.setItem("muhasib.portalInvite", TOKEN);
      respondWith(() => invite({ account: "signed_in", language: locale }));
      await mount();
      expect(byId("join-signed-in")).toBeTruthy();
      await click(byId("join-confirm-add"));
      const post = mocks.apiRequest.mock.calls.find(
        (c) => c[1] === "/api/portal-invitations/accept"
      );
      expect(post?.[2]).toEqual({ token: TOKEN, email: "layla@alnoor.test", acceptTerms: true });
      await act(async () => root.unmount());
      container.remove();

      window.sessionStorage.setItem("muhasib.portalInvite", TOKEN);
      respondWith(() =>
        invite({ account: "signed_in_other", signedInAs: "a@b.test", language: locale })
      );
      await mount();
      expect(byId("join-other")).toBeTruthy();
      expect(byId("join-sign-out-continue")).toBeTruthy();
    });

    it(locale === "ar" ? "has no English text nodes" : "reads in English", async () => {
      respondWith(() => invite({ language: locale }));
      await mount();
      await flush();
      if (locale === "ar") {
        const english = visibleText().filter((l) => englishWords(l).length > 0 && !/@/.test(l));
        expect(english).toEqual([]);
      }
    });
  });
}

describe("STEP5 portal join page without a valid token", () => {
  it("shows the invalid state and never calls the API", async () => {
    window.history.replaceState(null, "", "/portal/join");
    useI18n.setState({ locale: "en" });
    await mount();
    expect(byId("join-state-invalid")).toBeTruthy();
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
