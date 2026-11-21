// @vitest-environment jsdom
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { StrictMode, act, createElement, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import { ProtectedRoute } from "../../client/src/components/layout/ProtectedRoute";
import NotificationPreferences from "../../client/src/pages/NotificationPreferences";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import * as queryApi from "../../client/src/lib/queryClient";
import { useBankAuthorizationReturn } from "../../client/src/lib/bank-authorization-return";
import { clearCsrfToken } from "../../client/src/lib/csrf";
import { currentUserQueryKey } from "../../client/src/hooks/useCurrentUser";
import * as auth from "../../client/src/lib/auth";
import * as pwa from "../../client/src/lib/pwa";
import { establishAuthenticatedSession } from "../../client/src/lib/authSession";
import {
  BANK_AUTHORIZATION_RETURN_PATH,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH,
} from "../../shared/bank-authorization-paths";
import { bankStatementCopy, bankStatementTitle } from "../../shared/bank-statement-copy";
import { withNotificationCopy } from "../../shared/server-copy";
import { bankFeedCallbackBody } from "../../shared/validators/banking";
import { unsupportedStatementCopy } from "../helpers/statement-copy.mjs";

vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: PropsWithChildren) => children,
}));
const prohibitedCopy = new RegExp(
  `${unsupportedStatementCopy.source}|reconnect|thousands\\s+of\\s+financial\\s+institutions\\s+and\\s+tools`,
  "i"
);

function ReturnRoute({ protectedRoute = false }: { protectedRoute?: boolean }) {
  const [pathname] = useLocation();
  const authorization = useBankAuthorizationReturn(pathname);
  if (pathname === "/bank-feeds") return createElement(BankFeeds);
  if (authorization.cleaning || !authorization.isCallback) return null;
  const page = createElement(BankFeeds, {
    initialReturn: authorization.returned,
    onReturnClaimed: authorization.clear,
  });
  return protectedRoute
    ? createElement(ProtectedRoute, { replaceOnLoginRedirect: true, children: page })
    : page;
}

describe("signed-in CSV statement wording", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState({}, "", "/");
    clearCsrfToken();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setLocale(locale: "en" | "ar") {
    await loadLocale(locale);
    act(() => useI18n.getState().setLocale(locale));
  }

  it("captures a legacy return without adding history or putting its query on the replacement URL", async () => {
    const state = randomBytes(32).toString("base64url");
    const search = `?code=return%252F%2b%20value&state=${state}&provider=lean`;
    const post = vi.spyOn(queryApi, "apiRequest").mockImplementation(() => new Promise(() => {}));
    window.history.replaceState({}, "", `${LEGACY_BANK_AUTHORIZATION_RETURN_PATH}${search}`);
    const entries = window.history.length;
    await act(async () => root.render(createElement(ReturnRoute)));
    expect(window.location.pathname).toBe(BANK_AUTHORIZATION_RETURN_PATH);
    expect(window.location.search).toBe("");
    expect(post.mock.calls[0][2]).toEqual({ code: "return%2F+ value", state });
    expect(window.history.length).toBe(entries);
  });

  it.each([BANK_AUTHORIZATION_RETURN_PATH, LEGACY_BANK_AUTHORIZATION_RETURN_PATH])(
    "resumes %s after sign-in without restoring the query on Back",
    async (callbackPath) => {
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      client.setQueryData(currentUserQueryKey, null);
      const post = vi.spyOn(queryApi, "apiRequest").mockResolvedValue({ connections: [{}] });
      const state = randomBytes(32).toString("base64url");
      const code = "resume%2F+ sample";
      window.history.replaceState({}, "", "/previous-page");
      window.history.pushState({}, "", `${callbackPath}?${new URLSearchParams({ code, state })}`);
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(ReturnRoute, { protectedRoute: true })
          )
        )
      );
      const loginPath = `/login?next=${encodeURIComponent(BANK_AUTHORIZATION_RETURN_PATH)}`;
      expect(window.location.pathname + window.location.search).toBe(loginPath);
      expect(post).not.toHaveBeenCalled();

      await act(async () => {
        client.setQueryData(currentUserQueryKey, { userType: "customer" });
        window.history.replaceState({}, "", BANK_AUTHORIZATION_RETURN_PATH);
      });
      expect(post).toHaveBeenCalledOnce();
      expect(post.mock.calls[0][2]).toEqual({ code, state });
      expect(window.location.pathname).toBe("/bank-feeds");

      await act(async () => {
        await new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => resolve(), { once: true });
          window.history.back();
        });
      });
      expect(window.location.pathname + window.location.search).toBe("/previous-page");
      expect(post).toHaveBeenCalledOnce();
      client.clear();
    }
  );

  it("reloads an active workspace query that failed before sign-in", async () => {
    const user = { id: "fixture-user", userType: "customer" };
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValue(user);
    vi.spyOn(pwa, "rotatePwaSessionMarker").mockReturnValue("fixture-marker");
    const companies = [{ id: "workspace-fixture" }];
    const query = new QueryObserver(queryApi.queryClient, {
      queryKey: ["/api/companies"],
      queryFn: vi
        .fn()
        .mockRejectedValueOnce(new queryApi.ApiError("Unauthorized", 401))
        .mockResolvedValueOnce(companies),
      retry: false,
    });
    const stop = query.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(query.getCurrentResult().isError).toBe(true));
      await establishAuthenticatedSession(user);
      await vi.waitFor(() => expect(query.getCurrentResult().data).toEqual(companies));
    } finally {
      stop();
      queryApi.queryClient.clear();
      window.localStorage.clear();
    }
  });

  it.each(["en", "ar"] as const)(
    "shows CSV guidance on both legacy banking paths in %s",
    async (locale) => {
      await setLocale(locale);
      for (const path of ["/bank-feeds", "/bank-feeds/callback"]) {
        const { hook } = memoryLocation({ path });
        await act(async () =>
          root.render(createElement(Router, { hook }, createElement(BankFeeds)))
        );
        expect(container.querySelector("h1")?.textContent).toBe(bankStatementTitle[locale]);
        expect(container.textContent).toContain(bankStatementCopy[locale]);
        expect(container.textContent).not.toMatch(prohibitedCopy);
        expect(
          container
            .querySelector('[data-testid="button-feeds-import-statement"]')
            ?.getAttribute("href")
        ).toBe("/bank-reconciliation?import=1");
      }
    }
  );

  it.each(["en", "ar"] as const)(
    "posts the original encoded authorization code once and clears the URL in %s",
    async (locale) => {
      await setLocale(locale);
      const post = vi.spyOn(queryApi, "apiRequest").mockResolvedValue({ connections: [{}] });
      const codeField = locale === "ar" ? "entity_id" : "code";
      const code = "return%2F+sample%252F/";
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState(
        {},
        "",
        `/bank-feeds/callback?${new URLSearchParams({ [codeField]: code, state, provider: "lean" })}`
      );
      await act(async () =>
        root.render(createElement(StrictMode, null, createElement(ReturnRoute)))
      );
      expect(post).toHaveBeenCalledExactlyOnceWith(
        "POST",
        "/api/bank-connections/callback",
        { code, state },
        undefined,
        { queueWhenOffline: false }
      );
      expect(bankFeedCallbackBody.parse(post.mock.calls[0][2])).toEqual({
        code,
        state,
      });
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds");
      expect(container.textContent).toContain(bankStatementCopy[locale]);
    }
  );

  it.each(["en", "ar"] as const)(
    "keeps a return after a failed first CSRF request and submits it on retry in %s",
    async (locale) => {
      await setLocale(locale);
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      fetch
        .mockRejectedValueOnce(new TypeError("Fixture network failure"))
        .mockResolvedValueOnce(Response.json({ csrfToken: "fixture-csrf" }))
        .mockResolvedValueOnce(Response.json({ connections: [{}] }, { status: 201 }));
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState({}, "", `/bank-feeds/callback?code=fixture-code&state=${state}`);
      await act(async () =>
        root.render(createElement(StrictMode, null, createElement(ReturnRoute)))
      );
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds/callback");
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/csrf-token"]);
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnOffline"]
      );
      const button = container.querySelector("button");
      expect(button?.textContent).toBe(t[locale]["banking.feeds.returnRetry"]);
      await act(async () => button!.click());
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "/api/csrf-token",
        "/api/csrf-token",
        "/api/bank-connections/callback",
      ]);
      const request = fetch.mock.calls[2][1];
      expect(request?.method).toBe("POST");
      expect(request?.headers).toMatchObject({ "x-csrf-token": "fixture-csrf" });
      expect(bankFeedCallbackBody.parse(JSON.parse(String(request?.body)))).toEqual({
        code: "fixture-code",
        state,
      });
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds");
    }
  );

  it("checks offline status before fetching CSRF headers", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      queryApi.apiRequest("POST", "/api/bank-connections/callback", {}, undefined, {
        queueWhenOffline: false,
      })
    ).rejects.toBeInstanceOf(queryApi.ApiRequestNotSentError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"] as const)(
    "shows localized cancellation and cleans the URL in %s",
    async (locale) => {
      await setLocale(locale);
      const post = vi.spyOn(queryApi, "apiRequest");
      window.history.replaceState(
        {},
        "",
        "/bank-feeds/callback?error=access_denied&error_description=fixture"
      );
      await act(async () => root.render(createElement(ReturnRoute)));
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnCancelled"]
      );
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds/callback");
      expect(container.textContent).toContain(bankStatementCopy[locale]);
      expect(post).not.toHaveBeenCalled();
    }
  );

  it.each(["en", "ar"] as const)(
    "shows a localized failure without Retry when the callback POST may have reached the server in %s",
    async (locale) => {
      await setLocale(locale);
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      fetch
        .mockResolvedValueOnce(Response.json({ csrfToken: "fixture-csrf" }))
        .mockRejectedValueOnce(new TypeError("Fixture connection lost after submission"));
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState({}, "", `/bank-feeds/callback?code=fixture-code&state=${state}`);
      await act(async () => root.render(createElement(ReturnRoute)));
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        "/api/csrf-token",
        "/api/bank-connections/callback",
      ]);
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnError"]
      );
      expect(container.querySelector("button")).toBeNull();
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds/callback");
    }
  );

  it.each(["en", "ar"] as const)(
    "uses CSV copy in notification settings and accessible names in %s",
    async (locale) => {
      await setLocale(locale);
      const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
      const type = "bank.sync_failed";
      client.setQueryData(["/api/notification-preferences"], { eventTypes: [type] });
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client }, createElement(NotificationPreferences))
        )
      );
      const switches = [...container.querySelectorAll('[role="switch"][aria-labelledby]')];
      const localizedEvent = t[locale][`portal.eventType.${type}`];
      const accessibleNames = switches.map((toggle) =>
        toggle
          .getAttribute("aria-labelledby")!
          .split(" ")
          .map((id) => document.getElementById(id)?.textContent)
          .join(" ")
      );
      expect(accessibleNames).toEqual(
        expect.arrayContaining([
          `${localizedEvent} ${t[locale]["portal.channelInApp"]}`,
          `${localizedEvent} ${t[locale]["portal.channelEmail"]}`,
        ])
      );
      expect(accessibleNames.join(" ")).not.toMatch(prohibitedCopy);
      expect(container.textContent).not.toMatch(prohibitedCopy);
      expect(t[locale]["components.srv.notification.bankSyncFailed.message"]).toBe(
        bankStatementCopy[locale]
      );
      expect(t[locale]["serverErrors.BANK_FEED_BALANCE_UNAVAILABLE"]).toBe(
        bankStatementCopy[locale]
      );
    }
  );
});

it("documents the CSV workflow in the environment example", () => {
  const example = readFileSync(".env.example", "utf8");
  expect(example.split("\n")).toContain(`# ${bankStatementCopy.en}`);
  expect(example).not.toMatch(prohibitedCopy);
  expect(example).not.toMatch(/^\s*#?\s*(?:BANK_FEED_|LEAN_|TARABUT_|WIO_)\w*\s*=/m);
});

it("replaces stored banking notification text before returning it to the client", () => {
  const notice = withNotificationCopy({
    eventKey: "bank.sync_failed:fixture",
    title: "Legacy title",
    message: "Legacy instructions",
  });
  expect(notice.title).toBe("Review your bank statement");
  expect(notice.message).toBe(bankStatementCopy.en);
  expect(notice.copy.messageKey).toBe("notification.bankSyncFailed.message");
});

it("keeps the audit, data map and both roadmap formats free of superseded wording", () => {
  for (const file of [
    "docs/archive/2026-06/DEVELOPMENT_STATUS.md",
    "docs/archive/2026-06/COMPETITIVE_ROADMAP.md",
    "docs/archive/2026-06/FIX_PLAN.md",
    "docs/archive/root/COMPETITIVE_AUDIT_2026.md",
    "docs/archive/root/muhasibaisource20260611-audit.md",
    "docs/archive/root/Digits-Platform-Research.md",
    "docs/archive/root/Muhasib-Rebuild-Plan.md",
    "docs/archive/teardown-evidence/competitor-briefing.md",
    "docs/qa/2026-06-21-benchmark-audit/benchmark-run.json",
    "docs/security/data-map.md",
    "docs/qa/2026-06-21-benchmark-audit/03-cfo-audit-report.md",
    "tests/e2e/benchmark-audit.mjs",
    "client/src/locales/en/onboarding.json",
    "client/src/locales/ar/onboarding.json",
  ]) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toMatch(prohibitedCopy);
    expect(text, file).not.toMatch(
      /bankConnectedDescription|bank account is already connected|حسابك البنكي مرتبط بالفعل|Named integrations: \*\*Chase/i
    );
  }
  const digits = readFileSync("docs/archive/root/Digits-Platform-Research.md", "utf8");
  expect(digits).toContain("### Other Integrations\n- [Historical comparison excerpt redacted.]");
  const rebuild = readFileSync("docs/archive/root/Muhasib-Rebuild-Plan.md", "utf8");
  expect(rebuild).toContain(
    `| Bank reconciliation | ${bankStatementCopy.en} | [Historical comparison excerpt redacted.] |`
  );
  const developmentStatus = readFileSync("docs/archive/2026-06/DEVELOPMENT_STATUS.md", "utf8");
  expect(developmentStatus.split("## Where to go next")[1]).not.toContain(bankStatementCopy.en);
  const bankingValidators = readFileSync("shared/validators/banking.ts", "utf8");
  expect(bankingValidators).not.toMatch(prohibitedCopy);
  const markdownRoadmap = readFileSync("docs/archive/2026-06/COMPETITIVE_ROADMAP.md", "utf8");
  const [statementSection, phases] = markdownRoadmap.split("## Phased roadmap");
  expect(statementSection).toContain(bankStatementCopy.en);
  expect(phases).not.toContain(bankStatementCopy.en);
  const deployment = readFileSync("docs/vercel-uae-postgres-assessment.md", "utf8");
  expect(deployment).not.toMatch(unsupportedStatementCopy);
  expect(deployment).not.toMatch(/bank and e-invoice integrations/i);
  const benchmark = readFileSync("docs/qa/2026-06-21-benchmark-audit/benchmark-run.json", "utf8");
  expect(benchmark).toContain("[Historical copy redacted]");
  expect(benchmark).not.toMatch(
    /connect invoice and bank refreshes|bank, invoice, and receipt refresh/i
  );
  const roadmap = "docs/archive/root/Muhasib-Netmara-Audit-and-Competitive-Roadmap";
  const docx = unzipSync(readFileSync(`${roadmap}.docx`));
  const source = Buffer.from(docx["word/document.xml"])
    .toString("utf8")
    .replace(/<[^>]+>/g, " ");
  const pdf = execFileSync("pdftotext", [`${roadmap}.pdf`, "-"], { encoding: "utf8" });
  const pageFour = execFileSync("pdftotext", ["-f", "4", "-l", "4", `${roadmap}.pdf`, "-"], {
    encoding: "utf8",
  });
  expect(pageFour.replace(/\s+/g, " ")).toContain("financial-data authorization and processing");
  for (const contents of [source, pdf]) {
    const text = contents.replace(/\s+/g, " ");
    expect(text).toContain(bankStatementCopy.en);
    const monthsThreeToSix = text.indexOf("Months 3-6");
    expect(monthsThreeToSix).toBeGreaterThan(text.indexOf(bankStatementCopy.en));
    expect(text.slice(monthsThreeToSix)).not.toContain(bankStatementCopy.en);
    expect(text).not.toMatch(prohibitedCopy);
    expect(text).not.toMatch(/bank\s+connect\/sync/i);
  }
});

it("keeps superseded banking terms out of tracked prose, comments, and fixtures", () => {
  // Read tracked text, including source comments and test data. Compatibility paths and
  // identifiers use hyphens or underscores; this scan checks the prose around them.
  const wording = [
    "(bank|live)[[:blank:]]+feeds?",
    "open[[:blank:]]+banking",
    "connect[[:blank:]]+your[[:blank:]]+bank",
    "bank[[:blank:]]+connection[[:blank:]]+(deleted|created)",
    "الربط[[:blank:]]+(البنكي|المصرفي)",
    "مزامنة[[:blank:]]+(الحساب|الخلاصة)[[:blank:]]+البنكي",
    ["ADCB", "DIB", "ENBD", "FAB", "RAKBANK"].join(",[[:blank:]]+"),
  ].join("|");
  const result = spawnSync("git", ["grep", "-IinE", wording, "--", "."], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout || result.stderr).toBe(1);
});
