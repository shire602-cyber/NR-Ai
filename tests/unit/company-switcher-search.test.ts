// @vitest-environment jsdom
/**
 * Firm audit defect 15: with many companies the switcher gets a search box; typing a name
 * narrows the list to the match, and firm users get a link to the full client list.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companies = Array.from({ length: 61 }, (_, i) => ({
  id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  name: i === 42 ? "Zafaran Gold Trading LLC" : `Client Company ${i}`,
  companyType: "client",
}));

vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ company: companies[0] }),
}));
vi.mock("../../client/src/components/ActiveCompanyProvider", () => ({
  useActiveCompany: () => ({ isFirmContext: true, clearActiveClientCompany: vi.fn() }),
}));
vi.mock("../../client/src/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { id: "u1", firmRole: "firm_owner", userType: "customer" } }),
}));

let container: HTMLDivElement;
let root: Root;
let qc: QueryClient;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await loadLocale("en");
});
beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["/api/companies"], companies);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("company switcher search", () => {
  it("filters 61 companies to the typed match and links to all clients", async () => {
    const { CompanySwitcher } = await import("../../client/src/components/CompanySwitcher");
    const { TooltipProvider } = await import("../../client/src/components/ui/tooltip");
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(TooltipProvider, null, createElement(CompanySwitcher))
        )
      );
    });
    const trigger = container.querySelector(
      '[data-testid="button-company-switcher"]'
    ) as HTMLElement;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })
      );
    });
    const items = () => document.querySelectorAll('[data-testid^="company-switcher-item-"]');
    expect(items().length).toBe(61);
    const search = document.querySelector(
      '[data-testid="company-switcher-search"]'
    ) as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(document.querySelector('[data-testid="company-switcher-all-clients"]')).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(search, "zafaran");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(items().length).toBe(1);
    expect(items()[0].textContent).toContain("Zafaran Gold");
  });
});
