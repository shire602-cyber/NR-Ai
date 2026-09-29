import { describe, it, expect, vi, beforeEach } from "vitest";

const envState = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
const resendSend = vi.hoisted(() => vi.fn());
const smtpSend = vi.hoisted(() => vi.fn());

vi.mock("../../server/config/env", () => ({ getEnv: () => envState.env }));
vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: smtpSend }) },
}));

import {
  emailStatus,
  sendEmail,
  sendInvoiceEmail,
  sendPasswordResetEmail,
  assertEmailSent,
  emailDisabledCapabilities,
} from "../../server/services/email.service";

const invoice: any = { number: "INV-1", customerName: "Acme", subtotal: 100, vatAmount: 5, total: 105, currency: "AED", dueDate: null, date: new Date("2026-01-01"), notes: null };
const company: any = { name: "Co", trnVatNumber: null, businessAddress: null, contactEmail: null };

beforeEach(() => {
  envState.env = {};
  resendSend.mockReset();
  smtpSend.mockReset();
});

describe("emailStatus", () => {
  it("reports not configured with no provider", () => {
    expect(emailStatus()).toEqual({ configured: false, provider: null });
  });
  it("reports resend when RESEND_API_KEY is set (preferred over SMTP)", () => {
    envState.env = { RESEND_API_KEY: "re_x", SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" };
    expect(emailStatus()).toEqual({ configured: true, provider: "resend" });
  });
  it("reports smtp when only SMTP is set", () => {
    envState.env = { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" };
    expect(emailStatus()).toEqual({ configured: true, provider: "smtp" });
  });
});

describe("no provider configured", () => {
  it("every send path returns a typed EMAIL_NOT_CONFIGURED result instead of throwing or pretending", async () => {
    const results = [
      await sendEmail("a@b.co", "s", "b"),
      await sendPasswordResetEmail("a@b.co", "https://x/reset?token=1"),
      await sendInvoiceEmail("a@b.co", invoice, company, Buffer.from("%PDF")),
    ];
    for (const r of results) {
      expect(r.sent).toBe(false);
      expect(r.code).toBe("EMAIL_NOT_CONFIGURED");
    }
    expect(resendSend).not.toHaveBeenCalled();
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it("assertEmailSent turns it into a 503 EMAIL_NOT_CONFIGURED error for user-initiated sends", async () => {
    const r = await sendEmail("a@b.co", "s", "b");
    try {
      assertEmailSent(r);
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("EMAIL_NOT_CONFIGURED");
      expect(err.message).toMatch(/not configured/i);
    }
  });

  it("lists the disabled capabilities for the startup warning", () => {
    const caps = emailDisabledCapabilities();
    expect(caps.join(" ")).toMatch(/password reset/i);
    expect(caps.join(" ")).toMatch(/invoice/i);
  });
});

describe("with a mocked Resend provider", () => {
  beforeEach(() => {
    envState.env = { RESEND_API_KEY: "re_x", RESEND_FROM: "Muhasib <no@x.ae>" };
  });

  it("sends the invoice email with the PDF attached", async () => {
    resendSend.mockResolvedValue({ data: { id: "1" }, error: null });
    const r = await sendInvoiceEmail("cust@x.ae", invoice, company, Buffer.from("%PDF-1.4"));
    expect(r).toMatchObject({ sent: true, provider: "resend" });
    expect(resendSend).toHaveBeenCalledTimes(1);
    const arg = resendSend.mock.calls[0][0];
    expect(arg.to).toBe("cust@x.ae");
    expect(arg.attachments[0].filename).toBe("invoice-INV-1.pdf");
    expect(Buffer.isBuffer(arg.attachments[0].content)).toBe(true);
  });

  it("treats a Resend { error } response as a failed send", async () => {
    resendSend.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const r = await sendEmail("a@b.co", "s", "b");
    expect(r).toMatchObject({ sent: false, provider: "resend", code: "EMAIL_SEND_FAILED" });
    expect(r.error).toContain("domain not verified");
    expect(() => assertEmailSent(r)).toThrowError(/domain not verified|could not be sent/i);
  });

  it("returns EMAIL_SEND_FAILED when the provider throws", async () => {
    resendSend.mockRejectedValue(new Error("network down"));
    const r = await sendPasswordResetEmail("a@b.co", "https://x");
    expect(r).toMatchObject({ sent: false, code: "EMAIL_SEND_FAILED" });
  });
});

describe("with a mocked SMTP provider", () => {
  it("sends via SMTP", async () => {
    envState.env = { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "n@x.ae" };
    smtpSend.mockResolvedValue({});
    const r = await sendEmail("a@b.co", "hello", "body");
    expect(r).toMatchObject({ sent: true, provider: "smtp" });
    expect(smtpSend.mock.calls[0][0]).toMatchObject({ to: "a@b.co", subject: "hello", from: "n@x.ae" });
  });
});
