/**
 * Accounting round A integration: A1's filed-VAT-period lock (server/ledger/vat-lock.ts) composed
 * with A3's write-off / bad-debt relief and A2's control-account rule.
 *
 *  - A write-off (Dr 5120 / Cr 1040) carries no VAT and changes no VAT 201 box, so it is allowed in
 *    a filed period (the accounting period lock is the month-end close, not the VAT return).
 *  - Bad-debt relief (FDL 8/2017 Art. 64) is a VAT adjustment: a claim dated in a filed period is
 *    refused 409 VAT_PERIOD_FILED like any VAT document.
 *  - A reasoned control-account adjustment on 2020 passes A2's H8 rule but is still refused 409 in
 *    a filed period (and without a reason it is 422 before the lock is reached).
 *  - Recovery (Art. 64(3)): the relief reversal is declared in the period the payment is received,
 *    so a payment after the claim's quarter was filed reverses the relief in the open period and
 *    leaves the filed return unchanged. A payment dated inside a filed period moves the reversal to
 *    the next open period (Executive Regulation Art. 70).
 */
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function vatTenant() {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function issuedInvoice(t: Tenant, date: string, dueDate: string) {
  const c = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date,
    dueDate,
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
  expect(s.status, s.text).toBe(200);
  return c.body as { id: string };
}

async function fileReturn(t: Tenant, periodStart: string, periodEnd: string) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, { periodStart, periodEnd });
  expect(gen.status, gen.text).toBe(201);
  const sub = await t.as.post(`/api/vat-returns/${gen.body.id}/submit`, {
    ftaReferenceNumber: "FTA-123",
  });
  expect(sub.status, sub.text).toBe(200);
  return gen.body as { id: string };
}

/** Sum of the emirate adjustment boxes (Box 1a-1g "Adj") of a computed period. */
async function adjustments(t: Tenant, from: string, to: string): Promise<number> {
  const r = await t.as.get(`${base(t)}/vat/compute?from=${from}&to=${to}`);
  expect(r.status, r.text).toBe(200);
  const boxes = r.body.boxes as Record<string, number>;
  return Object.entries(boxes)
    .filter(([k]) => /^box1[a-g]\w*Adj$/.test(k))
    .reduce((s, [, v]) => s + Number(v), 0);
}

async function claimStatus(id: string, want: string) {
  let row = { status: "", reversed_at: null as string | null };
  for (let i = 0; i < 60; i++) {
    [row] = await h.sql<{ status: string; reversed_at: string | null }>(
      `SELECT status, reversed_at::text AS reversed_at FROM bad_debt_relief_claims WHERE id = $1`,
      [id]
    );
    if (row.status === want) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return row;
}

const relief = (t: Tenant, invoiceId: string, claimDate: string) =>
  t.as.post(`${base(t)}/vat/bad-debt-relief`, {
    invoiceId,
    claimDate,
    writtenOff: true,
    customerNotified: true,
  });

describe("A1 x A2 x A3: filed VAT periods, write-offs, relief and control adjustments", () => {
  it("write-off allowed, relief and reasoned 2020 adjustment refused in a filed period; recovery reverses in the open period", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const inv = await issuedInvoice(t, "2025-10-01", "2025-10-31");
    await fileReturn(t, "2026-04-01", "2026-06-30");

    // Write-off dated in the filed quarter: no VAT line, the filed return is unchanged.
    const wo = await t.as.post(`${base(t)}/invoices/${inv.id}/write-off`, {
      date: "2026-05-10",
      reason: "Customer in liquidation",
    });
    expect(wo.status, wo.text).toBe(201);
    expect(await adjustments(t, "2026-04-01", "2026-06-30")).toBe(0);

    // Relief dated in the filed quarter would change it: refused.
    const refused = await relief(t, inv.id, "2026-05-15");
    expect(refused.status, refused.text).toBe(409);
    expect(refused.body.code).toBe("VAT_PERIOD_FILED");

    // A2 control rule first (no reason: 422), then A1's lock (reasoned, filed period: 409).
    const vatPayable = await accountByCode(t, "2020");
    const manual = (date: string, controlAdjustment?: { reason: string }) =>
      t.as.post(`${base(t)}/journal`, {
        date,
        status: "posted",
        memo: "VAT correction",
        lines: [
          { accountId: vatPayable.id, debit: 10, credit: 0 },
          { accountId: bank.id, debit: 0, credit: 10 },
        ],
        ...(controlAdjustment ? { controlAdjustment } : {}),
      });
    const noReason = await manual("2026-06-15");
    expect(noReason.status, noReason.text).toBe(422);
    expect(noReason.body.code).toBe("CONTROL_ACCOUNT_MANUAL_POSTING");
    const inFiled = await manual("2026-06-15", { reason: "Correct output VAT rounding" });
    expect(inFiled.status, inFiled.text).toBe(409);
    expect(inFiled.body.code).toBe("VAT_PERIOD_FILED");
    const inOpen = await manual("2026-11-10", { reason: "Correct output VAT rounding" });
    expect(inOpen.status, inOpen.text).toBeLessThan(300);

    // Relief in the open quarter, then that quarter is filed too.
    const claim = await relief(t, inv.id, "2026-07-05");
    expect(claim.status, claim.text).toBe(201);
    expect(Number(claim.body.vatAmount)).toBe(50);
    await fileReturn(t, "2026-07-01", "2026-09-30");
    expect(await adjustments(t, "2026-07-01", "2026-09-30")).toBe(-50);

    // Recovery in the open period: the relief reversal is allowed and declared there.
    const pay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-10-10",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const after = await claimStatus(claim.body.id, "reversed");
    expect(after.status).toBe("reversed");
    expect(after.reversed_at).toBe("2026-10-10");
    expect(await adjustments(t, "2026-07-01", "2026-09-30")).toBe(-50);
    expect(await adjustments(t, "2026-10-01", "2026-10-31")).toBe(50);
  });

  it("a recovery payment dated inside a filed period reverses the relief in the next open period", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const inv = await issuedInvoice(t, "2025-10-01", "2025-10-31");
    const wo = await t.as.post(`${base(t)}/invoices/${inv.id}/write-off`, {
      date: "2026-05-10",
      reason: "Customer in liquidation",
    });
    expect(wo.status, wo.text).toBe(201);
    const claim = await relief(t, inv.id, "2026-05-15");
    expect(claim.status, claim.text).toBe(201);
    await fileReturn(t, "2026-04-01", "2026-06-30");
    await fileReturn(t, "2026-07-01", "2026-09-30");

    const pay = await t.as.post(`${base(t)}/invoices/${inv.id}/payments`, {
      amount: 1050,
      date: "2026-08-20",
      paymentAccountId: bank.id,
    });
    expect(pay.status, pay.text).toBe(201);
    const after = await claimStatus(claim.body.id, "reversed");
    expect(after.status).toBe("reversed");
    expect(after.reversed_at).toBe("2026-10-01");
    expect(await adjustments(t, "2026-04-01", "2026-06-30")).toBe(-50);
    expect(await adjustments(t, "2026-07-01", "2026-09-30")).toBe(0);
    expect(await adjustments(t, "2026-10-01", "2026-10-31")).toBe(50);
  });
});

describe("Filed VAT 201 uses the UAE reporting day and line treatment", () => {
  const periodStart = "2026-04-01";
  const periodEnd = "2026-06-30";
  const quarterBoundary = new Date("2026-03-31T21:00:00Z");

  async function zeroRatedLines(t: Tenant) {
    const bank = await accountByCode(t, "1020");
    const revenue = await accountByCode(t, "4010");
    return [
      { accountId: bank.id, debit: 100 },
      { accountId: revenue.id, credit: 100, attributes: { vatTreatment: "zero_rated" as const } },
    ];
  }

  async function zeroRatedSale(t: Tenant, date: Date | string, status: "posted" | "draft") {
    const { postJournal } = await import("../../server/ledger");
    return postJournal(
      { companyId: t.company.id, date, status, lines: await zeroRatedLines(t) },
      { actorId: t.user.id }
    );
  }

  async function computedZeroRatedSales(t: Tenant): Promise<number> {
    const computed = await t.as.get(`${base(t)}/vat/compute?from=${periodStart}&to=${periodEnd}`);
    expect(computed.status, computed.text).toBe(200);
    return Number(computed.body.boxes.box4ZeroRatedAmount);
  }

  const aprilLock = {
    code: "VAT_PERIOD_FILED",
    details: { postingDate: periodStart, periodStart, periodEnd },
  };

  it("refuses a VAT posting whose UTC timestamp falls on the filed UAE quarter's first day", async () => {
    const t = await vatTenant();
    await fileReturn(t, periodStart, periodEnd);

    await zeroRatedSale(t, new Date("2026-03-31T19:59:59Z"), "posted");
    await expect(zeroRatedSale(t, quarterBoundary, "posted")).rejects.toMatchObject(aprilLock);
    expect(await computedZeroRatedSales(t)).toBe(0);
  });

  it("checks the UAE reporting day when approving a VAT draft", async () => {
    const t = await vatTenant();
    const checker = await h.createSecondTenant();
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      t.company.id,
      checker.user.id,
    ]);
    const { entry } = await zeroRatedSale(t, quarterBoundary, "draft");
    await fileReturn(t, periodStart, periodEnd);

    const approval = await checker.as.post(`/api/journal/${entry.id}/approve`, {});
    expect(approval.status, approval.text).toBe(409);
    expect(approval.body).toMatchObject(aprilLock);
    expect(await computedZeroRatedSales(t)).toBe(0);
  });

  it("rechecks the draft's reporting day after a committed edit while posting waits", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    const { entry } = await zeroRatedSale(t, "2026-03-30", "draft");
    await fileReturn(t, periodStart, periodEnd);

    const blocker = new pg.Client({ connectionString: h.databaseUrl });
    let posting: ReturnType<Tenant["as"]["post"]> | undefined;
    try {
      await blocker.connect();
      const { rows } = await blocker.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid,
                pg_advisory_lock(hashtextextended('vat-returns:' || $1::uuid::text, 0))`,
        [t.company.id]
      );
      posting = t.as.post(`/api/journal/${entry.id}/post`, {});
      await vi.waitFor(
        async () => {
          const blocked = await h.sql(
            `SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
              AND $1::int = ANY(pg_blocking_pids(pid))`,
            [rows[0].pid]
          );
          expect(blocked).toHaveLength(1);
        },
        { timeout: 8_000, interval: 25 }
      );
      const { updateDraftEntry } = await import("../../server/ledger");
      await updateDraftEntry(
        entry.id,
        { date: quarterBoundary, lines: await zeroRatedLines(t) },
        { actorId: t.user.id, companyId: t.company.id }
      );
    } finally {
      await blocker.end();
      await Promise.allSettled([posting]);
    }

    const result = await posting!;
    expect(result.status, result.text).toBe(409);
    expect(result.body).toMatchObject(aprilLock);
    expect(await computedZeroRatedSales(t)).toBe(0);
  });

  it("checks the UAE reporting day of both the original VAT journal and its reversal", async () => {
    const t = await vatTenant();
    const fromOpenPeriod = await zeroRatedSale(t, "2026-03-30", "posted");
    const fromFiledPeriod = await zeroRatedSale(t, quarterBoundary, "posted");
    expect(await computedZeroRatedSales(t)).toBe(100);
    await fileReturn(t, periodStart, periodEnd);

    const { reverseEntry } = await import("../../server/ledger");
    const ctx = { actorId: t.user.id, companyId: t.company.id };
    await expect(
      reverseEntry(fromOpenPeriod.entry.id, { date: quarterBoundary }, ctx)
    ).rejects.toMatchObject(aprilLock);
    await expect(
      reverseEntry(fromFiledPeriod.entry.id, { date: "2026-07-01" }, ctx)
    ).rejects.toMatchObject(aprilLock);
    expect(await computedZeroRatedSales(t)).toBe(100);
  });

  it("allows an out-of-scope capital contribution and its reversal in a filed VAT period", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const capital = await accountByCode(t, "3010");
    const vatPayable = await accountByCode(t, "2020");
    const journal = (
      creditAccountId: string,
      status: "posted" | "draft",
      reason?: string,
      date = "2026-04-02"
    ) =>
      t.as.post(`${base(t)}/journal`, {
        date,
        status,
        lines: [
          { accountId: bank.id, debit: 100 },
          { accountId: creditAccountId, credit: 100, vatTreatment: "out_of_scope" },
        ],
        ...(reason ? { controlAdjustment: { reason } } : {}),
      });
    const original = await journal(capital.id, "posted");
    expect(original.status, original.text).toBe(200);
    await fileReturn(t, periodStart, periodEnd);

    const posted = await journal(capital.id, "posted");
    expect(posted.status, posted.text).toBe(200);
    const draft = await journal(capital.id, "draft");
    expect(draft.status, draft.text).toBe(200);
    const draftPosted = await t.as.post(`/api/journal/${draft.body.id}/post`, {});
    expect(draftPosted.status, draftPosted.text).toBe(200);
    const reversed = await t.as.post(`/api/journal/${original.body.id}/reverse`, {
      date: "2026-04-03",
      reason: "Undo capital contribution",
    });
    expect(reversed.status, reversed.text).toBe(200);

    const touchesVat = await journal(vatPayable.id, "posted", "Adjust output VAT");
    expect(touchesVat.status, touchesVat.text).toBe(409);
    expect(touchesVat.body.code).toBe("VAT_PERIOD_FILED");

    const openAdjustment = await journal(
      vatPayable.id,
      "posted",
      "Adjust output VAT",
      "2026-03-30"
    );
    expect(openAdjustment.status, openAdjustment.text).toBe(200);
    const reverseAdjustment = await t.as.post(`/api/journal/${openAdjustment.body.id}/reverse`, {
      date: "2026-04-03",
      reason: "Undo output VAT adjustment",
    });
    expect(reverseAdjustment.status, reverseAdjustment.text).toBe(409);
    expect(reverseAdjustment.body.code).toBe("VAT_PERIOD_FILED");
  });
});
