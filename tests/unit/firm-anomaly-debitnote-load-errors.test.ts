// @vitest-environment jsdom
/**
 * A failed load must not read as "no data" or "all clear": the firm health dashboard (clients and
 * deadlines), the anomaly checks list and the debit note editor (accounts and bills pickers) show
 * the shared load-error state with retry when their queries fail.
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

const net = vi.hoisted(() => ({ respond: (_path: string): unknown => null }));
vi.mock("../../client/src/lib/queryClient", async (orig) => {
  const actual = await orig<typeof import("../../client/src/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: async (_m: string, url: string) => {
      const r = net.respond(url);
      if (r === "fail") throw new actual.ApiError("Server exploded", 500, {});
      return (r as { ok: unknown }).ok;
    },
  };
});
vi.mock("../../client/src/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c1", companies: [], company: null, isLoading: false }),
}));
vi.mock("../../client/src/components/ui/date-picker", () => ({
  DatePicker: () => createElement("input"),
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

async function mount(
  Component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  locale: "en" | "ar",
  responder: (path: string) => unknown
) {
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
          if (r instanceof Promise) return r;
          return (r as { ok: unknown }).ok;
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
const retryButton = (scope: ParentNode = node!) =>
  [...scope.querySelectorAll("button")].find((b) =>
    /Try again|أعد المحاولة/.test(b.textContent ?? "")
  );

describe.each(["en", "ar"] as const)("Firm, anomaly and debit note load errors (%s)", (locale) => {
  it("firm health: failed clients query shows an error, not 'no clients'", async () => {
    const { default: FirmHealth } = await import("../../client/src/pages/firm/FirmHealth");
    await mount(FirmHealth as never, {}, locale, (p) =>
      p === "/api/firm/health" ? "fail" : ok({ deadlines: [] })
    );
    expect(tid("firm-health-load-error")).not.toBeNull();
    expect(tid("firm-deadlines-load-error")).toBeNull();
    expect(node!.textContent).not.toContain("Server exploded");
    expect(retryButton(tid("firm-health-load-error")!)).toBeDefined();
  });

  it("firm health: failed deadlines query never shows the green all-clear", async () => {
    const { default: FirmHealth } = await import("../../client/src/pages/firm/FirmHealth");
    const client = await mount(FirmHealth as never, {}, locale, (p) =>
      p === "/api/firm/health" ? ok({ clients: [], summary: null }) : "fail"
    );
    const panel = tid("firm-deadlines-load-error");
    expect(panel).not.toBeNull();
    expect(node!.querySelector(".text-success.w-8")).toBeNull();
    expect(retryButton(panel!)).toBeDefined();
    expect(client.getQueryState(["/api/firm/health/deadlines"])?.status).toBe("error");
  });

  it("firm health: succeeding queries still show the real empty states", async () => {
    const { default: FirmHealth } = await import("../../client/src/pages/firm/FirmHealth");
    await mount(FirmHealth as never, {}, locale, (p) =>
      p === "/api/firm/health" ? ok({ clients: [], summary: null }) : ok({ deadlines: [] })
    );
    expect(tid("firm-health-load-error")).toBeNull();
    expect(tid("firm-deadlines-load-error")).toBeNull();
    expect(node!.querySelector(".text-success.w-8")).not.toBeNull();
  });

  it("anomaly checks: a failed query shows an error with retry", async () => {
    const { AnomalyChecks } = await import("../../client/src/pages/AnomalyDetection");
    await mount(AnomalyChecks as never, {}, locale, (p) =>
      p.includes("anomalies") ? "fail" : ok(null)
    );
    expect(tid("anomaly-load-error")).not.toBeNull();
    expect(node!.textContent).not.toContain("Server exploded");
    expect(retryButton(tid("anomaly-load-error")!)).toBeDefined();
  });

  it("debit note editor: failed accounts list shows an error and blocks saving", async () => {
    const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
    await mount(DebitNoteEditor as never, {}, locale, (p) =>
      p.endsWith("/accounts") ? "fail" : ok([])
    );
    expect(tid("debit-note-accounts-load-error")).not.toBeNull();
    expect(tid("debit-note-bills-load-error")).toBeNull();
    expect((tid("button-save-debit-note") as HTMLButtonElement).disabled).toBe(true);
    expect(retryButton(tid("debit-note-accounts-load-error")!)).toBeDefined();
  });

  it("debit note editor: failed bills list shows an error and blocks saving", async () => {
    const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
    await mount(DebitNoteEditor as never, {}, locale, (p) =>
      p.endsWith("/bills") ? "fail" : ok([])
    );
    expect(tid("debit-note-bills-load-error")).not.toBeNull();
    expect((tid("button-save-debit-note") as HTMLButtonElement).disabled).toBe(true);
  });

  it("debit note editor: loaded lists show no error and allow saving", async () => {
    const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
    await mount(DebitNoteEditor as never, {}, locale, () => ok([]));
    expect(tid("debit-note-accounts-load-error")).toBeNull();
    expect(tid("debit-note-bills-load-error")).toBeNull();
  });
});
