import { describe, expect, it, vi } from "vitest";
import { pool } from "../../server/db";
import type { Queryable } from "../../server/reporting";
import { detectAnomalies } from "../../server/services/anomaly-detection.service";

vi.mock("../../server/db", () => ({ pool: { query: vi.fn() } }));

function readProbe() {
  let active = 0;
  let peak = 0;
  const query = vi.fn<Queryable["query"]>(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return { rows: [] };
  });
  return { query, peak: () => peak };
}

describe("anomaly scan query scheduling", () => {
  it("runs each rule serially on a single close transaction connection", async () => {
    const tx = readProbe();
    const scan = await detectAnomalies("company", tx);

    expect(scan.anomalies).toEqual([]);
    expect(tx.query.mock.calls.length).toBeGreaterThan(1);
    expect(tx.query.mock.calls.every(([, params]) => params?.[0] === "company")).toBe(true);
    expect(tx.peak()).toBe(1);
  });

  it("runs independent rules concurrently on the pool for a normal scan", async () => {
    const probe = readProbe();
    vi.mocked(pool.query).mockImplementation(probe.query as typeof pool.query);

    expect((await detectAnomalies("company")).anomalies).toEqual([]);
    expect(probe.peak()).toBeGreaterThan(1);
  });
});
