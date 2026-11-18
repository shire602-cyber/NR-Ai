// @vitest-environment jsdom
/**
 * DF3 / Fable N3: from the second question on, the newest answer stopped about 200 px short
 * and sat behind the docked composer, and the thread showed through the strip between the
 * composer and the tab bar. A stubbed multi-turn conversation runs against a fake layout
 * (jsdom has none): every turn is 300 px tall in a scrolling `<main>`, the composer's top is at
 * 646 px (a 390 x 844 phone). After each answer the newest turn must end above the composer.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_GAP_PX, revealScrollDelta } from "../../client/src/pages/assistant/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: "c-1", company: { id: "c-1" }, isLoading: false }),
}));

const COMPOSER_TOP = 646;
const TURN_HEIGHT = 300;
const TURN_GAP = 24;
const THREAD_TOP = 80;

let container: HTMLDivElement;
let main: HTMLElement;
let root: Root;
let scrollTop = 0;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 390,
    width: 390,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await loadLocale("en");
});

beforeEach(() => {
  scrollTop = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/ai/status")) return json({ configured: true });
      if (url.includes("dashboard/stats")) return json({ outstanding: 1200 });
      if (url.includes("/ai/nl-gateway")) {
        return json({
          response: "Revenue so far is AED 12,000 [F1].",
          citations: [
            { id: "F1", label: "Revenue (fiscal year to date)", value: 12000, unit: "AED" },
          ],
          timestamp: "2026-11-17T10:00:00Z",
        });
      }
      return json({});
    })
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  // Fake layout: turns stack from THREAD_TOP inside <main>, the dock is pinned at COMPOSER_TOP.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === "assistant-composer-dock") return rect(COMPOSER_TOP, 72);
    if (this === main) return rect(0, 844);
    if (this.tagName === "LI" && this.parentElement?.dataset.testid === "assistant-thread") {
      const index = Array.from(this.parentElement.children).indexOf(this);
      return rect(THREAD_TOP + index * (TURN_HEIGHT + TURN_GAP) - scrollTop, TURN_HEIGHT);
    }
    return originalRect.call(this);
  };
  main = document.createElement("main");
  main.style.overflowY = "auto";
  Object.defineProperty(main, "scrollHeight", { configurable: true, get: () => 10_000 });
  Object.defineProperty(main, "clientHeight", { configurable: true, get: () => 844 });
  main.scrollBy = ((opts: ScrollToOptions) => {
    scrollTop += opts.top ?? 0;
  }) as typeof main.scrollBy;
  container = document.createElement("div");
  main.appendChild(container);
  document.body.appendChild(main);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  main.remove();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function ask(question: string) {
  const input = container.querySelector<HTMLTextAreaElement>('[data-testid="assistant-input"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="assistant-send"]')!.click();
  });
  await flush();
}

function latestTurnBottom(): number {
  const turns = container.querySelectorAll('[data-testid="assistant-thread"] > li');
  return (turns[turns.length - 1] as HTMLElement).getBoundingClientRect().bottom;
}

describe("N3: the newest answer lands above the composer", () => {
  it("revealScrollDelta scrolls the overlap, never past the turn's own top", () => {
    expect(
      revealScrollDelta({ turnTop: 100, turnBottom: 400, composerTop: 646, visibleTop: 0 })
    ).toBe(0);
    expect(
      revealScrollDelta({ turnTop: 400, turnBottom: 819, composerTop: 646, visibleTop: 0 })
    ).toBe(819 - (646 - REVEAL_GAP_PX));
    // A turn taller than the space keeps its question at the top of the thread.
    expect(
      revealScrollDelta({ turnTop: 300, turnBottom: 1400, composerTop: 646, visibleTop: 0 })
    ).toBe(300 - REVEAL_GAP_PX);
  });

  it("each of three answers ends above the composer, and the dock is opaque to the tab bar", async () => {
    const { queryClient } = await import("../../client/src/lib/queryClient");
    const { default: AskPanel } = await import("../../client/src/pages/assistant/AskPanel");
    queryClient.clear();
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: queryClient }, createElement(AskPanel))
      );
    });
    await flush();

    for (const question of ["What is revenue?", "And expenses?", "Who owes me most?"]) {
      await ask(question);
      expect(container.querySelectorAll('[data-testid="assistant-answer"]').length).toBeGreaterThan(
        0
      );
      expect(latestTurnBottom()).toBeLessThanOrEqual(COMPOSER_TOP - REVEAL_GAP_PX);
    }
    expect(scrollTop).toBeGreaterThan(0);

    const dock = container.querySelector<HTMLElement>('[data-testid="assistant-composer-dock"]')!;
    expect(dock.querySelector('[data-testid="assistant-composer"]')).not.toBeNull();
    const cls = dock.className;
    expect(cls).toContain("sticky");
    expect(cls).toContain("bg-background");
    // <main>'s bottom padding already clears the tab bar, so the dock sticks at bottom 0 (an
    // extra tab-bar offset left a strip of thread visible under it) and its background
    // continues down through that padding to the tab bar / window edge.
    expect(cls.split(/\s+/)).toContain("bottom-0");
    expect(cls).not.toMatch(/bottom-\[calc/);
    expect(cls).toContain("after:top-full");
    expect(cls).toContain("after:h-[var(--mobile-nav-height)]");
    expect(cls).toContain("after:bg-background");
  });
});
