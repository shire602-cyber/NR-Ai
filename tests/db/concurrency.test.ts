/**
 * Concurrency and integrity regressions on the real app + real Postgres
 * (port of tests/integration/concurrency.test.mjs, R20-02).
 *
 * Every case was a real defect found by firing parallel requests at the
 * running app: they only show up when two requests interleave between a
 * check and the write it guards. Rate limits are effectively off in the
 * harness, so no case can be "skipped" by a 429.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { accountByCode, ledgerTotals, useHarness, type Tenant } from "./harness";
import { dubaiToday } from "../helpers/dates";

const h = useHarness();
const today = () => dubaiToday();
const parallel = <T>(n: number, fn: (i: number) => Promise<T>) =>
  Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
const untaxedLine = (description: string, unitPrice: number, quantity = 1) => ({
  description,
  quantity,
  unitPrice,
  vatRate: 0,
  vatSupplyType: "out_of_scope",
});

let t: Tenant;

async function mkInvoice(price: number, customerName = "C") {
  const r = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName,
    date: today(),
    lines: [{ description: "x", quantity: 1, unitPrice: price, vatRate: 5 }],
  });
  expect(r.status, r.text).toBe(200);
  return r.body as { id: string; number: string };
}

async function issue(id: string) {
  const r = await t.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
  expect(r.status, r.text).toBeLessThan(300);
}

async function writeAgainstHardClose<T>(
  tenant: Tenant,
  periodEnd: string,
  write: () => Promise<T>
) {
  const { withLedgerTx } = await import("../../server/ledger/tx");
  const { lockPeriod } = await import("../../server/services/month-end.service");
  let signalPublished = () => {};
  const published = new Promise<void>((resolve) => {
    signalPublished = resolve;
  });
  let releaseClose = () => {};
  const released = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  const close = withLedgerTx(async (tx) => {
    await lockPeriod(tenant.company.id, periodEnd, tenant.user.id, { lockType: "hard" }, tx);
    signalPublished();
    await released;
  });
  await Promise.race([published, close]);

  let responded = false;
  const writing = write().finally(() => {
    responded = true;
  });
  try {
    // Observe PostgreSQL's shared-lock waiter, or the early response on vulnerable code.
    await vi.waitFor(
      async () => {
        const [lock] = await h.sql<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
             WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
               AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          ) AS waiting
        `);
        expect(lock.waiting || responded).toBe(true);
      },
      { timeout: 6000 }
    );
  } finally {
    releaseClose();
    await Promise.all([close, writing]);
  }
  return writing;
}

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("concurrency (real Postgres)", () => {
  beforeAll(async () => {
    t = await h.createTenant({ name: "Conc" });
    const r = await t.as.patch(`/api/companies/${t.company.id}`, {
      trnVatNumber: "100123456700003",
      vatRegistered: true,
      emirate: "dubai",
    });
    expect(r.status, r.text).toBe(200);
  });

  it("20 parallel invoices get unique, gap-free numbers", async () => {
    const res = await parallel(20, (i) =>
      t.as.post(`/api/companies/${t.company.id}/invoices`, {
        customerName: `P${i}`,
        date: today(),
        lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }],
      })
    );
    expect(res.map((r) => r.status)).toEqual(Array(20).fill(200));
    const nums = res.map((r) => r.body.number as string);
    expect(new Set(nums).size).toBe(20);
    const seq = nums.map((x) => Number(String(x).split("-").pop())).sort((a, b) => a - b);
    expect(seq[seq.length - 1] - seq[0]).toBe(19);
  });

  it("rejects a draft invoice when a hard close wins the period lock, without consuming a number", async () => {
    const tenant = await h.createTenant({ name: "InvoicePeriodRace" });
    const companyId = tenant.company.id;
    const endpoint = `/api/companies/${companyId}/invoices`;
    const invoice = {
      date: "2025-11-30",
      customerName: "Period boundary customer",
      lines: [{ description: "Consulting", quantity: 1, unitPrice: 100, vatRate: 5 }],
    };
    const blocked = await writeAgainstHardClose(tenant, "2025-11-30", () =>
      tenant.as.post(endpoint, invoice)
    );
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body.code).toBe("PERIOD_LOCKED");
    expect(await h.sql("SELECT id FROM invoices WHERE company_id = $1", [companyId])).toEqual([]);

    const next = await tenant.as.post(endpoint, { ...invoice, date: "2025-12-01" });
    expect(next.status, next.text).toBe(200);
    expect(next.body.number).toBe("INV-2025-00001");
  });

  it("blocks quote conversion into a hard-closed period without billing lines or allocating a number", async () => {
    const tenant = await h.createTenant();
    const companyId = tenant.company.id;
    const quote = await tenant.as.post(`/api/companies/${companyId}/quotes`, {
      customerName: "Conversion boundary",
      date: "2025-11-15",
      lines: [untaxedLine("Support", 100, 2)],
    });
    expect(quote.status, quote.text).toBe(201);
    const endpoint = `/api/quotes/${quote.body.id}/convert-to-invoice`;
    const requestLines = [{ quoteLineId: quote.body.lines[0].id, quantity: 1 }];
    const blocked = await writeAgainstHardClose(tenant, "2025-11-30", () =>
      tenant.as.post(endpoint, { date: "2025-11-30", lines: requestLines })
    );
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body.code).toBe("PERIOD_LOCKED");
    const untouched = await tenant.as.get(`/api/quotes/${quote.body.id}`);
    expect(untouched.status, untouched.text).toBe(200);
    expect(untouched.body.status).toBe("draft");
    expect(Number(untouched.body.lines[0].billedQuantity)).toBe(0);
    expect(await h.sql("SELECT id FROM invoices WHERE company_id = $1", [companyId])).toEqual([]);

    const next = await tenant.as.post(endpoint, { date: "2025-12-01", lines: requestLines });
    expect(next.status, next.text).toBe(200);
    expect(next.body.invoice.number).toBe("INV-2025-00001");
    expect(next.body.fullyBilled).toBe(false);
  });

  it.each([
    ["into", "2025-12-01", "2025-11-30"],
    ["out of", "2025-11-30", "2025-12-01"],
  ])("blocks a draft invoice edit %s a period that just hard-closed", async (_label, from, to) => {
    const tenant = await h.createTenant();
    const companyId = tenant.company.id;
    const invoice = await tenant.as.post(`/api/companies/${companyId}/invoices`, {
      customerName: "Edit boundary",
      date: from,
      lines: [untaxedLine("Original", 100)],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const endpoint = `/api/invoices/${invoice.body.id}`;
    const blocked = await writeAgainstHardClose(tenant, "2025-11-30", () =>
      tenant.as.put(endpoint, {
        date: to,
        lines: [untaxedLine("Replacement", 200)],
      })
    );
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body.code).toBe("PERIOD_LOCKED");
    const unchanged = await tenant.as.get(endpoint);
    expect(unchanged.status, unchanged.text).toBe(200);
    expect(unchanged.body.date.slice(0, 10)).toBe(from);
    expect(unchanged.body.lines.map((line: { description: string }) => line.description)).toEqual([
      "Original",
    ]);
  });

  it("rolls back the debit note and its number when a hard close wins the period lock", async () => {
    const tenant = await h.createTenant();
    const companyId = tenant.company.id;
    const invoice = await tenant.as.post(`/api/companies/${companyId}/invoices`, {
      customerName: "Debit note boundary",
      date: "2025-12-01",
      lines: [untaxedLine("Original", 100)],
    });
    expect(invoice.status, invoice.text).toBe(200);
    const issued = await tenant.as.patch(`/api/invoices/${invoice.body.id}/status`, {
      status: "sent",
    });
    expect(issued.status, issued.text).toBe(200);
    const endpoint = `/api/companies/${companyId}/invoices/${invoice.body.id}/debit-note`;
    const lines = [untaxedLine("Freight", 20)];
    const blocked = await writeAgainstHardClose(tenant, "2025-11-30", () =>
      tenant.as.post(endpoint, { date: "2025-11-30", lines })
    );
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body.code).toBe("PERIOD_LOCKED");
    const debitNotes = () =>
      h.sql("SELECT id FROM invoices WHERE company_id = $1 AND invoice_type = 'debit_note'", [
        companyId,
      ]);
    expect(await debitNotes()).toEqual([]);

    const noValue = await tenant.as.post(endpoint, {
      date: "2025-12-01",
      lines: [{ ...lines[0], discountType: "percent", discountValue: 100 }],
    });
    expect(noValue.status, noValue.text).toBe(422);
    expect(noValue.body.code).toBe("INVOICE_HAS_NO_VALUE");
    expect(await debitNotes()).toEqual([]);

    const next = await tenant.as.post(endpoint, { date: "2025-12-01", lines });
    expect(next.status, next.text).toBe(201);
    expect(next.body.number).toBe("DN-2025-00001");
    expect(next.body.status).toBe("sent");
    expect(
      await h.sql(
        "SELECT id FROM journal_entries WHERE source = 'invoice' AND source_id = $1 AND status = 'posted'",
        [next.body.id]
      )
    ).toHaveLength(1);
  });

  it("10 parallel issues recognise revenue exactly once", async () => {
    const inv = await mkInvoice(500);
    await parallel(10, () => t.as.patch(`/api/invoices/${inv.id}/status`, { status: "sent" }));
    const rows = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND source_id = $2 AND status = 'posted'`,
      [t.company.id, inv.id]
    );
    expect(rows.length).toBe(1);
  });

  it("5 parallel full credit notes produce exactly one", async () => {
    const inv = await mkInvoice(800);
    await issue(inv.id);
    const res = await parallel(5, () =>
      t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/credit-note`, {})
    );
    const accepted = res.filter((r) => r.status < 400);
    expect(accepted.length, JSON.stringify(res.map((r) => r.status))).toBe(1);
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
  });

  it("10 parallel full payments accept exactly one", async () => {
    const bank = await accountByCode(t, "1020");
    const inv = await mkInvoice(1000);
    await issue(inv.id);
    const res = await parallel(10, () =>
      t.as.post(`/api/companies/${t.company.id}/invoices/${inv.id}/payments`, {
        amount: 1050,
        date: today(),
        method: "cash",
        paymentAccountId: bank.id,
      })
    );
    const accepted = res.filter((r) => r.status < 400);
    expect(accepted.length, JSON.stringify(res.map((r) => r.status))).toBe(1);
    const paid = await h.sql<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM invoice_payments WHERE invoice_id = $1`,
      [inv.id]
    );
    expect(Number(paid[0].total)).toBeCloseTo(1050, 2);
  });

  it("rejects negative and two-sided journal lines", async () => {
    const bank = await accountByCode(t, "1020");
    let r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      description: "neg",
      lines: [
        { accountId: bank.id, debit: -100, credit: 0 },
        { accountId: bank.id, debit: 0, credit: -100 },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("NEGATIVE_JOURNAL_AMOUNT");
    r = await t.as.post(`/api/companies/${t.company.id}/journal`, {
      date: today(),
      description: "both",
      lines: [
        { accountId: bank.id, debit: 100, credit: 100 },
        { accountId: bank.id, debit: 0, credit: 0 },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("LINE_HAS_BOTH_SIDES");
  });

  it("refuses companyType self-promotion (403, W2-D R17-05) and leaves the type unchanged", async () => {
    const r = await t.as.patch(`/api/companies/${t.company.id}`, { companyType: "nra" });
    expect(r.status).toBe(403);
    const rows = await h.sql("SELECT company_type FROM companies WHERE id = $1", [t.company.id]);
    expect(rows[0].company_type).not.toBe("nra");
  });

  it("whole ledger still balances after the concurrent abuse", async () => {
    const totals = await ledgerTotals(t.company.id);
    expect(totals.debit).toBeGreaterThan(0);
    expect(Math.abs(totals.debit - totals.credit)).toBeLessThan(0.01);
    const tb = await t.as.get(`/api/companies/${t.company.id}/reports/trial-balance`);
    expect(tb.status).toBe(200);
  });
});

describe.skipIf(process.env.HARNESS_MODE === "postgres")("concurrency (PGlite fallback)", () => {
  it.skip(`skipped: ${process.env.HARNESS_FALLBACK_REASON ?? "PGlite is single-connection"}`, () => {});
});
