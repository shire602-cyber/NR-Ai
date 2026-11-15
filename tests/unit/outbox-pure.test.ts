/**
 * W4-D pure logic: email provider gate (R16-08), outbox backoff, delivery-event parsing
 * (R16-17), dunning level planning (R16-02/R16-03), notification channel resolution (R16-18),
 * vault magic-byte sniffing (R16-09) and Stripe signature checks (R16-14).
 */
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeProviderName,
  backoffMs,
  parseResendEvent,
  parseSmtpDsn,
  verifySvixSignature,
} from "../../server/outbox";
import {
  hasEmailProvider,
  hasSmtpConfig,
  renderBilingualEmail,
} from "../../server/services/email.service";
import { dunningLevels, pickDunningLevel } from "../../server/services/scheduler.service";
import { resolveChannels } from "../../server/services/notification-engine.service";
import { parseMultipart, sniffVaultType } from "../../server/services/document-vault.service";
import { signStripePayload, verifyStripeSignature } from "../../server/services/payments";
import type { NotificationPreferences } from "../../shared/schema";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("outbox provider gate", () => {
  it("[R16-08] a Resend-only configuration is an email provider (the gate is not SMTP-only)", () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.RESEND_API_KEY = "re_123";
    expect(hasSmtpConfig()).toBe(false);
    expect(hasEmailProvider()).toBe(true);
    expect(activeProviderName()).toBe("resend");
    delete process.env.RESEND_API_KEY;
    expect(hasEmailProvider()).toBe(false);
    expect(activeProviderName()).toBeNull();
  });

  it("[R16-08] exponential backoff is capped", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(5)).toBe(16 * 60_000);
    expect(backoffMs(20)).toBe(6 * 3_600_000);
  });

  it("[R16-19] customer emails render English and right-to-left Arabic", () => {
    const html = renderBilingualEmail(
      {
        brandName: "Co <script>",
        heading: { en: "Hello", ar: "مرحبا" },
        paragraphs: { en: ["Hi"], ar: ["أهلاً"] },
      },
      "bilingual"
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("مرحبا");
    expect(html).not.toContain("<script>");
  });
});

describe("delivery events", () => {
  it("[R16-17] verifies Svix signatures and parses Resend bounces", () => {
    const secret = `whsec_${Buffer.from("k").toString("base64")}`;
    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "e1", bounce: { message: "no" } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto
      .createHmac("sha256", Buffer.from("k"))
      .update(`id1.${ts}.${body}`)
      .digest("base64");
    expect(
      verifySvixSignature({
        secret,
        id: "id1",
        timestamp: String(ts),
        signatureHeader: `v1,${sig}`,
        body,
      })
    ).toBe(true);
    expect(
      verifySvixSignature({
        secret,
        id: "id1",
        timestamp: String(ts - 3600),
        signatureHeader: `v1,${sig}`,
        body,
      })
    ).toBe(false);
    expect(parseResendEvent(JSON.parse(body))).toMatchObject({
      providerMessageId: "e1",
      type: "bounced",
    });
    expect(parseResendEvent({ type: "email.sent" })).toBeNull();
  });

  it("[R16-17] parses SMTP DSNs to the outbox id", () => {
    const id = crypto.randomUUID();
    const evt = parseSmtpDsn(
      `Original-Message-ID: <outbox-${id}@muhasib.ai>\r\n\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 no such user`
    );
    expect(evt).toMatchObject({ outboxId: id, type: "bounced" });
    expect(evt?.detail).toContain("5.1.1");
    expect(parseSmtpDsn("Action: delayed\r\n")).toBeNull();
  });
});

describe("dunning plan", () => {
  const overdue = {
    reminderType: "invoice_overdue",
    daysBeforeDue: null,
    daysAfterDue: 1,
    repeatIntervalDays: 7,
    maxReminders: 3,
  };

  it("[R16-02] levels follow the setting's offset, interval and maximum", () => {
    expect(dunningLevels(overdue, "2026-01-10")).toEqual([
      { level: 1, triggerDate: "2026-01-11" },
      { level: 2, triggerDate: "2026-01-18" },
      { level: 3, triggerDate: "2026-01-25" },
    ]);
    expect(dunningLevels({ ...overdue, repeatIntervalDays: null }, "2026-01-10").length).toBe(1);
    expect(
      dunningLevels(
        { ...overdue, reminderType: "invoice_due_soon", daysBeforeDue: 3, repeatIntervalDays: 2 },
        "2026-01-10"
      ).map((l) => l.triggerDate)
    ).toEqual(["2026-01-07", "2026-01-09"]);
  });

  it("[R16-03] catch-up sends the highest due level once and never goes back", () => {
    const levels = dunningLevels(overdue, "2026-01-10");
    const opts = { dueIso: "2026-01-10", reminderType: "invoice_overdue" };
    expect(pickDunningLevel(levels, "2026-01-10", new Set(), opts)).toEqual({
      send: null,
      skip: [],
    });
    expect(pickDunningLevel(levels, "2026-01-11", new Set(), opts)).toEqual({ send: 1, skip: [] });
    expect(pickDunningLevel(levels, "2026-01-12", new Set([1]), opts)).toEqual({
      send: null,
      skip: [],
    });
    expect(pickDunningLevel(levels, "2026-01-30", new Set(), opts)).toEqual({
      send: 3,
      skip: [1, 2],
    });
    expect(pickDunningLevel(levels, "2026-01-30", new Set([3]), opts).send).toBeNull();
    // Due-soon reminders stop once the invoice is overdue.
    expect(
      pickDunningLevel([{ level: 1, triggerDate: "2026-01-07" }], "2026-01-11", new Set(), {
        dueIso: "2026-01-10",
        reminderType: "invoice_due_soon",
      }).send
    ).toBeNull();
  });
});

describe("notification channels", () => {
  const prefs = (over: Partial<NotificationPreferences>): NotificationPreferences =>
    ({
      id: "p",
      userId: "u",
      pushEnabled: true,
      emailEnabled: true,
      inAppEnabled: true,
      invoiceReminders: true,
      paymentReceived: true,
      vatDeadlines: true,
      weeklyDigest: false,
      typePreferences: "{}",
      digestFrequency: "none",
      lastDigestAt: null,
      updatedAt: new Date(),
      ...over,
    }) as NotificationPreferences;

  it("[R16-18] per-type preferences, category switches, digest and push capability are honoured", () => {
    expect(resolveChannels(undefined, "compliance.deadline_due")).toEqual({
      inApp: true,
      email: true,
      push: false,
    });
    expect(resolveChannels(prefs({ vatDeadlines: false }), "compliance.deadline_due").inApp).toBe(
      false
    );
    expect(
      resolveChannels(
        prefs({
          typePreferences: JSON.stringify({ "invoice.paid": { email: true, inApp: false } }),
        }),
        "invoice.paid",
        { pushLive: true }
      )
    ).toEqual({ inApp: false, email: true, push: true });
    expect(resolveChannels(prefs({ digestFrequency: "daily" }), "task.due").email).toBe(false);
    expect(
      resolveChannels(prefs({ digestFrequency: "daily" }), "task.due", { urgent: true }).email
    ).toBe(true);
    expect(resolveChannels(prefs({}), "task.due", { pushLive: false }).push).toBe(false);
  });
});

describe("vault sniffing and multipart", () => {
  it("[R16-09] types come from the bytes, not the name", () => {
    expect(sniffVaultType(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffVaultType(Buffer.from("a,b\n1,2\n"), "text/csv")).toBe("text/csv");
    expect(sniffVaultType(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBeNull();
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("....word/document.xml"),
    ]);
    expect(sniffVaultType(docx)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const body = Buffer.from(
      '--b\r\nContent-Disposition: form-data; name="name"\r\n\r\nLicence\r\n--b\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 x\r\n--b--\r\n'
    );
    const parsed = parseMultipart(body, "multipart/form-data; boundary=b");
    expect(parsed.fields).toEqual({ name: "Licence" });
    expect(parsed.file?.fileName).toBe("a.pdf");
    expect(parsed.file?.buffer.toString()).toBe("%PDF-1.4 x");
  });
});

describe("stripe webhook signature", () => {
  it("[R16-14] accepts the signed payload only", () => {
    const sig = signStripePayload('{"id":"evt"}', "whsec_x");
    expect(verifyStripeSignature('{"id":"evt"}', sig, "whsec_x")).toBe(true);
    expect(verifyStripeSignature('{"id":"evt2"}', sig, "whsec_x")).toBe(false);
    expect(verifyStripeSignature('{"id":"evt"}', sig, "whsec_y")).toBe(false);
    const old = signStripePayload('{"id":"evt"}', "whsec_x", Math.floor(Date.now() / 1000) - 3600);
    expect(verifyStripeSignature('{"id":"evt"}', old, "whsec_x")).toBe(false);
  });
});
