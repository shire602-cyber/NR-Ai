/**
 * PR-62 port: the Stripe billing webhook must receive the RAW body. With the JSON parser in
 * front of it, `stripe.webhooks.constructEvent` could never verify a signature, so every
 * subscription event was refused with 400. Also: a delivery whose processing fails must
 * release its idempotency claim, so Stripe's retry is processed rather than skipped.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_harness_dummy_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_harness_test_secret";

import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const stripe = new Stripe("sk_test_harness_dummy_key");

function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  });
  return { payload, header };
}

async function post(payload: string, header: string) {
  return h.anon.post("/api/webhooks/stripe", undefined, {
    raw: payload,
    headers: { "content-type": "application/json", "stripe-signature": header },
  });
}

describe("PR-62 Stripe webhook raw body", () => {
  it("PR-62: a correctly signed event verifies (200) and a replay is a no-op", async () => {
    const id = `evt_${randomUUID().replace(/-/g, "")}`;
    const { payload, header } = signed({
      id,
      object: "event",
      type: "harness.unhandled",
      data: { object: {} },
    });
    const first = await post(payload, header);
    expect(first.status, first.text).toBe(200);
    expect(first.body).toEqual({ received: true });
    const again = await post(payload, header);
    expect(again.status, again.text).toBe(200);
    const rows = await h.sql(`SELECT id FROM stripe_events WHERE id = $1`, [id]);
    expect(rows).toHaveLength(1);
  });

  it("PR-62: a tampered body is refused (400) and records nothing", async () => {
    const id = `evt_${randomUUID().replace(/-/g, "")}`;
    const { payload, header } = signed({
      id,
      object: "event",
      type: "harness.unhandled",
      data: {},
    });
    const r = await post(payload.replace("harness.unhandled", "harness.tampered"), header);
    expect(r.status).toBe(400);
    expect(await h.sql(`SELECT id FROM stripe_events WHERE id = $1`, [id])).toHaveLength(0);
  });

  it("PR-62: a delivery that fails while processing releases its claim for Stripe's retry", async () => {
    const id = `evt_${randomUUID().replace(/-/g, "")}`;
    const { payload, header } = signed({
      id,
      object: "event",
      type: "checkout.session.completed",
      // Not a uuid: the subscription lookup fails inside the handler.
      data: { object: { id: "cs_test", metadata: { companyId: "not-a-uuid", planId: "starter" } } },
    });
    const r = await post(payload, header);
    // Any non-2xx makes Stripe retry; the error handler maps the bad uuid to a 4xx.
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.text).not.toMatch(/Webhook Error/);
    expect(await h.sql(`SELECT id FROM stripe_events WHERE id = $1`, [id])).toHaveLength(0);
  });
});
