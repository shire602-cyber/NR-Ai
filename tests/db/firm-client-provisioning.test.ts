import { expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const postgresOnly = it.skipIf(process.env.HARNESS_MODE !== "postgres");

type Response = Awaited<ReturnType<Tenant["as"]["post"]>>;

async function provisioningFootprint() {
  const [counts] = await h.sql(`SELECT
    (SELECT count(*)::integer FROM companies) AS companies,
    (SELECT count(*)::integer FROM subscriptions) AS subscriptions,
    (SELECT count(*)::integer FROM engagements) AS engagements,
    (SELECT count(*)::integer FROM accounts) AS accounts,
    (SELECT count(*)::integer FROM firm_client_links) AS links,
    (SELECT count(*)::integer FROM firm_staff_assignments) AS assignments,
    (SELECT count(*)::integer FROM firm_company_grants) AS grants,
    (SELECT count(*)::integer FROM company_users) AS memberships,
    (SELECT count(*)::integer FROM activity_logs) AS activity`);
  return counts;
}

async function waitForUserLock(userId: string, count: number) {
  await vi.waitFor(
    async () => {
      const [row] = await h.sql<{ waiting: number }>(
        `SELECT count(*)::integer AS waiting FROM pg_locks
          WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND locktype = 'advisory' AND NOT granted
            AND classid = hashtext('firm_timer_user')::bit(32)::bigint
            AND objid = hashtext($1)::bit(32)::bigint`,
        [userId]
      );
      expect(row.waiting).toBe(count);
    },
    { timeout: 5000 }
  );
}

postgresOnly.each(["create", "import"] as const)(
  "client %s leaves no provisioning writes when the caller loses access while waiting",
  async (operation) => {
    const owner = await h.createTenant({ firmRole: "firm_owner" });
    const staff = await h.createTenant({ firmRole: "firm_admin" });
    const name = `Provisioning raced ${operation}`;
    const before = await provisioningFootprint();
    const { pool } = await import("../../server/db");
    const blocker = await pool.connect();
    let downgrade: Promise<Response> | undefined;
    let provisioning: Promise<Response> | undefined;

    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtext('firm_timer_user'), hashtext($1))",
        [staff.user.id]
      );
      downgrade = owner.as.patch(`/api/firm/members/${staff.user.id}`, { role: "viewer" });
      await waitForUserLock(staff.user.id, 1);
      provisioning =
        operation === "create"
          ? staff.as.post("/api/firm/clients", { name })
          : staff.as.post("/api/firm/clients/import", { rows: [{ name }, { name: `${name} 2` }] });
      await waitForUserLock(staff.user.id, 2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([downgrade, provisioning]);
    }

    const changed = await downgrade!;
    expect(changed.status, changed.text).toBe(200);
    expect(await provisioningFootprint()).toEqual(before);
    const denied = await provisioning!;
    expect(denied.status, denied.text).toBe(403);
    expect(denied.body.code).toBe("FIRM_PERMISSION_DENIED");
  }
);

async function withProvisioningLogFailure<T>(run: () => Promise<T>) {
  // A late write failure exercises rollback of the company, plan, seeded accounts and access.
  await h.sql(`CREATE FUNCTION reject_provisioning_log() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id
        AND name IN ('Atomic client create', 'Atomic client import')) THEN
        RAISE EXCEPTION 'Injected provisioning log failure';
      END IF;
      RETURN NEW;
    END $$`);
  try {
    await h.sql(`CREATE TRIGGER reject_provisioning_log BEFORE INSERT ON activity_logs
      FOR EACH ROW EXECUTE FUNCTION reject_provisioning_log()`);
    return await run();
  } finally {
    await h.sql("DROP TRIGGER IF EXISTS reject_provisioning_log ON activity_logs");
    await h.sql("DROP FUNCTION reject_provisioning_log()");
  }
}

postgresOnly(
  "client create rolls back every write when the last provisioning write fails",
  async () => {
    const staff = await h.createTenant({ firmRole: "firm_admin" });
    const name = "Atomic client create";
    const before = await provisioningFootprint();
    const result = await withProvisioningLogFailure(() =>
      staff.as.post("/api/firm/clients", { name })
    );
    expect(result.status, result.text).toBe(500);
    expect(await provisioningFootprint()).toEqual(before);

    const retried = await staff.as.post("/api/firm/clients", { name });
    expect(retried.status, retried.text).toBe(201);
    expect(retried.body.name).toBe(name);
  }
);

postgresOnly("client import rolls back a failed row and commits its valid neighbors", async () => {
  const staff = await h.createTenant({ firmRole: "firm_admin" });
  const name = "Atomic client import";
  const fileData = Buffer.from(
    `Company Name,Emirate\n${name} first,Dubai\n${name},Dubai\n${name} last,Dubai\n`
  ).toString("base64");
  const result = await withProvisioningLogFailure(() =>
    staff.as.post("/api/firm/clients/import", {
      fileData,
      fileName: "clients.csv",
    })
  );

  expect(result.status, result.text).toBe(200);
  expect(result.body.created).toEqual([
    { id: expect.any(String), name: `${name} first` },
    { id: expect.any(String), name: `${name} last` },
  ]);
  expect(result.body.errors).toEqual([
    {
      row: 2,
      name,
      code: "ROW_FAILED",
      error: "The client could not be created. Try this row again.",
    },
  ]);
  expect(await h.sql("SELECT id FROM companies WHERE name = $1", [name])).toEqual([]);

  const retried = await staff.as.post("/api/firm/clients/import", { rows: [{ name }] });
  expect(retried.status, retried.text).toBe(200);
  expect(retried.body.created).toEqual([{ id: expect.any(String), name }]);
  expect(retried.body.errors).toEqual([]);
});

postgresOnly("client import reports safe file errors and accepts an XLSX workbook", async () => {
  const staff = await h.createTenant({ firmRole: "firm_admin" });
  const invalidFile = Buffer.from("not a spreadsheet").toString("base64");

  const unsupported = await staff.as.post("/api/firm/clients/import", {
    fileData: invalidFile,
    fileName: "clients.xls",
  });
  expect(unsupported.status, unsupported.text).toBe(400);
  expect(unsupported.body).toEqual({
    code: "CLIENT_IMPORT_FILE_TYPE",
    message: "Choose a CSV or XLSX file.",
  });

  const unreadable = await staff.as.post("/api/firm/clients/import", {
    fileData: invalidFile,
    fileName: "clients.xlsx",
  });
  expect(unreadable.status, unreadable.text).toBe(400);
  expect(unreadable.body).toEqual({
    code: "CLIENT_IMPORT_UNREADABLE",
    message: "The import file could not be read. Check the file format and try again.",
  });

  const { createSpreadsheetBuffer } = await import("../../server/services/spreadsheet.service");
  const workbook = await createSpreadsheetBuffer({
    sheetName: "Clients",
    columns: [{ key: "name", header: "Company Name" }],
    rows: [{ name: "Client Workbook Import" }],
  });
  const imported = await staff.as.post("/api/firm/clients/import", {
    fileData: workbook.toString("base64"),
    fileName: "clients.XLSX",
  });
  expect(imported.status, imported.text).toBe(200);
  expect(imported.body.created).toEqual([
    { id: expect.any(String), name: "Client Workbook Import" },
  ]);
  expect(imported.body.errors).toEqual([]);
});
