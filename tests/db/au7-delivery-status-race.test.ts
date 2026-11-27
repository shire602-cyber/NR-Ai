/**
 * AU7: invoice delivery-status race. Provider webhooks for one email ("delivered", "bounced",
 * "complained", "failed", an SMTP DSN racing the send itself) arrive concurrently and out of
 * order. Each must be applied as one guarded write so a stronger or later state is never
 * overwritten by a weaker or late one, and every event stays in the delivery history.
 */
import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { useHarness } from "./harness";

const h = useHarness();
// Row locks and parallel connections need real Postgres (the PGlite fallback is single-connection).
const realPostgres = process.env.HARNESS_MODE === "postgres";

async function outboxRow(status: string, extra: { providerMessageId?: string } = {}) {
  const [row] = await h.sql<{ id: string }>(
    `INSERT INTO email_outbox (to_address, subject, html, category, related_entity_type, status,
                               provider, provider_message_id, sent_at)
     VALUES ('buyer@example.test', 'Invoice INV-AU7', '<p>Invoice</p>', 'invoice', 'invoice', $1,
             'test', $2, CASE WHEN $1 = 'sent' THEN now() AT TIME ZONE 'UTC' END)
     RETURNING id`,
    [status, extra.providerMessageId ?? null]
  );
  return row.id;
}

async function state(id: string) {
  const [row] = await h.sql(
    `SELECT status, delivered_at, bounced_at, complained_at, dead_at, last_error,
            provider_message_id FROM email_outbox WHERE id = $1`,
    [id]
  );
  return row;
}

async function history(id: string) {
  const rows = await h.sql<{ event_type: string }>(
    "SELECT event_type FROM email_delivery_events WHERE outbox_id = $1 ORDER BY created_at, id",
    [id]
  );
  return rows.map((r) => r.event_type).sort();
}

/** Backends of this database blocked on a row lock while updating email_outbox. */
async function waitingUpdates(): Promise<number> {
  const [row] = await h.sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query ILIKE 'update "email_outbox"%'`
  );
  return row.n;
}

async function until(check: () => Promise<boolean>, what: string) {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(async () => {
  const { setEmailTransportOverride } = await import("../../server/outbox");
  setEmailTransportOverride(null);
});

describe("AU7 invoice delivery-status race", () => {
  it.skipIf(!realPostgres)(
    "a concurrent 'delivered' webhook does not overwrite a 'bounced' one",
    async () => {
      const { applyProviderEvent } = await import("../../server/outbox");
      const id = await outboxRow("sent", { providerMessageId: "msg-race-1" });

      // Hold the row so both webhooks have read it and are queued behind the same lock: the
      // bounce first, then the delivery. Releasing it lets them commit in that order.
      const locker = new pg.Client({ connectionString: h.databaseUrl });
      await locker.connect();
      try {
        await locker.query("BEGIN");
        await locker.query("SELECT id FROM email_outbox WHERE id = $1 FOR UPDATE", [id]);
        const bounced = applyProviderEvent({
          provider: "resend",
          providerMessageId: "msg-race-1",
          type: "bounced",
          detail: "Permanent: mailbox does not exist",
        });
        await until(async () => (await waitingUpdates()) === 1, "the bounce to block");
        const delivered = applyProviderEvent({
          provider: "resend",
          providerMessageId: "msg-race-1",
          type: "delivered",
        });
        await until(async () => (await waitingUpdates()) === 2, "the delivery to block");
        await locker.query("COMMIT");
        await expect(Promise.all([bounced, delivered])).resolves.toEqual([id, id]);
      } finally {
        await locker.query("ROLLBACK").catch(() => undefined);
        await locker.end();
      }

      expect(await state(id)).toMatchObject({
        status: "bounced",
        last_error: "Permanent: mailbox does not exist",
      });
      expect((await state(id)).bounced_at).not.toBeNull();
      // Both events are kept in the delivery history.
      expect(await history(id)).toEqual(["bounced", "delivered"]);
    }
  );

  // Runs on PGlite too: statements from the parallel calls interleave on its shared session, which
  // is enough to expose a read-then-write overwrite.
  it("many concurrent webhooks for one email always settle on the strongest state", async () => {
    const { applyProviderEvent } = await import("../../server/outbox");
    for (let round = 0; round < 5; round++) {
      const msg = `msg-storm-${round}`;
      const id = await outboxRow("sent", { providerMessageId: msg });
      const types = ["delivered", "opened", "bounced", "delivered", "failed", "opened"] as const;
      await Promise.all(
        types.map((type) =>
          applyProviderEvent({ provider: "resend", providerMessageId: msg, type })
        )
      );
      expect((await state(id)).status).toBe("bounced");
      expect(await history(id)).toHaveLength(types.length);
    }
  });

  it("a DSN that lands while the send is still in flight is not downgraded to 'sent'", async () => {
    const { applyProviderEvent, deliverOutboxMessage, setEmailTransportOverride } =
      await import("../../server/outbox");
    const id = await outboxRow("queued");
    setEmailTransportOverride({
      name: "test",
      send: async (mail) => {
        // The relay reports delivery (matched by outbox id) before the provider call returns.
        await applyProviderEvent({ provider: "smtp", outboxId: mail.outboxId, type: "delivered" });
        return { providerMessageId: "msg-dsn-first" };
      },
    });
    const result = await deliverOutboxMessage(id);
    expect(result?.status).toBe("delivered");
    const row = await state(id);
    expect(row).toMatchObject({ status: "delivered", provider_message_id: "msg-dsn-first" });
    expect(row.delivered_at).not.toBeNull();
    expect(await history(id)).toEqual(["delivered", "sent"]);
  });

  it("older or weaker events arriving late never downgrade the status", async () => {
    const { applyProviderEvent } = await import("../../server/outbox");
    const ev = (
      msg: string,
      type: "delivered" | "bounced" | "complained" | "failed",
      at?: string
    ) =>
      applyProviderEvent({
        provider: "resend",
        providerMessageId: msg,
        type,
        occurredAt: at ? new Date(at) : null,
      });

    // Bounced (10:05) is received before the older delivered (10:00) event.
    const a = await outboxRow("sent", { providerMessageId: "msg-ooo-a" });
    await ev("msg-ooo-a", "bounced", "2026-11-20T10:05:00Z");
    await ev("msg-ooo-a", "delivered", "2026-11-20T10:00:00Z");
    expect((await state(a)).status).toBe("bounced");

    // A late bounce or provider failure does not replace a spam complaint.
    const b = await outboxRow("sent", { providerMessageId: "msg-ooo-b" });
    await ev("msg-ooo-b", "complained", "2026-11-20T11:00:00Z");
    await ev("msg-ooo-b", "bounced", "2026-11-20T10:59:00Z");
    await ev("msg-ooo-b", "failed", "2026-11-20T10:58:00Z");
    expect((await state(b)).status).toBe("complained");

    // A late "failed" does not turn a bounce (or a delivery) into a dead letter.
    const c = await outboxRow("sent", { providerMessageId: "msg-ooo-c" });
    await ev("msg-ooo-c", "bounced", "2026-11-20T12:00:00Z");
    await ev("msg-ooo-c", "failed", "2026-11-20T11:59:00Z");
    expect((await state(c)).status).toBe("bounced");
    const d = await outboxRow("sent", { providerMessageId: "msg-ooo-d" });
    await ev("msg-ooo-d", "delivered", "2026-11-20T12:00:00Z");
    await ev("msg-ooo-d", "failed", "2026-11-20T11:59:00Z");
    expect((await state(d)).status).toBe("delivered");

    // A bounce reported after delivery is stronger and is applied.
    await ev("msg-ooo-d", "bounced", "2026-11-20T12:30:00Z");
    expect((await state(d)).status).toBe("bounced");

    // The provider's event time is recorded, and a duplicate keeps the earliest time.
    const e = await outboxRow("sent", { providerMessageId: "msg-ooo-e" });
    await ev("msg-ooo-e", "delivered", "2026-11-20T13:10:00Z");
    await ev("msg-ooo-e", "delivered", "2026-11-20T13:00:00Z");
    await ev("msg-ooo-e", "delivered", "2026-11-20T13:20:00Z");
    const [{ delivered_at }] = await h.sql(
      "SELECT to_char(delivered_at, 'YYYY-MM-DD HH24:MI') AS delivered_at FROM email_outbox WHERE id = $1",
      [e]
    );
    expect(delivered_at).toBe("2026-11-20 13:00");

    // Every event, applied or not, stays in the history.
    expect(await history(b)).toEqual(["bounced", "complained", "failed"]);
    expect(await history(d)).toEqual(["bounced", "delivered", "failed"]);
  });
});
