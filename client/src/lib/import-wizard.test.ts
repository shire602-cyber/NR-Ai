import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_BYTES,
  buildMappingBody,
  canCommit,
  duplicateColumns,
  eligibleOpeningJobs,
  fileToBase64,
  guessSlashDateFormat,
  isOpeningEntity,
  missingMapping,
  validateUpload,
  type FieldDef,
  type ImportJob,
} from "./import-wizard";

const fields: FieldDef[] = [
  { key: "name", required: true, description: "" },
  { key: "email", description: "" },
];

describe("validateUpload", () => {
  it("accepts csv and xlsx within the limit, any case", () => {
    expect(validateUpload("Contacts.CSV", 100)).toBeNull();
    expect(validateUpload("a.xlsx", MAX_IMPORT_BYTES)).toBeNull();
  });
  it("rejects other types, empty and oversize files", () => {
    expect(validateUpload("a.pdf", 100)).toBe("extension");
    expect(validateUpload("a.xls", 100)).toBe("extension");
    expect(validateUpload("a.csv", 0)).toBe("empty");
    expect(validateUpload("a.csv", MAX_IMPORT_BYTES + 1)).toBe("tooLarge");
  });
});

describe("fileToBase64", () => {
  it("round-trips a multi-chunk buffer", async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const b64 = await fileToBase64(new Blob([bytes]));
    expect(Buffer.from(b64, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("missingMapping", () => {
  it("lists required fields without a column", () => {
    expect(missingMapping("contacts", fields, {})).toEqual(["name"]);
    expect(missingMapping("contacts", fields, { name: "Display Name" })).toEqual([]);
  });
  it("applies the trial balance rules", () => {
    const tb: FieldDef[] = ["accountCode", "accountName", "debit", "credit", "balance"].map((key) => ({ key, description: "" }));
    expect(missingMapping("opening_tb", tb, {})).toEqual(["accountCode", "debit"]);
    expect(missingMapping("opening_tb", tb, { accountName: "Account", balance: "Balance" })).toEqual([]);
    expect(missingMapping("opening_tb", tb, { accountCode: "Code", credit: "Credit" })).toEqual([]);
  });
});

describe("duplicateColumns", () => {
  it("finds a column mapped twice and ignores empty choices", () => {
    expect(duplicateColumns({ a: "X", b: "X", c: "", d: "", e: "Y" })).toEqual(["X"]);
  });
});

describe("buildMappingBody", () => {
  it("drops empty mappings and options the entity does not use, without mutating", () => {
    const mapping = { name: "Name", email: "" };
    const body = buildMappingBody("contacts", mapping, { dateFormat: "dd/MM/yyyy", goLiveDate: "2026-01-01", defaultContactType: "vendor", currency: " aed " });
    expect(body.mapping).toEqual({ name: "Name" });
    expect(body.options).toEqual({ dateFormat: "dd/MM/yyyy", currency: "AED", defaultContactType: "vendor" });
    expect(mapping).toEqual({ name: "Name", email: "" });
  });
  it("keeps go-live and P&L folding for the trial balance", () => {
    const body = buildMappingBody("opening_tb", { accountCode: "c" }, { goLiveDate: "2026-01-01", foldProfitAndLoss: false });
    expect(body.options).toEqual({ goLiveDate: "2026-01-01", foldProfitAndLoss: false });
  });
});

describe("guessSlashDateFormat", () => {
  it("detects day-first and month-first from impossible months", () => {
    expect(guessSlashDateFormat(["13/02/2026", "01/03/2026"])).toBe("dd/MM/yyyy");
    expect(guessSlashDateFormat(["02/13/2026"])).toBe("MM/dd/yyyy");
  });
  it("does not guess when every sample is ambiguous or conflicting", () => {
    expect(guessSlashDateFormat(["01/02/2026", "03/04/2026"])).toBeNull();
    expect(guessSlashDateFormat(["13/02/2026", "02/13/2026"])).toBeNull();
    expect(guessSlashDateFormat(["2026-01-02", null, 5])).toBeNull();
  });
});

describe("eligibleOpeningJobs", () => {
  const job = (over: Partial<ImportJob>): ImportJob => ({
    id: "j", source: "zoho", entity: "opening_tb", status: "validated", filename: "f.csv", mapping: null, options: null, rowCount: 1, errorCount: 0, result: null, createdAt: "", committedAt: null, ...over,
  });
  it("keeps validated, error-free opening jobs by entity", () => {
    const out = eligibleOpeningJobs([
      job({ id: "a" }),
      job({ id: "b", errorCount: 1 }),
      job({ id: "c", status: "committed" }),
      job({ id: "d", entity: "open_invoices" }),
      job({ id: "e", entity: "contacts" }),
    ]);
    expect(out.opening_tb.map((j) => j.id)).toEqual(["a"]);
    expect(out.open_invoices.map((j) => j.id)).toEqual(["d"]);
    expect(out.open_bills).toEqual([]);
    expect(isOpeningEntity("contacts")).toBe(false);
  });
});

describe("canCommit", () => {
  const summary = { rowCount: 5, toCreate: 3, duplicates: 2, errors: 0, errorSample: [], created: 0 };
  it("needs something to create; rows with errors do not block (they are skipped)", () => {
    expect(canCommit(summary)).toBe(true);
    expect(canCommit({ ...summary, errors: 2 })).toBe(true);
    expect(canCommit({ ...summary, toCreate: 0 })).toBe(false);
    expect(canCommit(null)).toBe(false);
    expect(canCommit({ ...summary, balanced: false })).toBe(false);
  });
});
