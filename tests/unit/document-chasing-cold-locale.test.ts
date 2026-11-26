// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { loadLocaleForPath, setPublicBootScope, t, useI18n } from "../../client/src/lib/i18n";
import DocumentChasing from "../../client/src/pages/DocumentChasing";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", companyListState: "ready" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["en", "Document chasing autopilot"],
  ["ar", "الطيار الآلي لمتابعة المستندات"],
] as const)("loads the document-chasing catalog on a cold %s firm route", async (locale, title) => {
  window.history.replaceState(null, "", "/firm/document-chasing");
  setPublicBootScope(window.location.pathname);
  await loadLocaleForPath(locale, window.location.pathname);
  expect(t[locale]["documentChasing.documentChasingAutopilot"]).toBeUndefined();
  useI18n.getState().setLocale(locale);

  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: () => new Promise(() => undefined) } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(DocumentChasing)));
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector("h1")?.textContent).toBe(title);
    });
  } finally {
    act(() => root.unmount());
    client.clear();
    container.remove();
  }
});
