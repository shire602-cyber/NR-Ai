// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { budgetScopeChange } from "../../client/src/lib/budget-scope";
import { BudgetScopeChangeDialog } from "../../client/src/components/budgets/BudgetScopeChangeDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(BudgetScopeChangeDialog, { change, locale, onAcknowledge }));
    });

    const dialog = document.body.querySelector('[data-testid="budget-scope-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain(title);
    expect(dialog!.textContent).toContain("Marketing");
    expect(onAcknowledge).not.toHaveBeenCalled();

    const button = Array.from(dialog!.querySelectorAll("button")).pop()!;
    await act(async () => {
      button.click();
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
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
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          createElement(BudgetScopeChangeDialog, { change, locale, onAcknowledge: vi.fn() })
        );
      });
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

      act(() => root.unmount());
      container.remove();
    }
  );
});
