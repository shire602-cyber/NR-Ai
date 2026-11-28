import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// BACKGROUND_JOBS_ENABLED gates initScheduler, which is the only boot path that starts
// cron jobs and the (job-registry based) outbox pollers. We count node-cron schedules.
const scheduleSpy = vi.hoisted(() => vi.fn(() => ({ stop: () => undefined })));
vi.mock("node-cron", () => ({ default: { schedule: scheduleSpy, validate: () => true } }));

async function loadScheduler() {
  vi.resetModules();
  scheduleSpy.mockClear();
  return import("../../server/services/scheduler.service");
}

// The scheduler module graph is large; allow time for the first import.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe("BACKGROUND_JOBS_ENABLED", () => {
  const original = process.env.BACKGROUND_JOBS_ENABLED;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BACKGROUND_JOBS_ENABLED;
    else process.env.BACKGROUND_JOBS_ENABLED = original;
  });

  it("starts no scheduled jobs or outbox pollers when set to false", async () => {
    process.env.BACKGROUND_JOBS_ENABLED = "false";
    const { initScheduler } = await loadScheduler();
    initScheduler();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("starts jobs (including the outbox pollers) when unset", async () => {
    delete process.env.BACKGROUND_JOBS_ENABLED;
    const { initScheduler } = await loadScheduler();
    initScheduler();
    expect(scheduleSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("only the exact value false disables jobs", async () => {
    process.env.BACKGROUND_JOBS_ENABLED = "FALSE";
    const { initScheduler } = await loadScheduler();
    initScheduler();
    expect(scheduleSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
