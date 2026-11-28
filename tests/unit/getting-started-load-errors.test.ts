// @vitest-environment jsdom
/**
 * Getting started: a step whose records failed to load must say "couldn't check" (with one
 * Retry), never "not done"; a role without access (403) does not see the step; a first load is
 * neutral; and a step with records is done. Progress counts only the steps that could be checked.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadLocale, useI18n, useTranslation } from "../../client/src/lib/i18n";
import { ApiError } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const net = vi.hoisted(() => ({ respond: (_path: string): unknown => null }));
vi.mock("../../client/src/lib/queryClient", async (orig) => {
  const actual = await orig<typeof import("../../client/src/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: async (_m: string, url: string) => (net.respond(url) as { ok: unknown }).ok,
  };
});
vi.mock("../../client/src/hooks/useReadOnlyPlanCta", () => ({ useReadOnlyPlanCta: () => null }));
vi.mock("../../client/src/components/einvoice/use-einvoice", () => ({
  useEInvoiceReadiness: () => ({ data: undefined }),
}));

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

let root: Root | null = null;
let node: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  node?.remove();
  root = null;
  node = null;
  useI18n.setState({ locale: "en" });
});

const ok = (data: unknown) => ({ ok: data });
const settle = async (n = 20) => {
  for (let i = 0; i < n; i++)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};
const tid = (id: string) => node!.querySelector(`[data-testid="${id}"]`);

type Responder = (path: string) => unknown;

async function mount(locale: "en" | "ar", responder: Responder) {
  const { GettingStarted } = await import("../../client/src/pages/dashboard/GettingStarted");
  useI18n.setState({ locale });
  net.respond = responder;
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const r = responder(queryKey.filter(Boolean).join("/"));
          if (r === "fail") throw new ApiError("Server exploded", 500, {});
          if (r === "forbid") throw new ApiError("Forbidden", 403, {});
          if (r === "hang") return new Promise(() => {});
          return (r as { ok: unknown }).ok;
        },
      },
    },
  });
  const Host: ComponentType = () => {
    const { t } = useTranslation();
    const m = { t, selectedCompanyId: "c1", recentInvoices: [], company: null };
    return createElement(GettingStarted as ComponentType<Record<string, unknown>>, {
      m,
      alwaysShow: true,
    });
  };
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  const { hook } = memoryLocation({ path: "/" });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, { hook }, createElement(Host))
      )
    );
  });
  await settle();
  return client;
}

// Default: every list loads and is empty, except the overrides.
const lists =
  (over: Record<string, unknown>): Responder =>
  (p) => {
    for (const [key, v] of Object.entries(over)) if (p.includes(key)) return v;
    return ok([]);
  };

describe.each(["en", "ar"] as const)("Getting started load errors (%s)", (locale) => {
  const couldntCheck = locale === "en" ? "Couldn't check" : "تعذّر التحقق";

  it("failed bills query: the bill step says couldn't check with one Retry, not 'not done'", async () => {
    await mount(locale, lists({ "/bills": "fail" }));
    const unknown = tid("getting-started-unknown-bill");
    expect(unknown).not.toBeNull();
    expect(unknown!.textContent).toBe(couldntCheck);
    // No "about N min" not-done chip on that step.
    expect(tid("getting-started-minutes-bill")).toBeNull();
    // The steps that did load stay "not done".
    expect(tid("getting-started-minutes-customer")).not.toBeNull();
    expect(node!.querySelectorAll("[data-testid='button-getting-started-retry']").length).toBe(1);
    expect(node!.textContent).not.toContain("Server exploded");
  });

  it("failed contacts and receipts queries: both steps are unknown and one Retry refetches them", async () => {
    let contactCalls = 0;
    await mount(locale, (p) => {
      if (p.includes("customer-contacts")) {
        contactCalls++;
        return contactCalls === 1 ? "fail" : ok([{ id: "k1" }]);
      }
      if (p.includes("/receipts")) return "fail";
      return ok([]);
    });
    expect(tid("getting-started-unknown-customer")).not.toBeNull();
    expect(tid("getting-started-unknown-bill")).not.toBeNull();
    await act(async () => {
      (tid("button-getting-started-retry") as HTMLButtonElement).click();
    });
    await settle();
    // Contacts recovered: the customer step is now done; receipts still fail.
    expect(tid("getting-started-unknown-customer")).toBeNull();
    expect(tid("getting-started-minutes-customer")).toBeNull();
    expect(tid("getting-started-unknown-bill")).not.toBeNull();
  });

  it("progress excludes steps that could not be checked", async () => {
    await mount(locale, lists({ "/bills": "fail", "customer-contacts": ok([{ id: "k1" }]) }));
    const text = node!.textContent ?? "";
    // 1 done (customer) of 4 checkable (invoice, customer, bank, vat); the bill step is excluded.
    expect(text).toMatch(locale === "en" ? /1 of 4/ : /1.*4/);
    expect(tid("getting-started-unknown-note")).not.toBeNull();
  });

  it("403 on the bills and receipts lists: the step is not shown as not done", async () => {
    await mount(locale, lists({ "/bills": "forbid", "/receipts": "forbid" }));
    expect(tid("getting-started-bill")).toBeNull();
    expect(tid("getting-started-minutes-bill")).toBeNull();
    expect(tid("getting-started-unknown-bill")).toBeNull();
    expect(tid("button-getting-started-retry")).toBeNull();
    // Other steps are untouched.
    expect(tid("getting-started-minutes-customer")).not.toBeNull();
  });

  it("first load is neutral: no not-done chip and no couldn't-check while the lists are pending", async () => {
    await mount(
      locale,
      lists({ "customer-contacts": "hang", "/bills": "hang", "/receipts": "hang" })
    );
    expect(tid("getting-started-customer")).not.toBeNull();
    expect(tid("getting-started-minutes-customer")).toBeNull();
    expect(tid("getting-started-minutes-bill")).toBeNull();
    expect(tid("getting-started-unknown-customer")).toBeNull();
    expect(tid("button-getting-started-retry")).toBeNull();
  });

  it("success with records: the step is done, with no chip", async () => {
    await mount(locale, lists({ "/bills": ok([{ id: "b1" }]) }));
    expect(tid("getting-started-bill")).not.toBeNull();
    expect(tid("getting-started-minutes-bill")).toBeNull();
    expect(tid("getting-started-unknown-bill")).toBeNull();
    expect(tid("getting-started-minutes-customer")).not.toBeNull();
  });

  it("a bill step with records stays done when the receipts list fails", async () => {
    await mount(locale, lists({ "/bills": ok([{ id: "b1" }]), "/receipts": "fail" }));
    expect(tid("getting-started-unknown-bill")).toBeNull();
    expect(tid("getting-started-minutes-bill")).toBeNull();
  });
});
