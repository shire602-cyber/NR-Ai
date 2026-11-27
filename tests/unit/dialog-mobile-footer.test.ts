// @vitest-environment jsdom
/**
 * Mobile dialog footer: the sticky footer must keep its z-index and sm offset as separate
 * utility classes. A missing space once fused `sm:...:-bottom-6` with `...:z-10`, so the
 * footer lost its stacking order and form fields scrolled over the primary action on a phone.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "../../client/src/components/ui/dialog";

describe("sized dialog sticky footer", () => {
  it("emits z-10 and the sm bottom offset as separate classes", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(
          Dialog,
          { open: true },
          createElement(
            DialogContent,
            { size: "md" },
            createElement(DialogTitle, null, "t"),
            createElement(DialogFooter, null, "f")
          )
        )
      );
    });
    const panel = document.querySelector("[data-size='md']")!;
    const classes = panel.className.split(/\s+/);
    expect(classes).toContain("[&_[data-dialog-footer]]:z-10");
    expect(classes).toContain("sm:[&_[data-dialog-footer]]:-bottom-6");
    expect(classes.some((c) => /\]:-bottom-6\[/.test(c))).toBe(false);
    await act(async () => root.unmount());
  });
});
