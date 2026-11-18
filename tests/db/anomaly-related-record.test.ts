/**
 * Step 1 / F8: GET /api/companies/:id/anomalies names the record each alert is about (invoice
 * number, journal entry number, account code and name, receipt merchant), tenant-scoped: another
 * company's record id resolves to no label, so the page never links across tenants.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const today = () => new Date().toISOString().slice(0, 10);

describe("anomaly alerts name their record", () => {
  it("returns relatedLabel for the company's own records and none for another tenant's", async () => {
    const a = await h.createTenant();
    const b = await h.createSecondTenant();
    const invoice = await a.as.post(`/api/companies/${a.company.id}/invoices`, {
      customerName: "عميل التجربة",
      date: today(),
      lines: [{ description: "خدمة", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(invoice.status).toBeLessThan(300);
    const otherInvoice = await b.as.post(`/api/companies/${b.company.id}/invoices`, {
      customerName: "عميل آخر",
      date: today(),
      lines: [{ description: "خدمة", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    const [account] = await h.sql<{ id: string; code: string }>(
      `SELECT id, code FROM accounts WHERE company_id = $1 AND name_ar IS NOT NULL ORDER BY code LIMIT 1`,
      [a.company.id]
    );
    const insert = (type: string, id: string) =>
      h.sql(
        `INSERT INTO anomaly_alerts (company_id, type, severity, title, description, related_entity_type, related_entity_id, rule, dedupe_key)
         VALUES ($1, 'unusual_amount', 'medium', 'Alert', 'Invoice has a round amount', $2, $3, 'round_number', $4)`,
        [a.company.id, type, id, `${type}:${id}`]
      );
    await insert("invoice", invoice.body.id);
    await insert("invoice", otherInvoice.body.id); // another company's invoice id
    await insert("account", account.id);

    const res = await a.as.get(`/api/companies/${a.company.id}/anomalies`);
    expect(res.status).toBe(200);
    const byId = new Map<string, any>(res.body.anomalies.map((x: any) => [x.relatedId, x]));
    expect(byId.get(invoice.body.id).relatedLabel).toBe(invoice.body.number);
    expect(byId.get(otherInvoice.body.id).relatedLabel).toBeNull();
    const acct = byId.get(account.id);
    expect(acct.relatedLabel).toContain(account.code);
    expect(acct.relatedLabelAr).toContain(account.code);
  });
});
