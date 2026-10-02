/**
 * Phase 8 D2 client helpers: pure functions behind the vendor picker, approvals queue, projects and people screens.
 */
import { describe, expect, it } from "vitest";
import {
  approvalActionPath,
  approvalDocumentHref,
  approvalErrorKind,
  isPendingApprovalBody,
  clampPct,
  describeRuleRoles,
  exactVendorMatch,
  filterVendors,
  inclusiveCalendarDays,
  isOwnerRole,
  isForeignVendorCountry,
  reverseChargePreview,
  isCashOrBankAccount,
  canWriteHrRole,
  parseDurationInput,
  periodLabel,
  splitDuration,
  timerElapsedMinutes,
  vendorContactsOf,
  type VendorContact,
} from "../../client/src/lib/purchasing-hr";

const contacts: VendorContact[] = [
  { id: "1", name: "Acme Supplies", contactType: "vendor", trnNumber: "100123456700003", email: null },
  { id: "2", name: "Al Noor Trading", contactType: "both", trnNumber: null, email: "ap@noor.ae" },
  { id: "3", name: "Retail Customer LLC", contactType: "customer", trnNumber: null, email: null },
  { id: "4", name: "Legacy Co", trnNumber: null, email: null },
];

describe("vendor picker helpers", () => {
  it("offers vendor and both contacts only, never customer-only ones", () => {
    expect(vendorContactsOf(contacts).map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("filters by name, TRN or email, case-insensitively", () => {
    const vendors = vendorContactsOf(contacts);
    expect(filterVendors(vendors, "acme").map((c) => c.id)).toEqual(["1"]);
    expect(filterVendors(vendors, "1001234").map((c) => c.id)).toEqual(["1"]);
    expect(filterVendors(vendors, "NOOR.AE").map((c) => c.id)).toEqual(["2"]);
    expect(filterVendors(vendors, "  ").map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("finds an exact vendor by normalised name (case and spaces), and nothing for a partial name", () => {
    const vendors = vendorContactsOf(contacts);
    expect(exactVendorMatch(vendors, "  ACME   supplies ")?.id).toBe("1");
    expect(exactVendorMatch(vendors, "Acme")).toBeNull();
  });
});

describe("reverse charge on bills", () => {
  it("defaults on for a vendor in a known non-UAE country, never for the UAE or an unknown country", () => {
    expect(isForeignVendorCountry("United States")).toBe(true);
    expect(isForeignVendorCountry("India")).toBe(true);
    for (const uae of ["UAE", "AE", " united arab emirates ", "الإمارات", "", null, undefined]) expect(isForeignVendorCountry(uae as string | null)).toBe(false);
  });

  it("previews the same VAT as output (box 3) and input (box 10), payable without VAT", () => {
    const p = reverseChargePreview([{ quantity: 1, unit_price: 3600, vat_rate: 5 }]);
    expect(p).toEqual({ net: 3600, outputVatBox3: 180, inputVatBox10: 180, payable: 3600 });
    expect(reverseChargePreview([{ quantity: 3, unit_price: "33.33", vat_rate: "5" }]).outputVatBox3).toBe(5);
    expect(reverseChargePreview([])).toEqual({ net: 0, outputVatBox3: 0, inputVatBox10: 0, payable: 0 });
  });
});

describe("approvals", () => {
  it("routes each document type to its own approve endpoint", () => {
    expect(approvalActionPath("bill", "b1")).toBe("/api/bills/b1/approve");
    expect(approvalActionPath("expense_claim", "c1")).toBe("/api/expense-claims/c1/approve");
    expect(approvalActionPath("purchase_order", "p1")).toBe("/api/purchase-orders/p1/approve");
    expect(approvalActionPath("payroll_run", "r1")).toBe("/api/payroll-runs/r1/approve");
    expect(approvalActionPath("manual_journal", "j1")).toBe("/api/journal/j1/post");
  });

  it("links each document type to the screen that shows it", () => {
    expect(approvalDocumentHref("bill")).toBe("/bill-pay");
    expect(approvalDocumentHref("manual_journal", "j1")).toBe("/journal/j1");
    expect(approvalDocumentHref("payroll_run")).toBe("/payroll");
  });

  it("classifies the approval error codes the routes return", () => {
    expect(approvalErrorKind("APPROVAL_REQUIRED")).toBe("required");
    expect(approvalErrorKind("APPROVER_ALREADY_SIGNED")).toBe("alreadySigned");
    expect(approvalErrorKind("SELF_APPROVAL")).toBe("self");
    expect(approvalErrorKind("APPROVAL_IN_PROGRESS")).toBe("inProgress");
    expect(approvalErrorKind("SOMETHING_ELSE")).toBeNull();
    expect(approvalErrorKind(undefined)).toBeNull();
  });

  it("recognises an approve response that still needs signatures, for documents and journals alike", () => {
    const approval = { requestId: "r", completedSteps: 1, requiredSteps: 2, nextRole: "owner" };
    expect(isPendingApprovalBody({ status: "pending_approval", approval })).toBe(true);
    expect(isPendingApprovalBody({ status: "draft", approval })).toBe(true);
    expect(isPendingApprovalBody({ status: "approved", approval: { ...approval, completedSteps: 2 } })).toBe(false);
    expect(isPendingApprovalBody({ status: "approved" })).toBe(false);
    expect(isPendingApprovalBody(null)).toBe(false);
  });

  it("describes a rule's approver chain in order", () => {
    expect(describeRuleRoles(["accountant", "owner"], (r) => r.toUpperCase(), "then")).toBe("ACCOUNTANT then OWNER");
    expect(describeRuleRoles(["cfo"], (r) => r, "then")).toBe("cfo");
  });

  it("ranks roles: only accountant and above write HR records, only the owner edits rules", () => {
    expect(canWriteHrRole("employee")).toBe(false);
    expect(canWriteHrRole("accountant")).toBe(true);
    expect(canWriteHrRole("cfo")).toBe(true);
    expect(canWriteHrRole("owner")).toBe(true);
    expect(canWriteHrRole(null)).toBe(false);
    expect(isOwnerRole("owner")).toBe(true);
    expect(isOwnerRole("cfo")).toBe(false);
  });
});

describe("time helpers", () => {
  it("parses hours as decimals, h:mm and minutes, and rejects nonsense and over-long days", () => {
    expect(parseDurationInput("1.5")).toBe(90);
    expect(parseDurationInput("1:30")).toBe(90);
    expect(parseDurationInput("0:45")).toBe(45);
    expect(parseDurationInput("90m")).toBe(90);
    expect(parseDurationInput("2h")).toBe(120);
    expect(parseDurationInput("2h 15m")).toBe(135);
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
    expect(parseDurationInput("0")).toBeNull();
    expect(parseDurationInput("25")).toBeNull();
    expect(parseDurationInput("-1")).toBeNull();
  });

  it("splits minutes into hours and minutes", () => {
    expect(splitDuration(135)).toEqual({ hours: 2, minutes: 15 });
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0 });
  });

  it("counts a running timer from its start, never negative, rounded down to the minute", () => {
    const start = Date.parse("2026-10-02T09:00:00Z");
    expect(timerElapsedMinutes(start, start + 90_500)).toBe(1);
    expect(timerElapsedMinutes(start, start - 5000)).toBe(0);
  });

  it("clamps a budget percentage for a progress bar", () => {
    expect(clampPct(null)).toBe(0);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(42.4)).toBe(42.4);
    expect(clampPct(180)).toBe(100);
  });
});

describe("people helpers", () => {
  it("offers only active cash and bank asset accounts as a payment account", () => {
    const base = { id: "a", nameEn: "X", type: "asset" };
    expect(isCashOrBankAccount({ ...base, code: "1020", nameEn: "Main account" })).toBe(true);
    expect(isCashOrBankAccount({ ...base, code: "1100", nameEn: "Emirates NBD Bank" })).toBe(true);
    expect(isCashOrBankAccount({ ...base, code: "1200", subType: "cash" })).toBe(true);
    expect(isCashOrBankAccount({ ...base, code: "1080", nameEn: "Employee Loans" })).toBe(false);
    expect(isCashOrBankAccount({ ...base, code: "1020", type: "liability" })).toBe(false);
    expect(isCashOrBankAccount({ ...base, code: "1020", isArchived: true })).toBe(false);
  });

  it("counts calendar days inclusively for a leave request", () => {
    expect(inclusiveCalendarDays("2026-10-05", "2026-10-09")).toBe(5);
    expect(inclusiveCalendarDays("2026-10-05", "2026-10-05")).toBe(1);
    expect(inclusiveCalendarDays("2026-10-09", "2026-10-05")).toBe(0);
    expect(inclusiveCalendarDays("", "2026-10-05")).toBe(0);
  });

  it("labels a payroll period as MM/YYYY", () => {
    expect(periodLabel(2026, 3)).toBe("03/2026");
  });
});
