/**
 * W2-B close / lock policy on the report-08 scenario: revenue 1,000,000 in
 * June 2025, expense 300,000 in July, expense 100,000 in August. Corporate
 * tax for FY2025 is 20,250 and must stay 20,250 whatever is closed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
let t: Tenant;
let base: string;

async function ctTax(): Promise<number> {
  const r = await t.as.get(
    `${base}/corporate-tax/calculate?periodStart=2025-01-01&periodEnd=2025-12-31`
  );
  expect(r.status, r.text).toBe(200);
  return r.body.taxPayable;
}

async function journalCount(): Promise<number> {
  const rows = await h.sql<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM journal_entries WHERE company_id = $1`,
    [t.company.id]
  );
  return Number(rows[0].n);
}

beforeAll(async () => {
  t = await h.createTenant({ name: "Close08" });
  base = `/api/companies/${t.company.id}`;
  await postJournalEntry(t, {
    date: "2025-01-05",
    description: "Capital",
    lines: [
      { code: "1020", debit: 500_000 },
      { code: "3010", credit: 500_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-06-15",
    description: "June services",
    lines: [
      { code: "1040", debit: 1_000_000 },
      { code: "4020", credit: 1_000_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-07-10",
    description: "July rent",
    lines: [
      { code: "5010", debit: 300_000 },
      { code: "1020", credit: 300_000 },
    ],
  });
  await postJournalEntry(t, {
    date: "2025-08-20",
    description: "August travel",
    lines: [
      { code: "5090", debit: 100_000 },
      { code: "1020", credit: 100_000 },
    ],
  });
});

describe("month-end input validation", () => {
  it("[R08-11] garbage periods are 400s, never 500s", async () => {
    const lockGarbage = await t.as.post(`${base}/month-end/lock-period`, { periodEnd: "garbage" });
    expect(lockGarbage.status).toBe(400);
    expect(lockGarbage.body.code).toBe("INVALID_REPORT_DATE");
    const lockMissing = await t.as.post(`${base}/month-end/lock-period`, {});
    expect(lockMissing.status).toBe(400);
    const checklist = await t.as.get(`${base}/month-end/checklist?period=2025-13`);
    expect(checklist.status).toBe(400);
    const validation = await t.as.get(`${base}/month-end/ai-validation?period=2025-13`);
    expect(validation.status).toBe(400);
    const closeGarbage = await t.as.post(`${base}/month-end/generate-closing-entries`, {
      periodStart: "2025-08-01",
      periodEnd: "garbage",
    });
    expect(closeGarbage.status).toBe(400);
    const reversed = await t.as.post(`${base}/month-end/generate-closing-entries`, {
      periodStart: "2025-09-01",
      periodEnd: "2025-08-01",
    });
    expect(reversed.status).toBe(400);
    const unknownKey = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
      companyId: t.company.id,
    });
    expect(unknownKey.status).toBe(400);
    const badYearEnd = await t.as.post(`${base}/month-end/year-end-close`, {
      fiscalYearEnd: "2025-06-30",
      overrideChecklist: true,
      reason: "test",
    });
    expect(badYearEnd.status).toBe(400);
    expect(badYearEnd.body.code).toBe("NOT_FISCAL_YEAR_END");
  });
});

describe("closing entries", () => {
  it("[R08-01] closing August sums only August lines and posts nothing", async () => {
    const before = await journalCount();
    const r = await t.as.post(`${base}/month-end/generate-closing-entries`, {
      periodStart: "2025-08-01",
      periodEnd: "2025-08-31",
    });
    expect(r.status, r.text).toBe(200);
    expect(r.body.posted).toBe(false);
    const codes = r.body.lines.map((l: any) => l.accountCode).sort();
    expect(codes).toEqual(["3020", "5090"]);
    const travel = r.body.lines.find((l: any) => l.accountCode === "5090");
    expect(travel).toMatchObject({ debit: 0, credit: 100_000 });
    expect(r.body.netIncome).toBe(-100_000);
    expect(r.body.totalDebits).toBe(r.body.totalCredits);
    expect(await journalCount()).toBe(before);
    // Calling it twice is harmless: nothing was posted.
    const again = await t.as.post(`${base}/month-end/generate-closing-entries`, {
      periodStart: "2025-08-01",
      periodEnd: "2025-08-31",
    });
    expect(again.status).toBe(200);
    expect(await journalCount()).toBe(before);
    expect(await ctTax()).toBe(20_250);
  });
});

describe("lock policy", () => {
  it("[R08-05] locking needs a complete checklist or an audited override with a reason", async () => {
    const noOverride = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
    });
    expect(noOverride.status).toBe(422);
    expect(noOverride.body.code).toBe("CLOSE_CHECKLIST_INCOMPLETE");
    expect(noOverride.body.details.incomplete.length).toBeGreaterThan(0);

    const noReason = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
      overrideChecklist: true,
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("OVERRIDE_REASON_REQUIRED");

    const ok = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
      overrideChecklist: true,
      lockType: "soft",
      reason: "VAT return filed outside the app",
    });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({
      status: "locked",
      lockType: "soft",
      lockScope: "through",
      checklistOverride: true,
    });
    const audit = await h.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE resource_type = 'period' AND resource_id = '2025-08-31'`
    );
    expect(audit.map((a) => a.action)).toContain("period.lock_override");
  });

  it("[R02-19] lock-through date: July is locked by an August lock; soft lock allows a reasoned post", async () => {
    const julyEntry = {
      date: "2025-07-31",
      description: "late July prepayment",
      status: "posted",
      lines: [
        {
          accountId: (
            await h.sql(`SELECT id FROM accounts WHERE company_id=$1 AND code='1060'`, [
              t.company.id,
            ])
          )[0].id,
          debit: 50,
          credit: 0,
        },
        {
          accountId: (
            await h.sql(`SELECT id FROM accounts WHERE company_id=$1 AND code='1020'`, [
              t.company.id,
            ])
          )[0].id,
          debit: 0,
          credit: 50,
        },
      ],
    };
    const blocked = await t.as.post(`${base}/journal`, julyEntry);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PERIOD_SOFT_LOCKED");

    const withReason = await t.as.post(`${base}/journal`, julyEntry, {
      headers: { "X-Period-Lock-Reason": "Auditor adjustment AJE-3" },
    });
    expect(withReason.status, withReason.text).toBeLessThan(300);
    const override = await h.sql(
      `SELECT details FROM audit_logs WHERE action = 'period.soft_lock_override'`
    );
    expect(override.length).toBe(1);

    // Hard lock: nobody posts, reason or not.
    const hard = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
      overrideChecklist: true,
      lockType: "hard",
      reason: "Hard lock after review",
    });
    expect(hard.status).toBe(200);
    const hardBlocked = await t.as.post(`${base}/journal`, julyEntry, {
      headers: { "X-Period-Lock-Reason": "please" },
    });
    expect(hardBlocked.status).toBe(403);
    expect(hardBlocked.body.code).toBe("PERIOD_LOCKED");

    const state = await t.as.get(`${base}/period-lock`);
    expect(state.status).toBe(200);
    expect(state.body.lockThroughDate).toBe("2025-08-31");
  });

  it("[R02-11] a company owner can unlock with a reason; viewers cannot", async () => {
    const viewer = await h.createSecondTenant({ name: "Viewer08" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      viewer.user.id,
    ]);
    const forbidden = await viewer.as.post(`${base}/period-lock/unlock`, {
      periodEnd: "2025-08-31",
      reason: "let me in",
    });
    expect(forbidden.status).toBe(403);
    const viewerLock = await viewer.as.post(`${base}/month-end/lock-period`, {
      periodEnd: "2025-08-31",
      overrideChecklist: true,
      reason: "viewer tries",
    });
    expect(viewerLock.status).toBe(403);

    const noReason = await t.as.post(`${base}/period-lock/unlock`, { period: "2025-08" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe("UNLOCK_REASON_REQUIRED");

    const legacy = await t.as.post(`/api/period-lock/unlock`, {
      companyId: t.company.id,
      period: "2025-08",
      reason: "Correcting a misposted bill",
    });
    expect(legacy.status, legacy.text).toBe(200);
    expect(legacy.body).toMatchObject({
      status: "open",
      unlockReason: "Correcting a misposted bill",
    });
    expect(legacy.headers.get("deprecation")).toBe("true");
    const audit = await h.sql(`SELECT details FROM audit_logs WHERE action = 'period.unlock'`);
    expect(audit.length).toBe(1);
    expect(JSON.stringify(audit[0])).toContain("Correcting a misposted bill");
  });
});

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("hard-close checklist concurrency", () => {
  it.each([
    ["month", "lock-period", { periodEnd: "2025-12-31", lockType: "hard" }],
    ["year", "year-end-close", { fiscalYearEnd: "2025-12-31", hardClose: true }],
  ])("rechecks %s eligibility after a pending expense commits", async (_, endpoint, body) => {
    const tenant = await h.createTenant({
      name: `Checklist-${endpoint}`,
      vatRegistered: false,
      companyColumns: { tax_registration_type: "Non-registered" },
    });
    const companyId = tenant.company.id;
    const { postJournal, withLedgerTx } = await import("../../server/ledger");
    const [bank, expense] = await Promise.all([
      accountByCode(tenant, "1020"),
      accountByCode(tenant, "5010"),
    ]);
    const ready = await tenant.as.get(
      `/api/companies/${companyId}/month-end/checklist?period=2025-12`
    );
    expect(ready.status, ready.text).toBe(200);
    expect(
      ready.body.checklist.filter(
        (step: { effectiveStatus: string }) => step.effectiveStatus !== "complete"
      )
    ).toEqual([]);
    let signalInserted = () => {};
    const inserted = new Promise<void>((resolve) => {
      signalInserted = resolve;
    });
    let releasePosting = () => {};
    const released = new Promise<void>((resolve) => {
      releasePosting = resolve;
    });
    const posting = withLedgerTx(async (tx) => {
      await postJournal(
        {
          companyId,
          date: "2025-12-15",
          status: "posted",
          lines: [
            { accountId: expense.id, debit: 100 },
            { accountId: bank.id, credit: 100 },
          ],
        },
        { actorId: tenant.user.id, tx }
      );
      signalInserted();
      await released;
    });
    await Promise.race([inserted, posting]);
    const url = `/api/companies/${companyId}/month-end/${endpoint}`;
    const closing = tenant.as.post(url, body);
    try {
      await vi.waitFor(
        async () => {
          const [waiting] = await h.sql<{ waiting: boolean }>(
            `SELECT EXISTS (
             SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory' AND mode = 'ExclusiveLock' AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           ) AS waiting`
          );
          expect(waiting.waiting).toBe(true);
        },
        { timeout: 6000 }
      );
    } finally {
      releasePosting();
      await Promise.all([posting, closing]);
    }
    const close = await closing;
    expect(close.status, close.text).toBe(422);
    expect(close.body.code).toBe("CLOSE_CHECKLIST_INCOMPLETE");
    expect(close.body.details.incomplete).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 8 })])
    );
    const rows = await h.sql("SELECT 1 FROM month_end_close WHERE company_id = $1", [companyId]);
    expect(rows).toHaveLength(0);

    const override = await tenant.as.post(url, {
      ...body,
      overrideChecklist: true,
      reason: "Auditor confirmed no accrual required",
    });
    expect(override.status, override.text).toBe(endpoint === "lock-period" ? 200 : 201);
    const record = endpoint === "lock-period" ? override.body : override.body.lock;
    expect(record.checklistOverride).toBe(true);
    const [saved] = await h.sql<{ checklist_snapshot: unknown }>(
      "SELECT checklist_snapshot FROM month_end_close WHERE id = $1 AND company_id = $2",
      [record.id, companyId]
    );
    expect(saved.checklist_snapshot).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 8, status: "incomplete" })])
    );
  });
});

describe("year-end close", () => {
  it.each([
    { lockType: "soft", lockScope: "through" },
    { lockType: "hard", lockScope: "month" },
    { lockType: "hard", lockScope: "through" },
  ])(
    "keeps an active hard fiscal close when a lock requests $lockType/$lockScope",
    async (weaker) => {
      const tenant = await h.createTenant({ name: "Hard fiscal lock" });
      const companyId = tenant.company.id;
      const companyUrl = `/api/companies/${companyId}`;
      const url = `${companyUrl}/month-end`;
      const end = "2025-12-31";
      const settings = await tenant.as.put(`${url}/settings`, { requireChecklistToLock: false });
      expect(settings.status, settings.text).toBe(200);
      const month = await tenant.as.post(`${url}/lock-period`, {
        periodEnd: end,
        lockType: "soft",
      });
      expect(month.status, month.text).toBe(200);
      const request = await tenant.as.post(`${url}/reopen-requests`, {
        periodEnd: end,
        reason: "Draft correction",
      });
      expect(request.status, request.text).toBe(201);
      const close = await tenant.as.post(`${url}/year-end-close`, {
        fiscalYearEnd: end,
        hardClose: true,
        reason: "Annual review completed",
      });
      expect(close.status, close.text).toBe(201);
      const lockRow = () =>
        h.sql("SELECT * FROM month_end_close WHERE id = $1", [close.body.lock.id]);
      const originalLock = await lockRow();

      const weakening = await tenant.as.post(`${url}/lock-period`, { periodEnd: end, ...weaker });
      expect(weakening.status, weakening.text).toBe(403);
      expect(weakening.body.code).toBe("FISCAL_YEAR_HARD_CLOSED");

      const admin = await h.createTenant({ name: "Period administrator", isAdmin: true });
      await h.sql(
        "INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')",
        [companyId, admin.user.id]
      );
      const ordinaryUnlock = await admin.as.post(`${companyUrl}/period-lock/unlock`, {
        periodEnd: end,
        reason: "Draft correction",
      });
      expect(ordinaryUnlock.status, ordinaryUnlock.text).toBe(403);
      expect(ordinaryUnlock.body.code).toBe("FISCAL_YEAR_HARD_CLOSED");
      const approval = await admin.as.post(`${url}/reopen-requests/${request.body.id}/approve`, {});
      expect(approval.status, approval.text).toBe(403);
      expect(approval.body.code).toBe("FISCAL_YEAR_HARD_CLOSED");
      const [pending] = await h.sql("SELECT status FROM month_end_reopen_requests WHERE id = $1", [
        request.body.id,
      ]);
      expect(pending.status).toBe("pending");
      const period = await tenant.as.get(`${companyUrl}/period-lock`);
      expect(period.status, period.text).toBe(200);
      expect(period.body.locks).toEqual([
        expect.objectContaining({ id: close.body.lock.id, lockType: "hard", lockScope: "through" }),
      ]);
      expect(period.body.fiscalYears).toEqual([
        expect.objectContaining({ id: close.body.record.id, status: "closed", hardClosed: true }),
      ]);
      expect(await lockRow()).toEqual(originalLock);

      const reopen = await admin.as.post(`${url}/year-end-close/reopen`, {
        fiscalYearEnd: end,
        reason: "Restatement authorized",
      });
      expect(reopen.status, reopen.text).toBe(200);
      const ordinaryLock = await tenant.as.post(`${url}/lock-period`, {
        periodEnd: end,
        ...weaker,
      });
      expect(ordinaryLock.status, ordinaryLock.text).toBe(200);
      expect(ordinaryLock.body).toMatchObject(weaker);
    }
  );

  it.each(["weakened", "missing"])(
    "honors a hard fiscal close with a %s period lock row",
    async (state) => {
      const tenant = await h.createTenant({ name: "Legacy fiscal lock" });
      const companyId = tenant.company.id;
      const { closeFiscalYear } = await import("../../server/services/month-end.service");
      const close = await closeFiscalYear(companyId, "2025-12-31", tenant.user.id, {
        hardClose: true,
      });
      await h.sql(
        state === "weakened"
          ? "UPDATE month_end_close SET lock_type = 'soft', lock_scope = 'month' WHERE id = $1"
          : "DELETE FROM month_end_close WHERE id = $1",
        [close.lock.id]
      );
      const companyUrl = `/api/companies/${companyId}`;
      const period = await tenant.as.get(`${companyUrl}/period-lock`);
      expect(period.status, period.text).toBe(200);
      expect(period.body.lockThroughDate).toBe("2025-12-31");
      const draft = await tenant.as.post(`${companyUrl}/invoices`, {
        customerName: "Pending restatement",
        date: "2025-08-15",
        lines: [
          {
            description: "Services",
            quantity: 1,
            unitPrice: 100,
            vatRate: 0,
            vatSupplyType: "out_of_scope",
          },
        ],
      });
      expect(draft.status, draft.text).toBe(403);
      expect(draft.body.code).toBe("PERIOD_LOCKED");
    }
  );

  it("preserves the sign-off that made an incomplete year-end checklist step pass", async () => {
    const tenant = await h.createTenant({
      name: "YearCloseSignOff",
      vatRegistered: false,
      companyColumns: { tax_registration_type: "Non-registered" },
    });
    const companyId = tenant.company.id;
    const url = `/api/companies/${companyId}/month-end`;
    await postJournalEntry(tenant, {
      date: "2025-12-15",
      description: "Year-end office expense",
      lines: [
        { code: "5010", debit: 100 },
        { code: "1020", credit: 100 },
      ],
    });
    const input = { fiscalYearEnd: "2025-12-31", hardClose: true };
    const before = await tenant.as.post(`${url}/year-end-close`, input);
    expect(before.status, before.text).toBe(422);
    expect(before.body.details.incomplete).toEqual([expect.objectContaining({ id: 8 })]);

    const note = "Reviewed the December expenses. No accrual is outstanding.";
    const signOff = await tenant.as.post(`${url}/steps/accruals/sign-off`, {
      period: "2025-12",
      note,
    });
    expect(signOff.status, signOff.text).toBe(201);
    const close = await tenant.as.post(`${url}/year-end-close`, input);
    expect(close.status, close.text).toBe(201);
    expect(close.body.lock.checklistOverride).toBe(false);

    const [saved] = await h.sql<{ checklist_snapshot: unknown }>(
      "SELECT checklist_snapshot FROM month_end_close WHERE id = $1 AND company_id = $2",
      [close.body.lock.id, companyId]
    );
    expect(saved.checklist_snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 8,
          status: "incomplete",
          effectiveStatus: "complete",
          signOff: {
            stepKey: "accruals",
            signedOffBy: tenant.user.id,
            signedOffAt: signOff.body.signedOffAt,
            note,
          },
        }),
      ])
    );
    const [audit] = await h.sql<{ details: string }>(
      "SELECT details FROM audit_logs WHERE company_id = $1 AND action = 'fiscal_year.close'",
      [companyId]
    );
    expect(JSON.parse(audit.details).after.checklist).toEqual(saved.checklist_snapshot);
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "includes an AED 100 journal that commits while the year-end close waits for the period lock",
    async () => {
      const tenant = await h.createTenant({ name: "CloseConcurrentProfit" });
      const companyId = tenant.company.id;
      const actorId = tenant.user.id;
      const url = `/api/companies/${companyId}/month-end`;
      const settings = await tenant.as.put(`${url}/settings`, {
        postYearEndClosingEntry: true,
        requireChecklistToLock: false,
      });
      expect(settings.status, settings.text).toBe(200);
      const [bank, income] = await Promise.all([
        accountByCode(tenant, "1020"),
        accountByCode(tenant, "4020"),
      ]);
      const { postJournal } = await import("../../server/ledger");
      const { withLedgerTx } = await import("../../server/ledger/tx");
      const journal = (amount: number) => ({
        companyId,
        date: "2025-06-01",
        status: "posted" as const,
        lines: [
          { accountId: bank.id, debit: amount },
          { accountId: income.id, credit: amount },
        ],
      });
      await postJournal(journal(200), { actorId });
      let signalInserted = () => {};
      const inserted = new Promise<void>((resolve) => {
        signalInserted = resolve;
      });
      let releasePosting = () => {};
      const release = new Promise<void>((resolve) => {
        releasePosting = resolve;
      });
      const posting = withLedgerTx(async (tx) => {
        await postJournal(journal(100), { actorId, tx });
        signalInserted();
        await release;
      });
      await Promise.race([inserted, posting]);
      const closing = tenant.as.post(`${url}/year-end-close`, {
        fiscalYearEnd: "2025-12-31",
        hardClose: true,
      });
      try {
        await vi.waitFor(
          async () => {
            const [waiting] = await h.sql<{ waiting: boolean }>(
              `SELECT EXISTS (
               SELECT 1 FROM pg_locks
                WHERE locktype = 'advisory' AND mode = 'ExclusiveLock' AND NOT granted
                  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
             ) AS waiting`
            );
            expect(waiting.waiting).toBe(true);
          },
          { timeout: 6000 }
        );
      } finally {
        releasePosting();
        await Promise.all([posting, closing]);
      }
      const close = await closing;
      expect(close.status, close.text).toBe(201);
      expect(close.body.summary.netIncome).toBe(300);
      expect(close.body.record.netIncome).toBe(300);
      const [retainedEarnings] = await h.sql<{ credit: string }>(
        `SELECT jl.credit::text AS credit
           FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
          WHERE jl.entry_id = $1 AND a.code = '3020'`,
        [close.body.closingEntryId]
      );
      expect(Number(retainedEarnings.credit)).toBe(300);
      await expect(postJournal(journal(100), { actorId })).rejects.toMatchObject({
        code: "PERIOD_LOCKED",
      });
    }
  );

  it("rolls back failed year-end closes and reopens and lets each operation retry cleanly", async () => {
    const tenant = await h.createTenant({ name: "CloseAtomicRollback" });
    const companyId = tenant.company.id;
    const { closeFiscalYear, reopenFiscalYear, updateCloseSettings } =
      await import("../../server/services/month-end.service");
    await updateCloseSettings(companyId, { postYearEndClosingEntry: true }, tenant.user.id);
    await postJournalEntry(tenant, {
      date: "2025-06-01",
      description: "June revenue",
      lines: [
        { code: "1020", debit: 200 },
        { code: "4020", credit: 200 },
      ],
    });

    // Fail the last write after the closing journal and fiscal-year record have been attempted.
    await h.sql(`ALTER TABLE month_end_close ADD CONSTRAINT test_year_close_lock_write
                 CHECK (status <> 'locked') NOT VALID`);
    try {
      await expect(closeFiscalYear(companyId, "2025-12-31", tenant.user.id)).rejects.toMatchObject({
        cause: { code: "23514", constraint: "test_year_close_lock_write" },
      });
      const [state] = await h.sql<{ journals: number; closes: number; locks: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM journal_entries WHERE company_id = $1 AND source = 'year_end_close') AS journals,
           (SELECT COUNT(*)::int FROM fiscal_year_closes WHERE company_id = $1) AS closes,
           (SELECT COUNT(*)::int FROM month_end_close WHERE company_id = $1) AS locks`,
        [companyId]
      );
      expect(state).toEqual({ journals: 0, closes: 0, locks: 0 });
    } finally {
      await h.sql("ALTER TABLE month_end_close DROP CONSTRAINT test_year_close_lock_write");
    }

    const retry = await closeFiscalYear(companyId, "2025-12-31", tenant.user.id);
    expect(retry.record.netIncome).toBe(200);
    expect(retry.posted).toBe(true);
    expect(retry.lock.status).toBe("locked");

    // Fail the reversal after the fiscal record and its period lock have been reopened.
    await h.sql(`ALTER TABLE journal_entries ADD CONSTRAINT test_year_reopen_reverse_write
                 CHECK (source <> 'year_end_close' OR source_id IS NULL) NOT VALID`);
    try {
      await expect(
        reopenFiscalYear(companyId, "2025-12-31", tenant.user.id, "Auditor adjustment")
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "test_year_reopen_reverse_write" },
      });
      const [state] = await h.sql<{ reversals: number; close: string; period: string }>(
        `SELECT
           (SELECT COUNT(*)::int FROM journal_entries WHERE company_id = $1 AND source_id = $2) AS reversals,
           (SELECT status FROM fiscal_year_closes WHERE company_id = $1) AS close,
           (SELECT status FROM month_end_close WHERE company_id = $1) AS period`,
        [companyId, retry.closingEntryId]
      );
      expect(state).toEqual({ reversals: 0, close: "closed", period: "locked" });
    } finally {
      await h.sql("ALTER TABLE journal_entries DROP CONSTRAINT test_year_reopen_reverse_write");
    }
    const reopened = await reopenFiscalYear(
      companyId,
      "2025-12-31",
      tenant.user.id,
      "Auditor adjustment"
    );
    expect(reopened.status).toBe("reopened");
    const [reversal] = await h.sql<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM journal_entries WHERE company_id = $1 AND source_id = $2`,
      [companyId, retry.closingEntryId]
    );
    expect(reversal.n).toBe(1);
  });

  it("[R08-02][R11-14] posted year-end close keeps CT at 20,250 and the roll-forward does not double count", async () => {
    expect(await ctTax()).toBe(20_250);
    const settings = await t.as.put(`${base}/month-end/settings`, {
      postYearEndClosingEntry: true,
    });
    expect(settings.status, settings.text).toBe(200);

    const noChecklist = await t.as.post(`${base}/month-end/year-end-close`, {
      fiscalYearEnd: "2025-12-31",
    });
    expect(noChecklist.status).toBe(422);

    const close = await t.as.post(`${base}/month-end/year-end-close`, {
      fiscalYearEnd: "2025-12-31",
      hardClose: true,
      overrideChecklist: true,
      reason: "FY2025 signed off",
    });
    expect(close.status, close.text).toBe(201);
    expect(close.body.posted).toBe(true);
    expect(close.body.summary.netIncome).toBe(600_000);
    const entry = await h.sql<{ source: string }>(
      `SELECT source FROM journal_entries WHERE id = $1`,
      [close.body.closingEntryId]
    );
    expect(entry[0].source).toBe("year_end_close");

    const twice = await t.as.post(`${base}/month-end/year-end-close`, {
      fiscalYearEnd: "2025-12-31",
      overrideChecklist: true,
      reason: "again",
    });
    expect(twice.status).toBe(409);

    expect(await ctTax()).toBe(20_250);
    const pl = await t.as.get(`${base}/reports/profit-loss?from=2025-01-01&to=2025-12-31`);
    expect(pl.body.netProfit).toBe(600_000);
    const bs = await t.as.get(`${base}/reports/balance-sheet?endDate=2026-01-31`);
    expect(bs.body.retainedEarningsBroughtForward).toBe(600_000);
    expect(bs.body.isBalanced).toBe(true);
    const bs25 = await t.as.get(`${base}/reports/balance-sheet?endDate=2025-12-31`);
    expect(bs25.body.currentYearEarnings).toBe(600_000);
    expect(bs25.body.retainedEarningsBroughtForward).toBe(0);
    expect(bs25.body.isBalanced).toBe(true);
    const tb = await t.as.get(`${base}/reports/trial-balance?from=2026-01-01&to=2026-03-31`);
    expect(tb.body.isBalanced).toBe(true);
    const cmp = await t.as.get(
      `${base}/reports/comparison?from=2025-07-01&to=2025-12-31&compareTo=prior_period`
    );
    expect(cmp.body.current.totalExpenses).toBe(400_000);

    // pull-from-books also ignores the closing entry.
    const ret = await t.as.post(`/api/corporate-tax/returns`, {
      companyId: t.company.id,
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
    });
    if (ret.status < 300) {
      const pulled = await t.as.post(
        `/api/corporate-tax/returns/${ret.body.id}/pull-from-books`,
        {}
      );
      expect(pulled.status, pulled.text).toBe(200);
      expect(Number(pulled.body.totalRevenue)).toBe(1_000_000);
    }
  });

  it("[R02-11][R11-14] a hard-closed year needs firm/admin to reopen; owners get 403", async () => {
    const owner = await t.as.post(`${base}/period-lock/unlock`, {
      periodEnd: "2025-12-31",
      reason: "owner wants to edit",
    });
    expect(owner.status).toBe(403);
    expect(owner.body.code).toBe("FISCAL_YEAR_HARD_CLOSED");

    const admin = await h.createSecondTenant({ name: "Admin08", isAdmin: true });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [t.company.id, admin.user.id]
    );
    const reopen = await admin.as.post(`${base}/month-end/year-end-close/reopen`, {
      fiscalYearEnd: "2025-12-31",
      reason: "Restatement requested by auditor",
    });
    expect(reopen.status, reopen.text).toBe(200);
    expect(reopen.body.status).toBe("reopened");
    expect(await ctTax()).toBe(20_250);
    const pl = await t.as.get(`${base}/reports/profit-loss?from=2025-01-01&to=2025-12-31`);
    expect(pl.body.netProfit).toBe(600_000);
  });

  it("[R08-01][R08-02] a legacy all-period closing entry is excluded and found by the detector", async () => {
    // Simulate the pre-fix defect: an August "closing" entry that swept every period.
    const acct = async (code: string) =>
      (
        await h.sql(`SELECT id FROM accounts WHERE company_id=$1 AND code=$2`, [t.company.id, code])
      )[0].id;
    const [je] = await h.sql<{ id: string }>(
      `INSERT INTO journal_entries (company_id, entry_number, date, memo, status, source, created_by)
       VALUES ($1, 'JE-LEGACY-CLOSE', '2025-08-31', 'Closing entries for 2025-08-01 to 2025-08-31', 'posted', 'system', $2)
       RETURNING id`,
      [t.company.id, t.user.id]
    );
    const lines: Array<[string, number, number]> = [
      [await acct("4020"), 1_000_000, 0],
      [await acct("5010"), 0, 300_000],
      [await acct("5090"), 0, 100_000],
      [await acct("3020"), 0, 600_000],
    ];
    for (const [accountId, debit, credit] of lines) {
      await h.sql(
        `INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`,
        [je.id, accountId, debit, credit]
      );
    }
    expect(await ctTax()).toBe(20_250);
    const bs = await t.as.get(`${base}/reports/balance-sheet?endDate=2026-01-31`);
    expect(bs.body.isBalanced).toBe(true);
    expect(bs.body.retainedEarningsBroughtForward).toBe(600_000);

    const before = await h.sql(`SELECT COUNT(*)::int AS n FROM journal_lines`);
    const run = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "scripts/qa/find-bad-closing-entries.mjs"),
        "--json",
        "--company",
        t.company.id,
      ],
      { env: { ...process.env, DATABASE_URL: h.databaseUrl }, encoding: "utf8" }
    );
    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout);
    const found = report.findings.find((f: any) => f.entryId === je.id);
    expect(found).toBeTruthy();
    const travel = found.offendingLines.find((l: any) => l.accountCode === "4020");
    expect(travel.actual).toBe(1_000_000);
    expect(travel.expectedFromPeriod).toBe(0);
    expect(found.repairProposal.lines.find((l: any) => l.accountCode === "3020").debit).toBe(
      600_000
    );
    const after = await h.sql(`SELECT COUNT(*)::int AS n FROM journal_lines`);
    expect(after[0].n).toBe(before[0].n);
  });
});
