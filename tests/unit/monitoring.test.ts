import { describe, it, expect } from "vitest";
import {
  captureException,
  monitoringConfigured,
  monitoringDsnIgnored,
} from "../../server/services/monitoring";

describe("monitoring.captureException", () => {
  it("does not throw on an Error instance", () => {
    expect(() =>
      captureException(new Error("boom"), { requestId: "r1", method: "GET" })
    ).not.toThrow();
  });

  it("does not throw on a non-Error value (string)", () => {
    expect(() => captureException("plain string failure")).not.toThrow();
  });

  it("does not throw on a non-Error value (object)", () => {
    expect(() => captureException({ weird: true })).not.toThrow();
  });

  it("does not throw on null/undefined", () => {
    expect(() => captureException(null)).not.toThrow();
    expect(() => captureException(undefined)).not.toThrow();
  });
});

describe("monitoring.monitoringConfigured", () => {
  it("is false when no DSN env is set", () => {
    expect(monitoringConfigured({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("stays false when SENTRY_DSN is set, because nothing forwards errors", () => {
    const env = { SENTRY_DSN: "https://x@y/1" } as unknown as NodeJS.ProcessEnv;
    expect(monitoringConfigured(env)).toBe(false);
    expect(monitoringDsnIgnored(env)).toBe(true);
  });

  it("stays false when MONITORING_DSN is set", () => {
    const env = { MONITORING_DSN: "x" } as unknown as NodeJS.ProcessEnv;
    expect(monitoringConfigured(env)).toBe(false);
    expect(monitoringDsnIgnored(env)).toBe(true);
  });

  it("reports no ignored DSN when none is set", () => {
    expect(monitoringDsnIgnored({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
