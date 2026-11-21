// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, type QueryFunctionContext } from "@tanstack/react-query";
import { beforeAll, describe, expect, it, vi } from "vitest";
import BankFeeds from "../../client/src/pages/BankFeeds";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "company-1" }),
}));

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

const localeCases = [
  {
    locale: "en",
    statements: "Import bank statements",
    connections: "Bank connections",
    importAction: "Import a statement",
    connectAction: "Connect",
    syncAction: "Import transactions",
  },
  {
    locale: "ar",
    statements: "استيراد كشوف الحسابات البنكية",
    connections: "اتصالات الحسابات البنكية",
    importAction: "استيراد كشف",
    connectAction: "ربط",
    syncAction: "استيراد الحركات",
  },
] as const;

async function mountPage(
  locale: "en" | "ar",
  queryFn: (context: QueryFunctionContext) => Promise<unknown>,
  check: (node: HTMLDivElement) => void | Promise<void>
) {
  const client = new QueryClient({ defaultOptions: { queries: { queryFn, retry: false } } });
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  try {
    window.history.replaceState({}, "", "/bank-feeds");
    await act(async () => {
      useI18n.getState().setLocale(locale);
      root.render(createElement(QueryClientProvider, { client }, createElement(BankFeeds)));
    });
    await check(node);
  } finally {
    act(() => root.unmount());
    node.remove();
    client.clear();
    await act(async () => useI18n.getState().setLocale("en"));
  }
}

async function waitForElement(node: HTMLElement, selector: string): Promise<Element> {
  return vi.waitFor(async () => {
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    const element = node.querySelector(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    return element;
  });
}

describe.each(localeCases)("signed-in bank page ($locale)", (copy) => {
  it("shows statement import while loading and uses the real import action without a provider", async () => {
    let resolveProviders: (value: unknown) => void = () => {};
    const providers = new Promise((resolve) => {
      resolveProviders = resolve;
    });
    const read = vi.fn(async ({ queryKey }: QueryFunctionContext) =>
      queryKey[0] === "/api/bank/providers" ? providers : []
    );
    await mountPage(copy.locale, read, async (node) => {
      expect(node.querySelector("h1")?.textContent).toBe(copy.statements);
      expect(document.title).toBe(copy.statements);
      await act(async () =>
        resolveProviders({ isConfigured: false, statuses: [], redirectUris: [] })
      );
      const link = await waitForElement(node, '[data-testid="button-feeds-import-statement"]');
      expect(link.getAttribute("href")).toBe("/bank-reconciliation?import=1");
      expect(link.textContent).toBe(copy.importAction);
      expect(node.querySelector("h1")?.textContent).toBe(copy.statements);
      expect(document.title).toBe(copy.statements);
      expect(node.textContent).not.toMatch(/bank\s+feeds?/i);
      expect(read.mock.calls.map(([query]) => query.queryKey)).toEqual([["/api/bank/providers"]]);
    });
  });

  it("keeps connect and sync controls when a provider is configured", async () => {
    const read = async ({ queryKey }: QueryFunctionContext) => {
      if (queryKey[0] === "/api/bank/providers")
        return {
          isConfigured: true,
          statuses: [{ id: "lean", label: "Lean", configured: true, status: "sandbox" }],
          redirectUris: [],
        };
      if (queryKey[2] === "bank-accounts")
        return [
          { id: "linked", nameEn: "Operating account", nameAr: "الحساب التشغيلي" },
          { id: "unlinked", nameEn: "Current account", nameAr: "الحساب الجاري" },
        ];
      return [
        {
          id: "connection-1",
          provider: "lean",
          bankAccountId: "linked",
          status: "active",
        },
      ];
    };
    await mountPage(copy.locale, read, async (node) => {
      const connect = await waitForElement(node, '[data-testid="button-connect-unlinked"]');
      expect(node.querySelector("h1")?.textContent).toBe(copy.connections);
      expect(document.title).toBe(copy.connections);
      expect(connect.textContent).toBe(copy.connectAction);
      expect(
        node.querySelector('[data-testid="bank-feed-account-linked"] button')?.textContent
      ).toBe(copy.syncAction);
    });
  });
});
