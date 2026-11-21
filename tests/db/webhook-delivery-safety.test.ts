import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebhookTransportRequest } from "../../server/services/webhook.service";
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
    response_status: number | null;
    response_body: string | null;
    last_error: string | null;
    next_attempt_at: string | null;
  }>(
    `SELECT id, event_id, status, attempt_number, response_status, response_body,
            last_error, next_attempt_at
       FROM webhook_deliveries WHERE webhook_endpoint_id = $1 ORDER BY created_at`,
    [endpointId]
  );
}

afterEach(async () => {
  (await components()).setWebhookTransport(null);
  (await import("../../server/services/url-guard")).__setOutboundGuardForTests(null);
});

describe("outbound webhook delivery safety", () => {
  it("pauses disabled endpoints without using their retry slots or sending forced attempts", async () => {
    const svc = await components();
    const paused = await endpoint();
    const active = await endpoint();
    const transport = vi.fn(async () => ({ status: 503, ok: false, bodyText: "" }));
    svc.setWebhookTransport(transport);
    transport.mockResolvedValueOnce({ status: 204, ok: true, bodyText: "" });
    const [settledId] = await svc.enqueueWebhookEvent(paused.t.company.id, "bill.approved", {});
    const [pausedId] = await svc.enqueueWebhookEvent(paused.t.company.id, "bill.approved", {});
    const [activeId] = await svc.enqueueWebhookEvent(active.t.company.id, "bill.approved", {});
    expect(
      (await paused.t.as.put(`/api/webhooks/${paused.endpointId}`, { isActive: false })).status
    ).toBe(200);
    await h.sql(
      `UPDATE webhook_deliveries SET next_attempt_at = CASE WHEN id = $1 THEN now() - interval '1 minute' ELSE now() END
        WHERE id IN ($1, $2)`,
      [pausedId, activeId]
    );
    transport.mockClear();
    transport.mockResolvedValue({ status: 204, ok: true, bodyText: "" });

    expect(await svc.attemptWebhookDelivery(pausedId, { force: true })).toBe("skipped");
    const pausedPath = `/api/webhooks/${paused.endpointId}`;
    const history = await paused.t.as.get(`${pausedPath}/deliveries`);
    expect(history.status).toBe(200);
    expect(history.body.find((row: { id: string }) => row.id === settledId)).toMatchObject({
      replayEligible: false,
      replayUnavailableReason: "endpoint_disabled",
    });
    const manual = await paused.t.as.post(`${pausedPath}/test`);
    const replay = await paused.t.as.post(`${pausedPath}/deliveries/${settledId}/replay`);
    expect([manual.status, replay.status]).toEqual([409, 409]);
    expect(await svc.replayWebhookDelivery(settledId)).toBeNull();
    expect(await deliveries(paused.endpointId)).toHaveLength(2);
    expect(await svc.processDueWebhookDeliveries(1)).toMatchObject({ delivered: 1, skipped: 0 });
    expect((await deliveries(paused.endpointId)).find((row) => row.id === pausedId)).toMatchObject({
      id: pausedId,
      status: "retrying",
      attempt_number: 1,
    });
    expect((await deliveries(active.endpointId))[0]).toMatchObject({
      id: activeId,
      status: "delivered",
      attempt_number: 2,
    });
    expect(transport).toHaveBeenCalledOnce();

    expect(
      (await paused.t.as.put(`/api/webhooks/${paused.endpointId}`, { isActive: true })).status
    ).toBe(200);
    expect(await svc.processDueWebhookDeliveries()).toMatchObject({ delivered: 1 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("withholds HTTP bytes when the endpoint is disabled after the delivery claim", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const { __setOutboundGuardForTests } = await import("../../server/services/url-guard");
    let beginLookup!: () => void;
    const resolving = new Promise<void>((resolve) => {
      beginLookup = resolve;
    });
    let finishLookup!: () => void;
    const lookup = new Promise<void>((resolve) => {
      finishLookup = resolve;
    });
    __setOutboundGuardForTests({
      isBlocked: (ip) => ip !== "127.0.0.1",
      resolve: async () => {
        beginLookup();
        await lookup;
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    let received = 0;
    const receiver = http.createServer((_req, res) => {
      received += 1;
      res.writeHead(204).end();
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    let queued: Promise<string[]> | undefined;
    try {
      const port = (receiver.address() as AddressInfo).port;
      await h.sql("UPDATE webhook_endpoints SET url = $2 WHERE id = $1", [
        endpointId,
        `http://paused-receiver.test:${port}/receiver`,
      ]);
      queued = svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
      await Promise.race([resolving, queued]);
      expect((await t.as.put(`/api/webhooks/${endpointId}`, { isActive: false })).status).toBe(200);
    } finally {
      finishLookup();
      try {
        await queued;
      } finally {
        receiver.closeAllConnections();
        await new Promise<void>((resolve) => receiver.close(() => resolve()));
      }
    }
    expect(received).toBe(0);
    const [delivery] = await deliveries(endpointId);
    expect(delivery).toMatchObject({ status: "retrying", attempt_number: 1 });
    await h.sql("UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1", [
      delivery.id,
    ]);
    expect(await svc.processDueWebhookDeliveries()).toMatchObject({ delivered: 0, skipped: 0 });
  });

  it.each([
    { status: 200, outcome: "delivered" },
    { status: 503, outcome: "retrying" },
  ])(
    "retains HTTP $status if a real receiver leaves its body open",
    async ({ status, outcome }) => {
      const svc = await components();
      const { t, endpointId } = await endpoint();
      const { __setOutboundGuardForTests } = await import("../../server/services/url-guard");
      __setOutboundGuardForTests({ isBlocked: (ip) => ip !== "127.0.0.1" });
      const receiver = http.createServer((_req, res) => {
        res.writeHead(status, { "Content-Length": "40" });
        res.write("partial response");
      });
      await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      try {
        const port = (receiver.address() as AddressInfo).port;
        await h.sql("UPDATE webhook_endpoints SET url = $2 WHERE id = $1", [
          endpointId,
          `http://127.0.0.1:${port}/receiver`,
        ]);
        const [id] = await svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
        expect((await deliveries(endpointId))[0]).toMatchObject({
          id,
          status: outcome,
          response_status: status,
          response_body: "partial response",
          last_error: status === 200 ? null : `HTTP ${status}`,
          attempt_number: 1,
        });
        if (outcome === "retrying") {
          await h.sql(
            "UPDATE webhook_deliveries SET next_attempt_at = now() + interval '1 day' WHERE id = $1",
            [id]
          );
        }
      } finally {
        receiver.closeAllConnections();
        await new Promise<void>((resolve) => receiver.close(() => resolve()));
      }
    }
  );

  it("preserves the real response status if the caller aborts after headers", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const { __setOutboundGuardForTests, safeOutboundFetch } =
      await import("../../server/services/url-guard");
    __setOutboundGuardForTests({ isBlocked: (ip) => ip !== "127.0.0.1" });
    const caller = new AbortController();
    svc.setWebhookTransport((url, { prepareTransmission, onResponseHeaders, ...init }) =>
      safeOutboundFetch(url, init, {
        prepareTransmission,
        onResponseHeaders: (status) => {
          onResponseHeaders(status);
          caller.abort();
        },
      })
    );
    const receiver = http.createServer((_req, res) => {
      res.writeHead(202, { "Content-Length": "40" });
      res.flushHeaders();
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    try {
      const port = (receiver.address() as AddressInfo).port;
      await h.sql("UPDATE webhook_endpoints SET url = $2 WHERE id = $1", [
        endpointId,
        `http://127.0.0.1:${port}/receiver`,
      ]);
      const [id] = await svc.enqueueWebhookEvent(t.company.id, "bill.approved", {}, randomUUID(), {
        signal: caller.signal,
      });
      expect(caller.signal.aborted).toBe(true);
      expect((await deliveries(endpointId))[0]).toMatchObject({
        id,
        status: "delivered",
        response_status: 202,
        last_error: null,
        attempt_number: 1,
      });
    } finally {
      receiver.closeAllConnections();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });

  it("retries when the caller's deadline expires while the delivery claim is blocked", async ({
    skip,
  }) => {
    if (!h.concurrencySupported) skip();
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const { pool } = await import("../../server/db");
    const [delivery] = await h.sql<{ id: string }>(
      `INSERT INTO webhook_deliveries
         (webhook_endpoint_id, company_id, event, event_id, payload, status, attempt_number)
       VALUES ($1, $2, 'bill.approved', $3, '{}', 'pending', 0) RETURNING id`,
      [endpointId, t.company.id, randomUUID()]
    );
    const transport = vi.fn(async () => ({ status: 204, ok: true, bodyText: "" }));
    svc.setWebhookTransport(transport);
    const blocker = await pool.connect();
    const controller = new AbortController();
    let attempt: ReturnType<typeof svc.attemptWebhookDelivery> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM webhook_deliveries WHERE id = $1 FOR UPDATE", [
        delivery.id,
      ]);
      attempt = svc.attemptWebhookDelivery(delivery.id, { signal: controller.signal });
      await vi.waitFor(async () => {
        const waiting = await h.sql(
          `SELECT pid FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE '%UPDATE webhook_deliveries d%'`
        );
        expect(waiting).toHaveLength(1);
      });
      controller.abort();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await attempt;
    }

    expect(await attempt).toBe("retrying");
    expect(transport).not.toHaveBeenCalled();
    await h.sql("UPDATE webhook_deliveries SET next_attempt_at = now() WHERE id = $1", [
      delivery.id,
    ]);
    expect(await svc.processDueWebhookDeliveries()).toMatchObject({ delivered: 1 });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("keeps an actual refused TCP connection retryable and permits replay after it settles", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    const { __setOutboundGuardForTests } = await import("../../server/services/url-guard");
    __setOutboundGuardForTests({ isBlocked: (ip) => ip !== "127.0.0.1" });
    const receiver = http.createServer((_req, res) => res.writeHead(204).end());
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const port = (receiver.address() as AddressInfo).port;
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await h.sql("UPDATE webhook_endpoints SET url = $2 WHERE id = $1", [
      endpointId,
      `https://127.0.0.1:${port}/receiver`,
    ]);

    const [id] = await svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
    expect((await deliveries(endpointId))[0]).toMatchObject({ id, status: "retrying" });
    const retrying = await t.as.get(`/api/webhooks/${endpointId}/deliveries`);
    expect(retrying.status).toBe(200);
    expect(retrying.body[0]).toMatchObject({
      id,
      replayEligible: false,
      replayUnavailableReason: "delivery_pending",
    });
    await h.sql("UPDATE webhook_deliveries SET max_attempts = 2 WHERE id = $1", [id]);
    expect(await svc.attemptWebhookDelivery(id, { force: true })).toBe("dead");
    const list = await t.as.get(`/api/webhooks/${endpointId}/deliveries`);
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id, replayEligible: true, replayUnavailableReason: null });

    await new Promise<void>((resolve) => receiver.listen(port, "127.0.0.1", resolve));
    try {
      await h.sql("UPDATE webhook_endpoints SET url = $2 WHERE id = $1", [
        endpointId,
        `http://127.0.0.1:${port}/receiver`,
      ]);
      const replay = await t.as.post(`/api/webhooks/${endpointId}/deliveries/${id}/replay`);
      expect(replay.status, replay.text).toBe(201);
      expect(replay.body.status).toBe("delivered");
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });

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
      const markStarted = await request.prepareTransmission();
      markStarted();
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
    let expire!: () => void;
    const timers = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback, delay, ...args) => {
        if (delay === 15_000) expire = () => callback(...args);
        return realSetTimeout(callback, delay, ...args);
      });
    let release!: () => void;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const transport = vi.fn(async (_url: string, init: WebhookTransportRequest) => {
      const markStarted = await init.prepareTransmission();
      markStarted();
      signal = init.signal;
      expire();
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
      const history = await t.as.get(`/api/webhooks/${endpointId}/deliveries`);
      expect(history.status).toBe(200);
      expect(history.body[0]).toMatchObject({
        id,
        replayEligible: false,
        replayUnavailableReason: "delivery_uncertain",
      });
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

  it("recovers an interrupted pre-send claim and prevents its stale worker from writing", async () => {
    const svc = await components();
    const { t, endpointId } = await endpoint();
    let signalClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => {
      signalClaimed = resolve;
    });
    let release!: () => void;
    const waitingToSend = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: string[] = [];
    svc.setWebhookTransport(async (_url, init) => {
      const attempt = init.headers["X-Webhook-Attempt"];
      if (attempt === "1") {
        signalClaimed();
        await waitingToSend;
      }
      const markStarted = await init.prepareTransmission();
      markStarted();
      writes.push(attempt);
      return { status: 204, ok: true, bodyText: "" };
    });

    const sending = svc.enqueueWebhookEvent(t.company.id, "bill.approved", {});
    try {
      await claimed;
      const [delivery] = await deliveries(endpointId);
      await h.sql(
        "UPDATE webhook_deliveries SET updated_at = now() - interval '11 minutes' WHERE id = $1",
        [delivery.id]
      );
      expect(await svc.processDueWebhookDeliveries()).toMatchObject({ delivered: 1, dead: 0 });
    } finally {
      release();
      await sending;
    }
    expect(writes).toEqual(["2"]);
    expect((await deliveries(endpointId))[0]).toMatchObject({
      status: "delivered",
      attempt_number: 2,
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
    const transport = vi.fn(async (_url: string, init: WebhookTransportRequest) => {
      const markStarted = await init.prepareTransmission();
      markStarted();
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
    const transport = vi.fn(async (_url: string, init: WebhookTransportRequest) => {
      const markStarted = await init.prepareTransmission();
      markStarted();
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
    const transport = vi.fn(async (_url: string, req: WebhookTransportRequest) => {
      const markStarted = await req.prepareTransmission();
      markStarted();
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
      const history = await t.as.get(`/api/webhooks/${endpointId}/deliveries`);
      expect(history.status).toBe(200);
      expect(history.body.find((row: { id: string }) => row.id === originalId)).toMatchObject({
        replayEligible: false,
        replayUnavailableReason: "delivery_pending",
      });
    } finally {
      release();
      await replay;
    }

    expect(await svc.replayWebhookDelivery(originalId)).toBeNull();
    const replayId = await replay;
    await h.sql(
      `UPDATE webhook_deliveries SET created_at = now() - interval '2 days' WHERE id = $1`,
      [replayId]
    );
    await h.sql(
      `INSERT INTO webhook_deliveries
         (webhook_endpoint_id, company_id, event, event_id, created_at, status)
       SELECT $1, $2, 'bill.approved', gen_random_uuid()::text, now() - interval '1 day', 'delivered'
         FROM generate_series(1, 100)`,
      [endpointId, t.company.id]
    );
    const history = await t.as.get(`/api/webhooks/${endpointId}/deliveries`);
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(100);
    expect(history.body.some((row: { id: string }) => row.id === replayId)).toBe(false);
    expect(history.body.find((row: { id: string }) => row.id === originalId)).toMatchObject({
      replayEligible: false,
      replayUnavailableReason: "delivery_uncertain",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(sentHeaders[0]["X-Webhook-Id"]).toBe(eventId);
    expect(sentHeaders[0]["X-Webhook-Delivery"]).not.toBe(originalId);
    expect(await deliveries(endpointId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: originalId, status: "delivered" }),
        expect.objectContaining({ id: replayId, status: "dead" }),
      ])
    );
  });
});
