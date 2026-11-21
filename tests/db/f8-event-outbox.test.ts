/**
 * F8 item 2: durable transactional domain-event outbox (migration 0115).
 *
 * bill.approved / bill.paid / payroll.approved / payroll.paid / task.due used to be published
 * after commit on the in-memory bus only (lost on a crash between commit and dispatch, never
 * retried when a handler failed). They are now written inside the document transaction and
 * dispatched from domain_event_outbox with retry/backoff, dead-lettering and idempotent
 * per-handler delivery keyed by event id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);
const offs: Array<() => void> = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

async function platform() {
  const events = await import("../../server/platform/domain-events");
  const outbox = await import("../../server/platform/event-outbox");
  return { ...events, ...outbox };
}

async function outboxRows(entityId: string) {
  return h.sql<{
    id: string;
    event_type: string;
    status: string;
    attempts: number;
    last_error: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT id, event_type, status, attempts, last_error, payload FROM domain_event_outbox
      WHERE entity_id = $1 ORDER BY created_at`,
    [entityId]
  );
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function approvedBill(t: Awaited<ReturnType<typeof h.createTenant>>) {
  const b = await t.as.post(`/api/companies/${t.company.id}/bills`, {
    vendor_name: "Outbox Supplies LLC",
    vendor_trn: "100000000000003",
    bill_number: `B-${Math.random().toString(36).slice(2, 8)}`,
    bill_date: today(),
    line_items: [{ description: "Paper", quantity: 1, unit_price: 1000, vat_rate: 5 }],
  });
  expect(b.status, b.text).toBe(200);
  const appr = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
  expect(appr.status, appr.text).toBe(200);
  return b.body.id as string;
}

describe("F8 durable domain events", () => {
  it("[F8-02] bill.approved and bill.paid are committed with the document and delivered once", async () => {
    const p = await platform();
    const seen: Array<{ type: string; eventId?: string }> = [];
    offs.push(
      p.onDomainEvent(
        "*",
        (e) => {
          if (e.type === "bill.approved" || e.type === "bill.paid")
            seen.push({ type: e.type, eventId: e.payload.eventId });
        },
        { name: "f8.test.spy" }
      )
    );
    const t = await h.createTenant();
    const billId = await approvedBill(t);
    const pay = await t.as.post(`/api/bills/${billId}/payments`, {
      payment_date: today(),
      amount: 1050,
    });
    expect(pay.status, pay.text).toBe(200);
    await p.drainDomainEvents();
    const rows = await waitFor(
      () => outboxRows(billId),
      (r) => r.length === 2 && r.every((x) => x.status === "dispatched")
    );
    expect(rows.map((r) => [r.event_type, r.status, r.attempts])).toEqual([
      ["bill.approved", "dispatched", 1],
      ["bill.paid", "dispatched", 1],
    ]);
    expect(rows[1].payload).toMatchObject({ companyId: t.company.id, entityId: billId });
    expect(seen).toEqual([
      { type: "bill.approved", eventId: rows[0].id },
      { type: "bill.paid", eventId: rows[1].id },
    ]);
    const deliveries = await h.sql(
      `SELECT handler FROM domain_event_deliveries WHERE event_id = $1 AND handler = '*:f8.test.spy'`,
      [rows[1].id]
    );
    expect(deliveries).toHaveLength(1);
  });

  it("[F8-02] a rolled-back document leaves no event and no delivery", async () => {
    const p = await platform();
    const calls: string[] = [];
    offs.push(p.onDomainEvent("bill.paid", (e) => void calls.push(e.payload.entityId)));
    const t = await h.createTenant();
    const { withLedgerTx, postJournal } = await import("../../server/ledger");
    const bank = await accountByCode(t, "1020");
    const equity = await accountByCode(t, "3010");
    const entity = `rolled-${Math.random().toString(36).slice(2, 8)}`;
    await expect(
      withLedgerTx(async (tx) => {
        await postJournal(
          {
            companyId: t.company.id,
            date: today(),
            memo: `F8 rollback ${entity}`,
            status: "posted",
            source: "manual",
            lines: [
              { accountId: bank.id, debitFils: 1000 },
              { accountId: equity.id, creditFils: 1000 },
            ],
          },
          { actorId: t.user.id, tx }
        );
        await p.emitDomainEventInTx(tx, "bill.paid", { companyId: t.company.id, entityId: entity });
        throw new Error("document fails after the event was written");
      })
    ).rejects.toThrow(/document fails/);
    await p.drainDomainEvents();
    await p.dispatchEventOutbox();
    expect(await outboxRows(entity)).toHaveLength(0);
    expect(calls).toEqual([]);
    const journals = await h.sql(`SELECT id FROM journal_entries WHERE memo = $1`, [
      `F8 rollback ${entity}`,
    ]);
    expect(journals).toHaveLength(0);
  });

  it("[F8-02] a failing handler is retried with backoff, then dead-lettered; healthy handlers run once", async () => {
    const p = await platform();
    let failing = 0;
    let healthy = 0;
    offs.push(
      p.onDomainEvent(
        "payroll.paid",
        () => {
          failing += 1;
          throw new Error("downstream unavailable for recipient@example.invalid");
        },
        { name: "f8.test.failing" }
      )
    );
    offs.push(p.onDomainEvent("payroll.paid", () => void (healthy += 1), { name: "f8.test.ok" }));
    const t = await h.createTenant();
    const { withLedgerTx } = await import("../../server/ledger");
    const entity = `run-${Math.random().toString(36).slice(2, 8)}`;
    const id = await withLedgerTx((tx) =>
      p.emitDomainEventInTx(
        tx,
        "payroll.paid",
        { companyId: t.company.id, entityId: entity },
        { maxAttempts: 3 }
      )
    );
    await p.drainDomainEvents();
    let [row] = await outboxRows(entity);
    expect(row).toMatchObject({ id, status: "pending", attempts: 1 });
    expect(row.last_error).toBe("Handler failed: payroll.paid:f8.test.failing");
    const [{ delay }] = await h.sql<{ delay: number }>(
      `SELECT extract(epoch FROM next_attempt_at - updated_at)::int AS delay
         FROM domain_event_outbox WHERE id = $1`,
      [id]
    );
    expect(delay).toBe(30);
    // Not due yet: the dispatcher leaves it alone.
    expect(await p.dispatchEventOutbox()).toEqual({});

    for (const expected of ["retrying", "dead"]) {
      await h.sql(`UPDATE domain_event_outbox SET next_attempt_at = now() WHERE id = $1`, [id]);
      const counts = await p.dispatchEventOutbox();
      expect(counts).toEqual({ [expected]: 1 });
    }
    [row] = await outboxRows(entity);
    expect(row).toMatchObject({ status: "dead", attempts: 3 });
    expect(failing).toBe(3);
    expect(healthy).toBe(1);
    // A dead-lettered event is never picked up again.
    await h.sql(`UPDATE domain_event_outbox SET next_attempt_at = now() WHERE id = $1`, [id]);
    expect(await p.dispatchEventOutbox()).toEqual({});
    expect(failing).toBe(3);
  });

  it("[F8-02] duplicate and concurrent dispatch of one event id delivers it once", async () => {
    const p = await platform();
    let calls = 0;
    offs.push(
      p.onDomainEvent(
        "task.due",
        async () => {
          calls += 1;
          await new Promise((r) => setTimeout(r, 20));
        },
        { name: "f8.test.once" }
      )
    );
    const t = await h.createTenant();
    const entity = `task-${Math.random().toString(36).slice(2, 8)}`;
    const { db } = await import("../../server/db");
    // A transaction withLedgerTx did not open: the after-commit kick cannot see the row yet,
    // so the dispatcher job delivers it.
    const id = await db.transaction((tx) =>
      p.emitDomainEventInTx(tx as never, "task.due", {
        companyId: t.company.id,
        entityId: entity,
        dueDate: today(),
      })
    );
    await p.drainDomainEvents();
    await Promise.all([
      p.dispatchDomainEvent(id),
      p.dispatchDomainEvent(id),
      p.dispatchEventOutbox(),
      p.dispatchEventOutbox(),
      p.dispatchDomainEvent(id),
    ]);
    expect(calls).toBe(1);
    // Replay after a lost lease / crash: the delivery record keeps it at one call.
    await h.sql(
      `UPDATE domain_event_outbox SET status = 'pending', next_attempt_at = now() WHERE id = $1`,
      [id]
    );
    expect(await p.dispatchDomainEvent(id)).toBe("dispatched");
    expect(calls).toBe(1);
    const [row] = await outboxRows(entity);
    expect(row.status).toBe("dispatched");
  });

  it("recovers an expired claim without letting the old worker overwrite a completed event", async () => {
    const p = await platform();
    const eventId = "10000000-0000-4000-8000-000000000001";
    const entityId = "expired-lease-recovery";
    await h.sql(
      `INSERT INTO domain_event_outbox (id, event_type, entity_id, payload, max_attempts)
       VALUES ($1, 'task.due', $2, $3, 3)`,
      [eventId, entityId, JSON.stringify({ companyId: eventId, entityId, dueDate: today() })]
    );

    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let releaseOriginal!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseOriginal = resolve;
    });
    let calls = 0;
    offs.push(
      p.onDomainEvent(
        "task.due",
        async () => {
          if (++calls !== 1) return;
          signalEntered();
          await release;
          throw new Error("The original worker completed after losing its lease");
        },
        { name: "f8.test.stale" }
      )
    );

    const original = p.dispatchDomainEvent(eventId);
    try {
      const outcome = await Promise.race([entered, original]);
      expect(outcome).toBeUndefined();
      await h.sql("UPDATE domain_event_outbox SET locked_until = now() WHERE id = $1", [eventId]);
      expect(await p.dispatchDomainEvent(eventId)).toBe("dispatched");
    } finally {
      releaseOriginal();
      await original.catch(() => {});
    }

    expect(await original).toBeNull();
    expect(calls).toBe(2);
    const [row] = await outboxRows(entityId);
    expect(row).toMatchObject({ status: "dispatched", attempts: 2, last_error: null });
  });

  it("dead-letters an expired last attempt with incomplete receipts without calling handlers again", async () => {
    const p = await platform();
    const eventId = "10000000-0000-4000-8000-000000000002";
    const entityId = "expired-final-attempt";
    const completed = vi.fn();
    const missing = vi.fn();
    offs.push(p.onDomainEvent("task.due", completed, { name: "f8.test.final-attempt" }));
    offs.push(p.onDomainEvent("task.due", missing, { name: "f8.test.missing-receipt" }));
    await h.sql(
      `INSERT INTO domain_event_outbox
         (id, event_type, entity_id, payload, status, attempts, max_attempts, locked_until)
       VALUES ($1, 'task.due', $2, $3, 'dispatching', 1, 1, now() - interval '1 second')`,
      [eventId, entityId, JSON.stringify({ companyId: eventId, entityId, dueDate: today() })]
    );
    await h.sql("INSERT INTO domain_event_deliveries (event_id, handler) VALUES ($1, $2)", [
      eventId,
      "task.due:f8.test.final-attempt",
    ]);

    expect(await p.dispatchEventOutbox()).toEqual({ dead: 1 });
    expect(await p.dispatchDomainEvent(eventId)).toBeNull();
    expect(completed).not.toHaveBeenCalled();
    expect(missing).not.toHaveBeenCalled();
    const [row] = await outboxRows(entityId);
    expect(row).toMatchObject({
      status: "dead",
      attempts: 1,
      last_error: "Final delivery attempt expired",
    });
  });

  it("reconciles a fully receipted final attempt without invoking either handler", async () => {
    const p = await platform();
    const eventId = "10000000-0000-4000-8000-000000000003";
    const entityId = "expired-final-attempt-with-receipts";
    const first = vi.fn();
    const second = vi.fn();
    offs.push(p.onDomainEvent("task.due", first, { name: "f8.test.receipt" }));
    offs.push(p.onDomainEvent("*", second, { name: "f8.test.wildcard-receipt" }));
    await h.sql(
      `INSERT INTO domain_event_outbox
         (id, event_type, entity_id, payload, status, attempts, max_attempts, locked_until)
       VALUES ($1, 'task.due', $2, $3, 'dispatching', 2, 2, now() - interval '1 second')`,
      [eventId, entityId, JSON.stringify({ companyId: eventId, entityId, dueDate: today() })]
    );
    for (const { key } of p.domainEventHandlersFor("task.due")) {
      await h.sql("INSERT INTO domain_event_deliveries (event_id, handler) VALUES ($1, $2)", [
        eventId,
        key,
      ]);
    }

    const outcomes = await Promise.all([
      p.dispatchDomainEvent(eventId),
      p.dispatchDomainEvent(eventId),
    ]);
    expect(outcomes.filter((outcome) => outcome !== null)).toEqual(["dispatched"]);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    const [row] = await outboxRows(entityId);
    expect(row).toMatchObject({ status: "dispatched", attempts: 2, last_error: null });
    const [timestamps] = await h.sql(
      `SELECT locked_until IS NULL AS cleared, dispatched_at IS NOT NULL AS dispatched,
              dead_at IS NULL AS alive FROM domain_event_outbox WHERE id = $1`,
      [eventId]
    );
    expect(timestamps).toEqual({ cleared: true, dispatched: true, alive: true });
  });

  it("bounds a hung handler through the scheduled job and fences the late completion", async () => {
    const p = await platform();
    const { getJobStatus, runJob } = await import("../../server/platform/job-registry");
    const staleId = "10000000-0000-4000-8000-000000000004";
    const nextId = "10000000-0000-4000-8000-000000000005";
    for (const [id, order] of [
      [staleId, 2],
      [nextId, 1],
    ]) {
      await h.sql(
        `INSERT INTO domain_event_outbox (id, event_type, entity_id, payload, created_at, max_attempts)
         VALUES ($1, 'task.due', $2, $3, now() - ($4::int * interval '1 minute'), 2)`,
        [id, `job-${order}`, JSON.stringify({ companyId: id, entityId: `job-${order}` }), order]
      );
    }
    let releaseHung!: () => void;
    const hung = new Promise<void>((resolve) => {
      releaseHung = resolve;
    });
    const handler = vi.fn(
      async (event: { payload: { eventId?: string } }, signal?: AbortSignal) => {
        if (event.payload.eventId === staleId) {
          // Deliberately ignore abort so the test can exercise late completion.
          expect(signal?.aborted).toBe(false);
          await hung;
        }
      }
    );
    offs.push(p.onDomainEvent("task.due", handler, { name: "f8.test.hung" }));

    // Shorten only the production handler timeout. Keep DB and watchdog timers real.
    const realTimeout = globalThis.setTimeout;
    const timers = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) =>
        realTimeout(callback, delay === 60_000 ? 20 : delay, ...args)
      );
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    p.registerEventOutboxJob();
    const sweep = runJob(p.EVENT_OUTBOX_JOB);
    try {
      const outcome = await Promise.race([
        sweep,
        new Promise((_, reject) => {
          watchdog = realTimeout(
            () => reject(new Error("Dispatch job stalled on a handler")),
            1500
          );
        }),
      ]);
      expect(outcome).toBe("ok");
      expect(getJobStatus(p.EVENT_OUTBOX_JOB)?.running).toBe(false);
      expect(handler.mock.calls.map(([event]) => event.payload.eventId)).toEqual([staleId, nextId]);
      expect(handler.mock.calls.map(([, signal]) => signal?.aborted)).toEqual([true, false]);
      expect((await outboxRows("job-1"))[0]).toMatchObject({ status: "dispatched", attempts: 1 });
      expect((await outboxRows("job-2"))[0]).toMatchObject({
        status: "pending",
        attempts: 1,
        last_error: "Handler timed out: task.due:f8.test.hung",
      });
    } finally {
      clearTimeout(watchdog);
      timers.mockRestore();
      releaseHung();
      await sweep;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await outboxRows("job-2"))[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(
      await h.sql(
        "SELECT handler FROM domain_event_deliveries WHERE event_id = $1 AND handler = $2",
        [staleId, "task.due:f8.test.hung"]
      )
    ).toEqual([]);
  });

  it("[F8-02] the dispatcher is a registered job", async () => {
    const { registerEventOutboxJob } = await platform();
    const { listJobs } = await import("../../server/platform/job-registry");
    registerEventOutboxJob();
    registerEventOutboxJob();
    expect(listJobs().filter((j) => j.name === "events.outboxDispatch")).toHaveLength(1);
  });
});
