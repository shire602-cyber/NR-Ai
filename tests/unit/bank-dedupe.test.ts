import { describe, expect, it } from "vitest";
import { dedupeKey, planBankInsert } from "../../server/services/bank-dedupe";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const line = (date: string, amount: number, externalId: string | null = null) => ({ date: d(date), amount, externalId });
const row = (date: string, amount: number, externalId: string | null = null) => ({ dedupeKey: dedupeKey(d(date), amount), externalId });

describe("bank dedupe", () => {
  it("keys on the Dubai day and the signed amount, not the description", () => {
    expect(dedupeKey(d("2026-09-01"), -820.5)).toBe("2026-09-01|-820.50");
    // 21:00 UTC is already the next day in Dubai
    expect(dedupeKey(new Date("2026-09-01T21:00:00Z"), 10)).toBe("2026-09-02|10.00");
  });

  it("a re-upload adds nothing", () => {
    const existing = [row("2026-09-01", -820.5, "A"), row("2026-09-02", 5250, "B")];
    const plan = planBankInsert(existing, [line("2026-09-01", -820.5, "A"), line("2026-09-02", 5250, "B")]);
    expect(plan.insert).toEqual([]);
    expect(plan.duplicates).toEqual([0, 1]);
  });

  it("a CSV of the same days (no ids) adds nothing after an OFX import", () => {
    const existing = [row("2026-09-01", -820.5, "A"), row("2026-09-02", 5250, "B")];
    const plan = planBankInsert(existing, [line("2026-09-01", -820.5), line("2026-09-02", 5250)]);
    expect(plan.insert).toEqual([]);
  });

  it("identical same-day lines both survive the first import", () => {
    const plan = planBankInsert([], [line("2026-09-01", -5), line("2026-09-01", -5)]);
    expect(plan.insert).toEqual([0, 1]);
  });

  it("a third identical line is new when two already exist", () => {
    const existing = [row("2026-09-01", -5), row("2026-09-01", -5)];
    const plan = planBankInsert(existing, [line("2026-09-01", -5), line("2026-09-01", -5), line("2026-09-01", -5)]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(2);
  });

  it("a new id on a counted day still lands when the other two are known by id", () => {
    const existing = [row("2026-09-01", -5, "F1"), row("2026-09-01", -5, "F2")];
    const plan = planBankInsert(existing, [line("2026-09-01", -5, "F1"), line("2026-09-01", -5, "F2"), line("2026-09-01", -5, "F3")]);
    expect(plan.insert).toEqual([2]);
    expect(plan.duplicates).toEqual([0, 1]);
  });

  it("a repeated id inside one file is a duplicate", () => {
    const plan = planBankInsert([], [line("2026-09-01", -5, "X"), line("2026-09-02", -7, "X")]);
    expect(plan.insert).toEqual([0]);
    expect(plan.duplicates).toEqual([1]);
  });

  it("different amounts or days are new", () => {
    const plan = planBankInsert([row("2026-09-01", -5)], [line("2026-09-01", -6), line("2026-09-02", -5)]);
    expect(plan.insert).toEqual([0, 1]);
  });
});
