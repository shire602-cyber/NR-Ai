import { expect, it, vi } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const path = "/api/firm/clients";

async function portfolio(scenario: string) {
  const owner = await h.createTenant({ name: "Portfolio owner", firmRole: "firm_owner" });
  const staff = await h.createTenant({ name: "Portfolio staff", firmRole: "firm_admin" });
  const openName = `Portfolio A Open ${scenario}`;
  const protectedName = `Portfolio Z Protected ${scenario}`;

  async function addClient(name: string) {
    const created = await owner.as.post(path, { name });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;
    const assigned = await owner.as.post(`${path}/${id}/assign-staff`, {
      staffUserId: staff.user.id,
      action: "assign",
    });
    expect(assigned.status, assigned.text).toBe(200);
    return id;
  }

  const openId = await addClient(openName);
  const protectedId = await addClient(protectedName);
  const invoice = await owner.as.post(`/api/companies/${protectedId}/invoices`, {
    date: "2026-11-20",
    customerName: "Portfolio private customer",
    lines: [
      {
        description: "Services",
        quantity: 1,
        unitPrice: 120,
        vatRate: 0,
        vatSupplyType: "out_of_scope",
      },
    ],
  });
  expect(invoice.status, invoice.text).toBe(200);
  const { setCompanyMfaPolicy } = await import("../../server/services/security/policy");
  return {
    owner,
    staff,
    openId,
    openName,
    protectedId,
    protectedName,
    protect: () => setCompanyMfaPolicy(protectedId, "all", owner.user.id),
  };
}

it("requires enrollment for portfolio stats, without blocking names or an unrelated page", async () => {
  const { staff, openId, openName, protectedId, protectedName, protect } = await portfolio("pages");
  const warmed = await staff.as.get(path);
  expect(warmed.status, warmed.text).toBe(200);
  expect(warmed.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: protectedId, invoiceCount: 1, invoiceTotal: 120 }),
    ])
  );
  await protect();

  const names = await staff.as.get(`${path}?view=names`);
  expect(names.status, names.text).toBe(200);
  expect(names.body).toEqual([
    { id: openId, name: openName },
    { id: protectedId, name: protectedName },
  ]);
  const openPage = await staff.as.get(`${path}?sort=name&limit=1`);
  expect(openPage.status, openPage.text).toBe(200);
  expect(openPage.headers.get("x-total-count")).toBe("2");
  expect(openPage.body).toEqual([expect.objectContaining({ id: openId, invoiceCount: 0 })]);
  const openSearch = await staff.as.get(
    `${path}?q=${encodeURIComponent(openName)}&sort=invoiceCount`
  );
  expect(openSearch.status, openSearch.text).toBe(200);
  expect(openSearch.body).toEqual([expect.objectContaining({ id: openId, invoiceCount: 0 })]);
  const emptyPage = await staff.as.get(`${path}?sort=invoiceCount&limit=1&offset=2`);
  expect(emptyPage.status, emptyPage.text).toBe(200);
  expect(emptyPage.body).toEqual([]);

  const urls = [
    path,
    `${path}?sort=name&limit=1&offset=1`,
    `${path}?q=${encodeURIComponent(protectedName)}`,
    ...["invoiceCount", "outstandingAr", "vatDueDate"].map((key) => `${path}?sort=${key}&limit=1`),
  ];
  for (const url of urls) {
    const blocked = await staff.as.get(url);
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
      details: { companyId: protectedId },
    });
    expect(blocked.text).not.toContain("invoiceTotal");
    expect((await staff.as.request("HEAD", url)).status).toBe(403);
  }

  await h.sql("UPDATE users SET mfa_enabled = true WHERE id = $1", [staff.user.id]);
  const enrolled = await staff.as.get(`${path}?sort=invoiceCount&order=desc&limit=1`);
  expect(enrolled.status, enrolled.text).toBe(200);
  expect(enrolled.body).toEqual([
    expect.objectContaining({ id: protectedId, invoiceCount: 1, invoiceTotal: 120 }),
  ]);
});

it("never evaluates another client's policy for an unassigned portfolio user", async () => {
  const { owner, openId, protectedName, protect } = await portfolio("assignment");
  const staff = await h.createTenant({ name: "Open-only portfolio staff", firmRole: "firm_admin" });
  const assigned = await owner.as.post(`${path}/${openId}/assign-staff`, {
    staffUserId: staff.user.id,
    action: "assign",
  });
  expect(assigned.status, assigned.text).toBe(200);
  await protect();

  const allowed = await staff.as.get(`${path}?sort=invoiceCount`);
  expect(allowed.status, allowed.text).toBe(200);
  expect(allowed.body).toEqual([expect.objectContaining({ id: openId, invoiceCount: 0 })]);
  const absent = await staff.as.get(`${path}?q=${encodeURIComponent(protectedName)}`);
  expect(absent.status, absent.text).toBe(200);
  expect(absent.body).toEqual([]);
  expect(absent.headers.get("x-total-count")).toBe("0");
});

it.skipIf(process.env.HARNESS_MODE !== "postgres").each(["name", "invoiceCount"])(
  "checks MFA before reading invoice stats when sorted by %s",
  async (key) => {
    const { staff, protectedName, protect } = await portfolio(`lock-${key}`);
    await protect();
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let request: ReturnType<typeof staff.as.get> | undefined;
    let responded = false;
    let waitingForInvoices = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE invoices IN ACCESS EXCLUSIVE MODE");
      request = staff.as
        .get(`${path}?q=${encodeURIComponent(protectedName)}&sort=${key}`)
        .finally(() => {
          responded = true;
        });
      await vi.waitFor(async () => {
        const [state] = await h.sql<{ waiting: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks WHERE locktype = 'relation'
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND relation = 'invoices'::regclass AND NOT granted
          ) AS waiting`);
        waitingForInvoices = state.waiting;
        expect(responded || waitingForInvoices).toBe(true);
      });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await request;
    }
    const blocked = await request!;
    expect(waitingForInvoices).toBe(false);
    expect(blocked.status, blocked.text).toBe(403);
    expect(blocked.body.code).toBe("MFA_ENROLLMENT_REQUIRED");
  }
);
