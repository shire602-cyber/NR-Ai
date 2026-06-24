import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyInboundSignature,
  parseInboundEmail,
} from "../../server/services/email-intake-webhook";

const SECRET = "whsec_test_secret";
const sign = (body: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");

describe("verifyInboundSignature", () => {
  it("accepts a correct HMAC-SHA256 signature", () => {
    const body = '{"from":"a@b.com"}';
    expect(verifyInboundSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts a 'sha256=' prefixed signature", () => {
    const body = "payload";
    expect(verifyInboundSignature(body, `sha256=${sign(body)}`, SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyInboundSignature("payload", sign("different"), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = "payload";
    expect(verifyInboundSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects when signature or secret is missing", () => {
    expect(verifyInboundSignature("x", undefined, SECRET)).toBe(false);
    expect(verifyInboundSignature("x", "abc", undefined)).toBe(false);
  });

  it("rejects malformed (non-hex / wrong length) signatures without throwing", () => {
    expect(verifyInboundSignature("x", "not-hex!!", SECRET)).toBe(false);
    expect(verifyInboundSignature("x", "abcd", SECRET)).toBe(false);
  });
});

describe("parseInboundEmail", () => {
  it("maps a typical inbound payload to a RawInboundMessage", () => {
    const out = parseInboundEmail({
      messageId: "m-1",
      from: "Acme <billing@acme.ae>",
      subject: "January invoices",
      timestamp: "2026-01-31T10:00:00Z",
      dkim: { pass: true },
      attachments: [
        { filename: "inv-1.pdf", contentType: "application/pdf", content: "QkFTRTY0" },
      ],
    });
    expect(out).toHaveLength(1);
    const m = out[0];
    expect(m.providerMessageId).toBe("m-1");
    expect(m.fromHeader).toBe("Acme <billing@acme.ae>");
    expect(m.subject).toBe("January invoices");
    expect(m.dkimPass).toBe(true);
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0].filename).toBe("inv-1.pdf");
    expect(m.attachments[0].mimeType).toBe("application/pdf");
  });

  it("tolerates alternate field names (sender / name / data / unix timestamp)", () => {
    const out = parseInboundEmail({
      id: "x9",
      sender: "ap@beta.ae",
      Subject: "Hi",
      timestamp: 1769850000,
      attachments: [{ name: "r.jpg", type: "image/jpeg", data: "QQ==" }],
    });
    expect(out[0].fromHeader).toBe("ap@beta.ae");
    expect(out[0].subject).toBe("Hi");
    expect(out[0].attachments[0].filename).toBe("r.jpg");
    expect(out[0].receivedAt instanceof Date).toBe(true);
  });

  it("derives dkimPass from a verdict string", () => {
    expect(parseInboundEmail({ from: "a@b.com", dkim: "PASS" })[0].dkimPass).toBe(true);
    expect(parseInboundEmail({ from: "a@b.com", dkim: "fail" })[0].dkimPass).toBe(false);
  });

  it("drops attachments without content", () => {
    const out = parseInboundEmail({
      from: "a@b.com",
      attachments: [{ filename: "empty.pdf" }, { filename: "ok.pdf", content: "QQ==" }],
    });
    expect(out[0].attachments).toHaveLength(1);
    expect(out[0].attachments[0].filename).toBe("ok.pdf");
  });

  it("returns [] for a payload with no sender", () => {
    expect(parseInboundEmail({ subject: "no from" })).toEqual([]);
    expect(parseInboundEmail(null)).toEqual([]);
    expect(parseInboundEmail("nope")).toEqual([]);
  });
});
