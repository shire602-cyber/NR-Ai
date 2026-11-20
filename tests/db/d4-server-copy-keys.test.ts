/**
 * D4: server-generated user copy is returned as stable message keys + params next to the
 * English text, on the real app + Postgres. Covers notifications (stored rows incl. legacy
 * English rows) and the cash-forecast insights/assumptions/items.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("D4 server copy keys", () => {
  it("GET /api/notifications returns keys + params for stored rows, old and new", async () => {
    const t = await h.createTenant({ name: "CopyKeys" });
    const { emitDomainEvent, drainDomainEvents } =
      await import("../../server/platform/domain-events");
    emitDomainEvent(
      "compliance.deadline_due" as never,
      {
        companyId: t.company.id,
        entityId: crypto.randomUUID(),
        obligation: "VAT return Q3",
        dueDate: "2026-10-28",
      } as never
    );
    await drainDomainEvents();
    // A row written before keys existed (plain English, as the old emitters stored it).
    await h.sql(
      `INSERT INTO notifications (user_id, company_id, type, title, message, priority)
       VALUES ($1, $2, 'invoice_status_change', 'Invoice void', 'Invoice INV-5 for Acme LLC marked as void', 'normal')`,
      [t.user.id, t.company.id]
    );
    await h.sql(
      `INSERT INTO notifications (user_id, company_id, type, title, message, priority)
       VALUES ($1, $2, 'system', 'A custom admin notice', 'Free text that no template knows', 'low')`,
      [t.user.id, t.company.id]
    );

    const res = await t.as.get("/api/notifications");
    expect(res.status, res.text).toBe(200);
    const rows = res.body.notifications as Array<{
      title: string;
      message: string;
      copy: {
        titleKey: string | null;
        titleParams: Record<string, string>;
        messageKey: string | null;
        messageParams: Record<string, string>;
      };
    }>;
    const deadline = rows.find((r) => r.title.startsWith("Deadline due"))!;
    expect(deadline.message).toBe("VAT return Q3 is due on 2026-10-28.");
    expect(deadline.copy).toEqual({
      titleKey: "notification.deadlineDue.title",
      titleParams: { dueDate: "2026-10-28" },
      messageKey: "notification.deadlineDue.message",
      messageParams: { obligation: "VAT return Q3", dueDate: "2026-10-28" },
    });
    const legacy = rows.find((r) => r.title === "Invoice void")!;
    expect(legacy.copy.messageKey).toBe("notification.invoiceVoid.message");
    expect(legacy.copy.messageParams).toEqual({ number: "INV-5", customer: "Acme LLC" });
    const custom = rows.find((r) => r.title === "A custom admin notice")!;
    expect(custom.copy.titleKey).toBeNull();
    expect(custom.message).toBe("Free text that no template knows");
  });

  it("the cash forecast returns insight/assumption keys beside the English sentences", async () => {
    const t = await h.createTenant({ name: "FcKeys" });
    const empty = await t.as.get(`/api/companies/${t.company.id}/cashflow/forecast`);
    expect(empty.status, empty.text).toBe(200);
    expect(empty.body.insufficientData).toBe(true);
    expect(empty.body.insights.length).toBe(empty.body.insightMessages.length);
    expect(empty.body.insightMessages[0].key).toBe("cashForecast.insufficientData");
    expect(empty.body.insights[0]).toMatch(/^Insufficient data/);
    expect(empty.body.assumptions.length).toBe(empty.body.assumptionMessages.length);
    expect(empty.body.assumptionMessages.map((m: { key: string }) => m.key)).toEqual([
      "cashForecast.assumeOpeningBalance",
      "cashForecast.assumeInvoices",
      "cashForecast.assumeBills",
      "cashForecast.assumeNoExtrapolation",
    ]);
    expect(empty.body.assumptionMessages[1].params.days).toBe("7");

    const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
      customerName: "Acme LLC",
      date: "2026-10-01",
      dueDate: "2026-10-15",
      lines: [
        {
          description: "Services",
          quantity: 1,
          unitPrice: 2000,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    const fc = await t.as.get(`/api/companies/${t.company.id}/cashflow/forecast`);
    expect(fc.status, fc.text).toBe(200);
    const keys = fc.body.insightMessages.map((m: { key: string }) => m.key);
    expect(keys).toContain("cashForecast.overdueReceivables");
    const idx = keys.indexOf("cashForecast.overdueReceivables");
    expect(fc.body.insights[idx]).toContain("is overdue across 1 invoice(s)");
    expect(fc.body.insightMessages[idx].params.count).toBe("1");
  });
});
