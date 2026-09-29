import { describe, expect, it } from "vitest";
import {
  MANUAL_JOURNAL_SOURCE,
  buildManualJournalInsert,
  buildManualJournalUpdate,
  vatJournalDescriptionProblem,
} from "../../server/services/manual-journal-input";

// A journal created through the journal routes is ALWAYS a manual journal. The reports trust
// `source` (year_end_close is dropped from the P&L, vat_filing / opening_balance from the VAT
// ledger reading), so nothing but the allow-listed fields may come from the request body.

const FORGED = {
  source: "year_end_close",
  sourceId: "11111111-1111-1111-1111-111111111111",
  sourceType: "year_end_close",
  reversedEntryId: "22222222-2222-2222-2222-222222222222",
  reversalReason: "forged",
  postedBy: "33333333-3333-3333-3333-333333333333",
  createdBy: "44444444-4444-4444-4444-444444444444",
  entryNumber: "JE-FORGED",
  companyId: "55555555-5555-5555-5555-555555555555",
  updatedBy: "66666666-6666-6666-6666-666666666666",
  id: "77777777-7777-7777-7777-777777777777",
  createdAt: "2001-01-01T00:00:00Z",
};
const CTX = { companyId: "c1", userId: "u1", entryNumber: "JE-2026-001", date: new Date("2026-08-10T00:00:00Z"), now: new Date("2026-09-29T08:00:00Z") };

describe("manual journal input allow-list", () => {
  it("source is always 'manual' whatever the body says", () => {
    expect(MANUAL_JOURNAL_SOURCE).toBe("manual");
    for (const source of ["year_end_close", "vat_filing", "opening_balance", "vat_payment", "invoice", undefined, null, 5]) {
      const row = buildManualJournalInsert({ ...FORGED, source, memo: "x" }, { ...CTX, status: "posted" });
      expect(row.source).toBe("manual");
    }
  });

  it("no system field is taken from the body", () => {
    const row = buildManualJournalInsert({ ...FORGED, memo: "Accrual" }, { ...CTX, status: "posted" });
    expect(row).toEqual({
      companyId: "c1",
      createdBy: "u1",
      entryNumber: "JE-2026-001",
      date: CTX.date,
      memo: "Accrual",
      status: "posted",
      source: "manual",
      sourceId: null,
      postedBy: "u1",
      postedAt: CTX.now,
    });
  });

  it("a draft has no poster; description fills the memo when memo is absent", () => {
    const row = buildManualJournalInsert({ description: "Narration" }, { ...CTX, status: "draft" });
    expect(row.memo).toBe("Narration");
    expect(row.status).toBe("draft");
    expect(row.postedBy).toBeNull();
    expect(row.postedAt).toBeNull();
  });

  it("an unknown status becomes a draft (never a system status)", () => {
    const row = buildManualJournalInsert({}, { ...CTX, status: "void" });
    expect(row.status).toBe("draft");
  });

  it("update carries only date, memo and status fields, and never a source", () => {
    const patch = buildManualJournalUpdate({ ...FORGED, memo: "New", notes: "n", description: "d", status: "posted" }, {
      userId: "u1",
      date: CTX.date,
      now: CTX.now,
    });
    expect(patch).toEqual({
      date: CTX.date,
      updatedBy: "u1",
      updatedAt: CTX.now,
      memo: "New",
      status: "posted",
      postedBy: "u1",
      postedAt: CTX.now,
    });
    expect("source" in patch).toBe(false);
  });

  it("update rejects a status other than draft or posted", () => {
    expect(() => buildManualJournalUpdate({ status: "void" }, { userId: "u1", date: CTX.date, now: CTX.now })).toThrow(/only 'draft' or 'posted'/);
  });
});

describe("a manual VAT journal needs a description", () => {
  const accountsById = new Map([
    ["out", { code: "2020", type: "liability", isVatAccount: true, vatType: "output" }],
    ["exp", { code: "5000", type: "expense", isVatAccount: false, vatType: null }],
    ["bank", { code: "1020", type: "asset", isVatAccount: false, vatType: null }],
  ]);
  const vatLines = [{ accountId: "out" }, { accountId: "exp" }];
  it("refuses a posted VAT journal with an empty or blank description", () => {
    for (const memo of [undefined, null, "", "   "]) {
      expect(vatJournalDescriptionProblem({ isPosting: true, memo, lines: vatLines, accountsById })).toMatch(/description/);
    }
  });
  it("accepts a described VAT journal, any journal that does not touch VAT, and drafts", () => {
    expect(vatJournalDescriptionProblem({ isPosting: true, memo: "Correct output VAT", lines: vatLines, accountsById })).toBeNull();
    expect(vatJournalDescriptionProblem({ isPosting: true, memo: "", lines: [{ accountId: "exp" }, { accountId: "bank" }], accountsById })).toBeNull();
    expect(vatJournalDescriptionProblem({ isPosting: false, memo: "", lines: vatLines, accountsById })).toBeNull();
  });
});
