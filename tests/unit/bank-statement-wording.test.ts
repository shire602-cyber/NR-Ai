// @vitest-environment jsdom
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { StrictMode, act, createElement, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import NotificationPreferences from "../../client/src/pages/NotificationPreferences";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import * as queryApi from "../../client/src/lib/queryClient";
import { BANK_AUTHORIZATION_RETURN_PATH } from "../../client/src/lib/route-config";
import { bankStatementCopy, bankStatementTitle } from "../../shared/bank-statement-copy";
import { withNotificationCopy } from "../../shared/server-copy";
import { bankFeedCallbackBody } from "../../shared/validators/banking";

vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: PropsWithChildren) => children,
}));
const workspace = vi.hoisted(() => ({
  companyId: "" as string | undefined,
  isLoading: false,
  error: null as Error | null,
}));
vi.mock("@/hooks/useDefaultCompany", () => ({ useDefaultCompany: () => workspace }));

const prohibitedCopy =
  /\bbank[- ]feeds?\b|\blive (?:bank )?feeds?\b|\bopen[- ]banking\b|connect your bank|reconnect|الربط البنكي|مزامنة (?:الحساب|الخلاصة) البنكي/i;

describe("signed-in CSV statement wording", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(workspace, { companyId: "fixture-company", isLoading: false, error: null });
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setLocale(locale: "en" | "ar") {
    await loadLocale(locale);
    act(() => useI18n.getState().setLocale(locale));
  }

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
    "completes and clears an authorization return in %s",
    async (locale) => {
      await setLocale(locale);
      const post = vi.spyOn(queryApi, "apiRequest").mockResolvedValue({ connections: [{}] });
      const codeField = locale === "ar" ? "entity_id" : "code";
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState(
        {},
        "",
        `/bank-feeds/callback?${codeField}=fixture-code&state=${state}&provider=lean`
      );
      await act(async () => root.render(createElement(StrictMode, null, createElement(BankFeeds))));
      expect(post).toHaveBeenCalledExactlyOnceWith(
        "POST",
        "/api/companies/fixture-company/bank-connections/callback",
        { code: "fixture-code", state },
        undefined,
        { queueWhenOffline: false }
      );
      expect(bankFeedCallbackBody.parse(post.mock.calls[0][2])).toEqual({
        code: "fixture-code",
        state,
      });
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds");
      expect(container.textContent).toContain(bankStatementCopy[locale]);
    }
  );

  it.each(["en", "ar"] as const)(
    "keeps an unsubmitted return through a workspace retry in %s",
    async (locale) => {
      await setLocale(locale);
      const post = vi.spyOn(queryApi, "apiRequest").mockResolvedValue({ connections: [{}] });
      const render = () => root.render(createElement(StrictMode, null, createElement(BankFeeds)));
      Object.assign(workspace, {
        companyId: undefined,
        isLoading: false,
        error: new Error("temporary"),
      });
      const retry = vi
        .spyOn(queryApi.queryClient, "refetchQueries")
        .mockImplementation(async () => {
          Object.assign(workspace, { companyId: "fixture-company", error: null });
          render();
        });
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState({}, "", `/bank-feeds/callback?code=fixture-code&state=${state}`);
      await act(async () => render());
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds/callback");
      expect(post).not.toHaveBeenCalled();
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnWorkspaceError"]
      );
      const button = container.querySelector("button");
      expect(button?.textContent).toBe(t[locale]["banking.feeds.returnRetry"]);
      await act(async () => button!.click());
      expect(retry).toHaveBeenCalledOnce();
      expect(post).toHaveBeenCalledOnce();
      expect(bankFeedCallbackBody.parse(post.mock.calls[0][2])).toEqual({
        code: "fixture-code",
        state,
      });
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds");
    }
  );

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
      await act(async () => root.render(createElement(BankFeeds)));
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnCancelled"]
      );
      expect(window.location.pathname + window.location.search).toBe("/bank-feeds/callback");
      expect(container.textContent).toContain(bankStatementCopy[locale]);
      expect(post).not.toHaveBeenCalled();
    }
  );

  it.each(["en", "ar"] as const)(
    "shows a localized failure after a rejected return in %s",
    async (locale) => {
      await setLocale(locale);
      const post = vi.spyOn(queryApi, "apiRequest").mockRejectedValue(new Error("fixture denial"));
      const state = randomBytes(32).toString("base64url");
      window.history.replaceState({}, "", `/bank-feeds/callback?code=fixture-code&state=${state}`);
      await act(async () => root.render(createElement(BankFeeds)));
      expect(post).toHaveBeenCalledOnce();
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        t[locale]["banking.feeds.returnError"]
      );
      expect(container.textContent).not.toContain("fixture denial");
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

it("keeps the configured example on the application's registered authorization path", () => {
  const fixture = readFileSync(".env.example", "utf8").match(/^# BANK_FEED_REDIRECT_URIS=(\S+)/m);
  expect(fixture).not.toBeNull();
  expect(new URL(fixture![1]).pathname).toBe(BANK_AUTHORIZATION_RETURN_PATH);
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
    "docs/archive/root/muhasibaisource20260611-audit.md",
    "docs/archive/root/Digits-Platform-Research.md",
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
    expect(text).not.toMatch(prohibitedCopy);
    expect(text).not.toMatch(/bank connect\/sync/i);
  }
});
