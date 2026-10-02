import { describe, expect, it } from "vitest";
import {
  actionableDeletions,
  canDownloadExport,
  canSubmitDeletion,
  daysUntil,
  deletionErrorKey,
  deletionFor,
  exportPollInterval,
  formatBytes,
  type DeletionRow,
  type ExportRow,
} from "./data-lifecycle";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const exp = (over: Partial<ExportRow>): ExportRow => ({
  id: "e",
  status: "ready",
  createdAt: "2026-10-02T11:00:00Z",
  completedAt: null,
  expiresAt: "2026-10-03T11:00:00Z",
  sizeBytes: 1000,
  sha256: null,
  error: null,
  ...over,
});
const del = (over: Partial<DeletionRow>): DeletionRow => ({
  id: "d",
  companyId: "c1",
  companyName: "Acme",
  status: "pending",
  reason: null,
  requestedAt: "2026-10-01T00:00:00Z",
  purgeAfter: "2026-10-31T00:00:00Z",
  restoredAt: null,
  purgedAt: null,
  ...over,
});

describe("exports", () => {
  it("polls only while a job is queued or running", () => {
    expect(exportPollInterval(undefined)).toBe(false);
    expect(exportPollInterval([exp({ status: "ready" })])).toBe(false);
    expect(exportPollInterval([exp({ status: "ready" }), exp({ status: "running" })])).toBe(3000);
    expect(exportPollInterval([exp({ status: "queued" })])).toBe(3000);
  });
  it("offers download only for a ready, unexpired export", () => {
    expect(canDownloadExport(exp({}), NOW)).toBe(true);
    expect(canDownloadExport(exp({ expiresAt: "2026-10-02T11:59:00Z" }), NOW)).toBe(false);
    expect(canDownloadExport(exp({ status: "expired" }), NOW)).toBe(false);
    expect(canDownloadExport(exp({ status: "failed" }), NOW)).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(null)).toBe("");
  });
});

describe("deletions", () => {
  it("counts whole days remaining, never negative", () => {
    expect(daysUntil("2026-10-31T00:00:00Z", NOW)).toBe(29);
    expect(daysUntil("2026-09-01T00:00:00Z", NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("nope", NOW)).toBeNull();
  });
  it("keeps only requests the user can still act on", () => {
    const rows = [del({ id: "1" }), del({ id: "2", status: "restored" }), del({ id: "3", status: "awaiting_firm", purgeAfter: null }), del({ id: "4", purgeAfter: "2026-10-01T00:00:00Z" }), del({ id: "5", status: "purged" })];
    expect(actionableDeletions(rows, NOW).map((r) => r.id)).toEqual(["1", "3"]);
    expect(deletionFor(rows, "c1", NOW)?.id).toBe("1");
    expect(deletionFor(rows, "other", NOW)).toBeUndefined();
  });
  it("maps server codes", () => {
    expect(deletionErrorKey("REAUTH_REQUIRED")).toBe("reauth");
    expect(deletionErrorKey("PASSWORD_INVALID")).toBe("password");
    expect(deletionErrorKey("TOTP_REPLAYED")).toBe("code");
    expect(deletionErrorKey("CONFIRM_NAME_MISMATCH")).toBe("name");
    expect(deletionErrorKey("DELETION_ALREADY_REQUESTED")).toBe("exists");
    expect(deletionErrorKey("OWNER_REQUIRED")).toBe("owner");
    expect(deletionErrorKey(undefined)).toBe("generic");
  });
  it("requires the exact company name, a password and (with 2FA) a code", () => {
    const ok = { typedName: " Acme LLC ", companyName: "Acme LLC", password: "x", needsCode: false, code: "" };
    expect(canSubmitDeletion(ok)).toBe(true);
    expect(canSubmitDeletion({ ...ok, typedName: "acme llc" })).toBe(false);
    expect(canSubmitDeletion({ ...ok, password: "" })).toBe(false);
    expect(canSubmitDeletion({ ...ok, needsCode: true })).toBe(false);
    expect(canSubmitDeletion({ ...ok, needsCode: true, code: "123456" })).toBe(true);
    expect(canSubmitDeletion({ ...ok, typedName: "", companyName: "" })).toBe(false);
  });
});
