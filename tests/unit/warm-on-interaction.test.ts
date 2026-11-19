// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { warmOnFirstInteraction } from "../../client/src/lib/warmOnInteraction";

/**
 * Sign-in warms the remaining catalogs only after the visitor touches the form (or 8 s), so the
 * form's own scripts and first paint are not competing with ~40 catalog requests.
 */
describe("warmOnFirstInteraction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing until the visitor touches the page", () => {
    const warm = vi.fn();
    warmOnFirstInteraction(warm);
    vi.advanceTimersByTime(7_999);
    expect(warm).not.toHaveBeenCalled();
  });

  for (const type of ["focusin", "pointerdown", "keydown", "touchstart"]) {
    it(`runs once on the first ${type}`, () => {
      const warm = vi.fn();
      warmOnFirstInteraction(warm);
      window.dispatchEvent(new Event(type));
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(20_000);
      expect(warm).toHaveBeenCalledTimes(1);
    });
  }

  it("falls back to a timer when nobody touches the page, and can be cancelled", () => {
    const warm = vi.fn();
    warmOnFirstInteraction(warm, 5_000);
    vi.advanceTimersByTime(5_000);
    expect(warm).toHaveBeenCalledTimes(1);
    const never = vi.fn();
    const cancel = warmOnFirstInteraction(never, 5_000);
    cancel();
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(10_000);
    expect(never).not.toHaveBeenCalled();
  });
});
