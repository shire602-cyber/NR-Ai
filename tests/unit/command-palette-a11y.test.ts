// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocale, t } from "../../client/src/lib/i18n";
import { CommandDialog, CommandInput } from "../../client/src/components/ui/command";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  await loadLocale("en");
  // cmdk and Radix use these browser APIs, which jsdom does not implement.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => undefined;
});

describe("command palette accessibility", () => {
  it("gives the open command dialog a screen-reader title that labels the dialog", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(CommandDialog, { open: true }, createElement(CommandInput)));
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const titleId = dialog!.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    const title = document.getElementById(titleId!);
    expect(title?.className).toContain("sr-only");
    expect(title?.textContent).toBe(t.en["components.commandPaletteTitle"]);
    expect(title?.textContent?.length).toBeGreaterThan(0);

    act(() => root.unmount());
    container.remove();
  });
});
