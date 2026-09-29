import { describe, expect, it } from "vitest";
import {
  findNextFreeSequenceValue,
  parseSequenceNumber,
  sequenceAdvancesFromNumbers,
  MAX_SEQUENCE_SKIPS,
} from "../../server/services/invoice-numbering.service";

describe("findNextFreeSequenceValue", () => {
  it("returns the candidate when nothing is taken", () => {
    expect(findNextFreeSequenceValue(1, [])).toEqual({ ok: true, value: 1, skipped: 0 });
  });

  it("skips forward over taken numbers", () => {
    expect(findNextFreeSequenceValue(1, [1, 2, 3])).toEqual({ ok: true, value: 4, skipped: 3 });
  });

  it("stops at the first gap, not at the highest taken number", () => {
    expect(findNextFreeSequenceValue(1, [1, 3, 4])).toEqual({ ok: true, value: 2, skipped: 1 });
  });

  it("ignores taken numbers below the candidate", () => {
    expect(findNextFreeSequenceValue(10, [1, 2, 3])).toEqual({ ok: true, value: 10, skipped: 0 });
  });

  it("accepts unsorted input with duplicates", () => {
    expect(findNextFreeSequenceValue(5, [7, 5, 6, 5, 9])).toEqual({ ok: true, value: 8, skipped: 3 });
  });

  it("gives up after the bound and says so instead of looping forever", () => {
    const taken = Array.from({ length: MAX_SEQUENCE_SKIPS + 5 }, (_, i) => i + 1);
    const res = findNextFreeSequenceValue(1, taken);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(MAX_SEQUENCE_SKIPS);
  });

  it("honours a custom bound", () => {
    expect(findNextFreeSequenceValue(1, [1, 2, 3], 2)).toEqual({ ok: false, skipped: 2 });
    expect(findNextFreeSequenceValue(1, [1, 2], 2)).toEqual({ ok: true, value: 3, skipped: 2 });
  });
});

describe("parseSequenceNumber", () => {
  it("reads year and counter of the sequence's own format", () => {
    expect(parseSequenceNumber("invoice", "INV-2026-00003")).toEqual({ year: 2026, value: 3 });
    expect(parseSequenceNumber("credit_note", "CN-2025-00120")).toEqual({ year: 2025, value: 120 });
    expect(parseSequenceNumber("quote", "QT-2026-100000")).toEqual({ year: 2026, value: 100000 });
  });

  it("rejects other prefixes, free text and absurd widths", () => {
    expect(parseSequenceNumber("invoice", "OB-INV-1")).toBeNull();
    expect(parseSequenceNumber("invoice", "CN-2026-00001")).toBeNull();
    expect(parseSequenceNumber("invoice", "INV-2026-")).toBeNull();
    expect(parseSequenceNumber("invoice", "INV-26-00001")).toBeNull();
    expect(parseSequenceNumber("invoice", " INV-2026-00001")).toBeNull();
    expect(parseSequenceNumber("invoice", "INV-2026-9999999999999")).toBeNull();
  });
});

describe("sequenceAdvancesFromNumbers (opening documents)", () => {
  it("returns the highest matching counter per year", () => {
    const res = sequenceAdvancesFromNumbers("invoice", [
      "INV-2026-00001", "INV-2026-00003", "INV-2025-00090", "OB-INV-7", "CN-2026-00050",
    ]);
    expect(res).toEqual([
      { year: 2025, value: 90 },
      { year: 2026, value: 3 },
    ]);
  });

  it("returns nothing when no number matches the sequence format", () => {
    expect(sequenceAdvancesFromNumbers("invoice", ["A-1", "B-2"])).toEqual([]);
  });
});
