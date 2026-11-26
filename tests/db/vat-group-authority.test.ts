import { describe, expect, it, vi } from "vitest";
import { useHarness, type ApiResponse, type Tenant } from "./harness";

const h = useHarness();
const period = { periodStart: "2026-01-01", periodEnd: "2026-03-31" };
const groupTrn = "100000000000029";
const base = (tenant: Tenant) => `/api/companies/${tenant.company.id}`;

async function groupTenants(role: "viewer" | "admin") {
  const companyColumns = {
    emirate: "dubai",
    vat_filing_frequency: "Quarterly",
    vat_period_start_month: 1,
  };
  const representative = await h.createTenant({
    companyColumns: { ...companyColumns, trn_vat_number: "100000000000003" },
  });
  const member = await h.createSecondTenant({
    companyColumns: { ...companyColumns, trn_vat_number: "100000000000011" },
  });
  await h.sql("INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)", [
    member.company.id,
    representative.user.id,
    role,
  ]);
  return { representative, member };
}

function upsertGroup(representative: Tenant, member: Tenant) {
  return representative.as.put(`${base(representative)}/vat/group`, {
    name: "VAT group authority fixture",
    groupTrn,
    memberCompanyIds: [member.company.id],
  });
}

function preview(company: Tenant) {
  return company.as.get(
    `${base(company)}/vat/compute?from=${period.periodStart}&to=${period.periodEnd}&detail=true`
  );
}

async function draftSale(company: Tenant) {
  const draft = await company.as.post(`${base(company)}/invoices`, {
    customerName: "External customer",
    date: "2026-03-25",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Taxable sale", quantity: 1, unitPrice: 1000, vatRate: 5 }],
  });
  expect(draft.status, draft.text).toBe(200);
  return draft.body.id as string;
}

function issueSale(company: Tenant, id: string) {
  return company.as.patch(`/api/invoices/${id}/status`, { status: "sent" });
}

async function generate(company: Tenant) {
  const draft = await company.as.post(`${base(company)}/vat-returns/generate`, period);
  expect(draft.status, draft.text).toBe(201);
  return draft.body.id as string;
}

function file(company: Tenant, id: string, reference: string) {
  return company.as.post(`/api/vat-returns/${id}/submit`, {
    ftaReferenceNumber: reference,
    filedOn: "2026-04-20",
  });
}

function expectPrivateConflict(response: ApiResponse, ...privateIds: string[]) {
  expect(response.status, response.text).toBe(409);
  expect(response.body.code).toBe("VAT_RETURN_SCOPE_OVERLAP");
  expect(response.body.details).toBeUndefined();
  for (const id of privateIds) expect(response.text).not.toContain(id);
}

describe("VAT group management authority and filing exclusivity", () => {
  it("requires authority in every member company before adding it to a VAT group", async () => {
    const { representative, member } = await groupTenants("viewer");
    const denied = await upsertGroup(representative, member);
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("VAT_GROUP_MEMBER_AUTHORIZATION_REQUIRED");
    expect(
      await h.sql("SELECT id FROM vat_groups WHERE representative_company_id = $1", [
        representative.company.id,
      ])
    ).toEqual([]);

    await h.sql("UPDATE company_users SET role = 'admin' WHERE company_id = $1 AND user_id = $2", [
      member.company.id,
      representative.user.id,
    ]);
    const allowed = await upsertGroup(representative, member);
    expect(allowed.status, allowed.text).toBe(200);
    const invoice = await draftSale(member);
    const issued = await issueSale(member, invoice);
    expect(issued.status, issued.text).toBe(200);
    const computed = await preview(representative);
    expect(computed.status, computed.text).toBe(200);
    expect(computed.body.group.memberIds).toContain(member.company.id);
    expect(computed.body.boxes.box12TotalDueTax).toBe(50);
  });

  it.each(["recorded", "unresolved"] as const)(
    "a %s legacy group link created with viewer access neither reads nor closes a member’s VAT",
    async (scope) => {
      const { representative, member } = await groupTenants("viewer");
      const returnId = await generate(representative);
      const invoice = await draftSale(member);
      const issued = await issueSale(member, invoice);
      expect(issued.status, issued.text).toBe(200);
      const [group] = await h.sql<{ id: string }>(
        `INSERT INTO vat_groups (representative_company_id, name, group_trn, created_by)
         VALUES ($1, 'Legacy VAT group', $2, $3) RETURNING id`,
        [representative.company.id, groupTrn, representative.user.id]
      );
      await h.sql(
        "INSERT INTO vat_group_members (group_id, company_id) VALUES ($1, $2), ($1, $3)",
        [group.id, representative.company.id, member.company.id]
      );
      const frozen = {
        groupId: group.id,
        name: "Legacy VAT group",
        groupTrn,
        memberIds: [representative.company.id, member.company.id],
        provenance: "recorded",
      };
      await h.sql(
        `UPDATE vat_returns SET status = 'filed', vat_group_id = $2, reconciliation_snapshot = $3::jsonb
          WHERE id = $1`,
        [
          returnId,
          group.id,
          scope === "recorded" ? JSON.stringify({ filingVatGroup: frozen }) : null,
        ]
      );

      const computed = await preview(representative);
      expect(computed.status, computed.text).toBe(200);
      expect(computed.body.group).toBeNull();
      expect(computed.body.boxes.box12TotalDueTax).toBe(0);
      expect(computed.text).not.toContain(invoice);

      const backdated = await draftSale(member);
      const posted = await issueSale(member, backdated);
      expect(posted.status, posted.text).toBe(200);
    }
  );

  it("holds the member's exclusive VAT lock before waiting on period policy", async (ctx) => {
    ctx.skip(!h.concurrencySupported);
    const { representative, member } = await groupTenants("admin");
    const group = await upsertGroup(representative, member);
    expect(group.status, group.text).toBe(200);
    const { withLedgerTx } = await import("../../server/ledger");
    const { ledgerQueryable } = await import("../../server/ledger/tx");
    let generation: Promise<string> | undefined;
    try {
      await withLedgerTx(async (tx) => {
        const q = ledgerQueryable(tx);
        const {
          rows: [blocker],
        } = await q.query("SELECT pg_backend_pid() AS pid");
        // Isolate the period lock so it does not also take a VAT lock.
        await q.query("SELECT pg_advisory_xact_lock(hashtextextended('ledger-period:' || $1, 0))", [
          representative.company.id,
        ]);
        generation = generate(representative);
        await vi.waitFor(
          async () => {
            const waiting = await h.sql(
              "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND $1::int = ANY(pg_blocking_pids(pid))",
              [blocker.pid]
            );
            expect(waiting).toHaveLength(1);
          },
          { timeout: 8000, interval: 25 }
        );
        const memberLock = await h.sql(
          "SELECT pg_try_advisory_xact_lock_shared(hashtextextended('vat-returns:' || $1::uuid::text, 0)) AS acquired",
          [member.company.id]
        );
        expect(memberLock).toEqual([{ acquired: false }]);
      });
    } finally {
      await generation;
    }
  });

  it.for(["member", "representative", "concurrent"] as const)(
    "accepts only one overlapping return when filing starts with %s",
    async (first, ctx) => {
      if (first === "concurrent") ctx.skip(!h.concurrencySupported);
      const { representative, member } = await groupTenants("admin");
      const group = await upsertGroup(representative, member);
      expect(group.status, group.text).toBe(200);
      const invoice = await draftSale(member);
      const issued = await issueSale(member, invoice);
      expect(issued.status, issued.text).toBe(200);
      const repId = await generate(representative);
      const memberId = await generate(member);
      const repFiling = () => file(representative, repId, "ET-GROUP");
      const memberFiling = () => file(member, memberId, "ET-MEMBER");
      let results: ApiResponse[];
      if (first === "member") {
        results = [await memberFiling(), await repFiling()];
      } else if (first === "representative") {
        results = [await repFiling(), await memberFiling()];
      } else {
        results = await Promise.all([repFiling(), memberFiling()]);
      }
      const [accepted] = results.filter((response) => response.status === 200);
      const [conflict] = results.filter((response) => response.status !== 200);
      expect(
        results.map((response) => response.status).sort(),
        results.map((response) => response.text).join("\n")
      ).toEqual([200, 409]);
      expect(accepted.body.status).toBe("filed");
      expect(Number(accepted.body.box12TotalDueTax)).toBe(50);
      expectPrivateConflict(
        conflict,
        repId,
        memberId,
        group.body.id,
        member.company.id,
        representative.company.id
      );
      if (first === "representative") {
        const amendment = await representative.as.post(`/api/vat-returns/${repId}/amend`, {
          reason: "Correct the group return",
        });
        expect(amendment.status, amendment.text).toBe(201);
        const overlapping = await memberFiling();
        expectPrivateConflict(overlapping, repId, amendment.body.id, memberId, group.body.id);
      }
      const final = await h.sql<{ id: string; status: string }>(
        "SELECT id, status FROM vat_returns WHERE id = ANY($1::uuid[]) ORDER BY status",
        [[repId, memberId]]
      );
      expect(final.map((row) => row.status)).toEqual(
        first === "representative" ? ["amended", "draft"] : ["draft", "filed"]
      );
    }
  );
});
