import { expect, it, vi } from "vitest";
import { freezeTime, useHarness } from "./harness";

const h = useHarness();
const endpoint = "/api/firm/bulk/invoices";
const invoiceDay = "2026-06-30";
const amount = 10.01;

async function createClient(firm: Awaited<ReturnType<typeof h.createTenant>>, name: string) {
  const result = await firm.as.post("/api/firm/clients", {
    name,
    trnVatNumber: "100000000000003",
    emirate: "dubai",
  });
  expect(result.status, result.text).toBe(201);
  return result.body.id as string;
}

async function invoiceRows(companyId: string) {
  return h.sql(
    `SELECT number, subtotal::text, vat_amount::text, total::text, status
       FROM invoices WHERE company_id = $1`,
    [companyId]
  );
}

it.skipIf(process.env.HARNESS_MODE !== "postgres")(
  "waits for a pending period close before bulk invoicing and still creates the open client's draft",
  async () => {
    const firm = await h.createTenant({ name: "Bulk invoice period", firmRole: "firm_owner" });
    const closed = await createClient(firm, "Closed client");
    const open = await createClient(firm, "Open client");
    const { withLedgerTx } = await import("../../server/ledger/tx");
    const { lockPeriod } = await import("../../server/services/month-end.service");
    const restoreTime = freezeTime("2026-06-29T22:00:00Z"); // June 30 in the UAE.
    const inserted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const closing = withLedgerTx(async (tx) => {
      await lockPeriod(closed, invoiceDay, firm.user.id, {}, tx);
      inserted.resolve();
      await release.promise;
    });

    let creating: ReturnType<typeof firm.as.post> | undefined;
    try {
      await Promise.race([inserted.promise, closing]);
      let completed = false;
      creating = firm.as
        .post(endpoint, { companyIds: [closed, open], serviceDescription: "Advisory", amount })
        .finally(() => {
          completed = true;
        });
      await vi.waitFor(
        async () => {
          const [row] = await h.sql<{ waiting: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM pg_locks
              WHERE locktype = 'advisory' AND mode = 'ShareLock' AND NOT granted
                AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
            ) AS waiting`);
          expect(row.waiting || completed).toBe(true);
        },
        { timeout: 6000 }
      );
    } finally {
      release.resolve();
      try {
        await Promise.all([closing, creating]);
      } finally {
        restoreTime();
      }
    }

    const result = await creating!;
    expect(result.status, result.text).toBe(200);
    expect(result.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: closed, success: false, code: "PERIOD_LOCKED" }),
        expect.objectContaining({
          companyId: open,
          success: true,
          invoiceNumber: "INV-2026-00001",
        }),
      ])
    );
    expect(await invoiceRows(closed)).toEqual([]);
    expect(await invoiceRows(open)).toEqual([
      {
        number: "INV-2026-00001",
        subtotal: "10.01",
        vat_amount: "0.50",
        total: "10.51",
        status: "draft",
      },
    ]);
    const lines = await h.sql(
      `SELECT i.date::date::text, il.description, il.net_amount::text, il.vat_supply_type
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
       WHERE i.company_id = $1`,
      [open]
    );
    expect(lines).toEqual([
      {
        date: invoiceDay,
        description: "Advisory",
        net_amount: "10.01",
        vat_supply_type: "standard_rated",
      },
    ]);
  }
);

it("rolls back a bulk invoice and its number when its line cannot be saved", async () => {
  const firm = await h.createTenant({ name: "Bulk line rollback", firmRole: "firm_owner" });
  const client = await createClient(firm, "Advisory client");
  const restoreTime = freezeTime(`${invoiceDay}T12:00:00Z`);
  try {
    await h.sql(`ALTER TABLE invoice_lines ADD CONSTRAINT test_bulk_invoice_line_write
                 CHECK (description <> 'Refused line') NOT VALID`);
    try {
      const failed = await firm.as.post(endpoint, {
        companyIds: [client],
        serviceDescription: "Refused line",
        amount,
      });
      expect(failed.status, failed.text).toBe(200);
      expect(failed.body.results).toEqual([
        expect.objectContaining({ companyId: client, success: false }),
      ]);
      expect(await invoiceRows(client)).toEqual([]);
    } finally {
      await h.sql("ALTER TABLE invoice_lines DROP CONSTRAINT test_bulk_invoice_line_write");
    }

    const created = await firm.as.post(endpoint, {
      companyIds: [client],
      serviceDescription: "Successful line",
      amount,
      vatRate: 0,
    });
    expect(created.status, created.text).toBe(200);
    expect(created.body.results).toEqual([
      expect.objectContaining({
        companyId: client,
        success: true,
        invoiceNumber: "INV-2026-00001",
      }),
    ]);
  } finally {
    restoreTime();
  }
});
