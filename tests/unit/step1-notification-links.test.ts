// @vitest-environment jsdom
/**
 * STEP1 F3: notification / palette links to an invoice must work on every navigation (the bell
 * navigates while /invoices is already mounted), and the invoice preview chip must show the real
 * lifecycle status instead of "Draft".
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useOpenInvoiceParam } from "../../client/src/hooks/use-open-invoice-param";
import { previewStatusKey } from "../../client/src/lib/invoice-preview-status";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("STEP1 F3: ?open=<id> is honoured on every navigation", () => {
  it("opens on mount, on a later navigation while mounted, and on a repeat click of the same id", async () => {
    const opened: string[] = [];
    function Page() {
      useOpenInvoiceParam((id) => opened.push(id));
      return null;
    }
    const mem = memoryLocation({ path: "/invoices?open=a1", searchHook: true, record: true });
    await act(async () => {
      root.render(
        createElement(
          Router,
          { hook: mem.hook, searchHook: mem.searchHook } as never,
          createElement(Page)
        )
      );
    });
    expect(opened).toEqual(["a1"]);
    // The param is consumed so the back button does not re-open it.
    expect(mem.history?.at(-1)).toBe("/invoices");

    await act(async () => mem.navigate("/invoices?open=b2"));
    expect(opened).toEqual(["a1", "b2"]);

    await act(async () => mem.navigate("/invoices?open=b2"));
    expect(opened).toEqual(["a1", "b2", "b2"]);

    // Other params are preserved while `open` is removed.
    await act(async () => mem.navigate("/invoices?status=paid&open=c3"));
    expect(opened.at(-1)).toBe("c3");
    expect(mem.history?.at(-1)).toBe("/invoices?status=paid");
  });
});

describe("STEP1 F3: invoice preview chip shows the real status", () => {
  it.each([
    ["draft", "forms.preview.draftBadge"],
    [undefined, "forms.preview.draftBadge"],
    ["paid", "forms.preview.status.paid"],
    ["partial", "forms.preview.status.partial"],
    ["sent", "forms.preview.status.sent"],
    ["posted", "forms.preview.status.sent"],
    ["void", "forms.preview.status.void"],
    ["cancelled", "forms.preview.status.void"],
  ])("status %s -> %s", (status, key) => {
    expect(previewStatusKey(status)).toBe(key);
  });

  it("every status key exists in en and ar", async () => {
    const en = (await import("../../client/src/locales/en/forms.json")).default as Record<
      string,
      string
    >;
    const ar = (await import("../../client/src/locales/ar/forms.json")).default as Record<
      string,
      string
    >;
    for (const s of ["paid", "partial", "sent", "void"]) {
      const key = previewStatusKey(s);
      expect(en[key], key).toBeTruthy();
      expect(ar[key], key).toBeTruthy();
    }
    expect(en["forms.invoice.viewTitle"]).toContain("{number}");
    expect(ar["forms.invoice.viewTitle"]).toContain("{number}");
  });
});
