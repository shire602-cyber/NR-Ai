/**
 * E1: A-Cube webhook HTTP Message Signatures (RFC 9421, Ed25519, keyid "acube") — valid,
 * tampered, wrong key, replayed and stale requests — plus the two-track status model and the
 * event vocabulary shared by webhooks and polling.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSignatureBase,
  getAcubePublicKey,
  parseSignatureHeaders,
  publicKeyFrom,
  resetAcubeKeyCache,
  signAcubeRequest,
  verifyAcubeSignature,
} from "../../server/services/einvoice/acube-signature";
import {
  acubeStatusErrorCode,
  deliveryFromLegacy,
  legacyFromProviderTracks,
  legacyFromTracks,
  mapAcubeDeliveryStatus,
  reportByDate,
  reportingRequired,
  reportWindowDays,
} from "../../server/services/einvoice/tracks";
import {
  canonicalEventType,
  providerEventKey,
} from "../../server/services/einvoice/provider-events";

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "fixtures", "pint-ae", "asp", "acube", "acube-webhooks.json"),
    "utf8"
  )
) as {
  payloads: Record<string, Record<string, unknown>>;
  signed: {
    method: string;
    targetUri: string;
    created: number;
    publicKeyPem: string;
    headers: Record<string, string>;
    body: string;
  };
};
const s = fixture.signed;
const at = (offsetS: number) => new Date((s.created + offsetS) * 1000);
const request = (headers = s.headers, targetUri = s.targetUri) => ({
  method: s.method,
  targetUri,
  headers,
});

describe("E1 A-Cube webhook signature", () => {
  const key = publicKeyFrom(s.publicKeyPem);

  it("accepts the legacy signed document.received fixture", () => {
    const v = verifyAcubeSignature({
      raw: Buffer.from(s.body),
      request: request(),
      publicKey: key,
      now: at(60),
    });
    expect(v).toMatchObject({ ok: true, created: s.created });
  });

  it("parses the documented signature-input shape", () => {
    const p = parseSignatureHeaders(s.headers["signature-input"], s.headers.signature)!;
    expect(p.components).toEqual([
      "@method",
      "@authority",
      "@target-uri",
      "date",
      "content-digest",
    ]);
    expect(p).toMatchObject({ label: "pyhms", keyid: "acube", alg: "ed25519" });
    const base = buildSignatureBase(p.components, p.paramsRaw, request())!;
    expect(base.split("\n")[0]).toBe('"@method": POST');
    expect(base.split("\n")[1]).toBe('"@authority": app.muhasib.example');
    expect(base.endsWith(`"@signature-params": ${p.paramsRaw}`)).toBe(true);
  });

  it("refuses a tampered body (content-digest) and a tampered digest (signature)", () => {
    const tampered = s.body.replace("AE-INV-005", "AE-INV-006");
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(tampered),
        request: request(),
        publicKey: key,
        now: at(60),
      })
    ).toMatchObject({ ok: false, reason: "bad_content_digest" });
    const digest = `sha-256=:${crypto.createHash("sha256").update(tampered).digest("base64")}:`;
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(tampered),
        request: request({ ...s.headers, "content-digest": digest }),
        publicKey: key,
        now: at(60),
      })
    ).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("refuses another target URI and another key", () => {
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request(s.headers, "https://evil.example/api/webhooks/einvoice/acube/sandbox"),
        publicKey: key,
        now: at(60),
      })
    ).toMatchObject({ ok: false, reason: "bad_signature" });
    const other = crypto.generateKeyPairSync("ed25519").publicKey;
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request(),
        publicKey: other,
        now: at(60),
      })
    ).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("refuses a replay outside the retry window and a request from the future", () => {
    // A-Cube retries for ~10 h; the default window is 12 h.
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request(),
        publicKey: key,
        now: at(11 * 3600),
      }).ok
    ).toBe(true);
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request(),
        publicKey: key,
        now: at(13 * 3600),
      })
    ).toMatchObject({ ok: false, reason: "stale" });
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request(),
        publicKey: key,
        now: at(-3600),
      })
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  it("refuses missing headers and a signature that does not cover the body", () => {
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request({}),
        publicKey: key,
        now: at(1),
      })
    ).toMatchObject({ ok: false, reason: "missing_signature" });
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const created = Math.floor(Date.now() / 1000);
    const paramsRaw = `("@method" "@target-uri");created=${created};keyid="acube";alg="ed25519"`;
    const base = buildSignatureBase(["@method", "@target-uri"], paramsRaw, request({}))!;
    const sig = crypto.sign(null, Buffer.from(base), privateKey).toString("base64");
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(s.body),
        request: request({ "signature-input": `sig1=${paramsRaw}`, signature: `sig1=:${sig}:` }),
        publicKey,
      })
    ).toMatchObject({ ok: false, reason: "missing_component" });
  });

  it("signs and verifies round trip, with a raw base64 key and a fetched, cached key", async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const body = JSON.stringify(fixture.payloads["legal_entity.synchronized.LINK"]);
    const headers = signAcubeRequest({ privateKey, method: "POST", targetUri: s.targetUri, body });
    const raw = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(12);
    expect(
      verifyAcubeSignature({
        raw: Buffer.from(body),
        request: request(headers),
        publicKey: publicKeyFrom(raw.toString("base64")),
      }).ok
    ).toBe(true);

    resetAcubeKeyCache();
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify({ public_key: publicKey.export({ type: "spki", format: "pem" }) })
      );
    }) as unknown as typeof fetch;
    await getAcubePublicKey("sandbox", {}, { fetch: fetchImpl });
    await getAcubePublicKey("sandbox", {}, { fetch: fetchImpl });
    expect(urls).toEqual([
      "https://common.api.acubeapi.com/signature-public-key?environment=sandbox",
    ]);
    resetAcubeKeyCache();
  });
});

describe("E1 two-track status model", () => {
  it("maps both A-Cube status vocabularies onto the delivery track; unknown is never success", () => {
    expect(
      ["valid", "new", "sending_queued", "sending_started", "delivered", "processed"].map(
        mapAcubeDeliveryStatus
      )
    ).toEqual(["queued", "queued", "queued", "sending", "delivered", "sending"]);
    expect(
      [
        "sending_error",
        "sending_failed",
        "delivery_error",
        "delivery_failed",
        "action_required",
      ].map(mapAcubeDeliveryStatus)
    ).toEqual(["delivery_failed", "sending", "delivery_failed", "sending", "delivery_failed"]);
    expect(mapAcubeDeliveryStatus("rejected")).toBe("rejected");
    expect(mapAcubeDeliveryStatus("something_new")).toBe("delivery_failed");
    expect(acubeStatusErrorCode("delivery_error")).toBe("ACUBE_DELIVERY_FAILED");
    expect(acubeStatusErrorCode("delivered")).toBeNull();
  });

  it("preserves A-Cube receipt as in flight until positive MLS", () => {
    expect(legacyFromProviderTracks("acube", "processed", "sending", "pending")).toBe("submitted");
    expect(legacyFromProviderTracks("acube", "delivered", "delivered", "not_required")).toBe(
      "submitted"
    );
    expect(legacyFromProviderTracks("acube", "accepted", "delivered", "not_required")).toBe(
      "accepted"
    );
    expect(
      legacyFromProviderTracks("complyance", "delivery_success", "delivered", "not_required")
    ).toBe("submitted");
  });

  it("derives the legacy status: delivered stays 'accepted' until the FTA report is in", () => {
    expect(legacyFromTracks("delivered", "pending")).toBe("accepted");
    expect(legacyFromTracks("delivered", "report_failed")).toBe("accepted");
    expect(legacyFromTracks("delivered", "reported")).toBe("cleared");
    expect(legacyFromTracks("delivered", "not_required")).toBe("accepted");
    expect(legacyFromTracks("queued", "pending")).toBe("submitted");
    expect(legacyFromTracks("delivery_failed", "pending")).toBe("failed");
    expect(deliveryFromLegacy("generated")).toBe("validated");
    expect(deliveryFromLegacy(null)).toBe("draft");
  });

  it("requires FTA reporting for B2B/B2G only and computes the report-by date", () => {
    expect(reportingRequired({ customerTrn: "100765432100003" })).toBe(true);
    expect(reportingRequired({ customerTrn: null })).toBe(false); // B2C
    expect(reportingRequired({ customerTrn: "100765432100003", companyScope: "none" })).toBe(false);
    // The mandate not applying yet means nothing is required and no deadline exists.
    expect(reportingRequired({ customerTrn: "100765432100003", mandateApplies: false })).toBe(
      false
    );
    expect(reportingRequired({ customerTrn: "100765432100003", mandateApplies: true })).toBe(true);
    expect(reportWindowDays({})).toBe(14);
    expect(reportWindowDays({ EINVOICE_REPORT_WINDOW_DAYS: "7" })).toBe(7);
    expect(reportByDate("2026-11-25T10:00:00Z", 14)).toBe("2026-12-09");
  });

  it("normalises webhook and API event names and builds stable dedupe keys", () => {
    const p = fixture.payloads;
    expect(canonicalEventType(p["invoice.inbound"])).toBe("document.received");
    expect(canonicalEventType(p["invoice.outbound"])).toBe("document.delivered");
    expect(canonicalEventType(p["credit_note.inbound"])).toBe("document.received");
    expect(canonicalEventType(p["credit_note.outbound"])).toBe("document.delivered");
    expect(canonicalEventType(p["legal_entity.synchronized.LINK"])).toBe(
      "legal_entity.synchronized"
    );
    expect(canonicalEventType({}, "invoice.inbound")).toBe("document.received");
    expect(canonicalEventType({}, "credit_note.outbound")).toBe("document.delivered");
    expect(canonicalEventType({ hello: 1 })).toBeNull();
    const inbound = p["invoice.inbound"];
    expect(
      providerEventKey("document.received", { ...inbound, documentId: inbound.invoiceUuid })
    ).toBe("doc:01a0c453-5398-728c-8b10-84dd471cd797:received");
    expect(providerEventKey("document.delivered", p["invoice.outbound"])).toBe(
      "01a0ab23-2611-7c3e-9d41-5b7e8f0a1c22"
    );
    expect(providerEventKey("document.received", JSON.parse(s.body))).toBe(
      "doc:01a0c453-5398-728c-8b10-84dd471cd797:received"
    );
    expect(providerEventKey("legal_entity.synchronized", p["legal_entity.synchronized.LINK"])).toBe(
      "019e91b7-f799-7df7-a469-4824b2656b0e"
    );
  });
});
