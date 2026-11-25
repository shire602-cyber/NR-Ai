// @vitest-environment jsdom
/**
 * WQ3 (accounting core gaps): behaviour tests for the pure grid / chart helpers and the
 * Tax rates page rendered from the VAT engine's own box map.
 */
import { createElement as h, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  blankGridLine,
  fromStoredLines,
  gridTotals,
  toPayloadLine,
  type PreviewContext,
} from "../../client/src/lib/journal-grid";
import {
  drawerParentCandidates,
  roleLocked,
  rollUpTotals,
  suggestAccountCode,
} from "../../client/src/lib/account-hierarchy";
import { vatBoxMap, describeBoxKey } from "../../server/tax/vat-box-map";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  const { loadLocale } = await import("../../client/src/lib/i18n");
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const acc = (id: string, code: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  code,
  nameEn: `Account ${code}`,
  type,
  parentId: null as string | null,
  ...extra,
});

describe("WQ3 9.4: journal grid model", () => {
  const ctx: PreviewContext = {
    baseCurrency: "AED",
    rateFor: (c) => (c === "EUR" ? 4.1 : null),
    vatRate: 0.05,
    accountType: (id) => (id === "inc" ? "income" : "expense"),
  };

  it("previews converted foreign lines and derived VAT legs in the balance", () => {
    const lines = [
      { ...blankGridLine(), accountId: "exp", debit: 1000, vatTreatment: "standard" as const },
      { ...blankGridLine(), accountId: "eur", debit: 100, currency: "EUR" },
      { ...blankGridLine(), accountId: "bank", credit: 1460 },
    ];
    const t = gridTotals(lines, ctx);
    // 1000 + 50 VAT + 410 = 1460.
    expect(t).toEqual({ debitFils: 146000, creditFils: 146000, vatFils: 5000, known: true });
    expect(gridTotals([{ ...lines[1], currency: "GBP" }], ctx).known).toBe(false);
  });

  it("builds the strict payload: foreign amounts without base, contact split, CT share", () => {
    expect(
      toPayloadLine(
        {
          ...blankGridLine(),
          accountId: "a1",
          debit: 100,
          currency: "EUR",
          contact: "vendor:v1",
          description: " Hotel ",
          ctTreatment: "non_deductible",
          ctDisallowedPct: 50,
        },
        "AED"
      )
    ).toEqual({
      accountId: "a1",
      foreignCurrency: "EUR",
      foreignDebit: 100,
      description: "Hotel",
      contactType: "vendor",
      contactId: "v1",
      ctTreatment: "non_deductible",
      ctDisallowedPct: 50,
    });
    expect(toPayloadLine({ ...blankGridLine(), accountId: "a2", credit: 5 }, "AED")).toEqual({
      accountId: "a2",
      debit: 0,
      credit: 5,
    });
  });

  it("drops the server's derived VAT legs when a draft is edited", () => {
    const grid = fromStoredLines(
      [
        { accountId: "exp", debit: 1000, vatTreatment: "standard" },
        { accountId: "vat", debit: 50, systemVat: true },
        { accountId: "bank", credit: 1050 },
      ],
      "AED"
    );
    expect(grid.map((l) => [l.accountId, l.debit, l.credit, l.vatTreatment])).toEqual([
      ["exp", 1000, 0, "standard"],
      ["bank", 0, 1050, ""],
    ]);
  });
});

describe("WQ3 9.1 / 9.3: chart helpers", () => {
  const ar = acc("ar", "1040", "asset");
  const sub = acc("sub", "1041", "asset", { parentId: "ar" });
  const cash = acc("cash", "1010", "asset");
  const travel = acc("t", "5090", "expense");
  const meals = acc("m", "5091", "expense", { parentId: "t" });
  const all = [ar, sub, cash, travel, meals];

  it("suggests the next free code from the parent or the type", () => {
    expect(suggestAccountCode(all, { type: "expense", parentId: "t" })).toBe("5092");
    expect(suggestAccountCode(all, { type: "expense" })).toBe("5092");
    expect(suggestAccountCode(all, { type: "liability" })).toBe("2010");
  });

  it("never offers a control account (or its sub-account) as a parent; locks control roles", () => {
    expect(drawerParentCandidates(all, "asset").map((a) => a.code)).toEqual(["1010"]);
    expect(drawerParentCandidates(all, "expense", "t").map((a) => a.code)).toEqual([]);
    expect(roleLocked(sub, all)).toBe(true);
    expect(roleLocked(cash, all)).toBe(false);
  });

  it("rolls sub-account figures up into their parents", () => {
    const rows = [
      { account: travel, debitTotal: 100, creditTotal: 0, balance: 100 },
      { account: meals, debitTotal: 40, creditTotal: 0, balance: 40 },
    ];
    const r = rollUpTotals(rows, (x) => x.account);
    expect(r.get("t")).toEqual({ debitTotal: 140, creditTotal: 0, balance: 140 });
    expect(r.get("m")).toEqual({ debitTotal: 40, creditTotal: 0, balance: 40 });
  });
});

describe("WQ3 9.13: tax rates page", () => {
  it("reads box keys from the engine and renders them", async () => {
    expect(describeBoxKey("box1bDubaiVat")).toEqual({
      box: "1b",
      part: "vat",
      key: "box1bDubaiVat",
    });
    const map = vatBoxMap({ emirate: "sharjah" });
    const std = map.rows.find((r) => r.side === "sales" && r.treatment === "standard")!;
    expect(std.boxes.map((b) => b.key)).toEqual(["box1cSharjahAmount", "box1cSharjahVat"]);
    const rc = map.rows.find((r) => r.side === "purchases" && r.treatment === "reverse_charge")!;
    expect([...new Set(rc.boxes.map((b) => b.box))]).toEqual(["3", "10"]);

    const { TaxRatesView } = await import("../../client/src/pages/settings/TaxRates");
    const qc = new QueryClient();
    await act(async () => {
      root.render(h(QueryClientProvider, { client: qc }, h(TaxRatesView, { data: map as never })));
    });
    const row = container.querySelector('[data-testid="tax-rate-sales-standard"]')!;
    expect(row.textContent).toContain("5%");
    expect(row.querySelector('[data-testid="box-1c"]')).not.toBeNull();
    const zero = container.querySelector('[data-testid="tax-rate-sales-zero_rated"]')!;
    expect(zero.querySelector('[data-testid="box-4"]')).not.toBeNull();
    const oos = container.querySelector('[data-testid="tax-rate-sales-out_of_scope"]')!;
    expect(oos.textContent).toContain("Not reported");
  });
});
