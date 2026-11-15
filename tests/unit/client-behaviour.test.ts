// @vitest-environment jsdom
/**
 * R20-14: client behaviour tests that render real components in jsdom (no static source
 * scanning): the VAT 201 form boxes and totals, typing into a box auto-computing 5% VAT,
 * and the RTL shell switching <html dir> with the locale.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function emptyVat201() {
  const keys = [
    "box1aAbuDhabi",
    "box1bDubai",
    "box1cSharjah",
    "box1dAjman",
    "box1eUmmAlQuwain",
    "box1fRasAlKhaimah",
    "box1gFujairah",
  ];
  const data: Record<string, number> = {};
  for (const k of keys) {
    data[`${k}Amount`] = 0;
    data[`${k}Vat`] = 0;
    data[`${k}Adj`] = 0;
  }
  for (const k of [
    "box2TouristRefundAmount",
    "box2TouristRefundVat",
    "box3ReverseChargeAmount",
    "box3ReverseChargeVat",
    "box4ZeroRatedAmount",
    "box5ExemptAmount",
    "box6ImportsAmount",
    "box6ImportsVat",
    "box7ImportsAdjAmount",
    "box7ImportsAdjVat",
    "box9ExpensesAmount",
    "box9ExpensesVat",
    "box9ExpensesAdj",
    "box10ReverseChargeAmount",
    "box10ReverseChargeVat",
  ]) {
    data[k] = 0;
  }
  return data;
}

describe("R20-14 client behaviour: VAT 201 form", () => {
  it("[R20-14] renders every emirate box and derives the net VAT from the boxes", async () => {
    const { default: VAT201Form } = await import("../../client/src/components/VAT201Form");
    const data = {
      ...emptyVat201(),
      box1bDubaiAmount: 10_000,
      box1bDubaiVat: 500,
      box9ExpensesAmount: 2_000,
      box9ExpensesVat: 100,
    };
    act(() => {
      root.render(
        createElement(VAT201Form as never, {
          data,
          onChange: () => undefined,
          companyInfo: { nameEn: "Box Co LLC", trnNumber: "100123456700003" },
          periodInfo: { periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-04-28" },
        })
      );
    });
    for (const prefix of ["box1aAbuDhabi", "box1bDubai", "box1gFujairah"]) {
      expect(container.querySelector(`[data-testid="input-${prefix}-amount"]`)).not.toBeNull();
    }
    const text = container.textContent ?? "";
    expect(text).toContain("Box Co LLC");
    // Due tax 500, recoverable 100 → net 400.
    expect(text).toContain("400.00");
  });

  it("[R20-14] typing a standard-rated amount reports 5% VAT through onChange", async () => {
    const { default: VAT201Form } = await import("../../client/src/components/VAT201Form");
    const onChange = vi.fn();
    act(() => {
      root.render(
        createElement(VAT201Form as never, {
          data: emptyVat201(),
          onChange,
          companyInfo: { nameEn: "Box Co LLC" },
          periodInfo: { periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-04-28" },
        })
      );
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="input-box1bDubai-amount"]'
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "2000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.box1bDubaiAmount).toBe(2000);
    expect(next.box1bDubaiVat).toBe(100);
  });
});

describe("R20-14 client behaviour: RTL shell", () => {
  it("[R20-14] RTLProvider mirrors <html dir/lang> with the active locale", async () => {
    const { RTLProvider, useRTL } = await import("../../client/src/components/RTLProvider");
    const { useI18n } = await import("../../client/src/lib/i18n");
    function Probe() {
      const { direction } = useRTL();
      return createElement("span", { "data-testid": "dir" }, direction);
    }
    act(() => {
      useI18n.getState().setLocale("en");
      root.render(createElement(RTLProvider, null, createElement(Probe)));
    });
    expect(document.documentElement.dir).toBe("ltr");
    expect(container.textContent).toBe("ltr");
    act(() => useI18n.getState().setLocale("ar"));
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.classList.contains("rtl")).toBe(true);
    expect(container.textContent).toBe("rtl");
    act(() => useI18n.getState().setLocale("en"));
  });
});
