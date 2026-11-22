import { expect, it, vi } from "vitest";
import { useHarness, type Tenant } from "./harness";

const sheets = vi.hoisted(() => ({
  importInvoicesFromSheet: vi.fn(),
  importExpensesFromSheet: vi.fn(),
}));

vi.mock("../../server/integrations/googleSheets", () => ({
  isGoogleSheetsConnected: vi.fn(async () => true),
  ...sheets,
}));

const h = useHarness();

type ImportKind = "invoices" | "expenses";

function setRows(kind: ImportKind, dates: string[]) {
  if (kind === "invoices") {
    sheets.importInvoicesFromSheet.mockResolvedValue(
      dates.map((issueDate, index) => ({
        issueDate,
        invoiceNumber: `SHEET-${index + 1}`,
        customerName: `Customer ${index + 1}`,
        customerTrn: "",
        subtotal: 100,
        vatAmount: 5,
        total: 105,
        status: "draft",
      }))
    );
  } else {
    sheets.importExpensesFromSheet.mockResolvedValue(
      dates.map((date, index) => ({
        date,
        merchant: `Merchant ${index + 1}`,
        category: "Office",
        amount: 105,
        vatAmount: 5,
      }))
    );
  }
}

function importFromSheet(tenant: Tenant, kind: ImportKind) {
  return tenant.as.post(`/api/integrations/google-sheets/import/${kind}`, {
    companyId: tenant.company.id,
    sheetUrl: "https://docs.google.com/spreadsheets/d/offline-fixture/edit",
  });
}

async function importFootprint(companyId: string) {
  const [row] = await h.sql(
    `SELECT
      (SELECT count(*)::integer FROM invoices WHERE company_id = $1) AS invoices,
      (SELECT count(*)::integer FROM receipts WHERE company_id = $1) AS receipts,
      (SELECT count(*)::integer FROM invoice_number_sequences WHERE company_id = $1) AS sequences,
      (SELECT count(*)::integer FROM integration_syncs WHERE company_id = $1) AS history`,
    [companyId]
  );
  return row;
}

const emptyImport = { invoices: 0, receipts: 0, sequences: 0, history: 0 };

it.each(["invoices", "expenses"] as const)(
  "Sheets %s import rejects a fiscal close without persisting the open row or sync history",
  async (kind) => {
    const tenant = await h.createTenant({ planId: "enterprise" });
    const { closeFiscalYear } = await import("../../server/services/month-end.service");
    await closeFiscalYear(tenant.company.id, "2025-12-31", tenant.user.id, { hardClose: true });

    setRows(kind, ["2026-01-01", "2025-12-31"]);
    const refused = await importFromSheet(tenant, kind);
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("PERIOD_LOCKED");
    expect(await importFootprint(tenant.company.id)).toEqual(emptyImport);

    setRows(kind, ["2026-01-01"]);
    const accepted = await importFromSheet(tenant, kind);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.body.recordCount).toBe(1);
    expect(await importFootprint(tenant.company.id)).toEqual({
      invoices: kind === "invoices" ? 1 : 0,
      receipts: kind === "expenses" ? 1 : 0,
      sequences: 0,
      history: 1,
    });
    if (kind === "invoices") {
      expect(
        await h.sql("SELECT number FROM invoices WHERE company_id = $1", [tenant.company.id])
      ).toEqual([{ number: "SHEET-1" }]);
    }
  }
);

it.skipIf(process.env.HARNESS_MODE !== "postgres").each(["invoices", "expenses"] as const)(
  "Sheets %s import waits for an in-flight close and rechecks the period before writing",
  async (kind) => {
    const tenant = await h.createTenant({ planId: "enterprise" });
    const { closeFiscalYear } = await import("../../server/services/month-end.service");
    const { withLedgerTx } = await import("../../server/ledger/tx");
    const closeReady = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const closing = withLedgerTx(async (tx) => {
      await closeFiscalYear(
        tenant.company.id,
        "2025-12-31",
        tenant.user.id,
        { hardClose: true },
        tx
      );
      closeReady.resolve();
      await release.promise;
    });

    let importing: ReturnType<typeof importFromSheet> | undefined;
    try {
      await Promise.race([closeReady.promise, closing]);
      setRows(kind, ["2025-12-31"]);
      let completed = false;
      importing = importFromSheet(tenant, kind).finally(() => {
        completed = true;
      });
      await vi.waitFor(async () => {
        const [row] = await h.sql<{ waiting: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM pg_locks
           WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
             AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        ) AS waiting`);
        expect(row.waiting || completed).toBe(true);
      });
      expect(completed).toBe(false);
    } finally {
      release.resolve();
      await Promise.allSettled([closing, importing]);
    }
    await closing;
    const refused = await importing!;
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body.code).toBe("PERIOD_LOCKED");
    expect(await importFootprint(tenant.company.id)).toEqual(emptyImport);
  }
);

it.each(["invoices", "expenses"] as const)(
  "Sheets %s import rejects missing dates without assigning the current date",
  async (kind) => {
    const tenant = await h.createTenant({ planId: "enterprise" });
    setRows(kind, [""]);
    const rejected = await importFromSheet(tenant, kind);
    expect(rejected.status, rejected.text).toBe(400);
    expect(rejected.body.code).toBe("VALIDATION_ERROR");
    expect(await importFootprint(tenant.company.id)).toEqual(emptyImport);
  }
);

it("preserves the two sheet date formats and rejects impossible calendar dates", async () => {
  const tenant = await h.createTenant({ planId: "enterprise" });
  setRows("expenses", ["31/02/2026"]);
  const rejected = await importFromSheet(tenant, "expenses");
  expect(rejected.status, rejected.text).toBe(400);
  expect(rejected.body.code).toBe("VALIDATION_ERROR");
  expect(await importFootprint(tenant.company.id)).toEqual(emptyImport);

  setRows("expenses", ["05/01/26"]);
  const accepted = await importFromSheet(tenant, "expenses");
  expect(accepted.status, accepted.text).toBe(200);
  expect(accepted.body.recordCount).toBe(1);
  expect(
    await h.sql("SELECT date::date::text FROM receipts WHERE company_id = $1", [tenant.company.id])
  ).toEqual([{ date: "2026-01-05" }]);

  setRows("invoices", ["05/01/26"]);
  const invoice = await importFromSheet(tenant, "invoices");
  expect(invoice.status, invoice.text).toBe(200);
  expect(invoice.body.recordCount).toBe(1);
  expect(
    await h.sql("SELECT date::date::text FROM invoices WHERE company_id = $1", [tenant.company.id])
  ).toEqual([{ date: "2026-05-01" }]);
});
