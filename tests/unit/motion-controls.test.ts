// @vitest-environment jsdom
/**
 * Motion controls (front-end redesign): the pause preference, the pointer tilt / parallax
 * module and the top-bar pause button, exercised in jsdom. Stylesheet guards cover the
 * focus and motion selectors because jsdom cannot exercise the browser's CSS cascade.
 */
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parse } from "postcss";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardModel } from "../../client/src/pages/dashboard/useCustomerDashboardModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reduced = false;
let finePointer = false;

beforeAll(async () => {
  window.matchMedia = ((q: string) =>
    ({
      matches: q.includes("prefers-reduced-motion") ? reduced : finePointer,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

beforeEach(() => {
  reduced = false;
  finePointer = false;
  localStorage.clear();
  delete document.documentElement.dataset.motion;
});

describe("motion preference", () => {
  it("pausing sets <html data-motion=off> and persists; resuming clears both", async () => {
    const { setMotionPaused, MOTION_STORAGE_KEY } =
      await import("../../client/src/lib/motion/preference");
    setMotionPaused(true);
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe("off");
    setMotionPaused(false);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
  });
});

describe("pointer depth", () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function box(el: HTMLElement) {
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) as DOMRect;
  }

  it("tilts the hovered [data-tilt] element, clamps to its max angle and releases on stop", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { startPointerDepth } = await import("../../client/src/lib/motion/tilt");
    document.body.innerHTML = `<div data-tilt="4" id="card"><span id="inner">x</span></div>`;
    const card = document.getElementById("card")!;
    box(card);
    stop = startPointerDepth();
    // Pointer at the right edge, vertical middle: full rotation around Y, none around X.
    document
      .getElementById("inner")!
      .dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 50 }));
    expect(card.hasAttribute("data-tilt-active")).toBe(true);
    expect(card.style.getPropertyValue("--tilt-y")).toBe("2.00deg");
    expect(card.style.getPropertyValue("--tilt-x")).toBe("0.00deg");
    expect(card.style.getPropertyValue("--glare-x")).toBe("100.0%");

    stop();
    stop = undefined;
    expect(card.hasAttribute("data-tilt-active")).toBe(false);
    expect(card.style.getPropertyValue("--tilt-y")).toBe("");
  });

  it("writes --px / --py on a [data-parallax] scene and clears them when the pointer leaves", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const { startPointerDepth } = await import("../../client/src/lib/motion/tilt");
    document.body.innerHTML = `<div data-parallax id="scene"></div><p id="outside">y</p>`;
    const scene = document.getElementById("scene")!;
    box(scene);
    stop = startPointerDepth();
    scene.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 150, clientY: 50 })
    );
    expect(scene.style.getPropertyValue("--px")).toBe("0.500");
    expect(scene.style.getPropertyValue("--py")).toBe("0.000");
    document
      .getElementById("outside")!
      .dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 5, clientY: 5 }));
    expect(scene.style.getPropertyValue("--px")).toBe("");
  });

  it("ignores touch pointers", async () => {
    const { startPointerDepth } = await import("../../client/src/lib/motion/tilt");
    document.body.innerHTML = `<div data-tilt id="card"></div>`;
    const card = document.getElementById("card")!;
    box(card);
    stop = startPointerDepth();
    const touch = new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    card.dispatchEvent(touch);
    expect(card.hasAttribute("data-tilt-active")).toBe(false);
  });
});

describe("MotionToggle", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderToggle(locale: "en" | "ar" = "en") {
    const { useI18n } = await import("../../client/src/lib/i18n");
    const { MotionToggle } = await import("../../client/src/components/ui/motion-toggle");
    act(() => useI18n.getState().setLocale(locale));
    act(() => root.render(h(MotionToggle)));
    return container.querySelector<HTMLButtonElement>('[data-testid="button-motion-toggle"]')!;
  }

  const labels = [
    ["en", "Pause motion"],
    ["ar", "إيقاف الحركة مؤقتًا"],
  ] as const;

  it.each(labels)(
    "keeps the %s button name stable as its pressed state changes",
    async (locale, label) => {
      const button = await renderToggle(locale);
      function expectState(pressed: boolean) {
        expect(button.getAttribute("aria-label")).toBe(label);
        expect(button.getAttribute("aria-pressed")).toBe(String(pressed));
        expect(document.documentElement.dataset.motion).toBe(pressed ? "off" : undefined);
      }
      expectState(false);
      act(() => button.click());
      expectState(true);
      act(() => button.click());
      expectState(false);
    }
  );

  it.each(labels)(
    "keeps the %s account menu name stable as its checked state changes",
    async (locale, label) => {
      const { useI18n } = await import("../../client/src/lib/i18n");
      const { AccountMenu } = await import("../../client/src/components/layout/AccountMenu");
      const client = new QueryClient();
      client.setQueryData(["/api/auth/me"], null);
      try {
        act(() => {
          useI18n.getState().setLocale(locale);
          root.render(h(QueryClientProvider, { client }, h(AccountMenu)));
        });
        const trigger = container.querySelector('[data-testid="button-profile"]')!;
        act(() => {
          trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        });
        const item = document.querySelector<HTMLElement>('[data-testid="menu-account-motion"]')!;
        expect(item.getAttribute("role")).toBe("menuitemcheckbox");
        expect(item.textContent).toBe(label);
        expect(item.getAttribute("aria-checked")).toBe("false");
        act(() => item.click());
        expect(item.textContent).toBe(label);
        expect(item.getAttribute("aria-checked")).toBe("true");
        act(() => item.click());
        expect(item.getAttribute("aria-checked")).toBe("false");
      } finally {
        client.clear();
      }
    }
  );

  it("pauses and detaches pointer depth when browser storage throws", async () => {
    finePointer = true;
    const { MotionToggle } = await import("../../client/src/components/ui/motion-toggle");
    const { useAmbientMotion } = await import("../../client/src/lib/motion/useAmbientMotion");
    function MotionShell() {
      useAmbientMotion();
      return h(MotionToggle);
    }
    const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    try {
      act(() => root.render(h(MotionShell)));
      const button = container.querySelector("button")!;
      await vi.waitFor(() =>
        expect(add).toHaveBeenCalledWith("pointermove", expect.any(Function), { passive: true })
      );
      const listener = add.mock.calls.find(([event]) => event === "pointermove")?.[1];

      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(document.documentElement.dataset.motion).toBe("off");
      expect(remove).toHaveBeenCalledWith("pointermove", listener);

      add.mockClear();
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(document.documentElement.dataset.motion).toBeUndefined();
      await vi.waitFor(() =>
        expect(add).toHaveBeenCalledWith("pointermove", expect.any(Function), { passive: true })
      );
    } finally {
      storage.mockRestore();
      add.mockRestore();
      remove.mockRestore();
      const { setMotionPaused } = await import("../../client/src/lib/motion/preference");
      act(() => setMotionPaused(false));
    }
  });

  it.each(labels)(
    "keeps the %s button name when the OS locks motion in the paused state",
    async (locale, label) => {
      reduced = true;
      const button = await renderToggle(locale);
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.getAttribute("aria-disabled")).toBe("true");
      act(() => button.click());
      expect(document.documentElement.dataset.motion).toBeUndefined();
    }
  );
});

it("renders mirrored dashboard action arrows in Arabic with motion on and paused", async () => {
  const { useI18n, useTranslation } = await import("../../client/src/lib/i18n");
  const { setMotionPaused } = await import("../../client/src/lib/motion/preference");
  const { CompliancePanel } = await import("../../client/src/pages/dashboard/DashboardPlanning");
  const { NeedsYouStrip } = await import("../../client/src/pages/dashboard/NeedsYouStrip");
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: async () => [] } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function DashboardActions() {
    const { t } = useTranslation();
    const model = {
      t,
      locale: "ar",
      compliance: {
        auditReadiness: {
          score: 80,
          issues: ["Bank reconciliation"],
          checks: [{ status: "fail" }],
        },
      },
    } as DashboardModel;
    return h(
      QueryClientProvider,
      { client },
      h(CompliancePanel, { m: model }),
      h(NeedsYouStrip, {
        companyId: "company",
        invoices: [],
        compliance: { vatStatus: { filingStatus: "overdue", overdueCount: 1 } },
      })
    );
  }
  try {
    act(() => useI18n.getState().setLocale("ar"));
    expect(document.documentElement.dir).toBe("rtl");
    for (const paused of [false, true]) {
      act(() => {
        setMotionPaused(paused);
        root.render(h(DashboardActions));
      });
      for (const id of ["link-raise-score", "needs-you-vat-return"]) {
        const link = container.querySelector(`[data-testid="${id}"]`);
        expect(link, id).not.toBeNull();
        expect(link!.textContent).toMatch(/\p{Script=Arabic}/u);
        expect(link!.querySelector("svg.lucide-arrow-right")?.classList).toContain(
          "rtl:[scale:-1_1]"
        );
      }
    }
  } finally {
    act(() => {
      root.unmount();
      setMotionPaused(false);
      useI18n.getState().setLocale("en");
    });
    client.clear();
    container.remove();
  }
});

describe("motion strings and stylesheet", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("stops tilt and parallax under the pause control and under prefers-reduced-motion", () => {
    const css = read("client/src/index.css");
    expect(css).toMatch(
      /html\[data-motion="off"\] \[data-tilt\],[\s\S]*?transform: none !important/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-tilt\],[\s\S]*?transform: none !important/
    );
  });

  it("leaves keyboard focus rings available on every shared button variant", async () => {
    const { buttonVariants } = await import("../../client/src/components/ui/button");
    for (const variant of [
      "default",
      "outline",
      "secondary",
      "ghost",
      "link",
      "accent",
      "destructive",
    ] as const) {
      expect(buttonVariants({ variant }).split(" ")).toContain("focus-visible:ring-2");
    }
    // A custom box-shadow takes precedence over Tailwind's ring on these app buttons.
    const css = parse(read("client/src/index.css"));
    css.walkRules(/\.ui-btn\b/, (rule) => {
      rule.walkDecls("box-shadow", () => {
        for (const selector of rule.selectors) {
          expect(selector).toMatch(/:not\([^)]*:focus-visible[^)]*\)/);
        }
      });
    });
  });
});
