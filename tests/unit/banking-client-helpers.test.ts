import { describe, expect, it } from "vitest";
import { ApiError } from "../../client/src/lib/queryClient";
import {
  bulkErrors,
  bulkPartial,
  isBankingErrorCode,
  isLiveFeed,
  parseErrorLocation,
  reconciliationDifference,
} from "../../client/src/lib/banking-api-types";
import { messages } from "../../client/src/components/banking/BankingCommon.i18n";
import { bankingErrorText, confidenceTone, reasonText } from "../../client/src/components/banking/banking-common";
import { describeBulkFailure } from "../../client/src/components/banking/bulk-outcome";
import { warningText } from "../../client/src/components/banking/statement-warnings";

const tr = ((key: string, params?: Record<string, string | number>) => {
  const template = (messages.tables.en as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (params && name in params ? String(params[name]) : m));
}) as unknown as Parameters<typeof bankingErrorText>[0];

describe("error detail readers", () => {
  it("reads the line or tag of a parse error", () => {
    expect(parseErrorLocation({ line: 7 })).toEqual({ line: 7 });
    expect(parseErrorLocation({ line: "12" })).toEqual({ line: 12 });
    expect(parseErrorLocation({ tag: "Amt" })).toEqual({ tag: "Amt" });
    expect(parseErrorLocation(undefined)).toEqual({});
  });
  it("reads the bulk errors and the partial result", () => {
    const errors = bulkErrors({ errors: [{ index: 1, transactionId: "t1", code: "OVER_OUTSTANDING", message: "too much" }, 5] });
    expect(errors).toEqual([{ index: 1, transactionId: "t1", code: "OVER_OUTSTANDING", message: "too much" }]);
    expect(bulkErrors({})).toEqual([]);
    const partial = bulkPartial({ applied: ["a", "b"], failed: { index: 2, transactionId: "c", code: "ALREADY_RECONCILED", message: "x" } });
    expect(partial.applied).toEqual(["a", "b"]);
    expect(partial.failed?.code).toBe("ALREADY_RECONCILED");
  });
  it("reads the difference of an unbalanced reconciliation", () => {
    expect(reconciliationDifference({ difference: 12.5 })).toBe(12.5);
    expect(reconciliationDifference({ difference: "x" })).toBeNull();
  });
  it("knows the banking error codes", () => {
    expect(isBankingErrorCode("ALREADY_RECONCILED")).toBe(true);
    expect(isBankingErrorCode("SOMETHING_ELSE")).toBe(false);
  });
});

describe("isLiveFeed", () => {
  it("is false for the manual source and for a disconnected connection", () => {
    expect(isLiveFeed({ provider: "manual", status: "active" })).toBe(false);
    expect(isLiveFeed({ provider: "lean", status: "disconnected" })).toBe(false);
    expect(isLiveFeed({ provider: "lean", status: "active" })).toBe(true);
    expect(isLiveFeed({ provider: "lean", status: "error" })).toBe(true);
  });
});

describe("bankingErrorText", () => {
  it("names the line of a parse error", () => {
    const err = new ApiError("x", 422, "STATEMENT_PARSE_ERROR", { line: 7 });
    expect(bankingErrorText(tr, err)).toBe("The file could not be read: problem at line 7.");
    expect(bankingErrorText(tr, new ApiError("x", 422, "STATEMENT_PARSE_ERROR", { tag: "Amt" }))).toBe("The file could not be read: problem in tag Amt.");
  });
  it("distinguishes a scanned PDF with the provider off from one that is not configured", () => {
    expect(bankingErrorText(tr, new ApiError("x", 422, "PDF_NO_TRANSACTIONS", { ai: "not_configured" }))).toMatch(/not configured/);
    expect(bankingErrorText(tr, new ApiError("x", 422, "PDF_NO_TRANSACTIONS", { ai: "off" }))).toMatch(/which is off/);
  });
  it("explains the refused accounts and the unbalanced reconciliation", () => {
    expect(bankingErrorText(tr, new ApiError("x", 422, "ACCOUNT_REQUIRES_DOCUMENT"))).toMatch(/invoice or bill/);
    expect(bankingErrorText(tr, new ApiError("x", 422, "RECONCILIATION_NOT_BALANCED", { difference: 12.5 }))).toMatch(/12\.50/);
  });
  it("keeps the server's own words for a lock or an unknown code", () => {
    expect(bankingErrorText(tr, new ApiError("The period is locked", 403, "PERIOD_LOCKED"))).toBe("The period is locked");
  });
  it("turns a network failure into a clear message and a plain error into its text", () => {
    expect(bankingErrorText(tr, new TypeError("Failed to fetch"))).toMatch(/could not be reached/);
    expect(bankingErrorText(tr, new Error("boom"))).toBe("boom");
  });
});

describe("describeBulkFailure", () => {
  it("lists the problem per transaction when nothing was posted", () => {
    const err = new ApiError("x", 422, "BULK_MATCH_INVALID", { errors: [{ index: 0, transactionId: "t1", code: "X", message: "over the outstanding balance" }] });
    const f = describeBulkFailure(tr, err, "en");
    expect(f.kind).toBe("invalid");
    expect(f.byTransaction).toEqual({ t1: "over the outstanding balance" });
    expect(f.summary).toMatch(/Nothing was posted: 1 item/);
  });
  it("reports how many were applied before a partial failure", () => {
    const err = new ApiError("x", 409, "BULK_MATCH_PARTIAL", { applied: ["a"], failed: { index: 1, transactionId: "b", code: "ALREADY_RECONCILED", message: "already matched" } });
    const f = describeBulkFailure(tr, err, "en");
    expect(f).toMatchObject({ kind: "partial", applied: ["a"], summary: "already matched" });
  });
});

describe("reasons, confidence and warnings", () => {
  it("shows a reason in plain words and scores confidence in three bands", () => {
    expect(reasonText(tr, "AMOUNT_EXACT")).toBe("Exact amount");
    expect(confidenceTone(95)).toBe("success");
    expect(confidenceTone(65)).toBe("warning");
    expect(confidenceTone(40)).toBe("danger");
  });
  it("translates the known warning codes and leaves other sentences as the server wrote them", () => {
    expect(warningText("AI_EXTRACTED: these rows were read by the AI provider", "ar")).toMatch(/الذكاء الاصطناعي/);
    expect(warningText("PDF_PAGES_NOT_READ: the file has 14 pages; the text of 10 was sent.", "en")).toBe("The file has 14 pages; only the text of 10 was read.");
    expect(warningText("3 statements were read from one file.", "ar")).toBe("3 statements were read from one file.");
  });
});
