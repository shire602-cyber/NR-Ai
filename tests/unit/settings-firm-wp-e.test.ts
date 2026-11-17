// @vitest-environment jsdom
/**
 * WP-E settings and firm behaviour: identical sessions collapse into one device row,
 * generated practice-task titles read as words and a formatted range (no ISO dates),
 * and the feedback form posts without the invalid `rating: 0` the old star widget sent.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { collapseSessions } from "../../client/src/pages/settings/sessions";
import { displayTaskTitle } from "../../client/src/pages/firm/task-title";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userAgent: "Mozilla/5.0 (Macintosh) Chrome/130",
  ipAddress: "10.0.0.1",
  lastUsedAt: "2026-11-10T10:00:00Z",
  createdAt: "2026-11-01T10:00:00Z",
  current: false,
  ...over,
});

describe("security devices", () => {
  it("collapses identical sessions and puts this device first", () => {
    const groups = collapseSessions(
      [
        session("a"),
        session("b", { lastUsedAt: "2026-11-12T10:00:00Z" }),
        session("c", { ipAddress: "10.0.0.9" }),
        session("d", { ipAddress: "10.0.0.9", current: true }),
      ],
      () => "Chrome on macOS"
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].current).toBe(true);
    expect(groups[0].lead.id).toBe("d");
    expect(groups[1].count).toBe(2);
    expect(groups[1].lead.id).toBe("b");
    expect(groups[1].ids.sort()).toEqual(["a", "b"]);
  });
});

describe("practice task titles", () => {
  const t = { "firmOps.taskVatReturn": "إقرار ضريبة القيمة المضافة" };
  it("replaces the ISO range with a formatted one", () => {
    const en = displayTaskTitle("VAT return — 2026-07-01 to 2026-09-30", {}, "en");
    expect(en).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(en).toContain("VAT return, ");
    expect(en).toMatch(/1 Jul – 30 Sept? 2026/);
    const ar = displayTaskTitle("VAT return — 2026-07-01 to 2026-09-30", t, "ar");
    expect(ar.startsWith("إقرار ضريبة القيمة المضافة")).toBe(true);
    expect(ar).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("leaves other titles alone", () => {
    expect(displayTaskTitle("Call the client", {}, "en")).toBe("Call the client");
  });
});

describe("feedback form", () => {
  let container: HTMLDivElement;
  let root: Root;
  const posts: unknown[] = [];

  beforeAll(async () => {
    const { loadLocale } = await import("../../client/src/lib/i18n");
    await Promise.all([loadLocale("en"), loadLocale("ar")]);
  });
  beforeEach(() => {
    posts.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.includes("csrf-token")) {
          return new Response(JSON.stringify({ csrfToken: "t" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(init?.method === "POST" ? { id: "f1" } : []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
  });

  it("sends type and message only, with no star rating", async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: Feedback } = await import("../../client/src/pages/Feedback");
    queryClient.clear();
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(Feedback))
      );
    });
    expect(container.querySelector('[data-testid^="button-star-"]')).toBeNull();
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="input-message"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(textarea, "The bank import could be faster.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="button-type-bug"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="button-submit"]')!.click();
    });
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      feedbackType: "bug",
      message: "The bank import could be faster.",
    });
    expect(posts[0]).not.toHaveProperty("rating");
  });
});
