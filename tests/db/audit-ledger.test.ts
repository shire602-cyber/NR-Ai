import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { accountByCode, postJournalEntry, useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const base = (tenant: Tenant) => `/api/companies/${tenant.company.id}`;

async function setPrefix(t: Tenant, docType: "invoice" | "cash_sale", prefix: string) {
  const result = await t.as.put(`${base(t)}/numbering/${docType}`, {
    prefix,
    padding: 5,
    yearlyReset: true,
  });
  expect(result.status, result.text).toBe(200);
}

it("CASH-SERIES: a change of prefix also reserves numbers printed in prior open years", async () => {
  const t = await h.createTenant();
  const year = new Date().getUTCFullYear() - 1;
  const date = `${year}-04-12`;
  const doc = {
    date,
    customerName: "Retail customer",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Sale", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
  };
  await setPrefix(t, "invoice", "POS");
  const original = await t.as.post(`${base(t)}/invoices`, doc);
  expect(original.status, original.text).toBe(200);
  expect(original.body.number).toBe(`POS-${year}-00001`);
  await setPrefix(t, "invoice", "INV");
  await setPrefix(t, "cash_sale", "POS");

  const bank = await t.as.post(`${base(t)}/bank-accounts`, { nameEn: "Bank", bankName: "Bank" });
  expect(bank.status, bank.text).toBe(201);
  const sale = await t.as.post(`${base(t)}/cash-sales`, {
    ...doc,
    paymentAccountId: bank.body.glAccountId,
  });
  expect(sale.status, sale.text).toBe(201);
  expect(sale.body.number).toBe(`POS-${year}-00002`);
});

it("CASH-SERIES: forward repair resolves an already-applied 0130 collision and reserves printed numbers", async () => {
  const t = await h.createTenant();
  const date = new Date("2025-04-12T00:00:00Z");
  const { allocateInvoiceNumber, peekNextInvoiceNumber } =
    await import("../../server/services/invoice-numbering.service");
  const doc = {
    date: "2025-04-12",
    customerName: "Imported customer",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Sale", quantity: 1, unitPrice: 100, vatRate: 0.05 }],
  };
  for (const number of ["CSL-2025-00012", "CSL3-2025-00020"]) {
    const imported = await t.as.post(`${base(t)}/invoices`, doc);
    expect(imported.status, imported.text).toBe(200);
    await h.sql("UPDATE invoices SET number = $1 WHERE id = $2", [number, imported.body.id]);
  }
  // Both were valid settings before cash sales had their own document type.
  await h.sql(
    `INSERT INTO document_numbering_settings (company_id, doc_type, prefix, yearly_reset)
     VALUES ($1, 'quote', 'CS', true), ($1, 'invoice', 'CSL', true),
            ($1, 'debit_note', 'CSL2-2025', false)`,
    [t.company.id]
  );
  async function applyMigration(file: string) {
    const migration = readFileSync(path.join(repoRoot, "migrations", file), "utf8");
    for (const stmt of migration.split("--> statement-breakpoint")) await h.sql(stmt);
  }
  await applyMigration("0130_cash_sale_numbering.sql");
  expect(await peekNextInvoiceNumber(t.company.id, "cash_sale", date)).toBe("CSL-2025-00013");
  const repair = "0157_preserve_period_locks_and_repair_cash_sale_numbering.sql";
  await applyMigration(repair);
  await applyMigration(repair);
  expect(await allocateInvoiceNumber(t.company.id, "cash_sale", date)).toBe("CSL3-2025-00021");
  expect(await allocateInvoiceNumber(t.company.id, "invoice", date)).toBe("CSL-2025-00013");
  const result = await t.as.get(`${base(t)}/numbering`);
  expect(result.status, result.text).toBe(200);
  const settings = result.body.numbering as { docType: string; nextFormatted: string }[];
  const cash = settings.find((row) => row.docType === "cash_sale")!;
  expect(
    settings.filter((row) => row.docType !== "cash_sale").map((row) => row.nextFormatted)
  ).not.toContain(cash.nextFormatted);
});

it("CASH-SERIES: rejects a continuous prefix that overlaps yearly numbers before the first allocation", async () => {
  const t = await h.createTenant();
  const url = `${base(t)}/numbering/cash_sale`;
  const response = await t.as.put(url, { prefix: "INV-2026", padding: 5, yearlyReset: false });
  expect(response.status, response.text).toBe(409);
  expect(response.body.code).toBe("NUMBERING_PREFIX_IN_USE");
  const accepted = await t.as.put(url, { prefix: "POS-2026", padding: 5, yearlyReset: false });
  expect(accepted.status, accepted.text).toBe(200);

  const { allocateInvoiceNumber } = await import("../../server/services/invoice-numbering.service");
  const date = new Date("2026-04-12T00:00:00Z");
  expect(await allocateInvoiceNumber(t.company.id, "invoice", date)).toBe("INV-2026-00001");
  expect(await allocateInvoiceNumber(t.company.id, "cash_sale", date)).toBe("POS-2026-00001");
});

it("CLOSE: a retry after a fiscal close record write fails sweeps earnings only once", async () => {
  const t = await h.createTenant();
  const close = await import("../../server/services/month-end.service");
  await postJournalEntry(t, {
    date: "2025-02-04",
    description: "Cash revenue",
    lines: [
      { code: "1020", debit: 100 },
      { code: "4020", credit: 100 },
    ],
  });
  await close.updateCloseSettings(t.company.id, { postYearEndClosingEntry: true }, t.user.id);
  // Simulate a database write failure between recording the journal and recording the close.
  await h.sql(`ALTER TABLE fiscal_year_closes ADD CONSTRAINT audit_close_failure CHECK
    (reason IS DISTINCT FROM 'audit-write-failure')`);
  try {
    await expect(
      close.closeFiscalYear(t.company.id, "2025-12-31", t.user.id, {
        reason: "audit-write-failure",
      })
    ).rejects.toThrow();
  } finally {
    await h.sql("ALTER TABLE fiscal_year_closes DROP CONSTRAINT audit_close_failure");
  }
  await close.closeFiscalYear(t.company.id, "2025-12-31", t.user.id);
  const [posted] = await h.sql(
    `SELECT COUNT(*)::int AS entries, SUM(jl.credit - jl.debit)::text AS retained
     FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
     JOIN accounts a ON a.id = jl.account_id
     WHERE je.company_id = $1 AND je.source = 'year_end_close' AND a.code = '3020'`,
    [t.company.id]
  );
  expect(posted).toEqual({ entries: 1, retained: "100.00" });
});

it("CLOSE: the first half-hour of an open UAE month can be posted after last month is locked", async () => {
  const t = await h.createTenant();
  const { lockPeriod } = await import("../../server/services/month-end.service");
  await lockPeriod(t.company.id, "2025-07-31", t.user.id);
  const cash = await accountByCode(t, "1020");
  const capital = await accountByCode(t, "3010");
  const { postJournal } = await import("../../server/ledger");
  const result = await postJournal(
    {
      companyId: t.company.id,
      date: new Date("2025-08-01T00:30:00+04:00"),
      status: "posted",
      lines: [
        { accountId: cash.id, debit: 100 },
        { accountId: capital.id, credit: 100 },
      ],
    },
    { actorId: t.user.id }
  );
  const [row] = await h.sql(
    `SELECT (date + INTERVAL '4 hours')::date::text AS report_day FROM journal_entries WHERE id = $1`,
    [result.entry.id]
  );
  expect(row.report_day).toBe("2025-08-01");
});

it("LEDGER: a one-fil difference cannot survive a posted journal with high gross turnover", async () => {
  const t = await h.createTenant();
  const cash = await accountByCode(t, "1020");
  const capital = await accountByCode(t, "3010");
  const { postJournal } = await import("../../server/ledger");
  const pairs = Array.from({ length: 10 }, () => [
    { accountId: cash.id, debit: "9999999999999.98" },
    { accountId: capital.id, credit: "9999999999999.98" },
  ]).flat();
  // Each line fits numeric(15,2). SQL performs the independent total in decimal arithmetic.
  const memo = "Audit gross journal";
  let rejected = false;
  try {
    await postJournal(
      {
        companyId: t.company.id,
        date: "2025-09-01",
        status: "posted",
        memo,
        lines: [...pairs, { accountId: cash.id, debit: "0.01" }],
      },
      { actorId: t.user.id }
    );
  } catch (error) {
    expect(error).toMatchObject({ statusCode: 422 });
    rejected = true;
  }
  const [row] = await h.sql(
    `SELECT count(DISTINCT je.id)::int AS entries, COALESCE(SUM(jl.debit - jl.credit), 0)::text AS difference
     FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
     WHERE je.company_id = $1 AND je.memo = $2 AND je.status = 'posted'`,
    [t.company.id, memo]
  );
  expect({ rejected, entries: row.entries, difference: Number(row.difference) }).toEqual({
    rejected: true,
    entries: 0,
    difference: 0,
  });
});

it("CLOSE: the default year-end close preserves a hard December month-end close", async () => {
  const t = await h.createTenant();
  const { lockPeriod, closeFiscalYear } = await import("../../server/services/month-end.service");
  const { getEffectiveLock } = await import("../../server/services/period-lock.service");
  await lockPeriod(t.company.id, "2025-12-31", t.user.id, { lockType: "hard", lockScope: "month" });
  expect(await getEffectiveLock(t.company.id, "2025-12-15")).toMatchObject({ lockType: "hard" });
  await closeFiscalYear(t.company.id, "2025-12-31", t.user.id);
  // The year was soft-closed. The existing December close still has its own stronger policy.
  expect(await getEffectiveLock(t.company.id, "2025-06-15")).toMatchObject({ lockType: "soft" });
  expect(await getEffectiveLock(t.company.id, "2025-12-15")).toMatchObject({ lockType: "hard" });
});

it.each([
  { lockScope: "through", hardClose: false },
  { lockScope: "month", hardClose: true },
] as const)(
  "CLOSE: fiscal close (hard=$hardClose) and reopen preserve an independent hard $lockScope lock",
  async ({ lockScope, hardClose }) => {
    const t = await h.createTenant();
    const {
      lockPeriod,
      closeFiscalYear,
      reopenFiscalYear,
      listLockedPeriods,
      updateCloseSettings,
    } = await import("../../server/services/month-end.service");
    const { getEffectiveLock } = await import("../../server/services/period-lock.service");
    const { postJournal } = await import("../../server/ledger");
    const yearEnd = "2025-12-31";
    const december = "2025-12-15";
    const june = "2025-06-15";
    await postJournalEntry(t, {
      date: june,
      description: "Cash revenue",
      lines: [
        { code: "1020", debit: 100 },
        { code: "4020", credit: 100 },
      ],
    });
    await updateCloseSettings(t.company.id, { postYearEndClosingEntry: true }, t.user.id);
    const cash = await accountByCode(t, "1020");
    const capital = await accountByCode(t, "3010");
    const postOrdinaryJournal = () =>
      postJournal(
        {
          companyId: t.company.id,
          date: yearEnd,
          status: "posted",
          lines: [
            { accountId: cash.id, debit: 100 },
            { accountId: capital.id, credit: 100 },
          ],
        },
        { actorId: t.user.id }
      );
    await lockPeriod(
      t.company.id,
      yearEnd,
      t.user.id,
      lockScope === "through" ? {} : { lockScope }
    );
    const independent = await listLockedPeriods(t.company.id);
    expect(independent).toHaveLength(1);
    const closed = await closeFiscalYear(t.company.id, yearEnd, t.user.id, { hardClose });
    expect(closed.posted).toBe(true);
    expect(closed.closingEntryId).toBeTruthy();
    await expect(postOrdinaryJournal()).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    expect(await getEffectiveLock(t.company.id, june)).toMatchObject({
      lockType: "hard",
      lockScope: "through",
    });
    expect(await listLockedPeriods(t.company.id)).toEqual(independent);
    await reopenFiscalYear(t.company.id, yearEnd, t.user.id, "Restatement approved", {
      canReopenHardClose: true,
    });
    await expect(postOrdinaryJournal()).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    const journals = await h.sql(
      `SELECT je.id, je.source_id, SUM(jl.credit - jl.debit)::float8 AS retained
         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.source = 'year_end_close'
          AND je.entry_kind = 'year_end_close' AND je.status = 'posted' AND a.code = '3020'
        GROUP BY je.id`,
      [t.company.id]
    );
    expect(journals).toHaveLength(2);
    expect(journals).toEqual(
      expect.arrayContaining([
        { id: closed.closingEntryId, source_id: null, retained: 100 },
        { id: expect.any(String), source_id: closed.closingEntryId, retained: -100 },
      ])
    );
    expect(await listLockedPeriods(t.company.id)).toEqual(independent);
    expect(await getEffectiveLock(t.company.id, december)).toMatchObject({
      lockType: "hard",
      lockScope,
    });
    if (lockScope === "month") expect(await getEffectiveLock(t.company.id, june)).toBeNull();
  }
);
