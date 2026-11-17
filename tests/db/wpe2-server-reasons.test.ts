/**
 * WP-E2: anomaly alerts and categoriser queue rows come back with the message key + params next
 * to the English text (new rows and rows stored before keys existed), on the real app + Postgres.
 */
import { describe, expect, it } from "vitest";
import { postJournalEntry, useHarness } from "./harness";

const h = useHarness();

describe("WP-E2 server reasons as message keys", () => {
  it("anomaly scan and list return key + params; old English rows map to keys", async () => {
    const t = await h.createTenant({ name: "Reasons" });
    // Saturday 14 Nov 2026, AED 2,000: the weekend rule.
    await postJournalEntry(t, {
      date: "2026-11-14",
      description: "Weekend entry",
      lines: [
        { code: "1020", debit: 2000 },
        { code: "3010", credit: 2000 },
      ],
    });
    const base = `/api/companies/${t.company.id}`;
    const scan = await t.as.post(`${base}/anomalies/scan`);
    expect(scan.status, scan.text).toBe(200);
    const weekend = (scan.body.anomalies as Array<Record<string, any>>).find(
      (a) => a.rule === "weekend_transaction"
    )!;
    expect(weekend.description).toMatch(
      /^Journal entry .* dated Saturday 2026-11-14 for AED 2,000\.00\./
    );
    expect(weekend.message).toEqual({
      key: "anomaly.weekendSaturday",
      params: { number: expect.any(String), date: "2026-11-14", amount: "2,000.00" },
    });

    // An alert written before keys existed: plain English, no message column.
    await h.sql(
      `INSERT INTO anomaly_alerts (company_id, type, severity, title, description, rule, dedupe_key)
       VALUES ($1, 'unusual_amount', 'medium', 'Vat Rate Mismatch',
               'Receipt from Careem: VAT AED 5.00 is not 5% of the net AED 105.00.',
               'vat_rate_mismatch', 'legacy:1')`,
      [t.company.id]
    );
    await h.sql(
      `INSERT INTO anomaly_alerts (company_id, type, severity, title, description, rule, dedupe_key)
       VALUES ($1, 'unusual_amount', 'medium', 'Custom', 'A sentence no template knows', 'x', 'legacy:2')`,
      [t.company.id]
    );
    const list = await t.as.get(`${base}/anomalies`);
    expect(list.status, list.text).toBe(200);
    const rows = list.body.anomalies as Array<Record<string, any>>;
    const legacy = rows.find((a) => a.rule === "vat_rate_mismatch")!;
    expect(legacy.message).toEqual({
      key: "anomaly.vatMismatchReceipt",
      params: { merchant: "Careem", vat: "5.00", net: "105.00" },
    });
    expect(legacy.description).toContain("Careem");
    expect(rows.find((a) => a.rule === "x")!.message).toBeNull();
  });

  it("categoriser queue rows carry ai_reason_message for rule and operator reasons", async () => {
    const t = await h.createTenant({ name: "Queue" });
    const insert = (reason: string | null) =>
      h.sql(
        `INSERT INTO ai_gl_queue (company_id, description, amount, transaction_date, ai_reason, status)
         VALUES ($1, 'DEWA 11/2026', 420.00, now(), $2, 'pending_review')`,
        [t.company.id, reason]
      );
    await insert("Matched rule: DEWA (applied 4 times, 3 accepted)");
    await insert("OpenAI not configured — manual categorization required");
    await insert("The merchant name points to a utility bill.");
    const res = await t.as.get(`/api/companies/${t.company.id}/ai-gl/queue?status=pending_review`);
    expect(res.status, res.text).toBe(200);
    const byReason = new Map<string, any>(
      (res.body as Array<Record<string, any>>).map((r) => [r.ai_reason, r])
    );
    expect(
      byReason.get("Matched rule: DEWA (applied 4 times, 3 accepted)").ai_reason_message
    ).toEqual({
      key: "categorise.matchedRule",
      params: { pattern: "DEWA", applied: "4", accepted: "3" },
    });
    expect(
      byReason.get("OpenAI not configured — manual categorization required").ai_reason_message.key
    ).toBe("categorise.operator.notConfigured");
    expect(
      byReason.get("The merchant name points to a utility bill.").ai_reason_message
    ).toBeNull();
  });
});
