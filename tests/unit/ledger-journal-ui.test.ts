/**
 * R02-09: the journal UI reads the API's reversal fields on BOTH entries,
 * reads `source` (not `sourceType`), has no client-only "reversed" status,
 * and its new strings are translated (en + ar).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync("client/src/pages/JournalEntryDetail.tsx", "utf8");
const list = readFileSync("client/src/pages/Journal.tsx", "utf8");
const en = JSON.parse(readFileSync("client/src/locales/en/journal.json", "utf8"));
const ar = JSON.parse(readFileSync("client/src/locales/ar/journal.json", "utf8"));

describe("R02-09 journal UI reversal state", () => {
  it("R02-09: detail page uses reversedByEntryId and reversalOf, not the reversal-only reversedEntryId", () => {
    expect(detail).toContain("entry.reversedByEntryId");
    expect(detail).toContain("entry.reversalOf");
    expect(detail).not.toMatch(/entry\.reversedEntryId\b/);
  });

  it("R02-09: reads `source`, never `sourceType`", () => {
    expect(detail).not.toContain("sourceType");
    expect(detail).toContain("entry.source");
  });

  it("R02-09: the status type matches the server (draft | posted | void) and lifecycle is derived", () => {
    expect(detail).not.toMatch(/status:\s*"draft"\s*\|\s*"posted"\s*\|\s*"reversed"/);
    expect(detail).toMatch(/status:\s*"draft"\s*\|\s*"posted"\s*\|\s*"void"/);
    expect(detail).toContain("lifecycleStatus");
    expect(list).toContain("lifecycleStatus");
  });

  it("R02-09: 'Reversal Information' and the reversal/void actions are translated", () => {
    expect(detail).not.toMatch(/>\s*Reversal Information\s*</);
    expect(detail).toContain('t["journal.reversalInformation"]');
    for (const key of [
      "journal.reversalInformation",
      "journal.reversedBy",
      "journal.reversalOf",
      "journal.reversalDate",
      "journal.void",
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(ar[key], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("R02-16a: the list offers a reversal-date picker and a void action; no 0.01 tolerance", () => {
    expect(list).toContain("/void`");
    expect(list).toContain("input-reversal-date-");
    expect(list).not.toContain("< 0.01");
    expect(detail).not.toContain("< 0.01");
    expect(list).not.toContain("Original entry marked as void");
    expect(list).not.toMatch(/companyId: selectedCompanyId,\n\s+lines:/);
  });
});
