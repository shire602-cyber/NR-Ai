/**
 * Maps committed business operations (audit records, written AFTER the
 * database transaction commits) onto the small, documented set of outbound
 * webhook events. Also proves the audit hook is fire-and-forget.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted = vi.hoisted(() => [] as Array<{ companyId: string; event: string; payload: any }>);

vi.mock("../../server/services/webhook.service", () => ({
  emitWebhookEvent: vi.fn((companyId: string, event: string, payload: any) => {
    emitted.push({ companyId, event, payload });
  }),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    createAuditLog: vi.fn(async () => ({})),
    getInvoice: vi.fn(async (id: string) => ({
      id,
      number: "INV-7",
      total: "105.00",
      currency: "AED",
      status: "paid",
      customerName: "Secret Customer LLC",
    })),
  },
}));

import { SUPPORTED_WEBHOOK_EVENTS } from "../../shared/webhook-events";
import { webhookEventsForAudit } from "../../server/services/webhook-events";
import { recordAudit } from "../../server/services/audit.service";

beforeEach(() => {
  emitted.length = 0;
});

describe("webhookEventsForAudit", () => {
  it("invoice.create -> invoice.created with ids and amounts only", async () => {
    const out = await webhookEventsForAudit({
      action: "invoice.create",
      companyId: "co",
      entityId: "inv-1",
      after: { number: "INV-1", total: "50", currency: "AED", status: "draft", customerName: "X" },
    });
    expect(out).toEqual([
      {
        event: "invoice.created",
        payload: { invoiceId: "inv-1", number: "INV-1", total: "50", currency: "AED", status: "draft" },
      },
    ]);
  });

  it("status_change maps sent/paid/void/cancelled and ignores the rest", async () => {
    const status = async (to: string) =>
      (
        await webhookEventsForAudit({
          action: "invoice.status_change",
          companyId: "co",
          entityId: "inv-1",
          before: { status: "draft" },
          after: { status: to },
        })
      ).map((e) => e.event);
    expect(await status("sent")).toEqual(["invoice.issued"]);
    expect(await status("paid")).toEqual(["invoice.paid"]);
    expect(await status("void")).toEqual(["invoice.voided"]);
    expect(await status("cancelled")).toEqual(["invoice.voided"]);
    expect(await status("draft")).toEqual([]);
  });

  it("status_change payload is enriched with number and amounts but not customer data", async () => {
    const [evt] = await webhookEventsForAudit({
      action: "invoice.status_change",
      companyId: "co",
      entityId: "inv-1",
      before: { status: "sent" },
      after: { status: "paid" },
    });
    expect(evt.payload).toMatchObject({
      invoiceId: "inv-1",
      number: "INV-7",
      total: "105.00",
      currency: "AED",
      status: "paid",
      previousStatus: "sent",
    });
    expect(JSON.stringify(evt.payload)).not.toContain("Secret Customer");
  });

  it("invoice.payment -> payment.received, plus invoice.paid when it settles the invoice", async () => {
    const out = await webhookEventsForAudit({
      action: "invoice.payment",
      companyId: "co",
      entityId: "inv-1",
      before: { status: "sent" },
      after: { status: "paid", totalPaid: 105 },
      extra: { paymentId: "pay-1", amount: 105, method: "bank" },
    });
    expect(out.map((e) => e.event)).toEqual(["payment.received", "invoice.paid"]);
    expect(out[0].payload).toMatchObject({ paymentId: "pay-1", invoiceId: "inv-1", amount: 105 });
  });

  it("a partial payment only emits payment.received", async () => {
    const out = await webhookEventsForAudit({
      action: "invoice.payment",
      companyId: "co",
      entityId: "inv-1",
      before: { status: "sent" },
      after: { status: "partial" },
      extra: { paymentId: "pay-1", amount: 10 },
    });
    expect(out.map((e) => e.event)).toEqual(["payment.received"]);
  });

  it("invoice.credit_note -> credit_note.created", async () => {
    const [evt] = await webhookEventsForAudit({
      action: "invoice.credit_note",
      companyId: "co",
      entityId: "cn-1",
      before: { originalInvoiceId: "inv-1" },
      after: { creditNoteNumber: "CN-1", total: "20", currency: "AED" },
    });
    expect(evt).toEqual({
      event: "credit_note.created",
      payload: {
        creditNoteId: "cn-1",
        originalInvoiceId: "inv-1",
        number: "CN-1",
        total: "20",
        currency: "AED",
      },
    });
  });

  it("bill.approve -> bill.approved", async () => {
    const [evt] = await webhookEventsForAudit({
      action: "bill.approve",
      companyId: "co",
      entityId: "bill-1",
      after: { status: "approved", number: "B-1", total: "300", currency: "AED" },
    });
    expect(evt).toEqual({
      event: "bill.approved",
      payload: { billId: "bill-1", number: "B-1", total: "300", currency: "AED" },
    });
  });

  it("emits nothing for unrelated actions or when companyId is missing", async () => {
    expect(await webhookEventsForAudit({ action: "invoice.update", companyId: "co" })).toEqual([]);
    expect(await webhookEventsForAudit({ action: "invoice.create", companyId: null })).toEqual([]);
  });

  it("only ever produces supported events", async () => {
    const actions = ["invoice.create", "invoice.payment", "invoice.credit_note", "bill.approve"];
    for (const action of actions) {
      const out = await webhookEventsForAudit({
        action,
        companyId: "co",
        entityId: "x",
        before: { status: "sent" },
        after: { status: "paid" },
        extra: { paymentId: "p", amount: 1 },
      });
      for (const e of out) expect(SUPPORTED_WEBHOOK_EVENTS).toContain(e.event as any);
    }
  });
});

describe("recordAudit webhook hook", () => {
  it("emits the webhook after the audit row is persisted", async () => {
    await recordAudit({
      userId: "u",
      companyId: "co",
      action: "bill.approve",
      entityType: "vendor_bill",
      entityId: "bill-1",
      after: { status: "approved", number: "B-1", total: "300", currency: "AED" },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(emitted.map((e) => e.event)).toEqual(["bill.approved"]);
    expect(emitted[0].companyId).toBe("co");
  });

  it("never fails the caller when webhook mapping throws", async () => {
    const { storage } = await import("../../server/storage");
    (storage.getInvoice as any).mockRejectedValueOnce(new Error("db down"));
    await expect(
      recordAudit({
        userId: "u",
        companyId: "co",
        action: "invoice.status_change",
        entityType: "invoice",
        entityId: "inv-1",
        before: { status: "draft" },
        after: { status: "paid" },
      })
    ).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 10));
    // Falls back to an id-only payload rather than dropping the event.
    expect(emitted.map((e) => e.event)).toEqual(["invoice.paid"]);
  });
});

import { parseEventSubscription } from "../../shared/webhook-events";

describe("parseEventSubscription", () => {
  it("accepts supported events and '*', normalising whitespace and duplicates", () => {
    expect(parseEventSubscription(" invoice.paid , invoice.paid,bill.approved ")).toEqual({
      ok: true,
      events: "invoice.paid,bill.approved",
    });
    expect(parseEventSubscription("*")).toEqual({ ok: true, events: "*" });
  });

  it("rejects events that never fire", () => {
    const r = parseEventSubscription("invoice.paid,vat_return.filed,quote.accepted");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/vat_return\.filed, quote\.accepted/);
  });

  it("rejects empty or non-string input", () => {
    for (const bad of ["", "  ", ",,", undefined, 5, null]) {
      expect(parseEventSubscription(bad).ok).toBe(false);
    }
  });
});
