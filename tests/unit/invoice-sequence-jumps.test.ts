import { describe, expect, it } from "vitest";
import { sequenceJumps } from "../../server/services/invoice-numbering.service";

// Importing an opening invoice INV-2026-00500 moves the sequence to 00501 and leaves 00002-00499
// unused for good. UAE tax invoices need sequential numbering: a jump that can be explained is
// defensible, a silent one is not. The numbering behaviour itself is unchanged; this only warns.

describe("sequenceJumps", () => {
  it("warns when an imported number moves the sequence forward by more than 1", () => {
    const [j] = sequenceJumps("invoice", ["INV-2026-00500"], new Map([[2026, 1]]));
    expect(j).toMatchObject({
      year: 2026,
      highestExisting: 1,
      importedHighest: 500,
      nextNumber: "INV-2026-00501",
      gap: 498,
      firstUnused: "INV-2026-00002",
      lastUnused: "INV-2026-00499",
    });
    expect(j.message).toContain("INV-2026-00500");
    expect(j.message).toContain("INV-2026-00501");
    expect(j.message).toContain("498");
    expect(j.message).toContain("INV-2026-00002");
    expect(j.message).toContain("INV-2026-00499");
    expect(j.message).toMatch(/sequen/i);
  });

  it("numbers imported in the same run are not a gap: only the unused ones are counted", () => {
    const [j] = sequenceJumps("invoice", ["INV-2026-00001", "INV-2026-00003"], new Map());
    expect(j).toMatchObject({ gap: 1, firstUnused: "INV-2026-00002", lastUnused: "INV-2026-00002", nextNumber: "INV-2026-00004" });
    // 1, 2, 3 imported together leave nothing unused: no warning
    expect(sequenceJumps("invoice", ["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"], new Map())).toEqual([]);
  });

  it("no warning when the imported number simply continues the sequence (highest + 1)", () => {
    expect(sequenceJumps("invoice", ["INV-2026-00002"], new Map([[2026, 1]]))).toEqual([]);
  });

  it("no warning when the imported number is at or below what already exists (the counter does not move)", () => {
    expect(sequenceJumps("invoice", ["INV-2026-00001", "INV-2026-00005"], new Map([[2026, 10]]))).toEqual([]);
  });

  it("a gap of exactly one number is a warning (highest 1, imported 3)", () => {
    const [j] = sequenceJumps("invoice", ["INV-2026-00003"], new Map([[2026, 1]]));
    expect(j.gap).toBe(1);
    expect(j.firstUnused).toBe("INV-2026-00002");
    expect(j.lastUnused).toBe("INV-2026-00002");
  });

  it("with no invoice numbered yet in that year the whole run below the imported number is unused", () => {
    const [j] = sequenceJumps("invoice", ["INV-2026-00500"], new Map());
    expect(j).toMatchObject({ highestExisting: 0, gap: 499, firstUnused: "INV-2026-00001", nextNumber: "INV-2026-00501" });
  });

  it("only the highest imported number per year counts, and each year is judged on its own", () => {
    const r = sequenceJumps("invoice", ["INV-2026-00100", "INV-2026-00300", "INV-2025-00010"], new Map([[2026, 5], [2025, 9]]));
    // 2025: 10 follows 9, no gap. 2026: highest imported 300 after 5 leaves 294 numbers, one of which (100) was imported too.
    expect(r.map((j) => [j.year, j.importedHighest, j.gap])).toEqual([[2026, 300, 293]]);
  });

  it("numbers that are not in the sequence's own format are ignored", () => {
    expect(sequenceJumps("invoice", ["OLD-778", "2026/00500", "INV-26-00500"], new Map([[2026, 1]]))).toEqual([]);
  });
});
