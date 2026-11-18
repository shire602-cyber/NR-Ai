// @vitest-environment jsdom
/**
 * WP-E (spec 3.14) Assistant: one route with Ask · Review · Automations. Behaviour tests:
 * legacy hub tab ids land on their new tab, confidence is a word (never a percentage),
 * grounded figures are labelled in both languages with a report link, and the rendered
 * Ask panel shows the composer, no model id and no KPI tiles.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));

import {
  confidenceWord,
  presentFigure,
  resolveAssistantTab,
  sourcesFor,
} from "../../client/src/pages/assistant/model";

let container: HTMLDivElement;
let root: Root;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("dashboard/stats")) return json({ outstanding: 1200 });
      if (url.includes("/anomalies")) {
        return json({
          anomalies: [],
          summary: { total: 0, critical: 0, warning: 0, info: 0 },
          scannedAt: null,
        });
      }
      if (url.includes("/ai/nl-gateway")) {
        return json({
          response: "Revenue so far is AED 12,000 [F1].",
          citations: [
            { id: "F1", label: "Revenue (fiscal year to date)", value: 12000, unit: "AED" },
            { id: "F9", label: "Something new", value: 3, unit: "count" },
          ],
          timestamp: "2026-11-17T10:00:00Z",
        });
      }
      return json({});
    })
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("assistant model", () => {
  it("maps every legacy /ai hub tab to its replacement", () => {
    expect(resolveAssistantTab(null)).toBe("ask");
    expect(resolveAssistantTab("cfo")).toBe("ask");
    expect(resolveAssistantTab("chat")).toBe("ask");
    expect(resolveAssistantTab("assistant")).toBe("ask");
    expect(resolveAssistantTab("inbox")).toBe("review");
    expect(resolveAssistantTab("features")).toBe("automations");
    expect(resolveAssistantTab("review")).toBe("review");
    expect(resolveAssistantTab("nonsense")).toBe("ask");
  });

  it("states confidence as a word", () => {
    expect(confidenceWord("0.91")).toBe("high");
    expect(confidenceWord(0.7)).toBe("medium");
    expect(confidenceWord("0.2")).toBe("low");
    expect(confidenceWord("not-a-number")).toBe("low");
  });

  it("labels grounded figures and links them to their report; unknown figures are left out", () => {
    expect(presentFigure({ label: "Net profit (fiscal year to date)" })?.href).toBe(
      "/reports?tab=pl&report=profit-loss"
    );
    expect(presentFigure({ label: "Something new" })).toBeNull();
    const sources = sourcesFor([
      { label: "Revenue (fiscal year to date)" },
      { label: "Expenses (fiscal year to date)" },
      { label: "Total assets" },
    ]);
    expect(sources.map((s) => s.sourceKey)).toEqual([
      "assistant.srcProfitLoss",
      "assistant.srcBalanceSheet",
    ]);
  });
});

describe("Ask panel", () => {
  async function render() {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: AskPanel } = await import("../../client/src/pages/assistant/AskPanel");
    queryClient.clear();
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(AskPanel))
      );
    });
    await flush();
  }

  it("starts with suggestions and a composer; no model id, no KPI tiles", async () => {
    await render();
    const text = container.textContent ?? "";
    expect(container.querySelector('[data-testid="assistant-composer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="assistant-send"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="assistant-suggestions"] button').length).toBe(
      6
    );
    expect(text).not.toMatch(/gpt|model/i);
    expect(container.querySelector('[data-testid^="smart-stat"]')).toBeNull();
  });

  it("answers with the figures used and a source link", async () => {
    await render();
    const chip = container.querySelector<HTMLButtonElement>(
      '[data-testid="assistant-suggestions"] button'
    );
    await act(async () => chip!.click());
    await flush();
    const figures = container.querySelector('[data-testid="assistant-figures"]');
    expect(figures?.textContent).toContain("Revenue, year to date");
    expect(figures?.textContent).not.toContain("Something new");
    const link = container.querySelector<HTMLAnchorElement>('[data-testid="assistant-sources"] a');
    expect(link?.getAttribute("href")).toBe("/reports?tab=pl&report=profit-loss");
  });
});

describe("Review panel", () => {
  it("lists bank suggestions and mounts the shared anomaly checks; config notes are hidden", async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: ReviewPanel } = await import("../../client/src/pages/assistant/ReviewPanel");
    queryClient.clear();
    queryClient.setQueryData(
      ["/api/companies", "c-1", "ai-gl", "queue?status=pending_review"],
      [
        {
          id: "q1",
          description: "Bank service fee",
          amount: "95.00",
          transaction_date: "2026-11-13",
          suggested_account_id: null,
          suggested_account_name: null,
          suggested_account_code: null,
          ai_confidence: "0",
          ai_reason: "OpenAI not configured — manual categorization required",
        },
      ]
    );
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(ReviewPanel))
      );
    });
    await flush();
    expect(container.querySelector('[data-testid="review-item-q1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-choose-q1"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/OpenAI|not configured/);
    expect(container.querySelector('[data-testid="assistant-review-checks"]')).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="review-filter-checks"]')!.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="assistant-review-checks"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="review-item-q1"]')).toBeNull();
  });
});

describe("Ask panel sign-off fixes (B1-B3)", () => {
  async function render(overrides: Record<string, () => Response> = {}) {
    const base = globalThis.fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : String(input);
        for (const [needle, respond] of Object.entries(overrides)) {
          if (url.includes(needle)) return respond();
        }
        return base(input);
      })
    );
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: AskPanel } = await import("../../client/src/pages/assistant/AskPanel");
    queryClient.clear();
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(AskPanel))
      );
    });
    await flush();
  }

  it("B3: when the assistant is not switched on, says so up front with no chips and a disabled composer", async () => {
    await render({ "/api/ai/status": () => json({ configured: false }) });
    const notice = container.querySelector('[data-testid="assistant-unavailable"]');
    expect(notice?.textContent).toContain("not switched on");
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe("/reports");
    expect(container.querySelector('[data-testid="assistant-suggestions"]')).toBeNull();
    expect(
      container.querySelector<HTMLTextAreaElement>('[data-testid="assistant-input"]')?.disabled
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')?.disabled
    ).toBe(true);
  });

  it("B3: a switched-on assistant shows chips and no notice; a failed answer is a danger alert", async () => {
    await render({
      "/api/ai/status": () => json({ configured: true }),
      "/ai/nl-gateway": () =>
        new Response(JSON.stringify({ message: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(container.querySelector('[data-testid="assistant-unavailable"]')).toBeNull();
    const chip = container.querySelector<HTMLButtonElement>(
      '[data-testid="assistant-suggestions"] button'
    );
    await act(async () => chip!.click());
    await flush();
    const failed = container.querySelector('[data-testid="assistant-answer-failed"]');
    expect(failed?.getAttribute("data-tone")).toBe("danger");
    expect(failed?.textContent).toContain("could not be prepared");
  });

  it("B1/B2: the figures table fits a phone and only four chips show below md", async () => {
    // jsdom has no layout, so the phone behaviour is asserted through the classes that
    // drive it: `.mobile-fit` opts out of mobile.css's 600 px table minimum (the cause of
    // B1) and rows stack under 480 px; chips five and six are hidden below md (B2).
    await render();
    const chips = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="assistant-suggestions"] button'
      ),
    ];
    expect(chips.slice(0, 4).every((c) => !c.className.includes("max-md:hidden"))).toBe(true);
    expect(chips.slice(4).every((c) => c.className.includes("max-md:hidden"))).toBe(true);
    await act(async () => chips[0].click());
    await flush();
    const table = container.querySelector('[data-testid="assistant-figures"]');
    expect(table?.classList.contains("mobile-fit")).toBe(true);
    expect(table?.querySelector("tr")?.className).toContain("max-[479px]:flex-col");
  });
});
