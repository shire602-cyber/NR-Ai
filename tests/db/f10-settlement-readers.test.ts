/**
 * F10: the portal balance, reminder eligibility (dunning) and compliance-calendar deadline
 * queries, plus the bills list open balance, all read the one settlement fragment
 * (server/reporting/settlement.ts). An invoice settled by a credit-note invoice must not be
 * reminded/dunned even if its status still reads "sent"; a part-paid invoice shows its remaining
 * balance in the portal and is dunned; the bills list exposes the server open balance.
 */
import { describe, expect, it } from "vitest";
import { accountByCode, useHarness } from "./harness";
import { dubaiIso } from "../helpers/dates";

const h = useHarness();
const DAY = 86_400_000;
const iso = (d: Date) => dubaiIso(d);

describe("F10 settlement fragment readers", () => {
  it("portal balance, dunning eligibility and bills list follow the server open balance", async () => {
    const t = await h.createTenant();
    const co = t.company.id;
    const c = await t.as.post(`/api/companies/${co}/customer-contacts`, {
      name: "Settle Co",
      email: "ap@settle.example",
    });
    expect(c.status, c.text).toBeLessThan(300);
    const contactId = c.body.id as string;

    async function issue(unitPrice: number) {
      const r = await t.as.post(`/api/companies/${co}/invoices`, {
        contactId,
        date: iso(new Date(Date.now() - 40 * DAY)),
        lines: [{ description: "Retainer", quantity: 1, unitPrice, vatRate: 5 }],
      });
      expect(r.status, r.text).toBe(200);
      const s = await t.as.patch(`/api/invoices/${r.body.id}/status`, { status: "sent" });
      expect(s.status, s.text).toBe(200);
      await h.sql(`UPDATE invoices SET due_date = now() - interval '5 days' WHERE id = $1`, [
        r.body.id,
      ]);
      return r.body.id as string;
    }

    // Part-paid: 1,050 total, 400 paid -> 650 open.
    const partId = await issue(1000);
    const bank = await accountByCode(t, "1020");
    const pay = await t.as.post(`/api/companies/${co}/invoices/${partId}/payments`, {
      date: iso(new Date(Date.now() - 10 * DAY)),
      method: "bank",
      paymentAccountId: bank.id,
      amount: 400,
    });
    expect(pay.status, pay.text).toBe(201);

    // Settled by a credit-note invoice for the full amount; status forced back to "sent" so only
    // the settlement fragment (not the status) can keep it out of reminders.
    const cnId = await issue(1000);
    const cn = await t.as.post(`/api/companies/${co}/invoices/${cnId}/credit-note`, {});
    expect(cn.status, cn.text).toBe(201);
    await h.sql(`UPDATE invoices SET status = 'sent' WHERE id = $1`, [cnId]);

    // Unsettled control invoice: 1,050 open.
    const fullId = await issue(1000);

    // ── Portal balance (contactInvoices) ─────────────────────────────────────
    const { contactInvoices } = await import("../../server/routes/portal.public.routes");
    const rows = await contactInvoices(co, contactId);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(partId).amountDue).toBe(650);
    // Part-paid and past its due date: overdue (STEP5; a payment never hides an overdue balance).
    expect(by(partId).paymentStatus).toBe("overdue");
    expect(by(cnId).amountDue).toBe(0);
    expect(by(cnId).paymentStatus).toBe("paid");
    expect(by(fullId).amountDue).toBe(1050);

    // ── Dunning eligibility ─────────────────────────────────────────────────
    const st = await t.as.post(`/api/companies/${co}/reminder-settings`, {
      reminderType: "invoice_overdue",
      isEnabled: true,
      daysAfterDue: 1,
      sendEmail: true,
      sendInApp: false,
      sendSms: false,
    });
    expect(st.status, st.text).toBe(200);
    const { runDunningScan } = await import("../../server/services/scheduler.service");
    await runDunningScan(new Date());
    const mailed = async (id: string) =>
      (
        await h.sql(
          `SELECT id FROM email_outbox WHERE related_entity_id = $1 AND category = 'reminder'`,
          [id]
        )
      ).length;
    expect(await mailed(partId)).toBe(1);
    expect(await mailed(fullId)).toBe(1);
    expect(await mailed(cnId)).toBe(0);

    // ── Compliance calendar deadlines read the same remaining balance ───────
    const dl = await t.as.get(`/api/deadlines?companyId=${co}`);
    expect(dl.status, dl.text).toBe(200);
    const deadlineFor = (id: string) =>
      dl.body.find((d: { relatedEntityId?: string }) => d.relatedEntityId === id);
    expect(deadlineFor(cnId)).toBeUndefined();
    expect(deadlineFor(partId).amountDue).toBe(650);

    // ── Bills list exposes the server open balance ───────────────────────────
    const b = await t.as.post(`/api/companies/${co}/bills`, {
      vendor_name: "Acme Hosting LLC",
      vendor_trn: "100000000000003",
      bill_number: "F10-B1",
      bill_date: iso(new Date(Date.now() - 20 * DAY)),
      due_date: iso(new Date(Date.now() - 5 * DAY)),
      line_items: [{ description: "Hosting", quantity: 1, unit_price: 1000, vat_rate: 5 }],
    });
    expect(b.status, b.text).toBe(200);
    const ap = await t.as.post(`/api/bills/${b.body.id}/approve`, {});
    expect(ap.status, ap.text).toBe(200);
    const bp = await t.as.post(`/api/bills/${b.body.id}/payments`, {
      payment_date: iso(new Date(Date.now() - 10 * DAY)),
      amount: 300,
    });
    expect(bp.status, bp.text).toBeLessThan(300);
    const list = await t.as.get(`/api/companies/${co}/bills`);
    const listed = list.body.find((x: { id: string }) => x.id === b.body.id);
    expect(Number(listed.open_balance)).toBe(750);
    expect(Number(listed.open_balance_base)).toBe(750);
  });
});
