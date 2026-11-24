// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Calendar } from "../../client/src/components/ui/calendar";
import { Input } from "../../client/src/components/ui/input";
import { ScrollArea } from "../../client/src/components/ui/scroll-area";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await loadLocale("en");
  await loadLocale("ar");
});

beforeEach(() => {
  useI18n.setState({ locale: "ar" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Arabic form controls", () => {
  it("isolates email, phone, URL and decimal values without forcing Arabic prose to LTR", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          { dir: "rtl" },
          createElement(Input, { type: "email", defaultValue: "qa+invoice@example.com" }),
          createElement(Input, { type: "tel", defaultValue: "+971 50 000 0000" }),
          createElement(Input, { type: "url", defaultValue: "https://example.com/ae" }),
          createElement(Input, { inputMode: "decimal", defaultValue: "-1.20" }),
          createElement(Input, { defaultValue: "مؤسسة النخيل" }),
          createElement(Input, { inputMode: "decimal", dir: "auto" })
        )
      )
    );

    const fields = Array.from(container.querySelectorAll("input"));
    expect(fields.map((field) => field.getAttribute("dir"))).toEqual([
      "ltr",
      "ltr",
      "ltr",
      "ltr",
      null,
      "auto",
    ]);
    expect(fields[0].value).toBe("qa+invoice@example.com");
    expect(fields[3].value).toBe("-1.20");
  });

  it("localizes the shared calendar and navigates forward with the left-facing chevron", () => {
    act(() => root.render(createElement(Calendar, { defaultMonth: new Date(2026, 2, 1) })));

    const calendar = container.querySelector<HTMLElement>(".rdp")!;
    const previous = calendar.querySelector<HTMLButtonElement>('button[name="previous-month"]')!;
    const next = calendar.querySelector<HTMLButtonElement>('button[name="next-month"]')!;
    expect(calendar.dir).toBe("rtl");
    expect(calendar.textContent).toContain("مارس 2026");
    expect(previous.getAttribute("aria-label")).toBe("الشهر السابق");
    expect(previous.querySelector("svg.lucide-chevron-right.rtl-preserve")).not.toBeNull();
    expect(next.getAttribute("aria-label")).toBe("الشهر التالي");
    expect(next.querySelector("svg.lucide-chevron-left.rtl-preserve")).not.toBeNull();

    act(() => next.click());
    expect(calendar.textContent).toContain("أبريل 2026");
  });

  it("updates an existing scroll area when the locale changes and honors explicit LTR", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement(ScrollArea, { id: "localized" }, "الملفات"),
          createElement(ScrollArea, { id: "explicit", dir: "ltr" }, "ABC-120")
        )
      )
    );
    const localized = container.querySelector<HTMLElement>("#localized")!;
    const explicit = container.querySelector<HTMLElement>("#explicit")!;
    expect(localized.dir).toBe("rtl");
    expect(explicit.dir).toBe("ltr");
    act(() => useI18n.setState({ locale: "en" }));
    expect(localized.dir).toBe("ltr");
    expect(explicit.dir).toBe("ltr");
  });
});
