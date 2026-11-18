// @vitest-environment jsdom
/**
 * AS1 (Fable sign-off 2) on the client: an answer renders its amounts with <Money> (two
 * decimals, grouping, "د.إ" after the figure in Arabic, one isolated unit), never shows a
 * citation marker or an ISO date, labels its facts in both languages with source chips, and a
 * partial answer shows what is missing with a link. Also F1 (no red toast behind the upgrade
 * prompt) and F3 (notification dates in the app format).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));

let container: HTMLDivElement;
let root: Root;
let answer: unknown;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const OVERDUE_ANSWER = {
  response: "Two invoices are overdue.",
  segments: [
    { type: "text", text: "Two invoices are overdue, worth " },
    { type: "money", value: 10000, currency: "AED" },
    { type: "text", text: ". INV-2026-00003 was due 2026-10-03." },
  ],
  figures: [
    {
      id: "F4",
      key: "overdueInvoicesTotal",
      value: 10000,
      unit: "AED",
      params: { date: "2026-11-18" },
      source: { key: "invoices", href: "/invoices" },
    },
    {
      id: "F6",
      key: "invoiceOverdue",
      value: 9000,
      unit: "AED",
      params: { number: "INV-2026-00003", name: "Gulf Foods", due: "2026-10-03", days: 46 },
      source: { key: "invoices", href: "/invoices" },
    },
    {
      id: "F9",
      key: "vatNet",
      value: 540,
      unit: "AED",
      params: { from: "2026-10-01", to: "2026-12-31", due: "2027-01-28" },
      source: { key: "vat", href: "/vat-filing" },
    },
  ],
  missing: [],
  timestamp: "2026-11-18T10:00:00Z",
};

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  answer = OVERDUE_ANSWER;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/ai/status")) return json({ configured: true });
      if (url.includes("dashboard/stats")) return json({ outstanding: 1200 });
      if (url.includes("/ai/nl-gateway")) return json(answer);
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale("en"));
});

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function ask(locale: "en" | "ar") {
  const { useI18n } = await import("../../client/src/lib/i18n");
  act(() => useI18n.getState().setLocale(locale));
  const { queryClient } = await import("../../client/src/lib/queryClient");
  const { default: AskPanel } = await import("../../client/src/pages/assistant/AskPanel");
  queryClient.clear();
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, createElement(AskPanel))
    );
  });
  await flush();
  const chip = container.querySelector<HTMLButtonElement>(
    '[data-testid="assistant-suggestions"] button'
  );
  await act(async () => chip!.click());
  await flush();
}

describe("AS1 answer rendering", () => {
  it("A2/A3: English amounts through Money, no markers, dates in the app format", async () => {
    await ask("en");
    const text = container.querySelector('[data-testid="assistant-answer-text"]')!;
    expect(text.textContent).not.toMatch(/\[F\d/);
    expect(text.textContent).toContain("was due 3 Oct 2026");
    expect(text.textContent).not.toContain("2026-10-03");
    expect(text.textContent).toContain("INV-2026-00003");
    const money = text.querySelector(".money-figure")!;
    expect([...money.children].map((c) => c.textContent)).toEqual(["AED", "10,000.00"]);
    // `.money-figure` is `white-space: nowrap; unicode-bidi: isolate` (index.css).
    expect(money.classList.contains("money-figure")).toBe(true);
  });

  it("A4: facts are labelled from the catalog, with source chips per report", async () => {
    await ask("en");
    const rows = [...container.querySelectorAll('[data-testid="assistant-figures"] th')].map(
      (th) => th.textContent
    );
    expect(rows).toEqual([
      "Overdue invoices, total",
      "INV-2026-00003 · Gulf Foods, due 3 Oct 2026, 46 days late",
      "VAT to pay, 1 Oct – 31 Dec 2026 (due 28 Jan 2027)",
    ]);
    const links = [
      ...container.querySelectorAll<HTMLAnchorElement>('[data-testid="assistant-sources"] a'),
    ].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(links).toEqual([
      ["/invoices", "Invoices"],
      ["/vat-filing", "VAT return"],
    ]);
  });

  it("A3: in Arabic the amount reads 10,000.00 د.إ as one isolated, unbreakable unit", async () => {
    await ask("ar");
    const money = container.querySelector(
      '[data-testid="assistant-answer-text"] .money-figure'
    ) as HTMLElement;
    expect(money.getAttribute("dir")).toBe("rtl");
    const [first, second] = [...money.children].map((c) => c.textContent);
    expect(first).toBe("10,000.00");
    expect(second).toBe("د.إ");
    const rows = [...container.querySelectorAll('[data-testid="assistant-figures"] th')].map(
      (th) => th.textContent ?? ""
    );
    expect(rows[0]).toBe("الفواتير المتأخرة، الإجمالي");
    expect(rows[1]).toContain("أكتوبر");
    expect(rows.join(" ")).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("A1/A4: a partial answer shows its figures and says what is missing, with a link", async () => {
    answer = {
      response: "Your VAT registration number is not set.",
      segments: [{ type: "text", text: "Your VAT registration number is not set." }],
      figures: [OVERDUE_ANSWER.figures[2]],
      missing: [{ key: "vatNotSetUp", href: "/settings/company" }],
      timestamp: "2026-11-18T10:00:00Z",
    };
    await ask("en");
    expect(container.querySelector('[data-testid="assistant-figures"]')).not.toBeNull();
    const missing = container.querySelector('[data-testid="assistant-missing"]')!;
    expect(missing.textContent).toContain("TRN");
    expect(missing.querySelector("a")?.getAttribute("href")).toBe("/settings/company");
    expect(container.textContent).not.toMatch(/consult|professional/i);
  });

  it("older answers without segments still lose their markers", async () => {
    answer = {
      response: "Revenue so far is AED 12,000 [F1].",
      citations: [{ id: "F1", label: "Revenue (fiscal year to date)", value: 12000, unit: "AED" }],
      timestamp: "2026-11-17T10:00:00Z",
    };
    await ask("en");
    const text = container.querySelector('[data-testid="assistant-answer-text"]')!;
    expect(text.textContent).toBe("Revenue so far is AED 12,000.");
  });
});

describe("F1 plan refusal: one upgrade prompt, no red toast", () => {
  it("drops a destructive toast raised right after a plan refusal; keeps the others", async () => {
    const { announcePlanLimit, planLimitJustAnnounced, PLAN_LIMIT_TOAST_WINDOW_MS } =
      await import("../../client/src/lib/plan-limit");
    const { toast, useToast } = await import("../../client/src/hooks/use-toast");
    let state: ReturnType<typeof useToast> | null = null;
    function Probe() {
      state = useToast();
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    announcePlanLimit({ code: "PLAN_REQUIRED" });
    expect(planLimitJustAnnounced()).toBe(true);
    act(() => {
      toast({ title: "Failed to create contact", variant: "destructive" });
    });
    expect(state!.toasts.filter((x) => x.open)).toHaveLength(0);
    act(() => {
      toast({ title: "Saved" });
    });
    expect(state!.toasts.map((x) => x.title)).toEqual(["Saved"]);
    expect(planLimitJustAnnounced(Date.now() + PLAN_LIMIT_TOAST_WINDOW_MS + 1)).toBe(false);
  });

  it("the data-safe line sits in the dialog header, which never shrinks", async () => {
    const { PlanLimitDialog } = await import("../../client/src/components/billing/PlanLimitDialog");
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { announcePlanLimit } = await import("../../client/src/lib/plan-limit");
    await act(async () =>
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(PlanLimitDialog))
      )
    );
    act(() => announcePlanLimit({ code: "PLAN_REQUIRED" }));
    await flush();
    const line = document.querySelector('[data-testid="plan-limit-data-safe"]') as HTMLElement;
    expect(line.textContent).toBe("Nothing is deleted.");
    expect(line.parentElement?.className).toContain("shrink-0");
  });
});

describe("F3 notification dates", () => {
  it("formats ISO date params and stored English dates in both languages", async () => {
    const { localizeNotification } = await import("../../client/src/lib/notification-display");
    const en = (await import("../../client/src/locales/en/components.json")).default as Record<
      string,
      string
    >;
    const ar = (await import("../../client/src/locales/ar/components.json")).default as Record<
      string,
      string
    >;
    const n = {
      title: "VAT return due 2026-10-28",
      message: "The VAT return for the period ending 2026-09-30 is due on 2026-10-28.",
    };
    const viewEn = localizeNotification(n, en, "en");
    expect(viewEn.title).toBe("VAT return due 28 Oct 2026");
    expect(viewEn.message).toContain("period ending 30 Sep 2026 is due on 28 Oct 2026");
    const viewAr = localizeNotification(n, ar, "ar");
    expect(`${viewAr.title} ${viewAr.message}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(viewAr.title).toContain("أكتوبر");
  });
});
