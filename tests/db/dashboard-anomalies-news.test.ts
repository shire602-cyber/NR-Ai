/**
 * W3-E anomalies and news.
 * Issue ids: R13-13, R13-14, R13-15, R13-30, R13-31, R13-35.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freezeTime, postJournalEntry, useHarness, type Tenant } from "./harness";
import { NOW, insertBill, insertInvoice } from "./w3e-seed";

const h = useHarness();
let t: Tenant;
let restore: () => void;
const base = () => `/api/companies/${t.company.id}`;
const alertCount = async () =>
  Number(
    (
      await h.sql("SELECT COUNT(*)::int AS n FROM anomaly_alerts WHERE company_id = $1", [
        t.company.id,
      ])
    )[0].n
  );

beforeAll(async () => {
  restore = freezeTime(NOW);
  t = await h.createTenant();
  // Saturday 14 Nov 2026, AED 2,000: weekend rule.
  await postJournalEntry(t, {
    date: "2026-11-14",
    description: "Weekend entry",
    lines: [
      { code: "1020", debit: 2000 },
      { code: "3010", credit: 2000 },
    ],
  });
  // VAT 100 on a net of 1,000 is 10%, not 5%; malformed customer TRN.
  const inv = await insertInvoice(h.sql, t, {
    number: "INV-V",
    customer: "Wrong VAT LLC",
    date: "2026-11-10",
    due: "2026-12-10",
    subtotal: 1000,
    vat: 100,
  });
  await h.sql(`UPDATE invoices SET customer_trn = 'ABC123' WHERE id = $1`, [inv]);
  // Same supplier invoice number twice; VAT without a supplier TRN.
  await insertBill(h.sql, t, {
    vendor: "Acme Supplies",
    number: "S-77",
    date: "2026-11-01",
    due: "2026-12-01",
    subtotal: 400,
    vat: 20,
    vendorTrn: "100123456700003",
  });
  await insertBill(h.sql, t, {
    vendor: "Acme Supplies",
    number: "S-77",
    date: "2026-11-02",
    due: "2026-12-02",
    subtotal: 400,
    vat: 20,
    vendorTrn: "100123456700003",
  });
  await insertBill(h.sql, t, {
    vendor: "No Trn Traders",
    number: "N-1",
    date: "2026-11-03",
    due: "2026-12-03",
    subtotal: 200,
    vat: 10,
    vendorTrn: null,
  });
  // Cross-period baseline: rent about 1,000 a month for five months, then 5,000 this month.
  for (const [date, amount] of [
    ["2026-06-03", 1000],
    ["2026-07-03", 1100],
    ["2026-08-03", 900],
    ["2026-09-03", 1000],
    ["2026-10-02", 1000],
    ["2026-11-03", 5000],
  ] as const) {
    await postJournalEntry(t, {
      date,
      description: `Rent ${date}`,
      lines: [
        { code: "5020", debit: amount },
        { code: "1020", credit: amount },
      ],
    });
  }
});
afterAll(() => restore());

describe("anomalies", () => {
  it("R13-15 GET never writes, even when rules would fire", async () => {
    const before = await alertCount();
    for (let i = 0; i < 3; i++) {
      const r = await t.as.get(`${base()}/anomalies`);
      expect(r.status).toBe(200);
      expect(r.body.anomalies).toEqual([]);
    }
    expect(await alertCount()).toBe(before);
    expect(before).toBe(0);
  });

  it("R13-15 POST /scan records alerts, is idempotent and set-based", async () => {
    const first = await t.as.post(`${base()}/anomalies/scan`);
    expect(first.status, first.text.slice(0, 600)).toBe(200);
    expect(first.body.newAlerts).toBeGreaterThan(0);
    const n = await alertCount();
    const second = await t.as.post(`${base()}/anomalies/scan`);
    expect(second.body.newAlerts).toBe(0);
    expect(await alertCount()).toBe(n);
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/services/anomaly-detection.service.ts", "utf8");
    expect(src).not.toMatch(/getJournalLinesByEntryId/);
  });

  it("R13-14 the list carries the real transaction amount and date", async () => {
    const r = await t.as.get(`${base()}/anomalies`);
    const weekend = r.body.anomalies.find((a: any) => a.rule === "weekend_transaction");
    expect(weekend).toBeTruthy();
    expect(weekend.amount).toBe(2000);
    expect(weekend.date).toBe("2026-11-14");
    expect(weekend.relatedType).toBe("journal_entry");
  });

  it("R13-30 VAT rate mismatch, TRN and duplicate supplier invoice rules fire", async () => {
    const r = await t.as.get(`${base()}/anomalies`);
    const rules = r.body.anomalies.map((a: any) => a.rule);
    expect(rules).toContain("vat_rate_mismatch");
    expect(rules).toContain("trn_malformed");
    expect(rules).toContain("trn_missing");
    expect(rules).toContain("duplicate_supplier_invoice");
    const dup = r.body.anomalies.filter((a: any) => a.rule === "duplicate_supplier_invoice");
    expect(dup).toHaveLength(1);
    expect(dup[0].amount).toBe(420);
    const vat = r.body.anomalies.find((a: any) => a.rule === "vat_rate_mismatch");
    expect(vat.amount).toBe(100);
  });

  it("R13-31 the cross-period baseline flags a z-score outlier against trailing months", async () => {
    const r = await t.as.get(`${base()}/anomalies`);
    const spike = r.body.anomalies.find((a: any) => a.rule === "cross_period_baseline");
    expect(spike).toBeTruthy();
    expect(spike.amount).toBe(5000);
    expect(spike.description).toMatch(/standard deviations/);
    expect(JSON.stringify(r.body)).not.toMatch(/machine learning|\bAI\b/i);
  });

  it("dismiss accepts an empty body and removes the alert from the list", async () => {
    const r = await t.as.get(`${base()}/anomalies`);
    const id = r.body.anomalies[0].id;
    expect((await t.as.post(`${base()}/anomalies/${id}/dismiss`)).status).toBe(200);
    const after = await t.as.get(`${base()}/anomalies`);
    expect(after.body.anomalies.find((a: any) => a.id === id)).toBeUndefined();
    expect((await t.as.post(`${base()}/anomalies/${randomUUID()}/dismiss`)).status).toBe(404);
  });
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>FTA</title>
  <item><title>VAT return deadline reminder</title><link>https://tax.gov.ae/news/1</link><guid>fta-1</guid>
    <pubDate>Mon, 09 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Return due on the 28th.&lt;/p&gt;</description></item>
  <item><title>Corporate tax guide update</title><link>https://tax.gov.ae/news/2</link><guid>fta-2</guid>
    <pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate><description>Updated guide.</description></item>
</channel></rss>`;

describe("news", () => {
  it("R13-13 /api/news is honestly empty and the status says requires_external", async () => {
    const u = await h.createTenant();
    const r = await u.as.get("/api/news");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
    const s = await u.as.get("/api/news/status");
    expect(s.body).toMatchObject({ id: "news_feed", status: "requires_external", feedCount: 0 });
    const fs = await import("node:fs/promises");
    const page = await fs.readFile("client/src/pages/UAENewsFeed.tsx", "utf8");
    expect(page).not.toMatch(/SAMPLE_NEWS|initialData/);
  });

  it("R13-13 admin curation: only admins can publish; deactivated items disappear", async () => {
    const user = await h.createTenant();
    const admin = await h.createTenant({ isAdmin: true });
    const denied = await user.as.post("/api/admin/news", {});
    expect(denied.status).toBe(403);
    const created = await admin.as.post("/api/admin/news", {
      title: "FTA clarifies VAT on e-commerce",
      source: "fta",
      sourceUrl: "https://tax.gov.ae/en/news",
      category: "vat",
      publishedAt: "2026-11-10",
    });
    expect(created.status).toBe(201);
    expect((await user.as.get("/api/news")).body.map((n: any) => n.title)).toContain(
      "FTA clarifies VAT on e-commerce"
    );
    expect((await admin.as.post("/api/admin/news", { title: "x", source: "nope" })).status).toBe(
      400
    );
    expect((await admin.as.delete(`/api/admin/news/${created.body.id}`)).status).toBe(200);
    expect((await user.as.get("/api/news")).body).toEqual([]);
    expect((await admin.as.post("/api/admin/news/ingest")).status).toBe(409);
  });

  it("R13-35 the RSS ingester parses a fixture feed and is idempotent", async () => {
    const { ingestNewsFeeds } = await import("../../server/services/news-ingest.service");
    const urls = ["https://www.tax.gov.ae/feed.xml"];
    const first = await ingestNewsFeeds({ urls, fetchText: async () => RSS });
    expect(first).toMatchObject({ feeds: 1, inserted: 2, skipped: 0, errors: [] });
    const again = await ingestNewsFeeds({ urls, fetchText: async () => RSS });
    expect(again).toMatchObject({ inserted: 0, skipped: 2 });
    const rows = await h.sql(
      "SELECT title, source, summary, category FROM news_items WHERE external_id LIKE 'fta-%' ORDER BY published_at"
    );
    expect(rows[0]).toMatchObject({
      title: "VAT return deadline reminder",
      source: "fta",
      summary: "Return due on the 28th.",
    });
    const failing = await ingestNewsFeeds({
      urls,
      fetchText: async () => {
        throw new Error("boom");
      },
    });
    expect(failing.errors[0]).toContain("boom");
  });
});
