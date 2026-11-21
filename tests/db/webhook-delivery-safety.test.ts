import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

async function components() {
  return {
    ...(await import("../../server/services/webhook.service")),
    ...(await import("../../server/platform/event-outbox")),
    ...(await import("../../server/platform/domain-events")),
  };
}

async function endpoint() {
  const t = await h.createTenant();
  const created = await t.as.post(`/api/companies/${t.company.id}/webhooks`, {
    url: "https://93.184.215.14/test-receiver",
    events: ["bill.approved"],
  });
  expect(created.status).toBe(201);
  return { t, endpointId: created.body.id as string };
}

async function deliveries(endpointId: string) {
  return h.sql<{
    id: string;
    event_id: string;
    status: string;
    attempt_number: number;
    last_error: string | null;
    next_attempt_at: string | null;
  }>(
    `SELECT id, event_id, status, attempt_number, last_error, next_attempt_at
       FROM webhook_deliveries WHERE webhook_endpoint_id = $1 ORDER BY created_at`,
    [endpointId]
  );
}

afterEach(async () => {
  (await components()).setWebhookTransport(null);
});

describe("outbound webhook delivery safety", () => {
  it("sends an event once when the recipient handles the request but the response times out", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    let signalReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      signalReceived = resolve;
    });
    let releaseResponse!: () => void;
    const timedOut = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const receivedIds: string[] = [];
    svc.setWebhookTransport(async (_, request) => {
      receivedIds.push(request.headers["X-Webhook-Id"]);
      if (receivedIds.length === 1) {
        signalReceived();
        await timedOut;
      }
      throw new Error("Outbound request timed out");
    });

    const eventId = await svc.emitDomainEventInTx(null, "bill.approved", {
      companyId: t.company.id,
      entityId: randomUUID(),
    });

    try {
      await received;
      const [delivery] = await deliveries(endpointId);
      expect(await svc.attemptWebhookDelivery(delivery.id, { force: true })).toBe("skipped");
      const replay = await t.as.post(
        `/api/webhooks/${endpointId}/deliveries/${delivery.id}/replay`
      );
      expect(replay.status).toBe(409);
      await svc.processDueWebhookDeliveries();
      expect(receivedIds).toHaveLength(1);
    } finally {
      releaseResponse();
      await svc.drainDomainEvents();
    }

    // Simulate a worker restart after queue/send but before its domain-event receipt survived.
    await h.sql("DELETE FROM domain_event_deliveries WHERE event_id = $1", [eventId]);
    await h.sql(
      "UPDATE domain_event_outbox SET status = 'pending', next_attempt_at = now() WHERE id = $1",
      [eventId]
    );
    const outcome = await svc.dispatchDomainEvent(eventId);
    await h.sql(
      "UPDATE webhook_deliveries SET next_attempt_at = now() WHERE webhook_endpoint_id = $1 AND status = 'retrying'",
      [endpointId]
    );
    await svc.processDueWebhookDeliveries();
    expect(receivedIds).toHaveLength(1);
    expect(receivedIds[0]).toBe(eventId);
    expect(outcome).toBe("dispatched");
    expect(await deliveries(endpointId)).toEqual([
      expect.objectContaining({
        event_id: eventId,
        status: "dead",
        attempt_number: 1,
        last_error: expect.stringMatching(/outcome unknown/i),
        next_attempt_at: null,
      }),
    ]);
  });

  it("preserves a historical random delivery ID when its envelope matches a durable redelivery", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const eventId = randomUUID();
    const historicalId = randomUUID();
    await h.sql(
      `INSERT INTO domain_event_outbox
         (id, event_type, entity_id, payload, status, attempts)
       VALUES ($1, 'bill.approved', $2, $3, 'pending', 1)`,
      [eventId, randomUUID(), JSON.stringify({ companyId: t.company.id, entityId: randomUUID() })]
    );
    for (const [id, envelope] of [
      [randomUUID(), '{"data":'],
      [historicalId, JSON.stringify({ id: historicalId, data: { eventId } })],
    ]) {
      await h.sql(
        `INSERT INTO webhook_deliveries
           (webhook_endpoint_id, company_id, event, event_id, payload, status, attempt_number)
         VALUES ($1, $2, 'bill.approved', $3, $4, 'dead', 1)`,
        [endpointId, t.company.id, id, envelope]
      );
    }
    const transport = vi.fn(async () => ({ status: 204, ok: true, bodyText: "" }));
    svc.setWebhookTransport(transport);

    expect(await svc.dispatchDomainEvent(eventId)).toBe("dispatched");
    await svc.processDueWebhookDeliveries();
    expect(transport).not.toHaveBeenCalled();
    expect((await deliveries(endpointId)).map((row) => row.event_id)).toEqual(
      expect.arrayContaining([historicalId])
    );
    expect(await deliveries(endpointId)).toHaveLength(2);
  });

  it("bounds an uncooperative transport and rejects replay after uncertain delivery", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const realSetTimeout = globalThis.setTimeout;
    const timers = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) =>
        realSetTimeout(callback, delay === 15_000 ? 20 : delay, ...args)
      );
    let release!: () => void;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const transport = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      signal = init.signal;
      await late;
      return { status: 204, ok: true, bodyText: "" };
    });
    svc.setWebhookTransport(transport);

    const send = svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      const [id] = await Promise.race([
        send,
        new Promise<never>((_, reject) => {
          guard = realSetTimeout(
            () => reject(new Error("Webhook transport did not time out")),
            5000
          );
        }),
      ]);
      expect(signal?.aborted).toBe(true);
      await svc.processDueWebhookDeliveries();
      expect(await svc.attemptWebhookDelivery(id, { force: true })).toBe("skipped");
      const replay = await t.as.post(`/api/webhooks/${endpointId}/deliveries/${id}/replay`);
      expect(replay.status).toBe(409);
      expect(replay.body.code).toBe("INVALID_STATUS");
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(guard);
      timers.mockRestore();
      release();
      await send.catch(() => {});
    }

    const [delivery] = await deliveries(endpointId);
    expect(delivery).toMatchObject({
      status: "dead",
      attempt_number: 1,
      last_error: expect.stringMatching(/outcome unknown/i),
      next_attempt_at: null,
    });
  });

  it("retires an interrupted claim and fences its late success", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    let signalReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      signalReceived = resolve;
    });
    let release!: () => void;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = vi.fn(async () => {
      signalReceived();
      await late;
      return { status: 204, ok: true, bodyText: "" };
    });
    svc.setWebhookTransport(transport);

    const send = svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
    try {
      await received;
      const [claimed] = await deliveries(endpointId);
      await h.sql(
        "UPDATE webhook_deliveries SET updated_at = now() - interval '11 minutes' WHERE id = $1",
        [claimed.id]
      );
      expect(await svc.processDueWebhookDeliveries()).toMatchObject({ dead: 1 });
      expect(await svc.attemptWebhookDelivery(claimed.id, { force: true })).toBe("skipped");
    } finally {
      release();
      await send;
    }

    await svc.processDueWebhookDeliveries();
    expect(transport).toHaveBeenCalledTimes(1);
    const [delivery] = await deliveries(endpointId);
    expect(delivery).toMatchObject({
      status: "dead",
      attempt_number: 1,
      last_error: expect.stringMatching(/worker interruption/i),
      next_attempt_at: null,
    });
  });

  it("does not resume an ambiguous retry queued by an older worker", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const transport = vi.fn(async () => {
      throw new Error("Outbound request timed out");
    });
    svc.setWebhookTransport(transport);
    const [id] = await svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
    await h.sql(
      `UPDATE webhook_deliveries
          SET status = 'retrying', last_error = 'Outbound request timed out', next_attempt_at = now()
        WHERE id = $1`,
      [id]
    );

    expect(await svc.attemptWebhookDelivery(id, { force: true })).toBe("skipped");
    expect(await svc.processDueWebhookDeliveries()).toMatchObject({ dead: 1 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await deliveries(endpointId))[0]).toMatchObject({
      id,
      status: "dead",
      attempt_number: 1,
      last_error: expect.stringMatching(/outcome unknown/i),
      next_attempt_at: null,
    });
  });

  it("keeps replay identity stable and blocks competing or uncertain sibling replays", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const eventId = randomUUID();
    svc.setWebhookTransport(async () => ({ status: 204, ok: true, bodyText: "" }));
    const [originalId] = await svc.enqueueWebhookEvent(t.company.id, "bill.approved", {}, eventId);
    let signalReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      signalReceived = resolve;
    });
    let release!: () => void;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentHeaders: Array<Record<string, string>> = [];
    const transport = vi.fn(async (_url: string, req: { headers: Record<string, string> }) => {
      sentHeaders.push(req.headers);
      if (sentHeaders.length === 1) {
        signalReceived();
        await late;
      }
      throw new Error("Response lost after sending");
    });
    svc.setWebhookTransport(transport);

    const replay = svc.replayWebhookDelivery(originalId);
    try {
      await received;
      expect(await svc.replayWebhookDelivery(originalId)).toBeNull();
    } finally {
      release();
      await replay;
    }

    expect(await svc.replayWebhookDelivery(originalId)).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sentHeaders[0]["X-Webhook-Id"]).toBe(eventId);
    expect(sentHeaders[0]["X-Webhook-Delivery"]).not.toBe(originalId);
    expect(await deliveries(endpointId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: originalId, status: "delivered" }),
        expect.objectContaining({ id: await replay, status: "dead" }),
      ])
    );
  });
});
