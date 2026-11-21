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
    importAction: "Import a statement",
  },
  {
    locale: "ar",
    statements: "استيراد كشوف الحسابات البنكية",
    importAction: "استيراد كشف",
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

describe.each(localeCases)("signed-in bank page ($locale)", (copy) => {
  it.each([false, true])(
    "offers only statement import when provider configuration is %s",
    async (configured) => {
      const read = vi.fn(async ({ queryKey }: QueryFunctionContext) => {
        if (queryKey[0] === "/api/bank/providers")
          return {
            isConfigured: configured,
            statuses: [{ id: "lean", label: "Lean", configured, status: "sandbox" }],
            redirectUris: [],
          };
        if (queryKey[2] === "bank-accounts")
          return [{ id: "linked", nameEn: "Operating account", nameAr: "الحساب التشغيلي" }];
        return [
          { id: "connection-1", provider: "lean", bankAccountId: "linked", status: "active" },
        ];
      });
      await mountPage(copy.locale, read, (node) => {
        const link = node.querySelector('[data-testid="button-feeds-import-statement"]');
        expect(link?.getAttribute("href")).toBe("/bank-reconciliation?import=1");
        expect(link?.textContent).toBe(copy.importAction);
        expect(node.querySelector("h1")?.textContent).toBe(copy.statements);
        expect(document.title).toBe(copy.statements);
        expect(node.querySelectorAll("button")).toHaveLength(0);
        expect(node.textContent).not.toMatch(/bank\s+feeds?|bank connections|الربط البنكي/i);
        expect(read).not.toHaveBeenCalled();
      });
    }
  );
});
