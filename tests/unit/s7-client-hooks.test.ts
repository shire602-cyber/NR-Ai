// @vitest-environment jsdom
/**
 * S7: hooks rewritten to satisfy the React Compiler lint rules keep their behaviour —
 * useIsMobile (useSyncExternalStore over matchMedia), useHasMounted (replaces the
 * setMounted effect) and useKeyboardShortcuts (latest bindings via a layout effect).
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "../../client/src/hooks/use-mobile";
import { useHasMounted } from "../../client/src/hooks/use-has-mounted";
import { useKeyboardShortcuts } from "../../client/src/hooks/useKeyboardShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let mediaListeners: Array<() => void>;

beforeEach(() => {
  mediaListeners = [];
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: (_: string, cb: () => void) => mediaListeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      mediaListeners = mediaListeners.filter((fn) => fn !== cb);
    },
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

describe("S7 useIsMobile", () => {
  it("reports the current width and follows matchMedia changes", () => {
    setWidth(500);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useIsMobile());
      return null;
    }
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(true);

    setWidth(1200);
    act(() => mediaListeners.forEach((cb) => cb()));
    expect(seen.at(-1)).toBe(false);

    act(() => root.unmount());
    expect(mediaListeners).toHaveLength(0);
    root = createRoot(container);
  });
});

describe("S7 useHasMounted", () => {
  it("is true once rendered in the browser", () => {
    let mounted: boolean | null = null;
    function Probe() {
      mounted = useHasMounted();
      return null;
    }
    act(() => root.render(createElement(Probe)));
    expect(mounted).toBe(true);
  });
});

describe("S7 useKeyboardShortcuts", () => {
  it("dispatches to the bindings of the latest render", () => {
    const first = vi.fn();
    const second = vi.fn();
    function Probe({ handler }: { handler: () => void }) {
      useKeyboardShortcuts([{ combo: "mod+k", handler }]);
      return null;
    }
    act(() => root.render(createElement(Probe, { handler: first })));
    act(() => root.render(createElement(Probe, { handler: second })));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
