import { describe, expect, it } from "vitest";
import { resolveDescription, resolveDetails, resolveTitle } from "../../client/src/components/month-end/checklist-text";

describe("month-end checklist text", () => {
  it("maps items 1 to 7 to their titles and descriptions and leaves others alone", () => {
    expect(resolveTitle({ id: 6, title: "Depreciation Entries Posted", description: "" })).toEqual({ key: "title6", params: {} });
    expect(resolveDescription({ id: 1, title: "", description: "" })?.key).toBe("desc1");
    expect(resolveTitle({ id: 9, title: "x", description: "" })).toBeNull();
  });
  it("reads the figures out of the known sentences", () => {
    expect(resolveDetails("0/2 assets depreciated through 2026-09")).toEqual({ key: "dAssets", params: { done: "0", total: "2", month: "2026-09" } });
    expect(resolveDetails("3/5 posted (2 drafts remaining)")).toEqual({ key: "dInvoices", params: { done: "3", total: "5", left: "2" } });
    expect(resolveDetails("1/2 bank accounts have a completed reconciliation as at 2026-09-30 (4 lines unreconciled)")?.params).toEqual({ done: "1", total: "2", date: "2026-09-30", lines: "4" });
    expect(resolveDetails("7 items pending review")).toEqual({ key: "dAiPending", params: { count: "7" } });
    expect(resolveDetails("2 classifications pending review")?.key).toBe("dAiPending");
    expect(resolveDetails("No bank transactions in this period")?.key).toBe("dNoBank");
  });
  it("covers the revaluation item and the VAT sentences", () => {
    expect(resolveTitle({ id: 8, title: "", description: "" })?.key).toBe("title8");
    expect(resolveDetails("Not revalued at 2026-09-30: ADCB USD (USD)")).toEqual({ key: "dFxOpen", params: { date: "2026-09-30", names: "ADCB USD (USD)" } });
    expect(resolveDetails("1 foreign-currency bank account(s) revalued at 2026-09-30")?.key).toBe("dFxDone");
    expect(resolveDetails("No VAT return prepared for this period")?.key).toBe("dNoVat");
  });
  it("returns null for a sentence it does not know", () => {
    expect(resolveDetails("Something the server added later")).toBeNull();
    expect(resolveDetails(undefined)).toBeNull();
  });
});
