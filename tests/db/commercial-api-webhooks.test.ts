/**
 * W5-B: public API keys and outbound webhooks.
 *   R19-01 API keys authenticate /api/v1 (scoped, tenant-bound, last_used_at)
 *   R19-15 per-key rate limit, OpenAPI document, session-only routes refuse keys
 *   R19-10 key update/revoke are single tenant-scoped statements
 *   R19-02 domain events -> signed, queued deliveries with retry/backoff and dead letter
 */
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

async function createKey(t: Tenant, scopes: string[], extra: Record<string, unknown> = {}) {
  const r = await t.as.post(`/api/companies/${t.company.id}/api-keys`, {
    name: "Integration",
    scopes,
    ...extra,
  });
  expect(r.status, r.text).toBe(201);
  return r.body as { id: string; key: string; scopes: string[] };
}

const withKey = (key: string) => ({ token: null, headers: { Authorization: `ApiKey ${key}` } });

async function issueInvoice(t: Tenant) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Webhook Customer",
    date: today(),
    lines: [{ description: "Service", quantity: 1, unitPrice: 100, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string };
}

async function drain() {
  const { drainDomainEvents } = await import("../../server/platform/domain-events");
  await drainDomainEvents();
}

describe("W5-B public API keys", () => {
  it("locks an existing key at trial expiry and restores it on an API-enabled paid plan", async () => {
    process.env.BILLING_ENFORCEMENT = "true";
    try {
      const tenant = await h.createTenant();
      const key = await createKey(tenant, ["read:accounts", "write:contacts"]);
      const request = withKey(key.key);
      expect((await h.anon.get("/api/v1/accounts", request)).status).toBe(200);

      await h.sql("UPDATE subscriptions SET trial_ends_at = now() WHERE company_id = $1", [
        tenant.company.id,
      ]);
      const read = await h.anon.get("/api/v1/accounts", request);
      expect(read.status).toBe(402);
      expect(read.body).toMatchObject({ code: "PLAN_REQUIRED", companyId: tenant.company.id });
      expect((await h.anon.post("/api/v1/contacts", { name: "Locked" }, request)).status).toBe(402);

      await h.sql("UPDATE subscriptions SET plan_id = 'enterprise' WHERE company_id = $1", [
        tenant.company.id,
      ]);
      expect((await h.anon.get("/api/v1/accounts", request)).status).toBe(200);
    } finally {
      delete process.env.BILLING_ENFORCEMENT;
    }
  });

  it("[R19-01] a scoped key lists its own company's invoices over /api/v1 and sets last_used_at", async () => {
    const a = await h.createTenant();
    await issueInvoice(a);
    const key = await createKey(a, ["read:invoices"]);
    expect(key.key).toMatch(/^muh_[0-9a-f]{64}$/);
    const stored = await h.sql(
      `SELECT key_hash, key_prefix, last_used_at FROM api_keys WHERE id = $1`,
      [key.id]
    );
    expect(stored[0].key_hash).not.toContain(key.key.slice(4, 20));
    expect(stored[0].last_used_at).toBeNull();

    const list = await h.anon.get(`/api/v1/invoices`, withKey(key.key));
    expect(list.status, list.text).toBe(200);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].customerName).toBe("Webhook Customer");
    // X-API-Key works too
    const alt = await h.anon.get(`/api/v1/invoices`, {
      token: null,
      headers: { "X-API-Key": key.key },
    });
    expect(alt.status).toBe(200);

    const after = await h.sql(`SELECT last_used_at FROM api_keys WHERE id = $1`, [key.id]);
    expect(after[0].last_used_at).not.toBeNull();
  });

  it("[R19-01] a key without the scope gets 403 INSUFFICIENT_SCOPE; an invalid key gets 401", async () => {
    const a = await h.createTenant();
    const key = await createKey(a, ["read:contacts"]);
    const r = await h.anon.get(`/api/v1/invoices`, withKey(key.key));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("INSUFFICIENT_SCOPE");
    const write = await h.anon.post(`/api/v1/contacts`, { name: "Nope" }, withKey(key.key));
    expect(write.status).toBe(403);
    const bad = await h.anon.get(`/api/v1/invoices`, withKey(`muh_${"0".repeat(64)}`));
    expect(bad.status).toBe(401);
    const none = await h.anon.get(`/api/v1/invoices`);
    expect(none.status).toBe(401);
    expect(none.body.code).toBe("API_KEY_REQUIRED");
  });

  it("[R19-01] a key cannot reach another company's rows (404) and is bound to its own company", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const invB = await issueInvoice(b);
    const keyA = await createKey(a, ["read:invoices", "write:payments"]);
    const r = await h.anon.get(`/api/v1/invoices/${invB.id}`, withKey(keyA.key));
    expect(r.status).toBe(404);
    const list = await h.anon.get(`/api/v1/invoices`, withKey(keyA.key));
    expect(list.body.data.map((i: { id: string }) => i.id)).not.toContain(invB.id);
    const bankB = await accountByCode(b, "1020");
    const pay = await h.anon.post(
      `/api/v1/invoices/${invB.id}/payments`,
      { amount: "10.00", date: today(), paymentAccountId: bankB.id },
      withKey(keyA.key)
    );
    expect(pay.status).toBe(404);
    expect(
      (
        await h.sql(`SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1`, [
          invB.id,
        ])
      )[0].n
    ).toBe(0);
  });

  it("[R19-15] the per-key rate limit answers 429 with Retry-After", async () => {
    const a = await h.createTenant();
    const key = await createKey(a, ["read:accounts"], { rateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await h.anon.get(`/api/v1/accounts`, withKey(key.key))).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    const again = await h.anon.get(`/api/v1/accounts`, withKey(key.key));
    expect(again.headers.get("retry-after")).toBeTruthy();
  });

  it("[R19-15] keys are refused on session-only routes; writes validate strictly; OpenAPI is served", async () => {
    const a = await h.createTenant();
    const key = await createKey(a, ["write:contacts", "read:contacts", "read:reports"]);
    const session = await h.anon.get(`/api/companies/${a.company.id}/invoices`, withKey(key.key));
    expect(session.status).toBe(401);
    expect(session.body.code).toBe("API_KEY_NOT_ACCEPTED");

    const unknown = await h.anon.post(
      `/api/v1/contacts`,
      { name: "X", isAdmin: true },
      withKey(key.key)
    );
    expect(unknown.status).toBe(400);
    const created = await h.anon.post(
      `/api/v1/contacts`,
      { name: "API Contact" },
      withKey(key.key)
    );
    expect(created.status, created.text).toBe(201);
    const rows = await h.sql(`SELECT company_id FROM customer_contacts WHERE id = $1`, [
      created.body.id,
    ]);
    expect(rows[0].company_id).toBe(a.company.id);

    const tb = await h.anon.get(`/api/v1/reports/trial-balance`, withKey(key.key));
    expect(tb.status, tb.text).toBe(200);
    expect(tb.body.isBalanced).toBe(true);

    const doc = await h.anon.get(`/api/v1/openapi.json`);
    expect(doc.status).toBe(200);
    expect(doc.body.openapi).toBe("3.0.3");
    expect(doc.body.paths["/invoices"].post["x-required-scope"]).toBe("write:invoices");
    expect(
      doc.body.paths["/invoices"].post.requestBody.content["application/json"].schema
        .additionalProperties
    ).toBe(false);
  });

  it("[R19-10] update and revoke are tenant-scoped: another tenant's key is a 404 and stays active", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const keyA = await createKey(a, ["read:invoices"]);
    const upd = await b.as.put(`/api/api-keys/${keyA.id}`, { name: "hijack" });
    expect([403, 404]).toContain(upd.status);
    const del = await b.as.delete(`/api/api-keys/${keyA.id}`);
    expect([403, 404]).toContain(del.status);
    const row = await h.sql(`SELECT name, is_active FROM api_keys WHERE id = $1`, [keyA.id]);
    expect(row[0]).toMatchObject({ name: "Integration", is_active: true });

    const own = await a.as.delete(`/api/api-keys/${keyA.id}`);
    expect(own.status).toBe(200);
    const revoked = await h.anon.get(`/api/v1/invoices`, withKey(keyA.key));
    expect(revoked.status).toBe(401);
  });
});

describe("W5-B webhooks from domain events", () => {
  afterEach(async () => {
    const { setWebhookTransport } = await import("../../server/services/webhook.service");
    setWebhookTransport(null);
  });

  async function endpoint(t: Tenant, events: string[]) {
    const r = await t.as.post(`/api/companies/${t.company.id}/webhooks`, {
      url: "https://93.184.215.14/muhasib",
      events,
    });
    expect(r.status, r.text).toBe(201);
    return r.body as { id: string; secret: string };
  }

  it("[R19-02] issuing an invoice creates a signed delivery to the endpoint", async () => {
    const { setWebhookTransport, verifyWebhookSignature } =
      await import("../../server/services/webhook.service");
    const received: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    setWebhookTransport(async (url, init) => {
      received.push({ url, headers: init.headers, body: init.body });
      return { status: 200, ok: true, bodyText: "ok" };
    });
    const a = await h.createTenant();
    const ep = await endpoint(a, ["invoice.issued"]);
    const stored = await h.sql(`SELECT secret FROM webhook_endpoints WHERE id = $1`, [ep.id]);
    expect(stored[0].secret).toMatch(/^enc:v1:/); // secret encrypted at rest

    const inv = await issueInvoice(a);
    await drain();

    const issued = received.filter((r) => r.headers["X-Webhook-Event"] === "invoice.issued");
    expect(issued).toHaveLength(1);
    const payload = JSON.parse(issued[0].body);
    expect(payload).toMatchObject({ type: "invoice.issued", companyId: a.company.id });
    expect(payload.data.entityId).toBe(inv.id);
    expect(
      verifyWebhookSignature(ep.secret, issued[0].body, issued[0].headers["X-Muhasib-Signature"])
    ).toBe(true);
    const legacy = crypto.createHmac("sha256", ep.secret).update(issued[0].body).digest("hex");
    expect(issued[0].headers["X-Webhook-Signature"]).toBe(`sha256=${legacy}`);

    const rows = await h.sql(
      `SELECT status, attempt_number, success FROM webhook_deliveries WHERE webhook_endpoint_id = $1 AND event = 'invoice.issued'`,
      [ep.id]
    );
    expect(rows).toEqual([{ status: "delivered", attempt_number: 1, success: true }]);
  });

  it("[R19-02] a 500 schedules a retry with backoff; exhausted retries dead-letter; replay redelivers", async () => {
    const svc = await import("../../server/services/webhook.service");
    let mode: "fail" | "ok" = "fail";
    let calls = 0;
    svc.setWebhookTransport(async () => {
      calls++;
      return mode === "fail"
        ? { status: 500, ok: false, bodyText: "boom" }
        : { status: 204, ok: true, bodyText: "" };
    });
    const a = await h.createTenant();
    const ep = await endpoint(a, ["contact.created"]);
    const c = await a.as.post(`/api/companies/${a.company.id}/customer-contacts`, {
      name: "Hook Contact",
    });
    expect([200, 201]).toContain(c.status);
    await drain();

    let [d] = await h.sql(
      `SELECT id, status, attempt_number, next_attempt_at, response_status FROM webhook_deliveries WHERE webhook_endpoint_id = $1`,
      [ep.id]
    );
    expect(d.status).toBe("retrying");
    expect(d.attempt_number).toBe(1);
    expect(d.response_status).toBe(500);
    expect(new Date(d.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Not due yet: the retry job leaves it alone.
    await svc.processDueWebhookDeliveries();
    expect(calls).toBe(1);

    // Make every retry due and run the job until the attempts run out.
    for (let i = 0; i < 10; i++) {
      await h.sql(
        `UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = $1 AND status = 'retrying'`,
        [d.id]
      );
      await svc.processDueWebhookDeliveries();
    }
    [d] = await h.sql(`SELECT id, status, attempt_number FROM webhook_deliveries WHERE id = $1`, [
      d.id,
    ]);
    expect(d.status).toBe("dead");
    expect(d.attempt_number).toBe(svc.DEFAULT_MAX_ATTEMPTS);
    expect(calls).toBe(svc.DEFAULT_MAX_ATTEMPTS);

    mode = "ok";
    const replay = await a.as.post(`/api/webhooks/${ep.id}/deliveries/${d.id}/replay`);
    expect(replay.status, replay.text).toBe(201);
    expect(replay.body.status).toBe("delivered");
  });

  it("[R19-02] backoff grows exponentially and events outside the subscription are not sent", async () => {
    const svc = await import("../../server/services/webhook.service");
    expect(svc.webhookBackoffMs(1)).toBe(30_000);
    expect(svc.webhookBackoffMs(2)).toBe(120_000);
    expect(svc.webhookBackoffMs(3)).toBe(480_000);
    const sent: string[] = [];
    svc.setWebhookTransport(async (_u, init) => {
      sent.push(init.headers["X-Webhook-Event"]);
      return { status: 200, ok: true, bodyText: "" };
    });
    const a = await h.createTenant();
    await endpoint(a, ["bill.paid"]);
    await issueInvoice(a);
    await drain();
    expect(sent).toEqual([]);
  });
});
