// @vitest-environment jsdom
/**
 * Motion controls (front-end redesign): the pause preference, the pointer tilt / parallax
 * module and the top-bar pause button, exercised in jsdom. The last block reads index.css
 * because jsdom does not apply stylesheets, so "paused means no transform" can only be checked
 * against the rule text.
 */
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reduced = false;

beforeAll(async () => {
  window.matchMedia = ((q: string) =>
    ({
      matches: q.includes("prefers-reduced-motion") ? reduced : false,
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

  async function renderToggle() {
    const { useI18n } = await import("../../client/src/lib/i18n");
    const { MotionToggle } = await import("../../client/src/components/ui/motion-toggle");
    act(() => useI18n.getState().setLocale("en"));
    act(() => root.render(h(MotionToggle)));
    return container.querySelector<HTMLButtonElement>('[data-testid="button-motion-toggle"]')!;
  }

  it("is a labelled pause button that toggles the paused state", async () => {
    const button = await renderToggle();
    expect(button.getAttribute("aria-label")).toBe("Pause motion");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    act(() => button.click());
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(button.getAttribute("aria-label")).toBe("Play motion");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    act(() => button.click());
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("shows the paused state and does not resume when the OS asks for reduced motion", async () => {
    reduced = true;
    const button = await renderToggle();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    act(() => button.click());
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});

describe("motion strings and stylesheet", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("has the three motion strings in English and Arabic", () => {
    const en = JSON.parse(read("client/src/locales/en/shell.json")) as Record<string, string>;
    const ar = JSON.parse(read("client/src/locales/ar/shell.json")) as Record<string, string>;
    for (const key of ["shell.motionPause", "shell.motionPlay", "shell.motionSystemReduced"]) {
      expect(en[key], key).toBeTruthy();
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("stops tilt and parallax under the pause control and under prefers-reduced-motion", () => {
    const css = read("client/src/index.css");
    expect(css).toMatch(
      /html\[data-motion="off"\] \[data-tilt\],[\s\S]*?transform: none !important/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-tilt\],[\s\S]*?transform: none !important/
    );
  });
});
