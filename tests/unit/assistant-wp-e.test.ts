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
    expect(container.querySelector('[data-testid="assistant-review-checks"]')).not.toBeNull();
  });
});
