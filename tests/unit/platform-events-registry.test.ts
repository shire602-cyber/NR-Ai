import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_EVENT_TYPES,
  drainDomainEvents,
  emitDomainEvent,
  onDomainEvent,
  resetDomainEventHandlers,
  type DomainEvent,
} from "../../server/platform/domain-events";
import {
  has,
  listServices,
  provide,
  resetServices,
  resolve,
} from "../../server/platform/service-registry";
import {
  getJobStatus,
  listJobs,
  registerJob,
  resetJobs,
  runJob,
  startRegisteredJobs,
} from "../../server/platform/job-registry";
import { DomainError } from "../../server/errors";
import {
  CAPABILITY_IDS,
  computeCapabilities,
  getCapabilitySnapshot,
  isCapabilityLive,
} from "../../shared/capabilities";

afterEach(() => {
  resetDomainEventHandlers();
  resetServices();
  resetJobs();
});

describe("domain events", () => {
  it("has the frozen catalogue", () => {
    expect(DOMAIN_EVENT_TYPES).toEqual([
      "invoice.created",
      "invoice.issued",
      "invoice.paid",
      "invoice.voided",
      "payment.received",
      "credit_note.issued",
      "bill.approved",
      "bill.paid",
      "contact.created",
      "payroll.approved",
      "payroll.paid",
      "bank.sync_failed",
      "compliance.deadline_due",
      "task.due",
      "receipt.posted",
      "budget.variance_alert",
    ]);
    expect(Object.isFrozen(DOMAIN_EVENT_TYPES)).toBe(true);
  });

  it("delivers after the current tick with companyId, entityId, occurredAt", async () => {
    const seen: DomainEvent[] = [];
    onDomainEvent("invoice.paid", (e) => {
      seen.push(e);
    });
    emitDomainEvent("invoice.paid", { companyId: "c1", entityId: "inv1", amountFils: 1000 });
    expect(seen).toHaveLength(0); // not synchronous
    await drainDomainEvents();
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("invoice.paid");
    expect(seen[0].payload).toMatchObject({ companyId: "c1", entityId: "inv1", amountFils: 1000 });
    expect(new Date(seen[0].payload.occurredAt).toString()).not.toBe("Invalid Date");
  });

  it("wildcard handlers see every event; unsubscribe works", async () => {
    const all = vi.fn();
    const off = onDomainEvent("*", all);
    emitDomainEvent("bill.paid", { companyId: "c", entityId: "b" });
    emitDomainEvent("task.due", { companyId: "c", entityId: "t", occurredAt: new Date(0) });
    await drainDomainEvents();
    expect(all).toHaveBeenCalledTimes(2);
    expect(all.mock.calls[1][0].payload.occurredAt).toBe("1970-01-01T00:00:00.000Z");
    off();
    emitDomainEvent("bill.paid", { companyId: "c", entityId: "b" });
    await drainDomainEvents();
    expect(all).toHaveBeenCalledTimes(2);
  });

  it("handler errors are swallowed and never reach the emitter or other handlers", async () => {
    const good = vi.fn();
    onDomainEvent("receipt.posted", () => {
      throw new Error("sync boom");
    });
    onDomainEvent("receipt.posted", async () => {
      throw new Error("async boom");
    });
    onDomainEvent("receipt.posted", good);
    expect(() =>
      emitDomainEvent("receipt.posted", { companyId: "c", entityId: "r" })
    ).not.toThrow();
    await drainDomainEvents();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown types and payloads without tenant/entity", () => {
    // @ts-expect-error unknown type
    expect(() => emitDomainEvent("invoice.deleted", { companyId: "c", entityId: "x" })).toThrow();
    // @ts-expect-error unknown type
    expect(() => onDomainEvent("nope", () => undefined)).toThrow();
    // @ts-expect-error missing entityId
    expect(() => emitDomainEvent("invoice.paid", { companyId: "c" })).toThrow(/entityId/);
  });
});

describe("service registry", () => {
  it("provide / resolve / has", () => {
    const add = (a: number, b: number) => a + b;
    provide("math.add", add);
    expect(has("math.add")).toBe(true);
    expect(resolve<typeof add>("math.add")(2, 3)).toBe(5);
    expect(listServices()).toEqual(["math.add"]);
  });

  it("resolve of a missing service throws DomainError SERVICE_UNAVAILABLE 503", () => {
    expect(has("einvoice.submit")).toBe(false);
    try {
      resolve("einvoice.submit");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("SERVICE_UNAVAILABLE");
      expect((e as DomainError).statusCode).toBe(503);
    }
  });

  it("guards names and duplicates", () => {
    expect(() => provide("noDot", () => 1)).toThrow();
    provide("a.b", () => 1);
    expect(() => provide("a.b", () => 2)).toThrow(/already/);
    provide("a.b", () => 2, { replace: true });
    expect(resolve<() => number>("a.b")()).toBe(2);
  });
});

describe("job registry", () => {
  it("validates definitions", () => {
    registerJob({ name: "x.job", cron: "0 * * * *", run: () => undefined });
    expect(() => registerJob({ name: "x.job", cron: "0 * * * *", run: () => undefined })).toThrow();
    expect(() => registerJob({ name: "y.job", cron: "not cron", run: () => undefined })).toThrow();
    expect(listJobs().map((j) => j.name)).toEqual(["x.job"]);
  });

  it("isolates failures per job", async () => {
    registerJob({
      name: "fail.job",
      cron: "* * * * *",
      run: () => {
        throw new Error("boom");
      },
    });
    await expect(runJob("fail.job")).resolves.toBe("failed");
    expect(getJobStatus("fail.job")).toMatchObject({ running: false, lastOutcome: "failed" });
  });

  it("skips overlapping runs of the same job", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    registerJob({ name: "slow.job", cron: "* * * * *", run });
    const first = runJob("slow.job");
    await expect(runJob("slow.job")).resolves.toBe("skipped_overlap");
    release();
    await expect(first).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    // Once finished, the next tick runs normally.
    const third = runJob("slow.job");
    release();
    await expect(third).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("startRegisteredJobs schedules every job through the injected scheduler", async () => {
    const ran = vi.fn();
    registerJob({ name: "a.job", cron: "0 * * * *", run: ran });
    registerJob({ name: "b.job", cron: "*/5 * * * *", run: () => undefined });
    const ticks: Array<() => void> = [];
    const schedule = vi.fn((_expr: string, task: () => void) => ticks.push(task));
    expect(startRegisteredJobs(schedule)).toEqual(["a.job", "b.job"]);
    expect(schedule.mock.calls.map((c) => c[0])).toEqual(["0 * * * *", "*/5 * * * *"]);
    ticks[0]();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
  });
});

describe("capability registry", () => {
  it("covers every integration with en+ar copy and an external action", () => {
    const caps = computeCapabilities({});
    expect(caps.map((c) => c.id)).toEqual(CAPABILITY_IDS);
    expect(CAPABILITY_IDS.length).toBe(20);
    for (const c of caps) {
      expect(c.label.en && c.label.ar && c.externalAction.en && c.externalAction.ar).toBeTruthy();
      expect(/[؀-ۿ]/.test(c.label.ar)).toBe(true);
      expect(["disabled", "requires_external"]).toContain(c.status);
    }
  });

  it("derives live vs sandbox from env", () => {
    const status = (env: Record<string, string>, id: string) =>
      computeCapabilities(env).find((c) => c.id === id)?.status;
    expect(
      status({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "w" }, "stripe_billing")
    ).toBe("sandbox");
    expect(
      status({ STRIPE_SECRET_KEY: "sk_live_1", STRIPE_WEBHOOK_SECRET: "w" }, "stripe_billing")
    ).toBe("live");
    expect(
      status(
        { LEAN_APP_TOKEN: "t", LEAN_API_BASE_URL: "https://sandbox.leantech.me" },
        "bank_feed_lean"
      )
    ).toBe("sandbox");
    expect(
      status(
        { LEAN_APP_TOKEN: "t", LEAN_API_BASE_URL: "https://api.leantech.me" },
        "bank_feed_lean"
      )
    ).toBe("live");
    expect(
      status({ EINVOICE_ASP_API_KEY: "k", EINVOICE_ASP_BASE_URL: "https://asp" }, "einvoicing_asp")
    ).toBe("sandbox");
    expect(status({}, "einvoicing_asp")).toBe("requires_external");
    expect(status({ RESEND_API_KEY: "re_x" }, "email")).toBe("live");
    expect(status({ SMTP_HOST: "  " }, "email")).toBe("disabled");
    expect(isCapabilityLive("ai", { OPENAI_API_KEY: "sk" })).toBe(true);
    expect(isCapabilityLive("ai", {})).toBe(false);
  });

  it("serialisable snapshot never includes env values", () => {
    const secret = "sk_live_SUPERSECRET";
    const snap = getCapabilitySnapshot(
      { STRIPE_SECRET_KEY: secret, STRIPE_WEBHOOK_SECRET: "whsec_x" },
      new Date(0)
    );
    const json = JSON.stringify(snap);
    expect(JSON.parse(json)).toEqual(snap);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("whsec_x");
    expect(snap.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
