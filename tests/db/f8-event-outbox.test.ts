/**
 * F8 item 2: durable transactional domain-event outbox (migration 0115).
 *
 * bill.approved / bill.paid / payroll.approved / payroll.paid / task.due used to be published
 * after commit on the in-memory bus only (lost on a crash between commit and dispatch, never
 * retried when a handler failed). They are now written inside the document transaction and
 * dispatched from domain_event_outbox with retry/backoff, dead-lettering and idempotent
 * per-handler delivery keyed by event id.
 */
import { afterEach, describe, expect, it } from "vitest";
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
          throw new Error("downstream unavailable");
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
    expect(row.last_error).toMatch(/downstream unavailable/);
    const [{ delay }] = await h.sql<{ delay: number }>(
      `SELECT extract(epoch FROM next_attempt_at - updated_at)::int AS delay
         FROM domain_event_outbox WHERE id = $1`,
      [id]
    );
    expect(delay).toBeGreaterThanOrEqual(25); // backoff, not an immediate hot loop
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

  it("[F8-02] the dispatcher is a registered job", async () => {
    const { registerEventOutboxJob } = await platform();
    const { listJobs } = await import("../../server/platform/job-registry");
    registerEventOutboxJob();
    registerEventOutboxJob();
    expect(listJobs().filter((j) => j.name === "events.outboxDispatch")).toHaveLength(1);
  });
});
