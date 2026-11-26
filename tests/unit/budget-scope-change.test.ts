// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { budgetScopeChange, type BudgetScopeChange } from "../../client/src/lib/budget-scope";
import { BudgetScopeChangeDialog } from "../../client/src/components/budgets/BudgetScopeChangeDialog";
import { budgetCategoryLabel } from "../../client/src/lib/budget-categories";
import { formatMessage, loadLocale, t, useI18n, type Locale } from "../../client/src/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The dialog reads the real catalogs through useTranslation(), so each test loads the locale's
// namespace catalogs (the same app-wide load main.tsx awaits) and sets the store locale before
// rendering. Without this the dialog renders raw keys such as "budgets.scopeTitleCopy".
const mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement }[] = [];

async function renderDialog(
  change: BudgetScopeChange | null,
  locale: Locale,
  onAcknowledge: () => void = vi.fn()
) {
  await loadLocale(locale);
  await act(async () => {
    useI18n.setState({ locale });
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(createElement(BudgetScopeChangeDialog, { change, locale, onAcknowledge }));
  });
  return { container, root };
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
  // Radix portals the dialog into <body>; make sure nothing leaks into the next test.
  document.body.innerHTML = "";
  await act(async () => {
    useI18n.setState({ locale: "en" });
  });
});

// Demo data only.
const response = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Demo Budget (FY2027)",
  clearedPlanCostCenterIds: ["22222222-2222-4222-8222-222222222222"],
  clearedLineCostCenterIds: ["33333333-3333-4333-8333-333333333333"],
  clearedLines: [
    {
      category: "Marketing",
      description: "Demo campaign",
      costCenterId: "33333333-3333-4333-8333-333333333333",
    },
  ],
};

describe("budget copy / new version scope change", () => {
  it("returns null when nothing was cleared (plain success)", () => {
    expect(budgetScopeChange("copy", { id: "x", name: "n" })).toBeNull();
    expect(
      budgetScopeChange("newVersion", {
        clearedPlanCostCenterIds: [],
        clearedLineCostCenterIds: [],
        clearedLines: [],
      })
    ).toBeNull();
  });

  it.each(["copy", "newVersion"] as const)(
    "reports the cleared plan and lines for %s",
    (action) => {
      const change = budgetScopeChange(action, response);
      expect(change).toMatchObject({
        action,
        planName: "Demo Budget (FY2027)",
        planCostCenterCleared: true,
      });
      expect(change!.lines).toEqual([
        expect.objectContaining({ category: "Marketing", description: "Demo campaign" }),
      ]);
    }
  );

  it("still surfaces an id-only response", () => {
    const change = budgetScopeChange("copy", {
      id: "x",
      name: "n",
      clearedLineCostCenterIds: ["a", "b"],
    });
    expect(change?.lines).toHaveLength(2);
  });

  it.each([
    ["copy", "en", "Budget copied: scope changed"],
    ["newVersion", "en", "New version created: scope changed"],
    ["copy", "ar", "تم نسخ الموازنة: تغيّر النطاق"],
    ["newVersion", "ar", "تم إنشاء النسخة الجديدة: تغيّر النطاق"],
  ] as const)("shows the dialog for %s in %s until acknowledged", async (action, locale, title) => {
    const change = budgetScopeChange(action, response);
    const onAcknowledge = vi.fn();
    await renderDialog(change, locale, onAcknowledge);

    const dialog = document.body.querySelector('[data-testid="budget-scope-dialog"]');
    expect(dialog).not.toBeNull();
    const text = dialog!.textContent!;
    expect(text).toContain(title);
    // No raw catalog keys or uninterpolated placeholders.
    expect(text).not.toMatch(/budgets\.scope|forms\.budget\.cat\./);
    expect(text).not.toMatch(/\{(name|line|scope|category|description)\}/);

    // Description interpolates the plan name.
    const description = formatMessage(t[locale]["budgets.scopeDescription"], {
      name: "Demo Budget (FY2027)",
    });
    expect(description).toContain("Demo Budget (FY2027)");
    expect(text).toContain(description);

    // The line shows the translated category (catalog label) plus its description.
    const category = budgetCategoryLabel(t[locale], "Marketing");
    expect(category).not.toBe("forms.budget.cat.Marketing");
    const items = Array.from(dialog!.querySelectorAll('[data-testid="budget-scope-list"] li')).map(
      (li) => li.textContent ?? ""
    );
    expect(items.some((i) => i.includes(category) && i.includes("Demo campaign"))).toBe(true);
    expect(onAcknowledge).not.toHaveBeenCalled();

    const button = Array.from(dialog!.querySelectorAll("button")).pop()!;
    await act(async () => {
      button.click();
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("keeps the fallback the server reported for each line", () => {
    const change = budgetScopeChange("copy", {
      id: "x",
      name: "n",
      clearedLines: [
        { category: "A", description: null, costCenterId: "c1", fallback: "plan" },
        { category: "C", description: null, costCenterId: "c2", fallback: "all" },
        { category: "D", description: null, costCenterId: "c3", fallback: "bogus" },
      ],
    });
    expect(change!.lines.map((l) => l.fallback)).toEqual(["plan", "all", undefined]);
  });

  it.each([
    ["en", "now uses the plan's cost centre", "now includes all cost centres"],
    ["ar", "يستخدم الآن مركز تكلفة الخطة", "يشمل الآن كل مراكز التكلفة"],
  ] as const)(
    "labels the plan and all fallbacks per line in %s",
    async (locale, planText, allText) => {
      const change = budgetScopeChange("copy", {
        id: "x",
        name: "n",
        clearedLines: [
          { category: "Marketing", description: "One", costCenterId: "c1", fallback: "plan" },
          { category: "Marketing", description: "Two", costCenterId: "c2", fallback: "all" },
        ],
      });
      await renderDialog(change, locale);
      const items = Array.from(
        document.body.querySelectorAll('[data-testid="budget-scope-list"] li')
      ).map((li) => li.textContent ?? "");
      expect(items).toHaveLength(2);
      expect(items[0]).toContain(planText);
      expect(items[0]).not.toContain(allText);
      expect(items[1]).toContain(allText);
      expect(items[1]).not.toContain(planText);
      // The old "widened" wording must be gone from the dialog.
      const dialogText = document.body.querySelector(
        '[data-testid="budget-scope-dialog"]'
      )!.textContent!;
      expect(dialogText).not.toMatch(/widened|اتّسع/);
    }
  );
});
