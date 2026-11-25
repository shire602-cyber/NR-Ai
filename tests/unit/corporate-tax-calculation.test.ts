// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDraftBody,
  isEmptyCalculation,
} from "../../client/src/pages/corporateTax/screenState";
import { useCtCalculation } from "../../client/src/pages/corporateTax/useCtCalculation";

interface Result {
  totalRevenue: number;
  totalExpenses: number;
  journalEntriesProcessed: number;
}

const EMPTY: Result = { totalRevenue: 0, totalExpenses: 0, journalEntriesProcessed: 0 };
const YEAR_A = { periodStart: "2025-01-01", periodEnd: "2025-12-31" };
const YEAR_B = { periodStart: "2026-01-01", periodEnd: "2026-12-31" };

let root: Root;
let hook: ReturnType<typeof useCtCalculation<Result>>;
let period = YEAR_A;
const request = vi.fn<() => Promise<Result>>();
const onSuccess = vi.fn();
const client = new QueryClient();

function Probe() {
  hook = useCtCalculation<Result>({ companyId: "c1", ...period, request, onSuccess });
  return null;
}

async function select(next: typeof YEAR_A) {
  period = next;
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Probe)));
  });
}

async function calculate() {
  await act(async () => {
    hook.calculate();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What the page derives from the hook for the empty-period notice and "Save as Draft". */
function screen() {
  return {
    notice: isEmptyCalculation(hook.calculation, false),
    draft: buildDraftBody({
      ...period,
      calculation: hook.calculation,
      manual: null,
      deductions: 0,
      rows: [],
      notes: "",
    }),
  };
}

describe("corporate tax calculation is tied to the selected period", () => {
  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    request.mockReset();
    onSuccess.mockReset();
    root = createRoot(document.createElement("div"));
    await select(YEAR_A);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
  });

  it("empty success, new dates, failed recalculation: nothing stale, nothing to save", async () => {
    request.mockResolvedValueOnce(EMPTY);
    await calculate();
    expect(screen().notice).toBe(true);
    expect(screen().draft).not.toBeNull();

    await select(YEAR_B);
    expect(hook.calculation).toBeNull();
    expect(screen()).toEqual({ notice: false, draft: null });

    request.mockRejectedValueOnce(new Error("boom"));
    await calculate();
    expect(hook.calculation).toBeNull();
    expect(screen()).toEqual({ notice: false, draft: null });

    // Going back does not revive the old figures either.
    await select(YEAR_A);
    expect(hook.calculation).toBeNull();
  });

  it("drops the previous result when a recalculation of the same period fails", async () => {
    request.mockResolvedValueOnce(EMPTY);
    await calculate();
    request.mockRejectedValueOnce(new Error("boom"));
    await calculate();
    expect(screen()).toEqual({ notice: false, draft: null });
  });

  it("ignores a response that arrives after the period changed", async () => {
    let resolve!: (result: Result) => void;
    request.mockReturnValueOnce(new Promise<Result>((r) => (resolve = r)));
    await calculate();
    await select(YEAR_B);
    await act(async () => {
      resolve(EMPTY);
      await new Promise((done) => setTimeout(done, 0));
    });
    expect(hook.calculation).toBeNull();
    expect(screen()).toEqual({ notice: false, draft: null });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
