import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  contactEmail: "buyer@example.com" as string | null,
  emailConfigured: true,
  sendResult: { sent: true } as any,
  templateUpdates: [] as any[],
  shareTokens: [] as any[],
  notifications: [] as any[],
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ email: state.contactEmail }] }) }),
    update: () => ({
      set: (values: any) => ({
        where: async () => {
          state.templateUpdates.push(values);
        },
      }),
    }),
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getCompany: vi.fn(async () => ({ id: "co", name: "Pearl" })),
    getInvoice: vi.fn(async (id: string) => ({ id, number: "INV-1", status: "sent", companyId: "co", customerName: "Buyer" })),
    getInvoiceLinesByInvoiceId: vi.fn(async () => []),
    setInvoiceShareToken: vi.fn(async (id: string, token: string) => {
      state.shareTokens.push({ id, token });
    }),
    getCompanyUsersByCompanyId: vi.fn(async () => [{ userId: "u1" }, { userId: "u2" }]),
    createNotification: vi.fn(async (n: any) => {
      state.notifications.push(n);
    }),
  },
}));
vi.mock("../../server/services/email.service", () => ({
  emailStatus: () => ({ configured: state.emailConfigured }),
  EMAIL_NOT_CONFIGURED_MESSAGE: "Email is not configured on this server, so nothing was sent.",
  sendInvoiceEmail: vi.fn(async () => state.sendResult),
}));
vi.mock("../../server/services/pdf-invoice.service", () => ({ generateInvoicePDF: vi.fn(async () => Buffer.from("%PDF")) }));

import { sendGeneratedRecurringInvoice } from "../../server/services/recurring-send.service";

const template: any = { id: "t1", companyId: "co", contactId: "c1", customerName: "Buyer", autoSend: true };
const invoice: any = { id: "inv1", number: "INV-1", status: "sent", companyId: "co", customerName: "Buyer" };

describe("recurring auto-send", () => {
  beforeEach(() => {
    state.contactEmail = "buyer@example.com";
    state.emailConfigured = true;
    state.sendResult = { sent: true };
    state.templateUpdates = [];
    state.shareTokens = [];
    state.notifications = [];
  });

  it("emails the invoice with a fresh share link and records `sent`", async () => {
    const r = await sendGeneratedRecurringInvoice(template, invoice);
    expect(r).toEqual({ status: "sent" });
    expect(state.shareTokens).toHaveLength(1);
    expect(state.shareTokens[0].token).toMatch(/^[0-9a-f]{32}$/);
    expect(state.templateUpdates.at(-1)).toMatchObject({ lastSendStatus: "sent", lastSendError: null });
    expect(state.notifications).toHaveLength(0);
  });

  it("without an email provider: not_sent is recorded, every user is notified, nothing is thrown", async () => {
    state.emailConfigured = false;
    const r = await sendGeneratedRecurringInvoice(template, invoice);
    expect(r).toMatchObject({ status: "not_sent", code: "EMAIL_NOT_CONFIGURED" });
    expect(state.templateUpdates.at(-1)).toMatchObject({ lastSendStatus: "not_sent" });
    expect(state.notifications).toHaveLength(2);
    expect(state.notifications[0]).toMatchObject({ type: "recurring_invoice_not_sent", relatedEntityId: "inv1" });
    expect(state.shareTokens).toHaveLength(0);
  });

  it("a customer without an email address is not_sent with CONTACT_EMAIL_REQUIRED", async () => {
    state.contactEmail = null;
    const r = await sendGeneratedRecurringInvoice(template, invoice);
    expect(r).toMatchObject({ status: "not_sent", code: "CONTACT_EMAIL_REQUIRED" });
  });

  it("a provider failure is recorded with its reason and does not resend", async () => {
    state.sendResult = { sent: false, code: "EMAIL_SEND_FAILED", error: "mailbox full" };
    const r = await sendGeneratedRecurringInvoice(template, invoice);
    expect(r).toMatchObject({ status: "not_sent", code: "EMAIL_SEND_FAILED", error: "mailbox full" });
    expect(state.templateUpdates.at(-1)).toMatchObject({ lastSendStatus: "not_sent", lastSendError: "mailbox full" });
  });
});
