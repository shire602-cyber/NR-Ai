/**
 * Server "today" defaults use the Dubai business day, not the UTC day. The clock is frozen at
 * 2026-11-27T21:30:00Z, which is 01:30 on 28 Nov in Dubai; every default must say 2026-11-28.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, freezeTime, useHarness } from "./harness";

const h = useHarness();
const INSTANT = "2026-11-27T21:30:00Z";
const DUBAI_DAY = "2026-11-28";

describe("Dubai business day defaults", () => {
  it("firm recurring billing treats an engagement due on the Dubai day as due", async () => {
    const owner = await h.createTenant({ name: "SweepFirm", firmRole: "firm_owner" });
    const client = await owner.as.post("/api/firm/clients", {
      name: "Sweep Client",
      trnVatNumber: "100000000000003",
    });
    expect(client.status, client.text).toBe(201);
    const { resolveFirmContext } = await import("../../server/services/firm/scope");
    const { runRecurringBilling, startTimer } =
      await import("../../server/services/firm/billing.service");
    const ctx = (await resolveFirmContext({ id: owner.user.id }))!;
    await h.sql(
      `INSERT INTO engagements (company_id, firm_id, start_date, monthly_fee, billing_cycle, status, next_billing_date)
       VALUES ($1, $2, '2026-01-01', 500, 'monthly', 'active', $3)`,
      [client.body.id, ctx.firmId, DUBAI_DAY]
    );
    const out = await runRecurringBilling(ctx, [client.body.id], new Date(INSTANT));
    expect(out.created).toBe(1);
    const [eng] = await h.sql<{ d: string }>(
      `SELECT next_billing_date::text AS d FROM engagements WHERE company_id = $1 AND monthly_fee = 500`,
      [client.body.id]
    );
    expect(eng.d).toBe("2026-12-28");

    const thaw = freezeTime(INSTANT);
    try {
      const started = await startTimer(ctx, { companyId: client.body.id });
      expect(String((started as { entryDate: unknown }).entryDate).slice(0, 10)).toBe(DUBAI_DAY);
    } finally {
      thaw();
    }
  });

  it("overdue-invoice and VAT scans compare against the Dubai day", async () => {
    const thaw = freezeTime(INSTANT);
    try {
      const t = await h.createTenant({ name: "SweepNotify" });
      const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: "Sweep Co",
        date: "2026-11-01",
        lines: [{ description: "Line", quantity: 1, unitPrice: 100, vatRate: 5 }],
      });
      expect(inv.status, inv.text).toBe(200);
      const issued = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
      expect(issued.status, issued.text).toBe(200);
      // Due on the UTC day: overdue only once the Dubai day (28 Nov) is the "today".
      await h.sql(`UPDATE invoices SET due_date = '2026-11-27' WHERE id = $1`, [inv.body.id]);
      const { scanOverdueInvoices } =
        await import("../../server/services/notification-engine.service");
      expect(await scanOverdueInvoices(new Date(INSTANT))).toBe(1);
    } finally {
      thaw();
    }
  });

  it("FAF creation date and undated receipt posting date use the Dubai day", async () => {
    const t = await h.createTenant({
      companyColumns: { trn_vat_number: "100000000000003", emirate: "dubai" },
    });
    const { buildFaf } = await import("../../server/services/faf-export.service");
    const faf = await buildFaf({
      companyId: t.company.id,
      from: "2026-11-01",
      to: "2026-11-30",
      now: new Date(INSTANT),
    });
    expect(faf.company.fafCreationDate).toBe(DUBAI_DAY);

    const { receiptEntryDate } = await import("../../server/services/receipt-posting.service");
    const thaw = freezeTime(INSTANT);
    try {
      expect(receiptEntryDate({ date: null }).toISOString().slice(0, 10)).toBe(DUBAI_DAY);
    } finally {
      thaw();
    }
  });

  it("an invoice payment dated by a raw instant posts on the Dubai day", async () => {
    const thaw = freezeTime(INSTANT);
    try {
      const t = await h.createTenant({ name: "SweepPay" });
      const inv = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: "Pay Co",
        date: "2026-11-20",
        lines: [{ description: "Line", quantity: 1, unitPrice: 100, vatRate: 5 }],
      });
      expect(inv.status, inv.text).toBe(200);
      const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
      expect(sent.status, sent.text).toBe(200);
      const bank = await accountByCode(t, "1020");
      const { recordInvoicePayment } =
        await import("../../server/services/invoice-payment.service");
      const paid = await recordInvoicePayment({
        invoiceId: inv.body.id,
        companyId: t.company.id,
        amount: 50,
        date: new Date(INSTANT),
        paymentAccountId: bank.id,
        createdBy: t.user.id,
      });
      const [je] = await h.sql<{ d: string }>(
        `SELECT to_char(date::date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
        [paid.journalEntryId]
      );
      expect(je.d).toBe(DUBAI_DAY);
    } finally {
      thaw();
    }
  });
});
