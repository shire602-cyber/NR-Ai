// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { FtaAuditFileControl } from "../../client/src/pages/reports/StatementParts";
import { FAF_MAX_DAYS, fafRangeError, fafSpanDays } from "../../shared/faf-range";

// Stand-in for the calendar popover: exposes the min/max the control passes to the picker.
vi.mock("../../client/src/components/ui/date-picker", () => ({
  DatePicker: (p: { value: string; min?: string; max?: string; "data-testid"?: string }) =>
    createElement("input", {
      "data-testid": p["data-testid"],
      value: p.value,
      "data-min": p.min,
      "data-max": p.max,
      readOnly: true,
    }),
}));

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocale("en");
  await loadLocale("ar");
}, 120_000);

async function mount(from: string, to: string, locale: "en" | "ar") {
  const node = document.createElement("div");
  const root = createRoot(node);
  useI18n.setState({ locale });
  await act(async () => {
    root.render(createElement(FtaAuditFileControl, { companyId: "c1", from, to }));
  });
  return { node, unmount: () => act(async () => root.unmount()) };
}

describe("FAF range helpers", () => {
  it("counts inclusive days and flags the cap", () => {
    expect(fafSpanDays("2024-01-01", "2024-12-31")).toBe(FAF_MAX_DAYS);
    expect(fafRangeError("2024-01-01", "2024-12-31")).toBeNull();
    expect(fafRangeError("2024-01-01", "2025-01-01")).toBe("FAF_RANGE_TOO_LONG");
    expect(fafRangeError("2024-02-02", "2024-02-01")).toBe("INVALID_RANGE");
  });
});

describe("FtaAuditFileControl", () => {
  it("offers the download for an in-range selection and bounds the date inputs", async () => {
    const { node, unmount } = await mount("2024-01-01", "2024-12-31", "en");
    try {
      expect(node.querySelector("a[data-testid=link-fta-audit-file]")).not.toBeNull();
      expect(node.querySelector("[data-testid=faf-range-error]")).toBeNull();
      expect(
        node.querySelector<HTMLInputElement>("[data-testid=input-faf-from]")?.dataset.min
      ).toBe("2024-01-01");
      expect(node.querySelector<HTMLInputElement>("[data-testid=input-faf-to]")?.dataset.max).toBe(
        "2024-12-31"
      );
    } finally {
      await unmount();
    }
  });

  it.each([
    ["en", "at most 366 days"],
    ["ar", "366 يومًا"],
  ] as const)(
    "shows the localized error and no download for a 2-year range (%s)",
    async (locale, text) => {
      const prior = useI18n.getState().locale;
      const { node, unmount } = await mount("2024-01-01", "2025-12-31", locale);
      try {
        expect(node.querySelector("a[data-testid=link-fta-audit-file]")).toBeNull();
        expect(node.querySelector("[data-testid=faf-range-error]")?.textContent).toContain(text);
      } finally {
        await unmount();
        useI18n.setState({ locale: prior });
      }
    }
  );
});
