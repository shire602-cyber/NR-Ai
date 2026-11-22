import { describe, expect, it } from "vitest";
import { isVatFilingRecorded } from "../../shared/vat-filing-status";

describe("VAT filing evidence", () => {
  it.each(["filed", "paid", "accepted", "amended"])(
    "requires a nonblank reference for a %s return",
    (status) => {
      expect(isVatFilingRecorded(status, " FTA-2026-01 ")).toBe(true);
      expect(isVatFilingRecorded(status, "  ")).toBe(false);
      expect(isVatFilingRecorded(status, null)).toBe(false);
      expect(isVatFilingRecorded(status)).toBe(false);
    }
  );

  it.each(["draft", "finalised"])(
    "keeps a %s return outstanding even with a reference",
    (status) => {
      expect(isVatFilingRecorded(status, "FTA-2026-01")).toBe(false);
    }
  );
});
