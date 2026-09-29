import { describe, expect, it } from "vitest";
import {
  SYSTEM_ENTRY_NOT_REVERSIBLE,
  SYSTEM_ENTRY_READ_ONLY,
  editRefusal,
  reversalRefusal,
  systemEntryUndoHint,
} from "../../server/services/journal-entry-protection";

describe("reversalRefusal", () => {
  it("allows a manual journal", () => {
    expect(reversalRefusal({ source: "manual" })).toBeNull();
  });

  it("allows the reversal of a manual journal (correcting a correction)", () => {
    expect(reversalRefusal({ source: "reversal", reversedEntryId: "o" }, { source: "manual" })).toBeNull();
  });

  it("refuses the reversal of a system entry, and a reversal with no known original", () => {
    expect(reversalRefusal({ source: "reversal", reversedEntryId: "o" }, { source: "vat_filing" })?.code).toBe(SYSTEM_ENTRY_NOT_REVERSIBLE);
    expect(reversalRefusal({ source: "reversal", reversedEntryId: null })?.code).toBe(SYSTEM_ENTRY_NOT_REVERSIBLE);
  });

  it.each([
    ["vat_filing", /amendment/i],
    ["invoice", /void the invoice|credit note/i],
    ["year_end_close", /reopen/i],
    ["corporate_tax_filing", /amendment/i],
    ["fx_revaluation", /fx revaluation/i],
    ["payment", /payment/i],
  ])("refuses source %s and names the way to undo it", (source, hint) => {
    const r = reversalRefusal({ source });
    expect(r?.code).toBe(SYSTEM_ENTRY_NOT_REVERSIBLE);
    expect(r?.message).toMatch(hint);
    expect(r?.message).toContain(source);
  });

  it("falls back to a generic hint for an unknown source", () => {
    expect(systemEntryUndoHint("something_new")).toMatch(/screen or document that created it/);
    expect(reversalRefusal({ source: "something_new" })?.code).toBe(SYSTEM_ENTRY_NOT_REVERSIBLE);
  });
});

describe("editRefusal", () => {
  it("refuses editing or deleting anything but a manual journal", () => {
    expect(editRefusal({ source: "manual" })).toBeNull();
    expect(editRefusal({ source: "invoice" })?.code).toBe(SYSTEM_ENTRY_READ_ONLY);
    expect(editRefusal({ source: "reversal" }, { source: "invoice" })?.code).toBe(SYSTEM_ENTRY_READ_ONLY);
  });
});
