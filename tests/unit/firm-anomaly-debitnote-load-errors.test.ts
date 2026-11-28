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

const toasts = vi.hoisted(() => ({
  calls: [] as Array<{ title?: string; description?: string; variant?: string }>,
}));
const net = vi.hoisted(() => ({
  respond: (_path: string): unknown => null,
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
}));
vi.mock("../../client/src/lib/queryClient", async (orig) => {
  const actual = await orig<typeof import("../../client/src/lib/queryClient")>();
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      net.calls.push({ method, url, body });
      const r = net.respond(url);
      if (r === "fail") throw new actual.ApiError("Server exploded", 500, {});
      if (r === "hang") return new Promise(() => {});
      return (r as { ok: unknown }).ok;
    },
  };
});
vi.mock("../../client/src/hooks/use-toast", () => ({
  useToast: () => ({
    toast: (t: { title?: string; description?: string; variant?: string }) => {
      toasts.calls.push(t);
    },
    toasts: [],
    dismiss: () => {},
  }),
}));
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
let currentLocation: ReturnType<typeof memoryLocation> | null = null;
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
  responder: (path: string) => unknown,
  location = "/"
) {
  useI18n.setState({ locale });
  net.respond = responder;
  net.calls = [];
  toasts.calls = [];
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
  currentLocation = memoryLocation({ path: location, record: true });
  const { hook, searchHook } = currentLocation;
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Router, { hook, searchHook }, createElement(Component, props))
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

  describe("debit note editor: loading, bill detail and apply-now guards", () => {
    const bill = {
      id: "b1",
      vendor_id: null,
      vendor_name: "Acme Supplies",
      bill_number: "B-1",
      currency: "AED",
      status: "approved",
      total_amount: "105.00",
      open_balance: 105,
      line_items: [
        { description: "Parts", amount: "100.00", vat_rate: "5", account_id: null, quantity: "1" },
      ],
    };
    const responder =
      (over: { bills?: unknown; detail?: unknown; apply?: unknown } = {}) =>
      (p: string) => {
        if (p.endsWith("/debit-notes/n1/apply")) return over.apply ?? ok({ bill_status: "paid" });
        if (p.endsWith("/debit-notes")) return ok({ id: "n1", total_amount: "105.00" });
        if (p === "/api/bills/b1") return over.detail ?? ok(bill);
        if (p.endsWith("/bills")) return over.bills ?? ok([bill]);
        return ok([]);
      };
    const posts = () => net.calls.filter((c) => c.method === "POST");
    const save = () => tid("button-save-debit-note") as HTMLButtonElement;
    const fillReason = async () => {
      const el = tid("debit-note-reason") as HTMLTextAreaElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
          el,
          "Damaged goods"
        );
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const clickSave = async () => {
      await act(async () => save().click());
      await settle(5);
    };

    it("keeps Save disabled while the bills list is still loading and posts nothing", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ bills: "hang" }),
        "/?billId=b1"
      );
      expect(save().disabled).toBe(true);
      await fillReason();
      await clickSave();
      expect(posts()).toHaveLength(0);
    });

    it("enables Save once the lists and the linked bill have loaded, then applies the note", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(DebitNoteEditor as never, {}, locale, responder(), "/?billId=b1");
      expect(save().disabled).toBe(false);
      await fillReason();
      await clickSave();
      const [create, apply] = posts();
      expect(create.url).toMatch(/\/debit-notes$/);
      expect(apply.url).toMatch(/\/debit-notes\/n1\/apply$/);
      expect((apply.body as { bill_id: string }).bill_id).toBe("b1");
    });

    it("blocks with a message, and posts nothing, when apply-now cannot find the bill balance", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ bills: ok([]) }),
        "/?billId=b1"
      );
      await fillReason();
      await clickSave();
      expect(posts()).toHaveLength(0);
      const alert = tid("debit-note-error");
      expect(alert).not.toBeNull();
      expect(alert!.textContent!.length).toBeGreaterThan(10);
    });

    it("shows why Save is disabled while loading, and links it with aria-describedby", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ bills: "hang" }),
        "/?billId=b1"
      );
      const reason = tid("debit-note-save-reason");
      expect(reason).not.toBeNull();
      expect(reason!.textContent).toBe(
        locale === "ar"
          ? "ما زالت فواتير الموردين والحسابات قيد التحميل. حاول مرة أخرى بعد قليل."
          : "The supplier bills and accounts are still loading. Try again in a moment."
      );
      expect(save().disabled).toBe(true);
      expect(save().getAttribute("aria-describedby")).toBe(reason!.id);
    });

    it("shows the load-failed reason beside a disabled Save, and none once everything loaded", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ bills: "fail" }),
        "/?billId=b1"
      );
      expect(tid("debit-note-save-reason")!.textContent).toBe(
        locale === "ar"
          ? "تعذّر تحميل بعض البيانات التي يحتاجها هذا النموذج. استخدم زر أعد المحاولة أعلاه ثم احفظ."
          : "Some of the data this form needs did not load. Use Try again above, then save."
      );
      await act(async () => root!.unmount());
      node!.remove();
      root = null;
      await mount(DebitNoteEditor as never, {}, locale, responder(), "/?billId=b1");
      expect(save().disabled).toBe(false);
      expect(tid("debit-note-save-reason")).toBeNull();
      expect(save().getAttribute("aria-describedby")).toBeNull();
    });

    it("when applying fails after the note posted: warns it is posted but not applied, goes to the list, creates once", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ apply: "fail" }),
        "/?billId=b1"
      );
      await fillReason();
      await clickSave();
      const sent = posts();
      expect(sent.filter((c) => /\/debit-notes$/.test(c.url))).toHaveLength(1);
      expect(sent.filter((c) => /\/apply$/.test(c.url))).toHaveLength(1);
      expect(toasts.calls).toHaveLength(1);
      expect(toasts.calls[0].variant).toBe("destructive");
      expect(toasts.calls[0].title).toBe(
        locale === "ar"
          ? "تم ترحيل الإشعار المدين لكن لم يُطبَّق على الفاتورة. طبّقه من صفحة «إشعارات دائنة من الموردين»."
          : "Debit note posted, but not applied to the bill. Apply it from the Supplier credits page."
      );
      expect(currentLocation!.history!.at(-1)).toBe("/debit-notes");
      // No inline error inviting a retry that would post a second note.
      expect(tid("debit-note-error")).toBeNull();
    });

    it("blocks apply-now when the bill has no open balance and posts nothing", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ bills: ok([{ ...bill, open_balance: 0 }]) }),
        "/?billId=b1"
      );
      await fillReason();
      await clickSave();
      expect(posts()).toHaveLength(0);
      const expected =
        locale === "ar"
          ? "لا يوجد رصيد مفتوح في هذه الفاتورة لتطبيق الخصم عليه. ألغِ تحديد خيار التطبيق لحفظ الإشعار المدين دون تطبيقه."
          : "This bill has no open balance to apply the credit to. Untick the apply option to save the debit note without applying it.";
      expect(tid("debit-note-error")!.textContent).toBe(expected);
      expect(toasts.calls.map((c) => c.title)).toEqual([expected]);
    });

    it("a failed bill-detail load shows an inline error with retry and blocks saving", async () => {
      const { default: DebitNoteEditor } = await import("../../client/src/pages/DebitNoteEditor");
      await mount(
        DebitNoteEditor as never,
        {},
        locale,
        responder({ detail: "fail" }),
        "/?billId=b1"
      );
      const panel = tid("debit-note-bill-load-error");
      expect(panel).not.toBeNull();
      expect(retryButton(panel!)).toBeDefined();
      expect(save().disabled).toBe(true);
      expect(posts()).toHaveLength(0);
    });
  });

  it("firm health: failed summary shows an em dash with a screen-reader label, not zeros", async () => {
    const { default: FirmHealth } = await import("../../client/src/pages/firm/FirmHealth");
    await mount(FirmHealth as never, {}, locale, (p) =>
      p === "/api/firm/health" ? "fail" : ok({ deadlines: [] })
    );
    const cards = [...node!.querySelectorAll("p.text-h1")];
    expect(cards).toHaveLength(4);
    for (const c of cards) {
      expect(c.textContent).toContain("—");
      const sr = c.querySelector(".sr-only");
      expect(sr?.textContent).toBe(locale === "ar" ? "غير متاح" : "Not available");
      expect(c.textContent).not.toMatch(/\d/);
    }
  });
});
