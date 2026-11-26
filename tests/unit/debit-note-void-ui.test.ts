// @vitest-environment jsdom
/**
 * Debit notes list: the Void action opens a confirmation dialog that needs a reason, posts it to
 * the void route, and a voided note shows no Void action (en and ar labels).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));
vi.mock("@/hooks/useCompanyPermission", () => ({
  useCompanyPermission: () => ({ can: () => true, gate: () => ({}) }),
}));

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ method: string; url: string; body: unknown }> = [];

const NOTES = [
  {
    id: "n-open",
    debit_note_number: "DN-1",
    vendor_name: "Supplier LLC",
    bill_id: null,
    note_date: "2026-03-01",
    currency: "AED",
    total_amount: "105.00",
    amount_applied: "0",
    status: "open",
    reason: "x",
  },
  {
    id: "n-void",
    debit_note_number: "DN-2",
    vendor_name: "Supplier LLC",
    bill_id: null,
    note_date: "2026-03-02",
    currency: "AED",
    total_amount: "50.00",
    amount_applied: "0",
    status: "void",
    reason: "y",
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/api/csrf-token")) return json({ csrfToken: "x" });
      if (method === "GET" && url.endsWith("/debit-notes")) return json(NOTES);
      if (method === "POST" && url.includes("/void")) return json({ ...NOTES[0], status: "void" });
      return json([]);
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  const { useI18n } = await import("../../client/src/lib/i18n");
  useI18n.getState().setLocale("en");
});

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mountList() {
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { default: DebitNotes } = await import("../../client/src/pages/DebitNotes");
  queryClient.clear();
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(DebitNotes))
    );
  });
  await flush();
}

describe("debit note void action", () => {
  it("shows Void only for a live note, requires a reason, and posts it", async () => {
    await mountList();
    expect(document.querySelector('[data-testid="button-void-debit-note-n-open"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="button-void-debit-note-n-void"]')).toBeNull();

    await act(async () => {
      (
        document.querySelector('[data-testid="button-void-debit-note-n-open"]') as HTMLButtonElement
      ).click();
    });
    await flush();
    expect(document.querySelector('[data-testid="void-debit-note-dialog"]')).not.toBeNull();
    const confirm = document.querySelector(
      '[data-testid="button-confirm-void-debit-note"]'
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const reason = document.querySelector(
      '[data-testid="void-debit-note-reason"]'
    ) as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(reason, "Entered by mistake");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    await flush();
    const post = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/debit-notes/n-open/void")
    );
    expect(post?.body).toEqual({ reason: "Entered by mistake" });
    expect(document.querySelector('[data-testid="void-debit-note-dialog"]')).toBeNull();
  });

  it("labels the action in Arabic", async () => {
    const { useI18n } = await import("../../client/src/lib/i18n");
    await act(async () => useI18n.getState().setLocale("ar"));
    await mountList();
    const btn = document.querySelector('[data-testid="button-void-debit-note-n-open"]');
    expect(btn?.getAttribute("aria-label")).toBe("إبطال");
  });
});
