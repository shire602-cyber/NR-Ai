import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  extractSenderAddress,
  matchSenderToCompany,
  evaluateSenderGate,
  hashAttachment,
  isDuplicateAttachment,
  classifyDocKind,
  isProcessableAttachment,
  normalizeInboundMessage,
  type EmailSourceRef,
  type RawInboundMessage,
} from "../../server/services/email-intake";
import {
  UnconfiguredEmailIntakeSource,
  isEmailIntakeEnabled,
  isEmailIntakeConfigured,
  getEmailIntakeSource,
} from "../../server/services/email-intake-provider";

const source = (over: Partial<EmailSourceRef> = {}): EmailSourceRef => ({
  id: "s1",
  companyId: "c1",
  senderEmail: "billing@acme.ae",
  status: "active",
  requireDkimPass: true,
  ...over,
});

describe("normalizeEmail / extractSenderAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Billing@Acme.AE ")).toBe("billing@acme.ae");
  });
  it("pulls the address out of a display-name header", () => {
    expect(extractSenderAddress("Acme LLC <Billing@Acme.ae>")).toBe("billing@acme.ae");
  });
  it("handles a bare address", () => {
    expect(extractSenderAddress("billing@acme.ae")).toBe("billing@acme.ae");
  });
  it("returns empty when no address present", () => {
    expect(extractSenderAddress("no address here")).toBe("");
  });
});

describe("matchSenderToCompany", () => {
  const sources = [source(), source({ id: "s2", companyId: "c2", senderEmail: "ap@beta.ae" })];

  it("routes a known active sender to its company", () => {
    const m = matchSenderToCompany("Acme <billing@acme.ae>", sources);
    expect(m?.companyId).toBe("c1");
  });
  it("returns null for an unknown sender (never auto-creates)", () => {
    expect(matchSenderToCompany("stranger@evil.com", sources)).toBeNull();
  });
  it("does not match a paused source", () => {
    const paused = [source({ status: "paused" })];
    expect(matchSenderToCompany("billing@acme.ae", paused)).toBeNull();
  });
});

describe("evaluateSenderGate (allowlist + DKIM)", () => {
  it("ingests an active matched source with DKIM pass", () => {
    expect(evaluateSenderGate({ source: source(), dkimPass: true })).toEqual({
      ingest: true,
      reason: "ok",
    });
  });
  it("blocks an unknown sender", () => {
    expect(evaluateSenderGate({ source: null }).reason).toBe("unknown_sender");
  });
  it("blocks when DKIM is required but not passed", () => {
    expect(evaluateSenderGate({ source: source(), dkimPass: false }).reason).toBe("dkim_failed");
  });
  it("allows when DKIM not required even without a pass", () => {
    expect(
      evaluateSenderGate({ source: source({ requireDkimPass: false }), dkimPass: false }).ingest
    ).toBe(true);
  });
});

describe("hashAttachment / dedup", () => {
  it("is deterministic and content-addressed", () => {
    const a = hashAttachment(Buffer.from("invoice-123"));
    const b = hashAttachment(Buffer.from("invoice-123"));
    const c = hashAttachment(Buffer.from("invoice-999"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("accepts base64 equivalently to a Buffer", () => {
    const buf = Buffer.from("hello");
    expect(hashAttachment(buf.toString("base64"))).toBe(hashAttachment(buf));
  });
  it("flags a repeat hash as duplicate", () => {
    const seen = new Set<string>(["abc"]);
    expect(isDuplicateAttachment("abc", seen)).toBe(true);
    expect(isDuplicateAttachment("xyz", seen)).toBe(false);
  });
});

describe("classifyDocKind / isProcessableAttachment", () => {
  it("classifies by filename keywords", () => {
    expect(classifyDocKind("Bank_Statement_Jan.pdf", "application/pdf")).toBe("statement");
    expect(classifyDocKind("TAX-INVOICE-001.pdf", "application/pdf")).toBe("invoice");
    expect(classifyDocKind("receipt_pos.jpg", "image/jpeg")).toBe("receipt");
  });
  it("treats a bare image as a receipt photo", () => {
    expect(classifyDocKind("IMG_2231.HEIC", "image/heic")).toBe("receipt");
  });
  it("accepts images and pdfs, rejects others", () => {
    expect(isProcessableAttachment({ filename: "a.pdf", mimeType: "application/pdf" })).toBe(true);
    expect(isProcessableAttachment({ filename: "a.png", mimeType: "image/png" })).toBe(true);
    expect(isProcessableAttachment({ filename: "a.docx", mimeType: "application/msword" })).toBe(false);
  });
});

describe("normalizeInboundMessage", () => {
  it("normalises a routed message and hashes attachments", () => {
    const raw: RawInboundMessage = {
      providerMessageId: "m-1",
      fromHeader: "Acme <billing@acme.ae>",
      subject: "Jan invoices",
      receivedAt: new Date("2026-01-31T10:00:00Z"),
      dkimPass: true,
      attachments: [
        { filename: "inv-1.pdf", mimeType: "application/pdf", content: Buffer.from("inv-1") },
      ],
    };
    const out = normalizeInboundMessage(raw, source());
    expect(out.companyId).toBe("c1");
    expect(out.sourceId).toBe("s1");
    expect(out.fromEmail).toBe("billing@acme.ae");
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.attachments[0].docKind).toBe("invoice");
    expect(out.attachments[0].byteSize).toBe(5);
  });
});

describe("provider seam + flags", () => {
  it("unconfigured source yields nothing", async () => {
    const s = new UnconfiguredEmailIntakeSource();
    expect(s.configured).toBe(false);
    expect(await s.fetchNewMessages(new Date())).toEqual([]);
  });
  it("feature flag is off unless EMAIL_INTAKE_ENABLED=true", () => {
    expect(isEmailIntakeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isEmailIntakeEnabled({ EMAIL_INTAKE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("reports unconfigured when no provider set", () => {
    expect(isEmailIntakeConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(getEmailIntakeSource({} as NodeJS.ProcessEnv).configured).toBe(false);
  });
  it("throws on an unknown provider name", () => {
    expect(() =>
      getEmailIntakeSource({ EMAIL_INTAKE_PROVIDER: "nope" } as unknown as NodeJS.ProcessEnv)
    ).toThrow();
  });
});
