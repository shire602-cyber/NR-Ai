// @vitest-environment jsdom
/**
 * WP10 (code audit §2.2): the customer portal built its own Intl.NumberFormat("en-AE",
 * { style: "currency" }) and rendered money differently from the rest of the app. The
 * portal statement now renders through the shared <Money> component: Latin digits,
 * "," grouping, two decimals, true minus, "AED 12,345.50" in English and "د.إ" in Arabic.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import PortalStatements from "../../client/src/pages/portal/PortalStatements";
import { loadLocale, useI18n } from "../../client/src/lib/i18n";
import { formatMoneyText, stripBidiControls } from "../../client/src/lib/format-money";
import { portalQuery } from "../../client/src/lib/queryClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const statement = {
  asOf: "2026-03-31",
  party: { name: "Acme LLC" },
  company: { name: "Najma Trading LLC" },
  sections: [
    {
      currency: "AED",
      openingBalance: 12345.5,
      closingBalance: -1500,
      totals: { debit: 1050, credit: 14895.5 },
      lines: [
        {
          date: "2026-03-01",
          type: "invoice",
          reference: "INV-1",
          description: "Consulting",
          debit: 1050,
          credit: 0,
          balance: 13395.5,
        },
      ],
      aging: {
        current: 1000,
        days30: 0,
        days60: 0,
        days90: 0,
        over90: 0,
        total: 1000,
        unappliedCredits: 0,
      },
    },
  ],
};

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

describe("WP10 portal statement money uses the shared formatter", () => {
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
    act(() => useI18n.getState().setLocale("en"));
  });

  function renderStatement() {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    qc.setQueryData(portalQuery("/api/client-portal/statements").queryKey, statement);
    act(() => {
      root.render(
        createElement(QueryClientProvider, { client: qc }, createElement(PortalStatements))
      );
    });
    // <Money> lays sign, digits and currency out in separate spans; compare without spaces.
    return stripBidiControls(container.textContent ?? "").replace(/\s+/g, "");
  }

  it("WP10: English renders grouped Latin digits with the AED code first and a true minus", () => {
    const text = renderStatement();
    expect(text).toContain("AED12,345.50");
    expect(text).toContain("AED13,395.50");
    expect(text).toContain("AED−1,500.00");
    expect(text).not.toContain("12345.50");
    expect(text).not.toMatch(/-1,500/); // no hyphen-minus from Intl currency style
  });

  it("WP10: Arabic renders the same figures with د.إ, matching formatMoneyText", () => {
    act(() => useI18n.getState().setLocale("ar"));
    const text = renderStatement();
    expect(text).toContain(
      stripBidiControls(formatMoneyText(12345.5, "AED", "ar")).replace(/\s+/g, "")
    );
    expect(text).toContain("12,345.50د.إ");
    expect(text).toContain("−1,500.00د.إ");
  });
});
