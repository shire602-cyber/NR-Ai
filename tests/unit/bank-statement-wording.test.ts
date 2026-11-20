// @vitest-environment jsdom
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { act, createElement, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { unzipSync } from "fflate";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import NotificationPreferences from "../../client/src/pages/NotificationPreferences";
import { loadLocale, t, useI18n } from "../../client/src/lib/i18n";
import { bankStatementCopy, bankStatementTitle } from "../../shared/bank-statement-copy";
import { withNotificationCopy } from "../../shared/server-copy";

vi.mock("@/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: PropsWithChildren) => children,
}));

const prohibitedCopy =
  /\bbank[- ]feeds?\b|\blive (?:bank )?feeds?\b|\bopen[- ]banking\b|connect your bank|reconnect|الربط البنكي|مزامنة (?:الحساب|الخلاصة) البنكي/i;

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
      for (const path of ["/bank-feeds", "/bank-feeds/callback?code=fixture&state=fixture"]) {
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
    "docs/archive/root/muhasibaisource20260611-audit.md",
    "docs/security/data-map.md",
  ]) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(prohibitedCopy);
  }
  const roadmap = "docs/archive/root/Muhasib-Netmara-Audit-and-Competitive-Roadmap";
  const docx = unzipSync(readFileSync(`${roadmap}.docx`));
  const source = Buffer.from(docx["word/document.xml"])
    .toString("utf8")
    .replace(/<[^>]+>/g, " ");
  const pdf = execFileSync("pdftotext", [`${roadmap}.pdf`, "-"], { encoding: "utf8" });
  for (const contents of [source, pdf]) {
    const text = contents.replace(/\s+/g, " ");
    expect(text).toContain(bankStatementCopy.en);
    expect(text).not.toMatch(prohibitedCopy);
  }
});
