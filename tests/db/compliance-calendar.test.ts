/**
 * W4-A generated compliance calendar, overview, audit score, task feed and
 * month-end depth (sign-offs, reopen workflow).
 */
import { afterEach, describe, expect, it } from "vitest";
import { freezeTime, useHarness, type Tenant } from "./harness";

const h = useHarness();
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

async function addMember(t: Tenant, role: string, name: string): Promise<Tenant> {
  const m = await h.createSecondTenant({ name });
  await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, $3)`, [
    t.company.id,
    m.user.id,
    role,
  ]);
  return m;
}

const quarterly = {
  trn_vat_number: "100000000000003",
  vat_filing_frequency: "Quarterly",
  vat_period_start_month: 1,
  // X5 (J1 D4): returns apply from the books start (created_at / first posting); these
  // fixtures model a company that has kept its books here since 2025.
  created_at: "2025-01-01T00:00:00Z",
};

describe("W4-A compliance calendar (R08-03, R08-21)", () => {
  it("[R08-21] a quarterly company gets four VAT rows plus CT for 2026 and no ESR", async () => {
    restore = freezeTime("2026-06-01T08:00:00Z");
    const t = await h.createTenant({ name: "CalQ", companyColumns: quarterly });
    const gen = await t.as.post(`/api/companies/${t.company.id}/compliance-calendar/generate`, {
      year: 2026,
    });
    expect(gen.status, gen.text).toBe(200);
    const list = await t.as.get(
      `/api/companies/${t.company.id}/compliance-calendar?from=2026-01-01&to=2026-12-31&generate=false`
    );
    expect(list.status).toBe(200);
    const rows = list.body as Array<Record<string, string>>;
    const vat = rows.filter((r) => r.obligationType === "vat_return");
    expect(vat.map((r) => r.dueDate)).toEqual([
      "2026-01-28",
      "2026-04-28",
      "2026-07-28",
      "2026-10-28",
    ]);
    expect(vat.map((r) => r.periodEnd)).toEqual([
      "2025-12-31",
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
    ]);
    const ct = rows.filter((r) => r.obligationType === "corporate_tax_return");
    expect(ct).toHaveLength(1);
    expect(ct[0]).toMatchObject({ periodEnd: "2025-12-31", dueDate: "2026-09-30" });
    expect(rows.some((r) => /esr/i.test(`${r.obligationType} ${r.eventType} ${r.title}`))).toBe(
      false
    );
    // VAT periods already past their due date and not filed are overdue.
    expect(vat[0].status).toBe("overdue");
    expect(vat[2].status).toBe("upcoming");
    // Idempotent regeneration.
    await t.as.post(`/api/companies/${t.company.id}/compliance-calendar/generate`, { year: 2026 });
    const again = await h.sql(
      `SELECT COUNT(*)::int AS n FROM compliance_calendar WHERE company_id = $1 AND obligation_type = 'vat_return'`,
      [t.company.id]
    );
    expect(again[0].n).toBe(4);
  });

  it("[R08-03] FY2025 return shows deadline 2026-09-30, status follows the return state and rolls forward", async () => {
    restore = freezeTime("2026-06-01T08:00:00Z");
    const t = await h.createTenant({ name: "CalCt" });
    const reviewer = await addMember(t, "accountant", "CalCtReviewer");
    const created = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id;

    const overview1 = await t.as.get(`/api/companies/${t.company.id}/compliance/overview`);
    expect(overview1.status, overview1.text).toBe(200);
    expect(overview1.body.corporateTaxStatus).toMatchObject({
      nextDue: "2026-09-30",
      status: "up_to_date",
    });
    const cal1 = await t.as.get(`/api/companies/${t.company.id}/compliance-calendar`);
    const row1 = cal1.body.find(
      (r: { obligationKey: string }) => r.obligationKey === "ct:2025-12-31"
    );
    expect(row1).toMatchObject({ dueDate: "2026-09-30", status: "upcoming", relatedEntityId: id });
    expect(row1.description).toContain("draft");

    await t.as.post(`/api/corporate-tax/returns/${id}/transition`, { to: "computed" });
    await reviewer.as.post(`/api/corporate-tax/returns/${id}/transition`, { to: "reviewed" });
    const filed = await t.as.post(`/api/corporate-tax/returns/${id}/transition`, {
      to: "filed",
      filingReference: "FTA-REF-CAL",
    });
    expect(filed.status, filed.text).toBe(200);

    const cal2 = await t.as.get(`/api/companies/${t.company.id}/compliance-calendar`);
    const row2 = cal2.body.find(
      (r: { obligationKey: string }) => r.obligationKey === "ct:2025-12-31"
    );
    expect(row2.status).toBe("completed");
    expect(row2.statusDerived).toBe(true);
    // Derived rows cannot be completed by hand.
    const manual = await t.as.patch(
      `/api/companies/${t.company.id}/compliance-calendar/${row2.id}`,
      { status: "upcoming" }
    );
    expect(manual.status).toBe(409);

    const overview2 = await t.as.get(`/api/companies/${t.company.id}/compliance/overview`);
    expect(overview2.body.corporateTaxStatus.nextDue).toBe("2027-09-30");
    expect(overview2.body.corporateTaxStatus.lastReturn?.slice(0, 10)).toBe("2025-12-31");
  });

  it("[R08-13] the audit score is weighted by real checks, each explained", async () => {
    const t = await h.createTenant({ name: "CalAudit", companyColumns: quarterly });
    const r = await t.as.get(`/api/companies/${t.company.id}/compliance/overview`);
    expect(r.status, r.text).toBe(200);
    const checks = r.body.auditReadiness.checks as Array<{
      key: string;
      weight: number;
      score: number;
      explanation: string;
    }>;
    expect(checks.map((c) => c.key)).toEqual([
      "bank_reconciliation",
      "vat_returns",
      "period_locks",
      "unposted_documents",
      "corporate_tax_returns",
    ]);
    expect(checks.reduce((s, c) => s + c.weight, 0)).toBe(100);
    for (const c of checks) {
      expect(c.explanation.length).toBeGreaterThan(10);
      // S4: clients translate by stable key + params, never by English text.
      expect(
        (c as unknown as { explanationKey: string }).explanationKey.startsWith(`${c.key}.`)
      ).toBe(true);
    }
    const vatCheck = checks.find((c) => c.key === "vat_returns") as unknown as {
      explanationKey: string;
      explanationParams: Record<string, number>;
    };
    expect(vatCheck.explanationKey).toBe("vat_returns.ratio");
    expect(vatCheck.explanationParams.total).toBeGreaterThan(0);
    // VAT returns were due and none is filed; the last month is not locked.
    expect(checks.find((c) => c.key === "vat_returns")!.score).toBe(0);
    expect(checks.find((c) => c.key === "period_locks")!.score).toBe(0);
    expect(r.body.auditReadiness.score).toBeLessThan(100);
  });
});

describe("W4-A compliance calendar endpoints (R15-10, R13-34)", () => {
  it("[R15-10] reads are company-scoped; only owner/accountant (or firm) write; firm links hidden", async () => {
    const t = await h.createTenant({ name: "CalAcl" });
    const employee = await addMember(t, "employee", "CalEmployee");
    const viewer = await addMember(t, "viewer", "CalViewer");
    const url = `/api/companies/${t.company.id}/compliance-calendar`;
    const event = {
      eventType: "other",
      description: "Board meeting filing",
      eventDate: "2026-12-15",
    };

    expect((await employee.as.post(url, event)).status).toBe(403);
    expect((await viewer.as.post(url, event)).status).toBe(403);
    expect((await employee.as.post(`${url}/generate`, {})).status).toBe(403);
    expect((await viewer.as.get(url)).status).toBe(200);

    const created = await t.as.post(url, event);
    expect(created.status, created.text).toBe(201);
    expect(created.body).not.toHaveProperty("linkedRequirementId");
    const linked = await t.as.post(url, {
      ...event,
      linkedRequirementId: "00000000-0000-4000-8000-000000000001",
    });
    expect(linked.status).toBe(403);
    expect(linked.body.code).toBe("FIRM_ONLY_FIELD");
    const customerList = await viewer.as.get(`${url}?generate=false`);
    expect(customerList.body[0]).not.toHaveProperty("linkedRequirementId");

    // Manual rows can be completed by an owner, not an employee.
    const done = await employee.as.patch(`${url}/${created.body.id}`, { status: "completed" });
    expect(done.status).toBe(403);
    const ok = await t.as.patch(`${url}/${created.body.id}`, { status: "completed" });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body.status).toBe("completed");

    const stranger = await h.createSecondTenant({ name: "CalStranger" });
    expect([403, 404]).toContain((await stranger.as.get(url)).status);
    expect([403, 404]).toContain((await stranger.as.post(url, event)).status);

    // The endpoints left document-chasing: they are now served by one module.
    const routes = h.routes().filter((r) => r.path.includes("compliance-calendar"));
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it("[R13-34] obligations feed the task list; the service is registered and reminders fire at 30/14/7/1 days", async () => {
    restore = freezeTime("2026-06-28T06:00:00Z"); // 30 days before 2026-07-28 (Q2 VAT due)
    const t = await h.createTenant({ name: "CalTasks", companyColumns: quarterly });
    const { has, resolve } = await import("../../server/platform/service-registry");
    const { listJobs } = await import("../../server/platform/job-registry");
    const { onDomainEvent, drainDomainEvents } =
      await import("../../server/platform/domain-events");
    const { runDeadlineScan } =
      await import("../../server/services/compliance-obligations.service");
    expect(has("compliance.listUpcoming")).toBe(true);
    expect(listJobs().some((j) => j.name === "compliance.deadlineScan")).toBe(true);

    const seen: Array<{ companyId: string; obligation?: string; dueDate?: string }> = [];
    const off = onDomainEvent("compliance.deadline_due", (e) => {
      if (e.payload.companyId === t.company.id) seen.push(e.payload);
    });
    try {
      await runDeadlineScan(new Date("2026-06-28T06:00:00Z"));
      await drainDomainEvents();
      expect(seen).toContainEqual(
        expect.objectContaining({ obligation: "vat_return", dueDate: "2026-07-28" })
      );
      // A second scan on the same day does not repeat the reminder.
      const before = seen.length;
      await runDeadlineScan(new Date("2026-06-28T06:00:00Z"));
      await drainDomainEvents();
      expect(seen.length).toBe(before);
    } finally {
      off();
    }
    const listUpcoming =
      resolve<
        (
          companyId: string,
          opts?: { days?: number; now?: Date }
        ) => Promise<Array<{ obligationType: string }>>
      >("compliance.listUpcoming");
    const upcoming = await listUpcoming(t.company.id, {
      days: 45,
      now: new Date("2026-06-28T06:00:00Z"),
    });
    expect(upcoming.some((u) => u.obligationType === "vat_return")).toBe(true);

    const feed = await t.as.get(
      `/api/companies/${t.company.id}/compliance-calendar/upcoming?days=45`
    );
    expect(feed.status).toBe(200);
    expect(
      feed.body.some((u: { obligationType: string }) => u.obligationType === "vat_return")
    ).toBe(true);
  });
});

describe("W4-A month-end depth (R08-23)", () => {
  it("[R08-23] accruals/prepayments/FX steps, per-step sign-off, reopen needs a reason and a different approver", async () => {
    const t = await h.createTenant({ name: "CloseDepth" });
    const accountant = await addMember(t, "accountant", "CloseAccountant");
    const base = `/api/companies/${t.company.id}/month-end`;

    const checklist = await t.as.get(`${base}/checklist?period=2025-08`);
    expect(checklist.status, checklist.text).toBe(200);
    const keys = checklist.body.checklist.map((c: { key: string }) => c.key);
    for (const k of ["accruals", "prepayments", "fx_revaluation", "bank_reconciliation"]) {
      expect(keys).toContain(k);
    }
    const fx = checklist.body.checklist.find((c: { key: string }) => c.key === "fx_revaluation");
    expect(fx.actionEndpoint).toContain("exchange-rates/revalue");

    const unknown = await accountant.as.post(`${base}/steps/bogus/sign-off`, { period: "2025-08" });
    expect(unknown.status).toBe(404);
    const signed = await accountant.as.post(`${base}/steps/vat_return/sign-off`, {
      period: "2025-08",
      note: "Quarterly filer: no August return",
    });
    expect(signed.status, signed.text).toBe(201);
    expect(signed.body).toMatchObject({ stepKey: "vat_return", signedOffBy: accountant.user.id });
    expect(signed.body.signedOffAt).toBeTruthy();
    const after = await t.as.get(`${base}/checklist?period=2025-08`);
    const vat = after.body.checklist.find((c: { key: string }) => c.key === "vat_return");
    expect(vat.signOff.signedOffBy).toBe(accountant.user.id);
    expect(vat.effectiveStatus).toBe("complete");

    // Lock (override the rest of the checklist with a reason), then reopen.
    const lock = await t.as.post(`${base}/lock-period`, {
      periodEnd: "2025-08-31",
      overrideChecklist: true,
      reason: "Test close",
    });
    expect(lock.status, lock.text).toBe(200);
    const noReason = await accountant.as.post(`${base}/reopen-requests`, {
      periodEnd: "2025-08-31",
    });
    expect(noReason.status).toBe(400);
    const request = await accountant.as.post(`${base}/reopen-requests`, {
      periodEnd: "2025-08-31",
      reason: "Late supplier invoice",
    });
    expect(request.status, request.text).toBe(201);
    const dup = await accountant.as.post(`${base}/reopen-requests`, {
      periodEnd: "2025-08-31",
      reason: "Again",
    });
    expect(dup.status).toBe(409);
    // The accountant cannot approve (not owner) and the requester cannot self-approve.
    const selfApprove = await accountant.as.post(
      `${base}/reopen-requests/${request.body.id}/approve`,
      {}
    );
    expect(selfApprove.status).toBe(403);
    const approved = await t.as.post(`${base}/reopen-requests/${request.body.id}/approve`, {
      note: "OK",
    });
    expect(approved.status, approved.text).toBe(200);
    expect(approved.body.request).toMatchObject({ status: "approved", decidedBy: t.user.id });
    expect(approved.body.period.status).toBe("open");
    const audit = await h.sql<{ action: string }>(
      `SELECT action FROM audit_logs WHERE resource_type = 'period' AND resource_id = '2025-08-31'`
    );
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("period.reopen_requested");
    expect(actions).toContain("period.reopen_approved");
    expect(actions).toContain("close.step_sign_off");
    const again = await t.as.post(`${base}/reopen-requests/${request.body.id}/approve`, {});
    expect(again.status).toBe(409);
  });
});

describe("S4 compliance GETs are read-only (W4-A follow-up)", () => {
  async function snapshot(companyId: string) {
    const [row] = await h.sql<{ n: number; sig: string }>(
      `SELECT COUNT(*)::int AS n,
              COALESCE(string_agg(id::text || ':' || status || ':' || updated_at::text, ',' ORDER BY id), '') AS sig
         FROM compliance_calendar WHERE company_id = $1`,
      [companyId]
    );
    return row;
  }

  it("[S4-compliance-get] calendar, upcoming and overview GETs write nothing yet show live obligations", async () => {
    restore = freezeTime("2026-06-01T08:00:00Z");
    const t = await h.createTenant({ name: "CalReadOnly", companyColumns: quarterly });
    const { flushObligationRefreshes } =
      await import("../../server/routes/compliance-obligation-refresh");
    await flushObligationRefreshes();
    const before = await snapshot(t.company.id);
    expect(before.n).toBe(0);

    const cal = await t.as.get(
      `/api/companies/${t.company.id}/compliance-calendar?from=2026-01-01&to=2026-12-31`
    );
    expect(cal.status, cal.text).toBe(200);
    const vat = (cal.body as Array<Record<string, unknown>>).filter(
      (r) => r.obligationType === "vat_return"
    );
    expect(vat).toHaveLength(4);
    expect(vat[0]).toMatchObject({ persisted: false, id: "preview:vat:2025-12-31" });
    expect(vat[0].status).toBe("overdue");
    const upcoming = await t.as.get(
      `/api/companies/${t.company.id}/compliance-calendar/upcoming?days=60`
    );
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.length).toBeGreaterThan(0);
    const overview = await t.as.get(`/api/companies/${t.company.id}/compliance/overview`);
    expect(overview.status, overview.text).toBe(200);
    expect(overview.body.vatStatus.filingStatus).toBe("overdue");
    await flushObligationRefreshes();
    expect(await snapshot(t.company.id)).toEqual(before);

    // A settings change (VAT stagger) refreshes the stored calendar after the write.
    const patched = await t.as.patch(`/api/companies/${t.company.id}`, {
      vatFilingFrequency: "Monthly",
    });
    expect(patched.status, patched.text).toBe(200);
    await flushObligationRefreshes();
    const stored = await h.sql<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM compliance_calendar
        WHERE company_id = $1 AND obligation_type = 'vat_return'
          AND EXTRACT(YEAR FROM event_date) = 2026`,
      [t.company.id]
    );
    expect(stored[0].n).toBe(12);
    const afterRefresh = await snapshot(t.company.id);
    await t.as.get(`/api/companies/${t.company.id}/compliance-calendar`);
    await t.as.get(`/api/companies/${t.company.id}/compliance/overview`);
    await flushObligationRefreshes();
    expect(await snapshot(t.company.id)).toEqual(afterRefresh);
  });

  it("[S4-compliance-get] a preview obligation can be completed: the PATCH stores the calendar first", async () => {
    restore = freezeTime("2026-06-01T08:00:00Z");
    const t = await h.createTenant({ name: "CalPreviewPatch" });
    const cal = await t.as.get(`/api/companies/${t.company.id}/compliance-calendar`);
    const ubo = (cal.body as Array<{ id: string; obligationKey: string }>).find(
      (r) => r.obligationKey === "ubo:2026"
    );
    expect(ubo?.id).toBe("preview:ubo:2026");
    const done = await t.as.patch(
      `/api/companies/${t.company.id}/compliance-calendar/${encodeURIComponent(ubo!.id)}`,
      { status: "completed" }
    );
    expect(done.status, done.text).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", persisted: true });
    const bogus = await t.as.patch(
      `/api/companies/${t.company.id}/compliance-calendar/preview:nope`,
      { status: "completed" }
    );
    expect(bogus.status).toBe(404);
  });

  it("[S4-compliance-get] filing a corporate tax return refreshes the stored row's status", async () => {
    restore = freezeTime("2026-06-01T08:00:00Z");
    const t = await h.createTenant({ name: "CalCtRefresh" });
    const reviewer = await addMember(t, "accountant", "CalCtRefreshReviewer");
    const { flushObligationRefreshes } =
      await import("../../server/routes/compliance-obligation-refresh");
    const created = await t.as.post(`/api/companies/${t.company.id}/corporate-tax/returns`, {
      taxPeriodStart: "2025-01-01",
      taxPeriodEnd: "2025-12-31",
      totalRevenue: 1_000_000,
      totalExpenses: 400_000,
    });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id;
    await t.as.post(`/api/corporate-tax/returns/${id}/transition`, { to: "computed" });
    await reviewer.as.post(`/api/corporate-tax/returns/${id}/transition`, { to: "reviewed" });
    const filed = await t.as.post(`/api/corporate-tax/returns/${id}/transition`, {
      to: "filed",
      filingReference: "FTA-REF-CAL",
    });
    expect(filed.status, filed.text).toBe(200);
    await flushObligationRefreshes();
    const rows = await h.sql<{ status: string; related_entity_id: string }>(
      `SELECT status, related_entity_id FROM compliance_calendar
        WHERE company_id = $1 AND obligation_key = 'ct:2025-12-31'`,
      [t.company.id]
    );
    expect(rows).toEqual([{ status: "completed", related_entity_id: id }]);
  });
});
