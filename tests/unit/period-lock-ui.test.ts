import { describe, expect, it } from "vitest";
import {
  canUnlockPeriod,
  lockAllowed,
  lockBody,
  unlockBody,
  unlockReasonOk,
  vatItemOpen,
} from "../../client/src/lib/period-lock";
import { resolveDetails } from "../../client/src/components/month-end/checklist-text";
import { messages } from "../../client/src/components/month-end/ChecklistItemText.i18n";

describe("who can unlock a month", () => {
  it("the company owner, a firm owner and a platform admin can; an accountant or employee cannot", () => {
    expect(canUnlockPeriod({ isAdmin: false, firmRole: null }, "owner")).toBe(true);
    expect(canUnlockPeriod({ firmRole: "firm_owner" }, null)).toBe(true);
    expect(canUnlockPeriod({ isAdmin: true }, null)).toBe(true);
    expect(canUnlockPeriod({ isAdmin: false, firmRole: null }, "accountant")).toBe(false);
    expect(canUnlockPeriod({ firmRole: "firm_admin" }, null)).toBe(false);
    expect(canUnlockPeriod(null, "owner")).toBe(false);
  });

  it("needs a reason of ten characters", () => {
    expect(unlockReasonOk("too short")).toBe(false);
    expect(unlockReasonOk("   a b c    ")).toBe(false);
    expect(unlockReasonOk("VAT return needs a correction")).toBe(true);
  });

  it("asks to unlock one month with the company and the trimmed reason", () => {
    expect(unlockBody("c1", "2026-09", "  Correct a bill date  ")).toEqual({
      companyId: "c1",
      period: "2026-09",
      reason: "Correct a bill date",
    });
  });
});

describe("locking with the VAT item open", () => {
  const open = [
    { id: 6, status: "complete" as const },
    { id: 7, status: "incomplete" as const },
  ];
  const done = [{ id: 7, status: "complete" as const }];

  it("sees whether the VAT item is open", () => {
    expect(vatItemOpen(open)).toBe(true);
    expect(vatItemOpen(done)).toBe(false);
    expect(vatItemOpen(undefined)).toBe(false);
  });

  it("needs the explicit override with a written reason only while it is open, and sends them only then", () => {
    expect(lockAllowed(true, false)).toBe(false);
    expect(lockAllowed(true, true)).toBe(false);
    expect(lockAllowed(true, true, "short")).toBe(false);
    expect(lockAllowed(true, true, "Client asked to close the books early")).toBe(true);
    expect(lockAllowed(false, false)).toBe(true);
    expect(lockBody("2026-09-30", true, true, "  Client asked to close early  ")).toEqual({
      periodEnd: "2026-09-30",
      overrideVatCheck: true,
      overrideReason: "Client asked to close early",
    });
    expect(lockBody("2026-09-30", true, false)).toEqual({ periodEnd: "2026-09-30" });
    expect(lockBody("2026-09-30", false, true, "whatever reason here")).toEqual({
      periodEnd: "2026-09-30",
    });
  });
});

describe("checklist sentences the server writes read in Arabic", () => {
  it.each([
    "No VAT return prepared for this period",
    "This month falls inside a VAT period that has not ended: its return is prepared after the period closes",
    "2/2 bank accounts reconciled as at 2026-09-30",
    "3 lines without a bank account are unreconciled",
    "1 VAT return(s) cover this period",
    "VAT return for 2026-07-01 – 2026-09-30 exists (draft).",
    "Not the last month of the VAT period; the return is due with the period ending 2026-09-30.",
    "The VAT period ending 2026-09-30 has no return yet. Create the return, or lock with an override.",
    "No foreign-currency bank accounts",
    "Not revalued at 2026-09-30: USD Account",
    "2 foreign-currency bank account(s) revalued at 2026-09-30",
  ])("%s", (sentence) => {
    const r = resolveDetails(sentence);
    expect(r, sentence).not.toBeNull();
    expect(messages.tables.ar[r!.key as keyof typeof messages.tables.ar]).toMatch(/[؀-ۿ]/);
  });
});
