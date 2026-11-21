/**
 * E2 (J3-r2): the VAT filing flow on the Returns side. A return marked ready is recorded as filed
 * with the EmaraTax reference and filing date, then its payment (or refund) is recorded through
 * the settlement seam; the return's payment fields, the calendar and the ledger agree, and a
 * reversal returns it to unpaid. Payment status is not hand-editable.
 */
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { accountByCode, useHarness, type ApiResponse, type Tenant } from "./harness";

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

async function draftReturn(
  t: Tenant,
  period = { periodStart: "2026-01-01", periodEnd: "2026-03-31" }
) {
  const gen = await t.as.post(`${base(t)}/vat-returns/generate`, period);
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

  async function changeGroup(representative: Tenant, members: Tenant[]) {
    for (const member of members) {
      await h.sql(
        `INSERT INTO company_users (company_id, user_id, role)
         VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
        [member.company.id, representative.user.id]
      );
    }
    const group = await representative.as.put(`${base(representative)}/vat/group`, {
      name: "VAT Group",
      groupTrn: "100000000000029",
      memberCompanyIds: members.map((member) => member.company.id),
    });
    expect(group.status, group.text).toBe(200);
    return group.body.id as string;
  }

  async function seedLegacyGroup(representative: Tenant, member: Tenant) {
    const [group] = await h.sql<{ id: string }>(
      `INSERT INTO vat_groups (representative_company_id, name, group_trn, created_by)
       VALUES ($1, 'VAT Group', '100000000000029', $2) RETURNING id`,
      [representative.company.id, representative.user.id]
    );
    await h.sql("INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2), ($1, $3)", [
      group.id,
      representative.company.id,
      member.company.id,
    ]);
    return group.id;
  }

  async function draftSale(company: Tenant, unitPrice: number, date = "2026-03-25") {
    const invoice = await company.as.post(`${base(company)}/invoices`, {
      customerName: "Late customer",
      date,
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Backdated sale", quantity: 1, unitPrice, vatRate: 5 }],
    });
    expect(invoice.status, invoice.text).toBe(200);
    return invoice.body.id as string;
  }

  async function prepareBackdatedSale(company: Tenant, unitPrice: number, date?: string) {
    const id = await draftSale(company, unitPrice, date);
    return () => company.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
  }

  const groupFiling = { ftaReferenceNumber: "ET-HISTORICAL-GROUP", filedOn: "2026-04-20" };

  it.each(["filed", "submitted"] as const)(
    "keeps the original group membership after first closing the return as %s",
    async (status) => {
      const representative = await vatTenant();
      const removed = await vatTenant({ trn_vat_number: "100000000000011" });
      const added = await vatTenant({ trn_vat_number: "100000000000037" });
      const groupId = await changeGroup(representative, [removed]);
      const id = await readyReturn(representative);
      const url = `/api/vat-returns/${id}/submit`;
      const close = await representative.as.post(url, status === "filed" ? groupFiling : {});
      expect(close.status, close.text).toBe(200);
      expect(close.body.status).toBe(status);
      const snapshot = close.body.reconciliationSnapshot;
      expect(snapshot.filingVatGroup).toMatchObject({
        groupId,
        memberIds: [representative.company.id, removed.company.id].sort(),
        provenance: "recorded",
      });

      await changeGroup(representative, [added]);
      const postRemoved = await prepareBackdatedSale(removed, 1000);
      const postAdded = await prepareBackdatedSale(added, 2000);
      const blocked = await postRemoved();
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.body.code).toBe("VAT_PERIOD_FILED");
      const open = await postAdded();
      expect(open.status, open.text).toBe(200);

      if (status === "submitted") {
        const filed = await representative.as.post(url, groupFiling);
        expect(filed.status, filed.text).toBe(200);
        expect(filed.body).toMatchObject({ status: "filed", reconciliationSnapshot: snapshot });
        const stillBlocked = await postRemoved();
        expect(stillBlocked.status, stillBlocked.text).toBe(409);
        expect(stillBlocked.body.code).toBe("VAT_PERIOD_FILED");
        const postAnother = await prepareBackdatedSale(added, 500);
        const stillOpen = await postAnother();
        expect(stillOpen.status, stillOpen.text).toBe(200);
      } else {
        const amendment = await representative.as.post(`/api/vat-returns/${id}/amend`, {
          reason: "Include an omitted supply from the original VAT group",
        });
        expect(amendment.status, amendment.text).toBe(201);
        expect(Number(amendment.body.box14PayableTax)).toBe(0);
        expect(amendment.body.reconciliationSnapshot.filingVatGroup).toEqual(
          snapshot.filingVatGroup
        );
        const reopened = await postRemoved();
        expect(reopened.status, reopened.text).toBe(200);

        const regenerated = await draftReturn(representative);
        expect(regenerated).toBe(amendment.body.id);
        const refiled = await representative.as.post(`/api/vat-returns/${regenerated}/submit`, {
          ...groupFiling,
          ftaReferenceNumber: "ET-HISTORICAL-AMENDMENT",
        });
        expect(refiled.status, refiled.text).toBe(200);
        expect(Number(refiled.body.box14PayableTax)).toBe(50);
        expect(refiled.body.reconciliationSnapshot.filingVatGroup).toEqual(snapshot.filingVatGroup);

        // Legacy amendments inherit the original scope even when their own group ID is present.
        for (const legacyGroupId of [null, groupId]) {
          await h.sql(
            `UPDATE vat_returns SET vat_group_id = $2,
                    reconciliation_snapshot = reconciliation_snapshot - 'filingVatGroup'
             WHERE id = $1`,
            [regenerated, legacyGroupId]
          );
          const anotherRemoved = await prepareBackdatedSale(removed, 100);
          const lockedByAmendment = await anotherRemoved();
          expect(lockedByAmendment.status, lockedByAmendment.text).toBe(409);
          expect(lockedByAmendment.body.code).toBe("VAT_PERIOD_FILED");
          const anotherAdded = await prepareBackdatedSale(added, 100);
          const untouchedByAmendment = await anotherAdded();
          expect(untouchedByAmendment.status, untouchedByAmendment.text).toBe(200);
        }
      }
    }
  );

  it("recovers a legacy group's members from the audit chain before the next edit", async () => {
    const representative = await vatTenant();
    const oldMember = await vatTenant({ trn_vat_number: "100000000000011" });
    const added = await vatTenant({ trn_vat_number: "100000000000037" });
    const groupId = await changeGroup(representative, [oldMember]);
    const id = await readyReturn(representative);
    const closed = await representative.as.post(`/api/vat-returns/${id}/submit`, groupFiling);
    expect(closed.status, closed.text).toBe(200);
    await h.sql(
      "UPDATE vat_returns SET reconciliation_snapshot = reconciliation_snapshot - 'filingVatGroup' WHERE id = $1",
      [id]
    );

    // Model a membership change under the older software, after the return was recorded.
    await h.sql("DELETE FROM vat_group_members WHERE group_id = $1 AND company_id = $2", [
      groupId,
      oldMember.company.id,
    ]);
    await h.sql("INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2)", [
      groupId,
      added.company.id,
    ]);
    // The later event has an earlier timestamp, as can happen for transactions waiting on locks.
    await h.sql(
      `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details, created_at)
       VALUES ($1, $2, 'vat.group.upsert', 'vat_group', $3, $4, now() - interval '1 day')`,
      [
        representative.company.id,
        representative.user.id,
        groupId,
        JSON.stringify({
          after: {
            name: "VAT Group",
            groupTrn: "100000000000029",
            members: [representative.company.id, added.company.id],
          },
        }),
      ]
    );
    const postOld = await prepareBackdatedSale(oldMember, 1000);
    const postAdded = await prepareBackdatedSale(added, 1000);
    const blocked = await postOld();
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.body.code).toBe("VAT_PERIOD_FILED");
    const open = await postAdded();
    expect(open.status, open.text).toBe(200);
    await changeGroup(representative, [added]);
    const recovered = await returnRow(representative, id);
    expect(recovered.reconciliationSnapshot).toEqual({
      ...closed.body.reconciliationSnapshot,
      filingVatGroup: { ...closed.body.reconciliationSnapshot.filingVatGroup, provenance: "audit" },
    });
  });

  it("lets unrelated tenants post while a legacy group verifies historical membership", async () => {
    const representative = await vatTenant();
    const oldMember = await vatTenant({ trn_vat_number: "100000000000011" });
    const added = await vatTenant({ trn_vat_number: "100000000000037" });
    const guessed = await vatTenant();
    const unrelated = await vatTenant();
    const otherRepresentative = await vatTenant();
    await changeGroup(otherRepresentative, [unrelated]);
    // Shared access to companies is not evidence of shared VAT registration.
    await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'owner')", [
      unrelated.company.id,
      representative.user.id,
    ]);

    async function prepareVatChanges(t: Tenant) {
      const issuedId = await draftSale(t, 1000);
      const issuedUrl = `/api/invoices/${issuedId}/status`;
      const issued = await t.as.patch(issuedUrl, { status: "sent" });
      expect(issued.status, issued.text).toBe(200);
      const secondId = await draftSale(t, 1000);
      const second = await t.as.patch(`/api/invoices/${secondId}/status`, { status: "sent" });
      expect(second.status, second.text).toBe(200);
      const bank = await accountByCode(t, "1020");
      const deposit = await t.as.post(`${base(t)}/customer-deposits`, {
        customerName: "Late customer",
        date: "2026-02-05",
        amount: 200,
        vatTreatment: "zero_rated",
        paymentAccountId: bank.id,
      });
      expect(deposit.status, deposit.text).toBe(201);
      const creditUrl = `${base(t)}/customer-credits/${deposit.body.creditId}`;
      return {
        reverse: () => t.as.patch(issuedUrl, { status: "void" }),
        adjust: () =>
          t.as.post(`${base(t)}/vat/adjustments`, {
            periodStart: "2026-01-01",
            periodEnd: "2026-03-31",
            kind: "tourist_refund",
            amount: 200,
            vatAmount: 10,
            reason: "Tourist refunds for Q1",
          }),
        apply: () =>
          t.as.post(`${creditUrl}/apply`, { invoiceId: secondId, amount: 100, date: "2026-03-28" }),
        refund: () =>
          t.as.post(`${creditUrl}/refund`, {
            amount: 100,
            date: "2026-03-28",
            paymentAccountId: bank.id,
          }),
      };
    }
    const oldChanges = await prepareVatChanges(oldMember);
    const unrelatedChanges = await prepareVatChanges(unrelated);

    const groupId = await changeGroup(representative, [oldMember]);
    const id = await readyReturn(representative);
    await h.sql("UPDATE vat_returns SET status = 'submitted' WHERE id = $1", [id]);
    await changeGroup(representative, [added]);
    const legacy = await returnRow(representative, id);
    expect(legacy.reconciliationSnapshot.filingVatGroup).toBeUndefined();

    // A previous release could already have written a guess based on current membership.
    const guess = {
      groupId,
      name: "VAT Group",
      groupTrn: "100000000000029",
      memberIds: [representative.company.id, added.company.id, guessed.company.id].sort(),
    };
    await h.sql(
      `UPDATE vat_returns SET reconciliation_snapshot = reconciliation_snapshot || $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify({ filingVatGroup: guess })]
    );
    await changeGroup(representative, [added]);
    expect((await returnRow(representative, id)).reconciliationSnapshot).toEqual({
      ...legacy.reconciliationSnapshot,
      filingVatGroup: guess,
    });
    for (const details of [
      `Malformed legacy audit with ${unrelated.company.id}`,
      JSON.stringify({ before: { note: unrelated.company.id } }),
    ]) {
      await h.sql(
        `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, 'vat.group.upsert', 'vat_group', $3, $4)`,
        [representative.company.id, representative.user.id, groupId, details]
      );
    }

    function expectVerificationRequired(response: ApiResponse) {
      expect(response.status, response.text).toBe(409);
      expect(response.body.code).toBe("VAT_GROUP_MEMBERSHIP_VERIFICATION_REQUIRED");
      expect(response.body.details).toBeUndefined();
      for (const privateId of [representative.company.id, oldMember.company.id, groupId, id]) {
        expect(response.text).not.toContain(privateId);
      }
    }

    const postOld = await prepareBackdatedSale(oldMember, 1000);
    const postAdded = await prepareBackdatedSale(added, 1000);
    const postGuessed = await prepareBackdatedSale(guessed, 1000);
    const postUnrelated = await prepareBackdatedSale(unrelated, 1000);
    const unrelatedPosting = await postUnrelated();
    expect(unrelatedPosting.status, unrelatedPosting.text).toBe(200);
    for (const post of [postOld, postAdded, postGuessed]) expectVerificationRequired(await post());
    for (const change of Object.values(oldChanges)) expectVerificationRequired(await change());
    const unrelatedReversal = await unrelatedChanges.reverse();
    expect(unrelatedReversal.status, unrelatedReversal.text).toBe(200);
    for (const change of [
      unrelatedChanges.adjust,
      unrelatedChanges.apply,
      unrelatedChanges.refund,
    ]) {
      const allowed = await change();
      expect(allowed.status, allowed.text).toBe(201);
    }

    const submitUrl = `/api/vat-returns/${id}/submit`;
    const replay = await representative.as.post(submitUrl, {});
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.status).toBe("submitted");
    expectVerificationRequired(await representative.as.post(submitUrl, groupFiling));
    expectVerificationRequired(
      await representative.as.post(`/api/vat-returns/${id}/amend`, {
        reason: "Correct a historical filing",
      })
    );
    const bank = await accountByCode(oldMember, "1020");
    const equity = await accountByCode(oldMember, "3010");
    const nonVatJournal = await oldMember.as.post(`${base(oldMember)}/journal`, {
      date: "2026-03-27",
      status: "posted",
      lines: [
        { accountId: bank.id, debit: 100 },
        { accountId: equity.id, credit: 100 },
      ],
    });
    expect(nonVatJournal.status, nonVatJournal.text).toBe(200);
    const postNextPeriod = await prepareBackdatedSale(oldMember, 100, "2026-04-02");
    const nextPeriod = await postNextPeriod();
    expect(nextPeriod.status, nextPeriod.text).toBe(200);

    // Simulate restoring authoritative historical audit records before retrying the operations.
    const historical = {
      ...guess,
      memberIds: [representative.company.id, oldMember.company.id].sort(),
    };
    await h.sql(
      `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'vat.group.upsert', 'vat_group', $3, $4)`,
      [
        representative.company.id,
        representative.user.id,
        groupId,
        JSON.stringify({
          after: {
            name: historical.name,
            groupTrn: historical.groupTrn,
            members: historical.memberIds,
          },
        }),
      ]
    );
    await h.sql(
      `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id)
       VALUES ($1, $2, 'vat_return.submitted', 'vat_return', $3)`,
      [representative.company.id, representative.user.id, id]
    );
    await changeGroup(representative, [added]);
    const recovered = await returnRow(representative, id);
    expect(recovered.reconciliationSnapshot).toEqual({
      ...legacy.reconciliationSnapshot,
      filingVatGroup: { ...historical, provenance: "audit" },
    });
    const formerMember = await postOld();
    expect(formerMember.status, formerMember.text).toBe(409);
    expect(formerMember.body).toMatchObject({
      code: "VAT_PERIOD_FILED",
      details: { vatReturnId: id },
    });
    for (const post of [postAdded, postGuessed]) {
      const open = await post();
      expect(open.status, open.text).toBe(200);
    }
    const filed = await representative.as.post(submitUrl, groupFiling);
    expect(filed.status, filed.text).toBe(200);
    expect(filed.body).toMatchObject({
      status: "filed",
      reconciliationSnapshot: recovered.reconciliationSnapshot,
    });
  });

  it("does not infer the group from a filed audit that followed an unrecorded submission", async () => {
    const representative = await vatTenant();
    const oldMember = await vatTenant({ trn_vat_number: "100000000000011" });
    const added = await vatTenant({ trn_vat_number: "100000000000037" });
    await seedLegacyGroup(representative, oldMember);
    const id = await draftReturn(representative, {
      periodStart: "2025-10-01",
      periodEnd: "2025-12-31",
    });
    // The group changed in older software between the first closure and administrative filing.
    await h.sql("UPDATE vat_returns SET status = 'submitted' WHERE id = $1", [id]);
    await changeGroup(representative, [added]);
    await h.sql("UPDATE vat_returns SET status = 'filed' WHERE id = $1", [id]);
    await h.sql(
      `INSERT INTO audit_logs (company_id, user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'vat_return.filed', 'vat_return', $3, $4)`,
      [
        representative.company.id,
        representative.user.id,
        id,
        JSON.stringify({
          before: { status: "submitted" },
          after: { status: "filed" },
        }),
      ]
    );
    await changeGroup(representative, [added]);
    expect(
      (await returnRow(representative, id)).reconciliationSnapshot.filingVatGroup
    ).toBeUndefined();
    for (const company of [oldMember, added]) {
      const post = await prepareBackdatedSale(company, 100, "2025-12-15");
      const blocked = await post();
      expect(blocked.status, blocked.text).toBe(409);
      expect(blocked.body.code).toBe("VAT_GROUP_MEMBERSHIP_VERIFICATION_REQUIRED");
    }
  });

  it("finds a verified amendment ancestor with no current or audited link to the former member", async () => {
    const representative = await vatTenant();
    const former = await vatTenant({ trn_vat_number: "100000000000011" });
    const added = await vatTenant({ trn_vat_number: "100000000000037" });
    const groupId = await seedLegacyGroup(representative, former);
    const original = await readyReturn(representative);
    const filed = await representative.as.post(`/api/vat-returns/${original}/submit`, groupFiling);
    expect(filed.status, filed.text).toBe(200);

    // Older software changed the current group without an audit describing the former member.
    await h.sql(
      "UPDATE vat_group_members SET company_id = $1 WHERE group_id = $2 AND company_id = $3",
      [added.company.id, groupId, former.company.id]
    );
    const amendment = await representative.as.post(`/api/vat-returns/${original}/amend`, {
      reason: "Record a historical correction using the original group scope",
    });
    expect(amendment.status, amendment.text).toBe(201);
    const closed = await representative.as.post(`/api/vat-returns/${amendment.body.id}/submit`, {});
    expect(closed.status, closed.text).toBe(200);
    await h.sql(
      `UPDATE vat_returns SET vat_group_id = NULL,
              reconciliation_snapshot = reconciliation_snapshot - 'filingVatGroup'
       WHERE id = $1`,
      [amendment.body.id]
    );

    const postFormer = await prepareBackdatedSale(former, 100);
    const blocked = await postFormer();
    expect(blocked.status, blocked.text).toBe(409);
    expect(blocked.body).toMatchObject({
      code: "VAT_PERIOD_FILED",
      details: { vatReturnId: amendment.body.id },
    });
    const postAdded = await prepareBackdatedSale(added, 100);
    const open = await postAdded();
    expect(open.status, open.text).toBe(200);
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
