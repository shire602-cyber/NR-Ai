// @vitest-environment jsdom
/**
 * A failed load must not read as "nothing here": the invoice-template editor shows the shared load
 * error (and offers no Save, so no duplicate blank default is created), and the reminder rules and
 * automatic-email log show an error with retry instead of the empty state / disappearing.
 */
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { ApiError } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const net = vi.hoisted(() => ({ writes: [] as string[], bodies: [] as unknown[] }));
vi.mock("../../client/src/lib/queryClient", async (orig) => {
  const actual = await orig<typeof import("../../client/src/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: async (m: string, url: string, body?: unknown) => {
      net.writes.push(`${m} ${url}`);
      net.bodies.push(body);
      return { id: "new1" };
    },
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({
    companyId: "c1",
    companies: [],
    company: { id: "c1", name: "Acme", legalName: "Acme LLC", baseCurrency: "AED" },
    isLoading: false,
  }),
}));
vi.mock("../../client/src/hooks/useSubscription", () => ({
  useSubscription: () => ({
    canAccess: () => true,
    getRequiredTier: () => "pro",
    isLoading: false,
  }),
}));
vi.mock("../../client/src/components/layout/SettingsLayout", () => ({
  SettingsLayout: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));
vi.mock("../../client/src/components/invoices/InvoicePreview", () => ({
  InvoicePreview: () => null,
}));

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

let root: Root | null = null;
let node: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  node?.remove();
  root = null;
  node = null;
  net.writes.length = 0;
  net.bodies.length = 0;
  useI18n.setState({ locale: "en" });
});

const settle = async (n = 20) => {
  for (let i = 0; i < n; i++)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
};

async function mount(
  Component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  locale: "en" | "ar",
  responder: (path: string) => unknown
) {
  useI18n.setState({ locale });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const r = responder(queryKey.filter(Boolean).join("/"));
          if (r === "fail") throw new ApiError("Server exploded", 500, {});
          return r;
        },
      },
    },
  });
  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
  const { hook } = memoryLocation({ path: "/" });
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, { hook }, createElement(Component, props))
      )
    );
  });
  await settle();
  return client;
}

const tid = (id: string) => node!.querySelector(`[data-testid="${id}"]`);

describe.each(["en", "ar"] as const)("Templates and reminders load errors (%s)", (locale) => {
  it("invoice templates: a failed load shows the error and offers no Save or POST", async () => {
    const { default: InvoiceTemplates } = await import("../../client/src/pages/InvoiceTemplates");
    await mount(InvoiceTemplates as never, {}, locale, (p) =>
      p.includes("invoice-templates") ? "fail" : []
    );
    expect(tid("invoice-templates-load-error")).not.toBeNull();
    expect(tid("button-save-template")).toBeNull();
    expect(node!.textContent).not.toContain("Server exploded");
    expect(net.writes.filter((w) => w.startsWith("POST"))).toEqual([]);
  });

  it("invoice templates: a successful load keeps the editor and Save", async () => {
    const { default: InvoiceTemplates } = await import("../../client/src/pages/InvoiceTemplates");
    await mount(InvoiceTemplates as never, {}, locale, (p) =>
      p.includes("invoice-templates")
        ? [{ id: "t1", name: "Std", isDefault: true, primaryColor: "#112233" }]
        : []
    );
    expect(tid("invoice-templates-load-error")).toBeNull();
    const save = tid("button-save-template") as HTMLButtonElement | null;
    expect(save).not.toBeNull();
    expect(save!.disabled).toBe(false);
  });

  it("invoice templates: an empty loaded list enables Save, which creates a template then sets it default", async () => {
    const { default: InvoiceTemplates } = await import("../../client/src/pages/InvoiceTemplates");
    await mount(InvoiceTemplates as never, {}, locale, () => []);
    expect(tid("invoice-templates-load-error")).toBeNull();
    const save = tid("button-save-template") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await settle();
    expect(net.writes).toEqual([
      "POST /api/companies/c1/invoice-templates",
      "POST /api/invoice-templates/new1/set-default",
    ]);
    const created = net.bodies[0] as { layout: string; primaryColor: string };
    expect(created.layout).toBe("standard");
    expect(created.primaryColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("invoice templates: a failed refetch keeps the editor and saves onto the cached default", async () => {
    const { default: InvoiceTemplates } = await import("../../client/src/pages/InvoiceTemplates");
    let failing = false;
    const client = await mount(InvoiceTemplates as never, {}, locale, (p) =>
      p.includes("invoice-templates")
        ? failing
          ? "fail"
          : [{ id: "t1", name: "Std", isDefault: true, primaryColor: "#112233" }]
        : []
    );
    failing = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: ["/api/companies", "c1", "invoice-templates"] });
    });
    await settle();
    expect(client.getQueryState(["/api/companies", "c1", "invoice-templates"])?.status).toBe(
      "error"
    );
    expect(tid("invoice-templates-load-error")).toBeNull();
    const save = tid("button-save-template") as HTMLButtonElement;
    expect(save).not.toBeNull();
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await settle();
    expect(net.writes).toEqual(["PUT /api/invoice-templates/t1"]);
    expect((net.bodies[0] as { primaryColor: string }).primaryColor).toBe("#112233");
  });

  it("reminders: after a failed rules load the Add rule button is disabled", async () => {
    const { AutomaticEmailRules } = await import("../../client/src/pages/Reminders");
    await mount(AutomaticEmailRules as never, { companyId: "c1" }, locale, (p) =>
      p.includes("reminders") || p.includes("reminder-settings") ? "fail" : { configured: true }
    );
    const add = tid("button-create-reminder") as HTMLButtonElement | null;
    expect(add).not.toBeNull();
    expect(add!.disabled).toBe(true);
  });

  it("reminders: failed rules load shows the error, not the empty state", async () => {
    const { AutomaticEmailRules } = await import("../../client/src/pages/Reminders");
    await mount(AutomaticEmailRules as never, { companyId: "c1" }, locale, (p) =>
      p.includes("reminders") || p.includes("reminder-settings") ? "fail" : { configured: true }
    );
    expect(tid("reminder-rules-load-error")).not.toBeNull();
    expect(node!.querySelector('[data-testid="empty-state"]')).toBeNull();
  });

  it("reminders: an empty rules list still shows the empty state", async () => {
    const { AutomaticEmailRules } = await import("../../client/src/pages/Reminders");
    await mount(AutomaticEmailRules as never, { companyId: "c1" }, locale, (p) =>
      p.includes("status") ? { configured: true } : []
    );
    expect(tid("reminder-rules-load-error")).toBeNull();
    expect(tid("empty-state")).not.toBeNull();
    expect((tid("button-create-reminder") as HTMLButtonElement).disabled).toBe(false);
  });

  it("automatic email log: a failed load shows a compact error", async () => {
    const { AutomaticEmailLog } = await import("../../client/src/pages/Reminders");
    await mount(AutomaticEmailLog as never, { companyId: "c1" }, locale, () => "fail");
    expect(tid("reminder-log-load-error")).not.toBeNull();
  });

  it("automatic email log: an empty log still renders nothing", async () => {
    const { AutomaticEmailLog } = await import("../../client/src/pages/Reminders");
    await mount(AutomaticEmailLog as never, { companyId: "c1" }, locale, () => []);
    expect(node!.textContent).toBe("");
  });
});
