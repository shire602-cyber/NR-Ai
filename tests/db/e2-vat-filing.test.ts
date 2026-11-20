/**
 * E2 (J3-r2): the VAT filing flow on the Returns side. A return marked ready is recorded as filed
 * with the EmaraTax reference and filing date, then its payment (or refund) is recorded through
 * the settlement seam; the return's payment fields, the calendar and the ledger agree, and a
 * reversal returns it to unpaid. Payment status is not hand-editable.
 */
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type Tenant } from "./harness";

const h = useHarness();

async function vatTenant(columns: Record<string, unknown> = {}) {
  return h.createTenant({
    companyColumns: {
      trn_vat_number: "100000000000003",
      emirate: "dubai",
      vat_filing_frequency: "Quarterly",
      vat_period_start_month: 1,
      ...columns,
    },
  });
}

const base = (t: Tenant) => `/api/companies/${t.company.id}`;

async function activity(t: Tenant, sales: number, purchases: number) {
  const inv = await t.as.post(`${base(t)}/invoices`, {
    customerName: "Acme LLC",
    customerTrn: "100000000000011",
    date: "2026-02-01",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Job", quantity: 1, unitPrice: sales, vatRate: 5 }],
  });
  expect(inv.status, inv.text).toBe(200);
  const sent = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
  expect(sent.status, sent.text).toBe(200);
  const bill = await t.as.post(`${base(t)}/bills`, {
    vendor_name: "Supplier LLC",
    vendor_trn: "100000000000029",
    bill_number: `B-E2-${purchases}`,
    bill_date: "2026-03-10",
    due_date: "2026-12-31",
    line_items: [{ description: "Supplies", quantity: 1, unit_price: purchases, vat_rate: 5 }],
  });
  expect(bill.status, bill.text).toBe(200);
  const ap = await t.as.post(`/api/bills/${bill.body.id}/approve`, {});
  expect(ap.status, ap.text).toBe(200);
}

async function draftReturn(t: Tenant) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, {
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  });
  expect(gen.status, gen.text).toBe(201);
  return gen.body.id as string;
}

async function readyReturn(t: Tenant) {
  const id = await draftReturn(t);
  const ready = await t.as.post(`/api/vat-returns/${id}/ready`, {});
  expect(ready.status, ready.text).toBe(200);
  expect(ready.body.status).toBe("ready");
  return id;
}

async function addMember(t: Tenant, role: string, name: string): Promise<Tenant> {
  const m = await h.createSecondTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    m.user.id,
    role,
  ]);
  return m;
}

async function returnRow(t: Tenant, id: string) {
  const r = await t.as.get(`/api/vat-returns/${id}`);
  expect(r.status, r.text).toBe(200);
  return r.body;
}

describe("E2 (J3-r2) VAT return: ready -> filed -> paid", () => {
  it("records the filing with the EmaraTax reference and date, then the payment, then reverses it", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const submit = (body: object) => t.as.post(`/api/vat-returns/${id}/submit`, body);

    // The filing date is never in the future, never inside the period, and needs a reference.
    const future = await submit({ ftaReferenceNumber: "ET-1", filedOn: "2027-06-01" });
    expect(future.status, future.text).toBe(422);
    expect(future.body.code).toBe("VAT_FILED_ON_FUTURE");
    const inPeriod = await submit({ ftaReferenceNumber: "ET-1", filedOn: "2026-03-31" });
    expect(inPeriod.status, inPeriod.text).toBe(422);
    expect(inPeriod.body.code).toBe("VAT_FILED_ON_IN_PERIOD");
    const noRef = await submit({ filedOn: "2026-04-20" });
    expect(noRef.status, noRef.text).toBe(400);
    expect((await returnRow(t, id)).status).toBe("ready");

    const filed = await submit({ ftaReferenceNumber: "ET-2026-Q1-001", filedOn: "2026-04-20" });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({ status: "filed", ftaReferenceNumber: "ET-2026-Q1-001" });
    expect(String(filed.body.submittedAt).slice(0, 10)).toBe("2026-04-20");
    expect(filed.body.paymentStatus ?? "unpaid").toBe("unpaid");

    // Payment status follows the settlement only.
    const hand = await t.as.patch(`/api/vat-returns/${id}`, { paymentStatus: "paid" });
    expect(hand.status, hand.text).toBe(400);

    const url = `/api/vat-returns/${id}/settlement`;
    expect((await t.as.get(url)).body.settlement).toBeNull();
    const paid = await t.as.post(url, {
      date: "2026-04-25",
      paymentAccountId: bank.id,
      reference: "PAY-1",
    });
    expect(paid.status, paid.text).toBe(201);
    expect(paid.body.netPayable).toBe(80);
    const got = (await t.as.get(url)).body.settlement;
    expect(got).toMatchObject({
      id: paid.body.journalEntryId,
      date: "2026-04-25",
      reference: "PAY-1",
      netPayable: 80,
      kind: "payment",
    });
    const afterPay = await returnRow(t, id);
    expect(afterPay.paymentStatus).toBe("paid");
    expect(Number(afterPay.paymentAmount)).toBe(80);
    expect(String(afterPay.paymentDate).slice(0, 10)).toBe("2026-04-25");

    const rev = await t.as.post(`${url}/reverse`, { date: "2026-04-26", reason: "Wrong bank" });
    expect(rev.status, rev.text).toBe(200);
    expect((await t.as.get(url)).body.settlement).toBeNull();
    const afterRev = await returnRow(t, id);
    expect(afterRev.paymentStatus).toBe("unpaid");
    expect(afterRev.paymentAmount).toBeNull();
  });

  it("a refund return records the refund received (Dr bank) and reads back as a refund", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    await activity(t, 200, 4000);
    const id = await readyReturn(t);
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-REF-1",
      filedOn: "2026-04-10",
    });
    expect(filed.status, filed.text).toBe(200);
    expect(Number(filed.body.box14PayableTax)).toBeLessThan(0);
    const url = `/api/vat-returns/${id}/settlement`;
    const refund = await t.as.post(url, { date: "2026-05-30", paymentAccountId: bank.id });
    expect(refund.status, refund.text).toBe(201);
    expect(refund.body.netPayable).toBe(-190);
    expect((await t.as.get(url)).body.settlement).toMatchObject({
      kind: "refund",
      netPayable: -190,
    });
    expect((await returnRow(t, id)).paymentStatus).toBe("paid");
  });

  it("a viewer cannot record the filing or the payment", async () => {
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const viewer = await addMember(t, "viewer", "E2Viewer");
    const res = await viewer.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-X",
      filedOn: "2026-04-20",
    });
    expect(res.status).toBe(403);
  });
});

describe("INTEGRATE-G: the compliance calendar follows the filed VAT return", () => {
  it("filing the Q1 return (period end 31 Mar) completes the vat:2026-03-31 obligation", async () => {
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const calRow = async () => {
      const cal = await t.as.get(`${base(t)}/compliance-calendar?from=2026-01-01&to=2026-12-31`);
      expect(cal.status, cal.text).toBe(200);
      return (cal.body as Array<Record<string, unknown>>).find(
        (r) => r.obligationKey === "vat:2026-03-31"
      );
    };
    // Before filing the return is matched to its own period (not 1 Apr) and is not completed.
    const before = await calRow();
    expect(before, "obligation for the 31 Mar period").toBeTruthy();
    expect(before).toMatchObject({ periodEnd: "2026-03-31", relatedEntityId: id });
    expect(before!.status).not.toBe("completed");
    const filed = await t.as.post(`/api/vat-returns/${id}/submit`, {
      ftaReferenceNumber: "ET-2026-Q1-CAL",
      filedOn: "2026-04-20",
    });
    expect(filed.status, filed.text).toBe(200);
    const after = await calRow();
    expect(after).toMatchObject({ status: "completed", statusDerived: true, relatedEntityId: id });
  });
});

describe("VAT filing and settlement transaction boundaries", () => {
  it("blocks a group member's backdated sale until the representative's filing commits", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const representative = await vatTenant();
    const member = await vatTenant({ trn_vat_number: "100000000000011" });
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      member.company.id,
      representative.user.id,
    ]);
    const group = await representative.as.put(`${base(representative)}/vat/group`, {
      name: "VAT Group",
      groupTrn: "100000000000029",
      memberCompanyIds: [member.company.id],
    });
    expect(group.status, group.text).toBe(200);
    const id = await readyReturn(representative);
    const draft = await member.as.post(`${base(member)}/invoices`, {
      customerName: "Late customer",
      date: "2026-03-25",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Group member sale", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(draft.status, draft.text).toBe(200);

    // Pause filing at its final UPDATE, after it has already read the figures.
    const pauseKey = "73";
    await h.sql(`CREATE FUNCTION pause_group_filing() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${pauseKey}::bigint); RETURN NEW; END $$`);
    await h.sql(`CREATE TRIGGER pause_group_filing BEFORE UPDATE ON vat_returns
      FOR EACH ROW WHEN (NEW.status = 'filed') EXECUTE FUNCTION pause_group_filing()`);
    const blocker = new pg.Client({ connectionString: h.databaseUrl });
    let filing: ReturnType<Tenant["as"]["post"]> | undefined;
    let posting: ReturnType<Tenant["as"]["patch"]> | undefined;
    const waitForLock = (key: string) =>
      vi.waitFor(
        async () => {
          const blocked = await h.sql(
            `SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND classid::bigint = (($1::bigint >> 32) & 4294967295)
              AND objid::bigint = ($1::bigint & 4294967295)`,
            [key]
          );
          expect(blocked).toHaveLength(1);
        },
        { timeout: 8_000, interval: 25 }
      );
    try {
      await blocker.connect();
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [pauseKey]);
      filing = representative.as.post(`/api/vat-returns/${id}/submit`, {
        ftaReferenceNumber: "ET-GROUP",
        filedOn: "2026-04-20",
      });
      await waitForLock(pauseKey);
      const [memberLock] = await h.sql<{ key: string }>(
        "SELECT hashtextextended('vat-returns:' || $1::uuid::text, 0)::text AS key",
        [member.company.id]
      );
      posting = member.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" });
      await waitForLock(memberLock.key);
    } finally {
      await blocker.end();
      await Promise.allSettled([filing, posting]);
      await h.sql("DROP TRIGGER pause_group_filing ON vat_returns");
      await h.sql("DROP FUNCTION pause_group_filing()");
    }

    const [filed, posted] = await Promise.all([filing!, posting!]);
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({ status: "filed", vatGroupId: group.body.id });
    expect(Number(filed.body.box14PayableTax)).toBe(0);
    expect(posted.status, posted.text).toBe(409);
    expect(posted.body.code).toBe("VAT_PERIOD_FILED");
    expect(await h.sql("SELECT status FROM invoices WHERE id = $1", [draft.body.id])).toEqual([
      { status: "draft" },
    ]);
    expect(
      await h.sql("SELECT id FROM journal_entries WHERE source_id = $1", [draft.body.id])
    ).toHaveLength(0);

    const amended = await representative.as.post(`/api/vat-returns/${id}/amend`, {
      reason: "Include the member's omitted supply",
    });
    expect(amended.status, amended.text).toBe(201);
    expect(amended.body.vatGroupId).toBe(group.body.id);
    const retriedPosting = await member.as.patch(`/api/invoices/${draft.body.id}/status`, {
      status: "sent",
    });
    expect(retriedPosting.status, retriedPosting.text).toBe(200);
  });

  it("requires a new reason when a ledger-only posting changes an approved VAT difference", async () => {
    const t = await vatTenant();
    const bank = await accountByCode(t, "1020");
    const outputVat = await accountByCode(t, "2020");
    const { postJournal } = await import("../../server/ledger");
    const postLedgerOnly = (fils: number) =>
      postJournal(
        {
          companyId: t.company.id,
          date: "2026-03-25",
          source: "invoice",
          status: "posted",
          lines: [
            { accountId: bank.id, debitFils: fils },
            { accountId: outputVat.id, creditFils: fils, systemVat: true },
          ],
        },
        { actorId: t.user.id }
      );

    await postLedgerOnly(2_500);
    const id = await draftReturn(t);
    const approved = await t.as.post(`/api/vat-returns/${id}/ready`, {
      overrideReason: "First invoice journal awaits recovered document",
    });
    expect(approved.status, approved.text).toBe(200);
    expect(approved.body.reconciliationSnapshot.unexplainedOutputFils).toBe(-2_500);
    const url = `/api/vat-returns/${id}/submit`;
    const filing = { ftaReferenceNumber: "ET-FRESH-OVERRIDE", filedOn: "2026-04-20" };

    // A missing input amount is insufficient evidence even if the stored output amount matches.
    await h.sql(
      "UPDATE vat_returns SET reconciliation_snapshot = reconciliation_snapshot - 'unexplainedInputFils' WHERE id = $1",
      [id]
    );
    const malformed = await t.as.post(url, filing);
    expect(malformed.status, malformed.text).toBe(409);
    expect(malformed.body.code).toBe("VAT_RECONCILIATION_DIFFERENCE");
    await h.sql("UPDATE vat_returns SET reconciliation_snapshot = $2 WHERE id = $1", [
      id,
      JSON.stringify(approved.body.reconciliationSnapshot),
    ]);

    await postLedgerOnly(1);
    const blocked = await t.as.post(url, filing);
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.body).toMatchObject({
      code: "VAT_RECONCILIATION_DIFFERENCE",
      details: { unexplainedOutputVat: -25.01, unexplainedInputVat: 0 },
    });
    expect(await returnRow(t, id)).toMatchObject({
      status: "ready",
      box14PayableTax: approved.body.box14PayableTax,
      reconciliationSnapshot: approved.body.reconciliationSnapshot,
    });
    const filed = await t.as.post(url, {
      ...filing,
      reconciliationOverrideReason: "Reviewed the additional ledger posting",
    });
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({
      status: "filed",
      reconciliationOverrideReason: "Reviewed the additional ledger posting",
      reconciliationSnapshot: { unexplainedOutputFils: -2_501 },
    });
    const audits = await h.sql(
      "SELECT 1 FROM audit_logs WHERE action = 'vat_return.reconciliation_override' AND resource_id = $1",
      [id]
    );
    expect(audits).toHaveLength(2);
  });

  it("serializes filing and settlement retries and keeps the original result", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const url = `/api/vat-returns/${id}`;
    const filing = { ftaReferenceNumber: "ET-REPLAY", filedOn: "2026-04-20" };
    const filings = await Promise.all(
      Array.from({ length: 12 }, () => t.as.post(`${url}/submit`, filing))
    );
    for (const result of filings) {
      expect(result.status, result.text).toBe(200);
      expect(result.body).toEqual(filings[0].body);
    }
    const conflict = await t.as.post(`${url}/submit`, {
      ...filing,
      ftaReferenceNumber: "ET-OTHER",
    });
    expect(conflict.status, conflict.text).toBe(409);
    expect(conflict.body.code).toBe("VAT_FILING_CONFLICT");

    const bank = await accountByCode(t, "1020");
    const payment = { date: "2026-04-25", paymentAccountId: bank.id, reference: "" };
    const settlements = await Promise.all(
      Array.from({ length: 12 }, () => t.as.post(`${url}/settlement`, payment))
    );
    for (const result of settlements) {
      expect(result.status, result.text).toBe(201);
      expect(result.body).toEqual(settlements[0].body);
    }
    const [journal] = await h.sql(
      "SELECT id, date::date::text AS date FROM journal_entries WHERE source = 'vat_return_settlement' AND source_id = $1",
      [id]
    );
    expect(journal).toEqual({ id: settlements[0].body.journalEntryId, date: payment.date });
    expect(
      await h.sql(
        "SELECT id FROM journal_entries WHERE source = 'vat_return_settlement' AND source_id = $1",
        [id]
      )
    ).toHaveLength(1);
    const audit = await h.sql<{ action: string }>(
      "SELECT action FROM audit_logs WHERE resource_id = $1 AND action IN ('vat_return.filed', 'vat.return_settlement.create')",
      [id]
    );
    expect(audit.map((row) => row.action).sort()).toEqual([
      "vat.return_settlement.create",
      "vat_return.filed",
    ]);
    await h.sql(
      "UPDATE vat_returns SET payment_status = 'unpaid', payment_date = NULL, payment_amount = NULL WHERE id = $1",
      [id]
    );
    const retry = await t.as.post(`${url}/settlement`, payment);
    expect(retry.status, retry.text).toBe(201);
    expect(retry.body).toEqual(settlements[0].body);
    const row = await returnRow(t, id);
    expect(row).toMatchObject({
      status: "filed",
      paymentStatus: "paid",
      ftaReferenceNumber: filing.ftaReferenceNumber,
    });
    expect(String(row.paymentDate).slice(0, 10)).toBe(payment.date);
    expect(Number(row.paymentAmount)).toBe(80);
  });

  it("serializes a filing against a backdated sales posting and requires fresh figures", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const id = await readyReturn(t);
    const draft = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Late customer",
      date: "2026-03-25",
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Late sale", quantity: 1, unitPrice: 1000, vatRate: 5 }],
    });
    expect(draft.status, draft.text).toBe(200);

    const filing = { ftaReferenceNumber: "ET-LATE", filedOn: "2026-04-20" };
    const [filed, posted] = await Promise.all([
      t.as.post(`/api/vat-returns/${id}/submit`, filing),
      t.as.patch(`/api/invoices/${draft.body.id}/status`, { status: "sent" }),
    ]);
    expect([filed.status, posted.status].sort(), filed.text + posted.text).toEqual([200, 409]);
    if (filed.status === 200) {
      expect(posted.body.code).toBe("VAT_PERIOD_FILED");
      expect(Number(filed.body.box14PayableTax)).toBe(80);
    } else {
      expect(filed.body.code).toBe("VAT_RETURN_STALE");
      expect((await returnRow(t, id)).status).toBe("ready");
      expect(await draftReturn(t)).toBe(id);
      const retry = await t.as.post(`/api/vat-returns/${id}/submit`, filing);
      expect(retry.status, retry.text).toBe(200);
      expect(Number(retry.body.box14PayableTax)).toBe(130);
    }
  });

  it("keeps settlement and filing dates consistent whichever request wins", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const t = await vatTenant();
    await activity(t, 2000, 400);
    const bank = await accountByCode(t, "1020");
    const id = await draftReturn(t);
    const url = `/api/vat-returns/${id}`;
    expect((await t.as.post(`${url}/submit`, {})).status).toBe(200);
    const [filed, paid] = await Promise.all([
      t.as.post(`${url}/submit`, { ftaReferenceNumber: "ET-DATE-RACE", filedOn: "2026-04-20" }),
      t.as.post(`${url}/settlement`, { date: "2026-04-19", paymentAccountId: bank.id }),
    ]);
    if (filed.status === 200) {
      expect(paid.status, paid.text).toBe(422);
      expect(paid.body.code).toBe("VAT_SETTLEMENT_BEFORE_FILING");
      expect((await t.as.get(`${url}/settlement`)).body.settlement).toBeNull();
    } else {
      expect(paid.status, paid.text).toBe(201);
      expect(filed.status, filed.text).toBe(409);
      expect(filed.body.code).toBe("VAT_FILING_AFTER_SETTLEMENT");
      expect(await returnRow(t, id)).toMatchObject({ status: "submitted", paymentStatus: "paid" });
    }
  });

  it("rolls back journals and return state when filing, settling or reversing fails before commit", async () => {
    const t = await vatTenant({ partial_exemption_enabled: true });
    await activity(t, 2000, 400);
    const exempt = await t.as.post(`${base(t)}/invoices`, {
      customerName: "Tenant",
      date: "2026-03-01",
      lines: [
        {
          description: "Residential rent",
          quantity: 1,
          unitPrice: 2000,
          vatRate: 0,
          vatSupplyType: "exempt",
        },
      ],
    });
    expect(exempt.status, exempt.text).toBe(200);
    expect(
      (await t.as.patch(`/api/invoices/${exempt.body.id}/status`, { status: "sent" })).status
    ).toBe(200);
    const id = await draftReturn(t);
    const url = `/api/vat-returns/${id}`;
    const filing = { ftaReferenceNumber: "ET-ROLLBACK", filedOn: "2026-04-20" };
    const bank = await accountByCode(t, "1020");
    const payment = { date: "2026-04-25", paymentAccountId: bank.id };
    const reversal = { date: "2026-04-26", reason: "Bank rejected payment" };
    const journals = (source: string) =>
      h.sql(
        "SELECT id, reversed_by_entry_id FROM journal_entries WHERE source_id = $1 AND source = $2",
        [id, source]
      );

    // The trigger aborts the final return UPDATE, after the kernel has inserted the journal.
    await h.sql(`CREATE FUNCTION fail_vat_return_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced VAT return update failure'; END $$`);
    async function failWrite(request: () => ReturnType<Tenant["as"]["post"]>) {
      await h.sql(`CREATE TRIGGER fail_vat_return_update BEFORE UPDATE ON vat_returns
        FOR EACH ROW EXECUTE FUNCTION fail_vat_return_update()`);
      try {
        const result = await request();
        expect(result.status, result.text).toBe(500);
      } finally {
        await h.sql("DROP TRIGGER fail_vat_return_update ON vat_returns");
      }
    }
    try {
      await failWrite(() => t.as.post(`${url}/submit`, filing));
      expect(await journals("vat_partial_exemption")).toHaveLength(0);
      expect(
        await h.sql("SELECT id FROM accounts WHERE company_id = $1 AND code = '5160'", [
          t.company.id,
        ])
      ).toHaveLength(0);
      expect((await returnRow(t, id)).status).toBe("draft");

      const filed = await t.as.post(`${url}/submit`, filing);
      expect(filed.status, filed.text).toBe(200);
      expect(await journals("vat_partial_exemption")).toHaveLength(1);
      expect(Number(filed.body.box14PayableTax)).toBe(90);

      await failWrite(() => t.as.post(`${url}/settlement`, payment));
      expect(await journals("vat_return_settlement")).toHaveLength(0);
      expect((await returnRow(t, id)).paymentStatus).toBe("unpaid");

      const paid = await t.as.post(`${url}/settlement`, payment);
      expect(paid.status, paid.text).toBe(201);
      await failWrite(() => t.as.post(`${url}/settlement/reverse`, reversal));
      expect(await journals("vat_return_settlement")).toEqual([
        { id: paid.body.journalEntryId, reversed_by_entry_id: null },
      ]);
      expect((await returnRow(t, id)).paymentStatus).toBe("paid");
      expect(
        await h.sql("SELECT id FROM journal_entries WHERE reversed_entry_id = $1", [
          paid.body.journalEntryId,
        ])
      ).toHaveLength(0);

      const reversed = await t.as.post(`${url}/settlement/reverse`, reversal);
      expect(reversed.status, reversed.text).toBe(200);
      expect((await returnRow(t, id)).paymentStatus).toBe("unpaid");
      const reposted = await t.as.post(`${url}/settlement`, payment);
      expect(reposted.status, reposted.text).toBe(201);
      expect(reposted.body.journalEntryId).not.toBe(paid.body.journalEntryId);
    } finally {
      await h.sql("DROP FUNCTION fail_vat_return_update()");
    }
  });
});
