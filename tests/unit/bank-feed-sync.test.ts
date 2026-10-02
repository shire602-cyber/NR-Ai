import { describe, expect, it } from "vitest";

import { selectDueConnections, syncFromDay, type DueCandidate } from "../../server/services/bank-feed-sync.service";

const now = new Date("2026-10-02T12:00:00Z");
const base: DueCandidate = { id: "a", provider: "lean", status: "active", autoSync: true, lastSyncedAt: new Date("2026-10-02T10:00:00Z"), syncLeaseUntil: null, consecutiveFailures: 0 };

describe("hourly sync selection", () => {
  it("picks active auto-sync lean connections that are due", () => {
    expect(selectDueConnections([base], now)).toEqual(["a"]);
    expect(selectDueConnections([{ ...base, lastSyncedAt: null }], now)).toEqual(["a"]);
  });
  it("skips manual, disabled, paused, leased, failing and just-synced connections", () => {
    const rows: DueCandidate[] = [
      { ...base, id: "manual", provider: "manual" },
      { ...base, id: "off", autoSync: false },
      { ...base, id: "err", status: "error" },
      { ...base, id: "gone", status: "disconnected" },
      { ...base, id: "leased", syncLeaseUntil: new Date("2026-10-02T12:05:00Z") },
      { ...base, id: "fail", consecutiveFailures: 3 },
      { ...base, id: "fresh", lastSyncedAt: new Date("2026-10-02T11:30:00Z") },
      { ...base, id: "expiredLease", syncLeaseUntil: new Date("2026-10-02T11:00:00Z") },
    ];
    expect(selectDueConnections(rows, now)).toEqual(["expiredLease"]);
  });
});

describe("sync window", () => {
  it("uses the requested day, else three days before the last sync, else 30 days back", () => {
    expect(syncFromDay({ requested: "2026-09-01", lastSyncedAt: null, now })).toBe("2026-09-01");
    expect(syncFromDay({ lastSyncedAt: new Date("2026-10-01T00:00:00Z"), now })).toBe("2026-09-28");
    expect(syncFromDay({ lastSyncedAt: null, now })).toBe("2026-09-02");
  });
});
