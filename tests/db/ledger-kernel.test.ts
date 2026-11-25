/**
 * Ledger posting kernel (W2-A) on the real app + real Postgres.
 *
 * Issue ids in test names: R02-01 exact balance, R02-02 one reversal per
 * entry, R02-03 one post per draft, R02-04 inactive accounts, R02-07 bad input
 * is 4xx, R02-08 reversal mirrors cost centre + FX and dates, R02-09 reversal
 * state on both entries, R02-12 same-account entries, R02-16a void / reverse
 * date / maker-checker / recurring + auto-reversing / attachments / cursor,
 * R02-18 exact integer-fils maths over 1,000 entries.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { allocate } from "../../shared/money";
import { accountByCode, ledgerTotals, useHarness, type Tenant } from "./harness";

const h = useHarness();
const pg = () => h.mode === "postgres";
// The ledger's posting "today" is the UAE calendar date (UTC+4).
const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const parallel = <T>(n: number, fn: (i: number) => Promise<T>) =>
  Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

let t: Tenant;
let cash: string;
let capital: string;
let rent: string;

async function entryCount(companyId: string): Promise<number> {
  const rows = await h.sql<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM journal_entries WHERE company_id = $1`,
    [companyId]
  );
  return rows[0].n;
}

async function post(body: Record<string, unknown>, tenant: Tenant = t) {
  return tenant.as.post(`/api/companies/${tenant.company.id}/journal`, body);
}

function simple(amount: string | number, extra: Record<string, unknown> = {}) {
  return {
    date: today(),
    memo: "kernel test",
    status: "posted",
    lines: [
      { accountId: cash, debit: amount, credit: 0 },
      { accountId: capital, debit: 0, credit: amount },
    ],
    ...extra,
  };
}

beforeAll(async () => {
  t = await h.createTenant({ name: "Ledger" });
  cash = (await accountByCode(t, "1020")).id;
  capital = (await accountByCode(t, "3010")).id;
  const exp = await h.sql<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND type = 'expense' AND is_active ORDER BY code LIMIT 1`,
    [t.company.id]
  );
  rent = exp[0].id;
});

describe("R02-01 / R02-18 exact balance in integer fils", () => {
  it("R02-01: debit 100.01 vs credit 100.00 is 422 ENTRY_UNBALANCED and nothing is stored", async () => {
    const before = await entryCount(t.company.id);
    const r = await post({
      date: today(),
      status: "posted",
      lines: [
        { accountId: cash, debit: 100.01 },
        { accountId: capital, credit: 100.0 },
      ],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("ENTRY_UNBALANCED");
    expect(await entryCount(t.company.id)).toBe(before);
  });

  it("R02-01: the legacy storage.createJournalEntry path is exact too (no 0.01 tolerance)", async () => {
    const { storage } = await import("../../server/storage");
    const before = await entryCount(t.company.id);
    await expect(
      storage.createJournalEntry(
        {
          companyId: t.company.id,
          date: new Date(),
          entryNumber: "ignored",
          status: "posted",
          source: "manual",
          createdBy: t.user.id,
        },
        [
          { accountId: cash, debit: 100.01, credit: 0 },
          { accountId: capital, debit: 0, credit: 100 },
        ]
      )
    ).rejects.toMatchObject({ code: "ENTRY_UNBALANCED", statusCode: 422 });
    expect(await entryCount(t.company.id)).toBe(before);
  });

  it("R02-18: more than 2 decimal places is rejected, not rounded", async () => {
    const r = await post(simple("10.005"));
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("INVALID_AMOUNT");
    expect(r.body.details?.reason).toBe("MONEY_TOO_PRECISE");
  });

  it("R02-18: journals whose aggregate exceeds safe integer precision are refused", async () => {
    const before = await entryCount(t.company.id);
    const lines = Array.from({ length: 9 }, () => [
      { accountId: cash, debit: "9999999999999.99" },
      { accountId: capital, credit: "9999999999999.99" },
    ]).flat();
    lines.push(
      { accountId: cash, debit: "9999999999999.97" },
      { accountId: capital, credit: "9999999999999.97" },
      { accountId: capital, credit: "0.01" }
    );
    const r = await post({ ...simple(1), lines });
    expect(r.status, r.text).toBe(422);
    expect(r.body).toMatchObject({
      code: "INVALID_AMOUNT",
      details: { reason: "MONEY_OUT_OF_RANGE" },
    });
    expect(await entryCount(t.company.id)).toBe(before);
  });

  it("R02-01: a legacy unbalanced entry cannot produce an unbalanced reversal", async () => {
    const [original] = await h.sql<{ id: string }>(
      `INSERT INTO journal_entries (company_id, entry_number, date, source, status, created_by)
       VALUES ($1, 'JE-UNBALANCED-IMPORT', $2, 'manual', 'posted', $3) RETURNING id`,
      [t.company.id, today(), t.user.id]
    );
    await h.sql(
      `INSERT INTO journal_lines (entry_id, account_id, debit, credit)
       VALUES ($1, $2, 100.01, 0), ($1, $3, 0, 100.00)`,
      [original.id, cash, capital]
    );
    const reverse = await t.as.post(`/api/journal/${original.id}/reverse`, {});
    expect(reverse.status, reverse.text).toBe(422);
    expect(reverse.body.code).toBe("ENTRY_UNBALANCED");
    expect(
      await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [original.id])
    ).toHaveLength(0);
    await h.sql(`UPDATE journal_lines SET debit = 100 WHERE entry_id = $1 AND account_id = $2`, [
      original.id,
      cash,
    ]);
  });

  it("R02-18: 1,000 random balanced entries leave a trial-balance difference of exactly 0", async () => {
    const tb = await h.createTenant({ name: "TB" });
    const acc = await h.sql<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND is_active AND NOT is_archived ORDER BY code`,
      [tb.company.id]
    );
    const ids = acc.map((a) => a.id);
    const { postJournal } = await import("../../server/ledger");
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let expected = 0;
    for (let batch = 0; batch < 20; batch++) {
      await Promise.all(
        Array.from({ length: 50 }, async () => {
          const total = 1 + Math.floor(rnd() * 99_999_99); // fils
          const debits = allocate(total, [rnd() + 0.01, rnd() + 0.01, rnd() + 0.01]);
          const credits = allocate(total, [rnd() + 0.01, rnd() + 0.01]);
          expected += total;
          const pick = () => ids[Math.floor(rnd() * ids.length)];
          await postJournal(
            {
              companyId: tb.company.id,
              date: daysAgo(Math.floor(rnd() * 300)),
              status: "posted",
              allowSameAccount: true,
              lines: [
                ...debits.filter((f) => f > 0).map((f) => ({ accountId: pick(), debitFils: f })),
                ...credits.filter((f) => f > 0).map((f) => ({ accountId: pick(), creditFils: f })),
              ],
            },
            // B1 (NC1): random accounts include control accounts; the fixture posts them as
            // explicit control-account adjustments (the kernel refuses them otherwise).
            {
              actorId: tb.user.id,
              controlAdjustment: { reason: "Random trial-balance fixture", role: null },
            }
          );
        })
      );
    }
    const rows = await h.sql<{ d: string; c: string; n: number }>(
      `SELECT SUM(jl.debit)::text AS d, SUM(jl.credit)::text AS c, COUNT(DISTINCT je.id)::int AS n
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted'`,
      [tb.company.id]
    );
    expect(rows[0].n).toBe(1000);
    expect(rows[0].d).toBe(rows[0].c);
    expect(Math.round(Number(rows[0].d) * 100)).toBe(expected);
    const report = await tb.as.get(`/api/companies/${tb.company.id}/reports/trial-balance`);
    expect(report.status, report.text).toBe(200);
    const totals = report.body.totals ?? report.body;
    if (totals?.sumDebits !== undefined) {
      expect(Number(totals.sumDebits)).toBeCloseTo(Number(totals.sumCredits), 6);
    }
  }, 240_000);
});

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("R02-11 period lock concurrency", () => {
  it("a period lock waits for a posting transaction, then blocks new dated postings", async () => {
    const { postJournal } = await import("../../server/ledger");
    const { withLedgerTx } = await import("../../server/ledger/tx");
    const { lockPeriod } = await import("../../server/services/month-end.service");
    const tenant = await h.createTenant({ name: "LockPublication" });
    const [debit, credit] = await Promise.all([
      accountByCode(tenant, "1020"),
      accountByCode(tenant, "3010"),
    ]);
    const companyId = tenant.company.id;
    const date = daysAgo(10);
    const input = {
      companyId,
      date,
      status: "posted" as const,
      lines: [
        { accountId: debit.id, debit: 1 },
        { accountId: credit.id, credit: 1 },
      ],
    };
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const inserted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const posting = withLedgerTx(async (tx) => {
      await postJournal(input, { actorId: tenant.user.id, tx });
      started();
      await held;
    });
    await Promise.race([inserted, posting]);
    const closing = lockPeriod(companyId, date, tenant.user.id);
    try {
      await vi.waitFor(async () => {
        const [waiting] = await h.sql<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory' AND mode = 'ExclusiveLock' AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           ) AS waiting`
        );
        expect(waiting.waiting).toBe(true);
      });
    } finally {
      release();
      await Promise.all([posting, closing]);
    }
    await expect(postJournal(input, { actorId: tenant.user.id })).rejects.toMatchObject({
      code: "PERIOD_LOCKED",
    });
    expect(await entryCount(companyId)).toBe(1);
  });

  it("a draft post checks the edited date after waiting for the draft row", async () => {
    const { pool } = await import("../../server/db");
    const { lockPeriod } = await import("../../server/services/month-end.service");
    const tenant = await h.createTenant({ name: "LockDraftEdit" });
    const [debit, credit] = await Promise.all([
      accountByCode(tenant, "1020"),
      accountByCode(tenant, "3010"),
    ]);
    const date = daysAgo(10);
    const created = await post(
      {
        date: today(),
        status: "draft",
        lines: [
          { accountId: debit.id, debit: 1 },
          { accountId: credit.id, credit: 1 },
        ],
      },
      tenant
    );
    expect(created.status, created.text).toBe(200);
    await lockPeriod(tenant.company.id, date, tenant.user.id);
    const client = await pool.connect();
    let posting: ReturnType<Tenant["as"]["post"]> | undefined;
    try {
      await client.query("BEGIN");
      await client.query("UPDATE journal_entries SET date = $1 WHERE id = $2", [
        date,
        created.body.id,
      ]);
      posting = tenant.as.post(`/api/journal/${created.body.id}/post`, {});
      await vi.waitFor(async () => {
        const [waiting] = await h.sql<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
               AND wait_event_type = 'Lock' AND query LIKE '%"journal_entries"%for update%'
           ) AS waiting`
        );
        expect(waiting.waiting).toBe(true);
      });
      await client.query("COMMIT");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    const result = await posting!;
    expect(result.status, result.text).toBe(403);
    expect(result.body.code).toBe("PERIOD_LOCKED");
  });
});

describe("R02-07 bad input is 4xx with a code, never 500", () => {
  const cases: Array<[string, () => Record<string, unknown>, number, string]> = [
    ["garbage date", () => ({ ...simple(10), date: "garbage" }), 422, "INVALID_DATE"],
    ["impossible date", () => ({ ...simple(10), date: "2025-02-30" }), 422, "INVALID_DATE"],
    ["1e30", () => simple(1e30), 422, "INVALID_AMOUNT"],
    ["Infinity", () => simple("Infinity"), 422, "INVALID_AMOUNT"],
    ["NaN string", () => simple("NaN"), 422, "INVALID_AMOUNT"],
    ["numeric(15,2) overflow", () => simple(99999999999999), 422, "INVALID_AMOUNT"],
    ["future date", () => ({ ...simple(10), date: "2999-01-01" }), 422, "FUTURE_DATE"],
  ];
  for (const [label, body, status, code] of cases) {
    it(`R02-07: ${label} -> ${status} ${code}`, async () => {
      const r = await post(body());
      expect(r.status, r.text).toBe(status);
      expect(r.body.code).toBe(code);
    });
  }

  it("R02-07: zero-amount lines are rejected instead of silently stored", async () => {
    const r = await post({
      date: today(),
      status: "draft",
      lines: [
        { accountId: cash, debit: 50 },
        { accountId: capital, credit: 50 },
        { accountId: rent, debit: 0, credit: 0 },
      ],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("ZERO_AMOUNT_LINE");
  });

  it("R02-07: missing date, unknown fields, server-owned fields and a bad account id are 4xx", async () => {
    const noDate = await post({ status: "posted", lines: simple(1).lines });
    expect(noDate.status).toBe(400);
    const unknown = await post({ ...simple(1), hacked: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("VALIDATION_ERROR");
    const owned = await post({ ...simple(1), companyId: t.company.id });
    expect(owned.status).toBe(400);
    const badAccount = await post({
      ...simple(1),
      lines: [
        { accountId: "not-a-uuid", debit: 1 },
        { accountId: capital, credit: 1 },
      ],
    });
    expect(badAccount.status).toBe(422);
    expect(badAccount.body.code).toBe("ACCOUNT_NOT_FOUND");
    const bothSides = await post({
      ...simple(1),
      lines: [
        { accountId: cash, debit: 1, credit: 1 },
        { accountId: capital, credit: 0 },
      ],
    });
    expect(bothSides.status).toBe(422);
  });
});

describe("R02-04 / R02-12 account guards", () => {
  it("R02-04: posting to an archived account is 422 ACCOUNT_INACTIVE (route and legacy path)", async () => {
    const tenant = await h.createTenant({ name: "Archive" });
    const acc = await accountByCode(tenant, "1020");
    const cap = await accountByCode(tenant, "3010");
    await h.sql(`UPDATE accounts SET is_active = false, is_archived = true WHERE id = $1`, [
      acc.id,
    ]);
    const r = await post(
      {
        date: today(),
        status: "posted",
        lines: [
          { accountId: acc.id, debit: 5 },
          { accountId: cap.id, credit: 5 },
        ],
      },
      tenant
    );
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("ACCOUNT_INACTIVE");
    const { storage } = await import("../../server/storage");
    await expect(
      storage.createJournalEntry(
        {
          companyId: tenant.company.id,
          date: new Date(),
          entryNumber: "x",
          status: "posted",
          source: "invoice",
          createdBy: tenant.user.id,
        },
        [
          { accountId: acc.id, debit: 5, credit: 0 },
          { accountId: cap.id, debit: 0, credit: 5 },
        ]
      )
    ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  });

  it("R02-04: another company's account is 422 ACCOUNT_NOT_FOUND", async () => {
    const other = await h.createSecondTenant();
    const foreign = await accountByCode(other, "1020");
    const r = await post({
      ...simple(5),
      lines: [
        { accountId: foreign.id, debit: 5 },
        { accountId: capital, credit: 5 },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("R02-12: an entry whose every account nets to zero is 422 SAME_ACCOUNT_ENTRY", async () => {
    const r = await post({
      date: today(),
      status: "posted",
      lines: [
        { accountId: cash, debit: 10 },
        { accountId: cash, credit: 10 },
      ],
    });
    expect(r.status, r.text).toBe(422);
    expect(r.body.code).toBe("SAME_ACCOUNT_ENTRY");
  });
});

describe.skipIf(process.env.HARNESS_MODE !== "postgres")("R02-02 / R02-03 concurrency", () => {
  it("R02-02: 4 parallel reverses -> exactly 1 reversal, 3 x 409 ALREADY_REVERSED, books net zero", async () => {
    const tenant = await h.createTenant({ name: "Rev" });
    const a = await accountByCode(tenant, "1020");
    const b = await accountByCode(tenant, "3010");
    const created = await post(
      {
        date: today(),
        status: "posted",
        lines: [
          { accountId: a.id, debit: 250.5 },
          { accountId: b.id, credit: 250.5 },
        ],
      },
      tenant
    );
    expect(created.status, created.text).toBe(200);
    const id = created.body.id;
    const res = await parallel(4, () =>
      tenant.as.post(`/api/journal/${id}/reverse`, { reason: "x" })
    );
    const statuses = res.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    for (const r of res.filter((x) => x.status === 409))
      expect(r.body.code).toBe("ALREADY_REVERSED");
    const reversals = await h.sql(`SELECT id FROM journal_entries WHERE reversed_entry_id = $1`, [
      id,
    ]);
    expect(reversals).toHaveLength(1);
    const again = await tenant.as.post(`/api/journal/${id}/reverse`, {});
    expect(again.status).toBe(409);
    const totals = await h.sql<{ net: string }>(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::text AS net
         FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.company_id = $1 AND je.status = 'posted' AND jl.account_id = $2`,
      [tenant.company.id, a.id]
    );
    expect(Number(totals[0].net)).toBe(0);
  });

  it("R02-02: reverseEntry / voidEntry from the kernel cannot double-reverse concurrently either", async () => {
    const { postJournal, reverseEntry, voidEntry } = await import("../../server/ledger");
    const { entry } = await postJournal(
      {
        companyId: t.company.id,
        date: today(),
        status: "posted",
        lines: [
          { accountId: cash, debit: "12.34" },
          { accountId: capital, credit: "12.34" },
        ],
      },
      { actorId: t.user.id }
    );
    const results = await Promise.allSettled([
      reverseEntry(entry.id, { reason: "a" }, { actorId: t.user.id }),
      voidEntry(entry.id, { reason: "b" }, { actorId: t.user.id }),
      reverseEntry(entry.id, {}, { actorId: t.user.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason.code).toBe("ALREADY_REVERSED");
    }
  });

  it("R02-03: 10 parallel posts of one draft -> 1 success, 9 x 409, exactly 1 audit row", async () => {
    const d = await post({ ...simple(77), status: "draft" });
    expect(d.status, d.text).toBe(200);
    const id = d.body.id;
    const res = await parallel(10, () => t.as.post(`/api/journal/${id}/post`, {}));
    const ok = res.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("ENTRY_NOT_DRAFT");
    }
    const audits = await h.sql(
      `SELECT id FROM audit_logs WHERE action = 'journal.post' AND resource_id = $1`,
      [id]
    );
    expect(audits).toHaveLength(1);
  });
});

describe("R02-08 / R02-09 / R02-16a reversal semantics", () => {
  let costCenter: string;
  beforeAll(async () => {
    const rows = await h.sql<{ id: string }>(
      `INSERT INTO cost_centers (company_id, code, name) VALUES ($1, 'CC1', 'Ops') RETURNING id`,
      [t.company.id]
    );
    costCenter = rows[0].id;
  });

  it("R02-08: reversal mirrors cost centre, foreign amounts and rate; default date = original date", async () => {
    const date = daysAgo(3);
    const created = await post({
      date,
      status: "posted",
      lines: [
        {
          accountId: rent,
          debit: "367.25",
          costCenterId: costCenter,
          foreignCurrency: "USD",
          foreignDebit: "100.00",
          exchangeRate: "3.6725",
        },
        {
          accountId: cash,
          credit: "367.25",
          foreignCurrency: "USD",
          foreignCredit: "100.00",
          exchangeRate: "3.6725",
        },
      ],
    });
    expect(created.status, created.text).toBe(200);
    const rev = await t.as.post(`/api/journal/${created.body.id}/reverse`, { reason: "fix" });
    expect(rev.status, rev.text).toBe(200);
    const lines = await h.sql<Record<string, string | null>>(
      `SELECT account_id, cost_center_id, debit::text, credit::text, foreign_currency,
              foreign_debit::text, foreign_credit::text, exchange_rate::text
         FROM journal_lines WHERE entry_id = $1 ORDER BY account_id`,
      [rev.body.reversalId]
    );
    const rentLine = lines.find((l) => l.account_id === rent)!;
    expect(rentLine).toMatchObject({
      cost_center_id: costCenter,
      debit: "0.00",
      credit: "367.25",
      foreign_currency: "USD",
      foreign_debit: "0.00",
      foreign_credit: "100.00",
      exchange_rate: "3.672500",
    });
    const cashLine = lines.find((l) => l.account_id === cash)!;
    expect(cashLine).toMatchObject({ debit: "367.25", foreign_debit: "100.00" });
    const dates = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
      [rev.body.reversalId]
    );
    expect(dates[0].d).toBe(date);
    // Cost-centre P&L nets to zero for the pair.
    const cc = await h.sql<{ net: string }>(
      `SELECT SUM(debit - credit)::text AS net FROM journal_lines WHERE cost_center_id = $1`,
      [costCenter]
    );
    expect(Number(cc[0].net)).toBe(0);
  });

  it("R02-08: a caller-chosen reversal date is used; a date before the original is 422", async () => {
    const created = await post({ ...simple(20), date: daysAgo(10) });
    const early = await t.as.post(`/api/journal/${created.body.id}/reverse`, { date: daysAgo(11) });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe("REVERSAL_BEFORE_ORIGINAL");
    const chosen = await t.as.post(`/api/journal/${created.body.id}/reverse`, { date: daysAgo(2) });
    expect(chosen.status, chosen.text).toBe(200);
    const d = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
      [chosen.body.reversalId]
    );
    expect(d[0].d).toBe(daysAgo(2));
  });

  it("R02-08: when the original's period is locked the reversal defaults to today", async () => {
    const tenant = await h.createTenant({ name: "Locked" });
    const a = await accountByCode(tenant, "1020");
    const b = await accountByCode(tenant, "3010");
    const old = new Date();
    old.setUTCMonth(old.getUTCMonth() - 2, 10);
    const oldIso = old.toISOString().slice(0, 10);
    const created = await post(
      {
        date: oldIso,
        status: "posted",
        lines: [
          { accountId: a.id, debit: 9 },
          { accountId: b.id, credit: 9 },
        ],
      },
      tenant
    );
    expect(created.status, created.text).toBe(200);
    const monthEnd = new Date(Date.UTC(old.getUTCFullYear(), old.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    await h.sql(
      `INSERT INTO month_end_close (company_id, period_end, status) VALUES ($1, $2::date, 'locked')`,
      [tenant.company.id, monthEnd]
    );
    const rev = await tenant.as.post(`/api/journal/${created.body.id}/reverse`, {});
    expect(rev.status, rev.text).toBe(200);
    const d = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
      [rev.body.reversalId]
    );
    expect(d[0].d).toBe(today());
    // New postings into the locked month are refused.
    const other = await post(
      {
        date: oldIso,
        status: "posted",
        lines: [
          { accountId: a.id, debit: 1 },
          { accountId: b.id, credit: 1 },
        ],
      },
      tenant
    );
    expect(other.status).toBe(403);
  });

  it("R02-09: GET shows reversal state on BOTH entries and returns `source`", async () => {
    const created = await post(simple(31));
    const rev = await t.as.post(`/api/journal/${created.body.id}/reverse`, {});
    expect(rev.status).toBe(200);
    const original = await t.as.get(`/api/journal/${created.body.id}`);
    expect(original.body).toMatchObject({
      reversedByEntryId: rev.body.reversalId,
      reversalOf: null,
      lifecycleStatus: "reversed",
      status: "posted",
      source: "manual",
    });
    expect(original.body.reversedByEntry.entryNumber).toBe(rev.body.reversalNumber);
    expect(original.body.lines[0].account.code).toBeTruthy();
    const reversal = await t.as.get(`/api/journal/${rev.body.reversalId}`);
    expect(reversal.body).toMatchObject({
      reversalOf: created.body.id,
      reversedByEntryId: null,
      lifecycleStatus: "posted",
      entryKind: "reversal",
      source: "reversal",
    });
    expect(reversal.body.reversalOfEntry.id).toBe(created.body.id);
    // A reversal cannot itself be reversed.
    const chain = await t.as.post(`/api/journal/${rev.body.reversalId}/reverse`, {});
    expect(chain.status).toBe(409);
    expect(chain.body.code).toBe("ENTRY_IS_REVERSAL");
  });

  it("R02-16a: void posts a reversal on the original date and labels the original voided", async () => {
    const created = await post({ ...simple(45), date: daysAgo(5) });
    const v = await t.as.post(`/api/journal/${created.body.id}/void`, { reason: "duplicate" });
    expect(v.status, v.text).toBe(200);
    const original = await t.as.get(`/api/journal/${created.body.id}`);
    expect(original.body.lifecycleStatus).toBe("voided");
    expect(original.body.reversalKind).toBe("voided");
    const d = await h.sql<{ d: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM journal_entries WHERE id = $1`,
      [v.body.reversalId]
    );
    expect(d[0].d).toBe(daysAgo(5));
    const again = await t.as.post(`/api/journal/${created.body.id}/void`, {});
    expect(again.status).toBe(409);
  });

  it("R02-16a: reverseBySource reverses every unreversed posted entry of a document once", async () => {
    const { postJournal, reverseBySource } = await import("../../server/ledger");
    const doc = "6c1d6a3e-1b1f-4f39-9d37-1d2c3b4a5f60";
    for (const amt of ["10.00", "2.50"]) {
      await postJournal(
        {
          companyId: t.company.id,
          date: today(),
          status: "posted",
          source: "invoice",
          sourceId: doc,
          lines: [
            { accountId: cash, debit: amt },
            { accountId: capital, credit: amt },
          ],
        },
        { actorId: t.user.id }
      );
    }
    const first = await reverseBySource(
      t.company.id,
      "invoice",
      doc,
      { reason: "void" },
      {
        actorId: t.user.id,
      }
    );
    expect(first).toHaveLength(2);
    const second = await reverseBySource(t.company.id, "invoice", doc, {}, { actorId: t.user.id });
    expect(second).toHaveLength(0);
  });

  it("R02-02: a legacy full reversal through storage.createJournalEntry links the original once", async () => {
    const { storage } = await import("../../server/storage");
    const created = await post(simple(60));
    const legacy = (amount: number) =>
      storage.createJournalEntry(
        {
          companyId: t.company.id,
          date: new Date(),
          entryNumber: "x",
          status: "posted",
          source: "invoice",
          reversedEntryId: created.body.id,
          createdBy: t.user.id,
        },
        [
          { accountId: cash, debit: 0, credit: amount },
          { accountId: capital, debit: amount, credit: 0 },
        ]
      );
    // A partial (credit note) keeps only the reference and can repeat.
    await legacy(10);
    await legacy(10);
    const original = await t.as.get(`/api/journal/${created.body.id}`);
    expect(original.body.reversedByEntryId).toBeNull();
    // A partial does not block a later full reversal of the remaining amount... but a
    // full mirror does link and blocks any second full reversal.
    const t2 = await post(simple(70));
    const full = () =>
      storage.createJournalEntry(
        {
          companyId: t.company.id,
          date: new Date(),
          entryNumber: "x",
          status: "posted",
          source: "invoice",
          reversedEntryId: t2.body.id,
          createdBy: t.user.id,
        },
        [
          { accountId: cash, debit: 0, credit: 70 },
          { accountId: capital, debit: 70, credit: 0 },
        ]
      );
    const rev = await full();
    expect(rev.entryKind).toBe("reversal");
    await expect(full()).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
    const o2 = await t.as.get(`/api/journal/${t2.body.id}`);
    expect(o2.body.reversedByEntryId).toBe(rev.id);
  });
});

describe("idempotency", () => {
  it("R02-16a: an idempotency key replay returns the same entry (also concurrently)", async () => {
    const key = `idem-${Date.now()}`;
    const res = await parallel(5, () => post({ ...simple(15), idempotencyKey: key }));
    for (const r of res) expect(r.status, r.text).toBe(200);
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(res.filter((r) => r.body.replayed === false)).toHaveLength(1);
    const rows = await h.sql(
      `SELECT id FROM journal_entries WHERE company_id = $1 AND idempotency_key = $2`,
      [t.company.id, key]
    );
    expect(rows).toHaveLength(1);
  });
});

describe("R02-16a maker-checker, templates, attachments, cursor", () => {
  it("R02-16a: entries above the threshold need a different approver", async () => {
    const tenant = await h.createTenant({ name: "Maker" });
    const checker = await h.createTenant({ name: "Checker" });
    await h.sql(
      `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'accountant')`,
      [tenant.company.id, checker.user.id]
    );
    const a = await accountByCode(tenant, "1020");
    const b = await accountByCode(tenant, "3010");
    const set = await tenant.as.put(`/api/companies/${tenant.company.id}/journal/settings`, {
      manualApprovalThreshold: "1000.00",
    });
    expect(set.status, set.text).toBe(200);
    const body = (amt: number) => ({
      date: today(),
      status: "posted",
      lines: [
        { accountId: a.id, debit: amt },
        { accountId: b.id, credit: amt },
      ],
    });
    const small = await post(body(999), tenant);
    expect(small.status).toBe(200);
    expect(small.body.status).toBe("posted");
    const big = await post(body(5000), tenant);
    expect(big.status, big.text).toBe(202);
    expect(big.body).toMatchObject({ status: "draft", approvalStatus: "pending" });
    const selfPost = await tenant.as.post(`/api/journal/${big.body.id}/post`, {});
    expect(selfPost.status).toBe(202);
    expect(selfPost.body.code).toBe("APPROVAL_REQUIRED");
    const selfApprove = await tenant.as.post(`/api/journal/${big.body.id}/approve`, {});
    expect(selfApprove.status).toBe(403);
    const approved = await checker.as.post(`/api/journal/${big.body.id}/approve`, {});
    expect(approved.status, approved.text).toBe(200);
    expect(approved.body).toMatchObject({ status: "posted", approvalStatus: "approved" });
    const row = await h.sql<{ approved_by: string }>(
      `SELECT approved_by FROM journal_entries WHERE id = $1`,
      [big.body.id]
    );
    expect(row[0].approved_by).toBe(checker.user.id);
  });

  it("R02-16a: recurring templates post once per date through the job, auto-reversing entries reverse", async () => {
    const tenant = await h.createTenant({ name: "Tpl" });
    const a = await accountByCode(tenant, "1020");
    const b = await accountByCode(tenant, "3010");
    const created = await tenant.as.post(`/api/companies/${tenant.company.id}/journal-templates`, {
      name: "Monthly accrual",
      frequency: "monthly",
      nextRunOn: daysAgo(3),
      autoReverseDays: 1,
      lines: [
        { accountId: a.id, debit: "300.00" },
        { accountId: b.id, credit: "300.00" },
      ],
    });
    expect(created.status, created.text).toBe(201);
    const { runDueJournalTemplates, runDueAutoReversals, registerLedgerJobs } =
      await import("../../server/ledger/templates");
    const { listJobs } = await import("../../server/platform/job-registry");
    registerLedgerJobs();
    const names = listJobs().map((j) => j.name);
    expect(names).toContain("ledger.recurringJournals");
    expect(names).toContain("ledger.autoReverse");
    expect(await runDueJournalTemplates()).toBe(1);
    expect(await runDueJournalTemplates()).toBe(0);
    const entries = await h.sql<{ id: string; auto: string }>(
      `SELECT id, to_char(auto_reverse_on, 'YYYY-MM-DD') AS auto FROM journal_entries
        WHERE company_id = $1 AND source = 'journal_template'`,
      [tenant.company.id]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].auto).toBe(daysAgo(2));
    const tpl = await tenant.as.get(`/api/companies/${tenant.company.id}/journal-templates`);
    expect(tpl.body[0].nextRunOn > daysAgo(3)).toBe(true);
    // Manual "run" for the same date is idempotent.
    const rerun = await tenant.as.post(`/api/journal-templates/${created.body.id}/run`, {
      date: daysAgo(3),
    });
    expect(rerun.status, rerun.text).toBe(200);
    expect(rerun.body.replayed).toBe(true);
    expect(await runDueAutoReversals()).toBeGreaterThanOrEqual(1);
    const rev = await h.sql<{ reversed_by_entry_id: string | null }>(
      `SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1`,
      [entries[0].id]
    );
    expect(rev[0].reversed_by_entry_id).toBeTruthy();
    expect(await ledgerTotals(tenant.company.id)).toEqual({ debit: 600, credit: 600 });
  });

  it("R02-16a: manual accruals carry autoReverseOn (must be after the entry date)", async () => {
    const bad = await post({ ...simple(5), autoReverseOn: daysAgo(1) });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("INVALID_AUTO_REVERSE_DATE");
  });

  it("R02-16a: attachments upload, list, download and delete", async () => {
    const created = await post(simple(8));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    const up = await t.as.post(`/api/journal/${created.body.id}/attachments`, {
      fileName: "receipt.png",
      data: png.toString("base64"),
    });
    expect(up.status, up.text).toBe(201);
    const list = await t.as.get(`/api/journal/${created.body.id}/attachments`);
    expect(list.body).toHaveLength(1);
    const file = await t.as.get(`/api/journal/${created.body.id}/attachments/${up.body.id}`);
    expect(file.status).toBe(200);
    const other = await h.createSecondTenant();
    const leak = await other.as.get(`/api/journal/${created.body.id}/attachments/${up.body.id}`);
    expect([403, 404]).toContain(leak.status);
    const del = await t.as.delete(`/api/journal/${created.body.id}/attachments/${up.body.id}`);
    expect(del.status).toBe(200);
  });

  it("R02-16a: cursor pagination walks the whole list without duplicates", async () => {
    const tenant = await h.createTenant({ name: "Page" });
    const a = await accountByCode(tenant, "1020");
    const b = await accountByCode(tenant, "3010");
    for (let i = 0; i < 7; i++) {
      await post(
        {
          date: daysAgo(i % 3),
          status: "posted",
          lines: [
            { accountId: a.id, debit: i + 1 },
            { accountId: b.id, credit: i + 1 },
          ],
        },
        tenant
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const url = `/api/companies/${tenant.company.id}/journal?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await tenant.as.get(url);
      expect(r.status, r.text).toBe(200);
      seen.push(...r.body.map((e: { id: string }) => e.id));
      cursor = r.headers.get("x-next-cursor") ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const bad = await tenant.as.get(`/api/companies/${tenant.company.id}/journal?cursor=zzz`);
    expect(bad.status).toBe(400);
  });
});

describe("migration 0090", () => {
  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "applies over a database that already holds a duplicate reversal and records findings",
    async () => {
      const tenant = await h.createTenant({ name: "Mig" });
      const a = await accountByCode(tenant, "1020");
      const b = await accountByCode(tenant, "3010");
      const created = await post(
        {
          date: today(),
          status: "posted",
          lines: [
            { accountId: a.id, debit: 40 },
            { accountId: b.id, credit: 40 },
          ],
        },
        tenant
      );
      // Simulate pre-kernel books: no index, two reversals of one entry, one
      // unbalanced entry, nothing linked yet.
      await h.sql(`DROP INDEX IF EXISTS uq_journal_entries_one_reversal`);
      const dupIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const rows = await h.sql<{ id: string }>(
          `INSERT INTO journal_entries (company_id, entry_number, date, status, source, source_id,
                                        reversed_entry_id, created_by, entry_kind)
           VALUES ($1, $2, now(), 'posted', 'reversal', $3, $3, $4, 'standard') RETURNING id`,
          [tenant.company.id, `JE-LEGACY-${i}`, created.body.id, tenant.user.id]
        );
        dupIds.push(rows[0].id);
        await h.sql(
          `INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, 0, 40), ($1, $3, 40, 0)`,
          [rows[0].id, a.id, b.id]
        );
      }
      const unbalanced = await h.sql<{ id: string }>(
        `INSERT INTO journal_entries (company_id, entry_number, date, status, source, created_by)
         VALUES ($1, 'JE-LEGACY-UNBAL', now(), 'posted', 'manual', $2) RETURNING id`,
        [tenant.company.id, tenant.user.id]
      );
      await h.sql(
        `INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, 100.01, 0), ($1, $3, 0, 100.00)`,
        [unbalanced[0].id, a.id, b.id]
      );
      const sqlText = fs.readFileSync(
        path.join(process.cwd(), "migrations/0090_w2a_ledger_kernel.sql"),
        "utf8"
      );
      await h.sql(sqlText);
      await h.sql(sqlText); // idempotent
      const flags = await h.sql<{ id: string; is_duplicate_reversal: boolean; entry_kind: string }>(
        `SELECT id, is_duplicate_reversal, entry_kind FROM journal_entries WHERE id = ANY($1::uuid[]) ORDER BY entry_number`,
        [dupIds]
      );
      expect(flags.map((f) => f.entry_kind)).toEqual(["reversal", "reversal"]);
      expect(flags.map((f) => f.is_duplicate_reversal)).toEqual([false, true]);
      const findings = await h.sql<{ kind: string; entry_id: string }>(
        `SELECT kind, entry_id FROM ledger_repair_findings WHERE company_id = $1 ORDER BY kind`,
        [tenant.company.id]
      );
      expect(findings).toEqual([
        { kind: "duplicate_reversal", entry_id: dupIds[1] },
        { kind: "unbalanced_entry", entry_id: unbalanced[0].id },
      ]);
      const idx = await h.sql(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'uq_journal_entries_one_reversal'`
      );
      expect(idx).toHaveLength(1);
      const orig = await h.sql<{ reversed_by_entry_id: string }>(
        `SELECT reversed_by_entry_id FROM journal_entries WHERE id = $1`,
        [created.body.id]
      );
      expect(orig[0].reversed_by_entry_id).toBe(dupIds[0]);
      // Posted amounts were not touched.
      const amounts = await h.sql<{ d: string }>(
        `SELECT SUM(debit)::text AS d FROM journal_lines WHERE entry_id = $1`,
        [unbalanced[0].id]
      );
      expect(amounts[0].d).toBe("100.01");
      // And the kernel now refuses a third reversal.
      const third = await tenant.as.post(`/api/journal/${created.body.id}/reverse`, {});
      expect(third.status).toBe(409);
    }
  );
});

void pg;
