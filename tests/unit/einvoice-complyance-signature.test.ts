/**
 * E2: Complyance webhook HMAC verification and event normalisation, against the doc-derived
 * delivery in tests/fixtures/pint-ae/asp/complyance/complyance-webhooks.json.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseWebhookTimestamp,
  signComplyanceBody,
  verifyComplyanceSignature,
} from "../../server/services/einvoice/providers/complyance-signature";
import { normaliseComplyanceEvent } from "../../server/services/einvoice/providers/complyance-events";
import { providerEventKey } from "../../server/services/einvoice/provider-events";

const fx = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "fixtures",
      "pint-ae",
      "asp",
      "complyance",
      "complyance-webhooks.json"
    ),
    "utf8"
  )
) as {
  testSecret: string;
  events: Record<string, Record<string, unknown>>;
  signed: { headers: Record<string, string>; rawBody: string };
};
const NOW = Date.parse("2026-09-18T07:05:00.000Z");

describe("E2 Complyance webhook signature", () => {
  const raw = Buffer.from(fx.signed.rawBody, "utf8");
  const base = {
    raw,
    secret: fx.testSecret,
    timestamp: fx.signed.headers["X-Webhook-Timestamp"],
    maxAgeSeconds: 3600,
    now: NOW,
  };

  it("accepts the documented lowercase-hex HMAC-SHA256 of the raw body", () => {
    expect(
      verifyComplyanceSignature({ ...base, signature: fx.signed.headers["X-Webhook-Signature"] })
    ).toEqual({
      ok: true,
    });
  });

  it("refuses a wrong secret, a tampered body, a missing or malformed header", () => {
    const sig = fx.signed.headers["X-Webhook-Signature"];
    expect(verifyComplyanceSignature({ ...base, secret: "other", signature: sig })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(
      verifyComplyanceSignature({
        ...base,
        raw: Buffer.from(fx.signed.rawBody.replace("1774.5", "1.5")),
        signature: sig,
      })
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyComplyanceSignature({ ...base, signature: undefined })).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(verifyComplyanceSignature({ ...base, signature: sig.toUpperCase() })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a delivery stamped outside the window (cheap replay filter)", () => {
    const sig = fx.signed.headers["X-Webhook-Signature"];
    expect(
      verifyComplyanceSignature({ ...base, signature: sig, now: NOW + 2 * 3600 * 1000 })
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("supports sha512 when the webhook was created with it", () => {
    const sig = signComplyanceBody(raw, fx.testSecret, "sha512");
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyComplyanceSignature({ ...base, signature: sig, algorithm: "sha512" })).toEqual({
      ok: true,
    });
    expect(verifyComplyanceSignature({ ...base, signature: sig })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("reads ISO and unix timestamps", () => {
    expect(parseWebhookTimestamp("2026-09-18T07:04:02.000Z")).toBe(
      Date.parse("2026-09-18T07:04:02.000Z")
    );
    expect(parseWebhookTimestamp("1789801442")).toBe(1789801442000);
    expect(parseWebhookTimestamp("1789801442000")).toBe(1789801442000);
    expect(parseWebhookTimestamp("not a time")).toBeNull();
  });
});

describe("E2 Complyance events -> inbox", () => {
  it("purchase.invoice.stored becomes document.received keyed like the poll", () => {
    const ev = normaliseComplyanceEvent({
      eventType: "purchase.invoice.stored",
      eventId: "purchase:01JEXAMPLE0000000000000142",
      body: fx.events["purchase.invoice.stored"],
    });
    expect(ev).toMatchObject({
      type: "document.received",
      payload: {
        documentId: "01JEXAMPLE0000000000000142",
        documentType: "invoice",
        complyanceCompanyId: "66b9f0a1c2d3e4f567890123",
        validationFailed: false,
      },
    });
    expect(providerEventKey(ev!.type, ev!.payload)).toBe("doc:01JEXAMPLE0000000000000142:received");
  });

  it("validation_failed purchases still arrive (for review), credit notes keep their type", () => {
    const ev = normaliseComplyanceEvent({
      eventType: null,
      eventId: null,
      body: fx.events["purchase.invoice.validation_failed"],
    });
    expect(ev?.payload).toMatchObject({ documentType: "credit-note", validationFailed: true });
  });

  it("invoice.passed asks for a status re-read; onboarding events re-sync the company", () => {
    const passed = normaliseComplyanceEvent({
      eventType: "invoice.passed",
      eventId: "x",
      body: fx.events["invoice.passed"],
    });
    expect(passed).toMatchObject({
      type: "document.delivered",
      payload: { documentId: "01K5EXAMPLE00000000000142" },
    });
    const company = normaliseComplyanceEvent({
      eventType: "company.added.successfully",
      eventId: "evt-1",
      body: fx.events["company.added.successfully"],
    });
    expect(company).toMatchObject({
      type: "legal_entity.synchronized",
      payload: { eventId: "evt-1", legalEntityId: "66b9f0a1c2d3e4f567890123", tin: "1001234567" },
    });
    expect(providerEventKey(company!.type, company!.payload)).toBe("evt-1");
  });

  it("ignores events we do not act on", () => {
    expect(
      normaliseComplyanceEvent({ eventType: "isv.credits.pool.low", eventId: "e", body: {} })
    ).toBeNull();
    expect(
      normaliseComplyanceEvent({ eventType: "purchase.invoice.stored", eventId: "e", body: {} })
    ).toBeNull();
  });
});
