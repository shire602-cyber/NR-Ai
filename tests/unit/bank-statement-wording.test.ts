// @vitest-environment jsdom
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { act, createElement, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import NotificationPreferences from "../../client/src/pages/NotificationPreferences";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import * as queryApi from "../../client/src/lib/queryClient";
import { clearCsrfToken } from "../../client/src/lib/csrf";
import * as auth from "../../client/src/lib/auth";
import * as pwa from "../../client/src/lib/pwa";
import { establishAuthenticatedSession } from "../../client/src/lib/authSession";
import { bankStatementCopy, bankStatementTitle } from "../../shared/bank-statement-copy";
import { withNotificationCopy } from "../../shared/server-copy";
import { unsupportedStatementCopy } from "../helpers/statement-copy.mjs";

vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: PropsWithChildren) => children,
}));
const prohibitedCopy = new RegExp(
  `${unsupportedStatementCopy.source}|reconnect|thousands\\s+of\\s+financial\\s+institutions\\s+and\\s+tools`,
  "i"
);

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
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function setLocale(locale: "en" | "ar") {
    await loadLocale(locale);
    act(() => useI18n.getState().setLocale(locale));
  }

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

  it("checks offline status before fetching CSRF headers", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      queryApi.apiRequest("POST", "/api/fixture", {}, undefined, {
        queueWhenOffline: false,
      })
    ).rejects.toBeInstanceOf(queryApi.ApiRequestNotSentError);
    expect(fetch).not.toHaveBeenCalled();
  });

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
  expect(notice.title).toBe("Import a CSV bank statement");
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
    "client/src/components/ui/README.md",
    "client/src/locales/en/onboarding.json",
    "client/src/locales/ar/onboarding.json",
  ]) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toMatch(prohibitedCopy);
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

it("uses CSV guidance in the shared UI example and omits unverified firm metrics", () => {
  const example = readFileSync("client/src/components/ui/README.md", "utf8");
  expect(example).toContain('t["banking.feeds.unavailableBody"]');
  // These static pages and their README ship their copy as source.
  for (const file of ["index.html", "about.html", "industries.html", "README.md"]) {
    const copy = readFileSync(`sites/najma-al-raeda-website/${file}`, "utf8");
    expect(copy).not.toMatch(/(?:700|500|40)\+|98%/);
  }
});

it("keeps superseded banking terms out of tracked prose, comments, and fixtures", () => {
  // Read tracked text, including source comments and test data. Compatibility paths and
  // identifiers use hyphens or underscores; this scan checks the prose around them.
  const wording = [
    "(bank|live)[[:blank:]]+feeds?",
    "open[[:blank:]]+banking",
    "(re)?connect(s|ing)?[[:blank:]]+(a|their|your|the)[[:blank:]]+bank",
    "link(s|ing)?[[:blank:]]+(a|their|your)[[:blank:]]+bank",
    "feeds?[[:blank:]]+(sync|connection)",
    "bank[[:blank:]]+sync",
    "sync(s|ing)?[[:blank:]]+(a|the)[[:blank:]]+feed",
    "banking[[:blank:]]+embedded",
    "(account[[:blank:]]+is[[:blank:]]+already[[:blank:]]+connected|مرتبط[[:blank:]]+بالفعل)",
    "bank[[:blank:]]+connection[[:blank:]]+(deleted|created)",
    "الربط[[:blank:]]+(البنكي|المصرفي)",
    "مزامنة[[:blank:]]+(الحساب|الخلاصة)[[:blank:]]+البنكي",
    ["ADCB", "DIB", "ENBD", "FAB", "RAKBANK"].join(",[[:blank:]]+"),
  ].join("|");
  const result = spawnSync("git", ["grep", "-IinE", wording, "--", "."], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stdout || result.stderr).toBe(1);
});
