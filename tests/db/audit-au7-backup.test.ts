import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { accountByCode, type Tenant, useHarness } from "./harness";

const h = useHarness();

async function snapshot(t: Tenant) {
  const response = await t.as.post(`/api/companies/${t.company.id}/backups`, {
    name: "AU7 accounting snapshot",
  });
  expect(response.status, response.text).toBe(201);
  return response.body as { id: string; name: string };
}

async function makeLegacy(
  backupId: string,
  change: (tables: Record<string, unknown[]>) => void = () => {}
) {
  const { openSnapshot, sealSnapshot } = await import("../../server/services/backup.service");
  const [row] = await h.sql<{ data_snapshot: string; checksum: string }>(
    "SELECT data_snapshot, checksum FROM backups WHERE id = $1",
    [backupId]
  );
  const snapshot = openSnapshot(row.data_snapshot, row.checksum).snapshot;
  if (!("tables" in snapshot)) throw new Error("Expected an accounting snapshot");
  change(snapshot.tables);
  const { sealed, checksum } = sealSnapshot({
    version: "2.0",
    companyId: snapshot.companyId,
    createdAt: snapshot.createdAt,
    tables: snapshot.tables,
  });
  await h.sql("UPDATE backups SET data_snapshot = $2, checksum = $3 WHERE id = $1", [
    backupId,
    sealed,
    checksum,
  ]);
}

function restore(
  t: Tenant,
  backup: { id: string; name: string },
  mode: "merge" | "replace",
  key?: string
) {
  return t.as.post(
    `/api/backups/${backup.id}/restore`,
    {
      mode,
      confirmRestore: true,
      confirmName: backup.name,
    },
    key ? { headers: { "Idempotency-Key": key } } : undefined
  );
}

function replace(t: Tenant, backup: { id: string; name: string }, key?: string) {
  return restore(t, backup, "replace", key);
}

async function expectRestoreConflict(
  t: Tenant,
  backup: { id: string; name: string },
  table: string,
  mode: "merge" | "replace"
) {
  const preRestoreBackups = () =>
    h.sql(
      "SELECT id FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore' ORDER BY id",
      [t.company.id]
    );
  const before = await preRestoreBackups();
  for (const response of [
    await t.as.post(`/api/backups/${backup.id}/restore-preview`, { mode }),
    await restore(t, backup, mode),
  ]) {
    expect(response.status, response.text).toBe(409);
    expect(response.body).toMatchObject({
      code: "BACKUP_RESTORE_CONFLICT",
      details: { table },
    });
  }
  expect(await preRestoreBackups()).toEqual(before);
}

function expectReplaceConflict(t: Tenant, backup: { id: string; name: string }, table: string) {
  return expectRestoreConflict(t, backup, table, "replace");
}

async function draftInvoice(t: Tenant, contactId?: string): Promise<string> {
  const response = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    customerName: "Fixture customer",
    contactId,
    date: new Date().toISOString().slice(0, 10),
    lines: [
      {
        description: "Consulting",
        quantity: 1,
        unitPrice: 120,
        vatRate: 0,
        vatSupplyType: "zero_rated",
      },
    ],
  });
  expect(response.status, response.text).toBe(200);
  expect(response.body.status).toBe("draft");
  return response.body.id;
}

async function issueInvoice(t: Tenant, invoiceId: string) {
  const response = await t.as.patch(`/api/invoices/${invoiceId}/status`, { status: "sent" });
  expect(response.status, response.text).toBe(200);
}

async function recordPartialPayment(t: Tenant, invoiceId: string, bankId: string) {
  const payment = await t.as.post(`/api/companies/${t.company.id}/invoices/${invoiceId}/payments`, {
    date: new Date().toISOString().slice(0, 10),
    method: "bank",
    amount: 30,
    paymentAccountId: bankId,
  });
  expect(payment.status, payment.text).toBe(201);
}

async function partiallyPaidInvoice(t: Tenant, bankId: string, contactId?: string) {
  const invoiceId = await draftInvoice(t, contactId);
  await issueInvoice(t, invoiceId);
  await recordPartialPayment(t, invoiceId, bankId);
  return invoiceId;
}

async function issuePartialCreditNote(t: Tenant, invoiceId: string): Promise<string> {
  const response = await t.as.post(
    `/api/companies/${t.company.id}/invoices/${invoiceId}/credit-note`,
    {
      lines: [
        {
          description: "Partial credit",
          quantity: 1,
          unitPrice: 20,
          vatRate: 0,
          vatSupplyType: "zero_rated",
        },
      ],
    }
  );
  expect(response.status, response.text).toBe(201);
  return response.body.id;
}

async function journalLines(t: Tenant, sourceId: string) {
  return h.sql(
    `SELECT l.* FROM journal_lines l JOIN journal_entries j ON j.id = l.entry_id
     WHERE j.company_id = $1 AND j.source_id = $2 AND j.status = 'posted' ORDER BY l.id`,
    [t.company.id, sourceId]
  );
}

async function createPaymentLinkFixture(t: Tenant, invoiceId: string) {
  const token = randomBytes(24).toString("hex");
  const [link] = await h.sql<{ id: string }>(
    `INSERT INTO payment_links (company_id, invoice_id, provider, token_hash, amount_fils, currency, expires_at)
     VALUES ($1, $2, 'stripe', $3, 12000, 'AED', now() + interval '1 day') RETURNING id`,
    [t.company.id, invoiceId, createHash("sha256").update(token).digest("hex")]
  );
  return { invoiceId, linkId: link.id, token };
}

async function startCheckout(
  t: Tenant,
  invoiceId: string,
  depositAccountId: string,
  amountFils: number
) {
  const { setStripeFetch } = await import("../../server/services/payments");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_au7");
  vi.stubEnv("INVOICE_PAYMENTS_ENABLED", "true");
  vi.stubEnv("STRIPE_INVOICE_WEBHOOK_SECRET", "whsec_test_au7");
  const sessionId = `cs_test_${invoiceId}`;
  setStripeFetch(async (_url, init) => {
    expect(new URLSearchParams(init.body).get("line_items[0][price_data][unit_amount]")).toBe(
      String(amountFils)
    );
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: sessionId,
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      }),
    };
  });
  try {
    const link = await t.as.post(
      `/api/companies/${t.company.id}/invoices/${invoiceId}/payment-links`,
      { depositAccountId }
    );
    expect(link.status, link.text).toBe(201);
    const checkout = await h.anon.get(new URL(link.body.url).pathname);
    expect(checkout.status, checkout.text).toBe(303);
    expect(
      await h.sql("SELECT provider_session_id FROM payment_links WHERE id = $1", [link.body.id])
    ).toEqual([{ provider_session_id: sessionId }]);
  } finally {
    setStripeFetch(null);
    vi.unstubAllEnvs();
  }
}

async function startCheckoutWithClearingFallback(t: Tenant, invoiceId: string) {
  const deposit = await t.as.post(`/api/companies/${t.company.id}/accounts`, {
    code: "1028",
    nameEn: "Temporary checkout deposits",
    type: "asset",
    subType: "bank",
  });
  expect(deposit.status, deposit.text).toBe(201);
  await startCheckout(t, invoiceId, deposit.body.id, 12000);
  const deleted = await t.as.delete(`/api/accounts/${deposit.body.id}`);
  expect(deleted.status, deleted.text).toBe(200);
  expect(
    await h.sql("SELECT deposit_account_id FROM payment_links WHERE invoice_id = $1", [invoiceId])
  ).toEqual([{ deposit_account_id: null }]);
}

async function seedPaymentLink(t: Tenant) {
  const [invoice] = await h.sql<{ id: string }>(
    `INSERT INTO invoices (company_id, number, customer_name, date, total)
     VALUES ($1, 'AU7-LINK', 'Fixture customer', now(), 120) RETURNING id`,
    [t.company.id]
  );
  return createPaymentLinkFixture(t, invoice.id);
}

describe("AU7 accounting backup integrity", () => {
  it("keeps a cancelled public payment link inactive when restoring a legacy snapshot", async () => {
    const t = await h.createTenant();
    const { linkId, token } = await seedPaymentLink(t);
    const backup = await snapshot(t);
    const [active] = await h.sql<{ data: unknown }>(
      "SELECT to_jsonb(l) AS data FROM payment_links l WHERE id = $1",
      [linkId]
    );
    await makeLegacy(backup.id, (tables) => {
      expect(tables).not.toHaveProperty("payment_links");
      tables.payment_links = [active.data];
    });
    const { cancelPaymentLink } = await import("../../server/services/payments");
    expect(await cancelPaymentLink(t.company.id, linkId)).toBe(true);

    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    const checkout = await h.anon.get(`/api/portal/pay/${token}`);
    expect(checkout.status, checkout.text).toBe(410);
    expect(checkout.body.code).toBe("PAYMENT_LINK_INACTIVE");
    expect(await h.sql("SELECT status FROM payment_links WHERE id = $1", [linkId])).toEqual([
      { status: "cancelled" },
    ]);
  });

  it("keeps a payment gateway receipt, its link and its invoice through replace", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const { invoiceId, linkId } = await seedPaymentLink(t);
    const eventId = randomUUID();
    await h.sql(
      `INSERT INTO payment_gateway_events (provider, event_id, type, payment_link_id)
       VALUES ('stripe', $1, 'checkout.session.completed', $2)`,
      [eventId, linkId]
    );

    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    expect(await h.sql("SELECT id FROM invoices WHERE id = $1", [invoiceId])).toEqual([
      { id: invoiceId },
    ]);
    expect(await h.sql("SELECT invoice_id FROM payment_links WHERE id = $1", [linkId])).toEqual([
      { invoice_id: invoiceId },
    ]);
    expect(
      await h.sql("SELECT payment_link_id FROM payment_gateway_events WHERE event_id = $1", [
        eventId,
      ])
    ).toEqual([{ payment_link_id: linkId }]);
  });

  it.each(["draft invoice", "missing issuance journal lines"])(
    "rejects replace with a live payment link and a snapshot with %s",
    async (scenario) => {
      const t = await h.createTenant();
      const invoiceId = await draftInvoice(t);
      if (scenario === "missing issuance journal lines") await issueInvoice(t, invoiceId);
      const backup = await snapshot(t);
      if (scenario === "draft invoice") {
        await issueInvoice(t, invoiceId);
      } else {
        await makeLegacy(backup.id, (tables) => {
          expect(tables.journal_lines.length).toBeGreaterThan(0);
          tables.journal_lines = [];
        });
      }
      const { linkId } = await createPaymentLinkFixture(t, invoiceId);
      const lines = await journalLines(t, invoiceId);
      expect(lines.length).toBeGreaterThan(0);

      await expectReplaceConflict(t, backup, "payment_links");

      expect(await h.sql("SELECT status FROM invoices WHERE id = $1", [invoiceId])).toEqual([
        { status: "sent" },
      ]);
      expect(await h.sql("SELECT status FROM payment_links WHERE id = $1", [linkId])).toEqual([
        { status: "active" },
      ]);
      expect(await journalLines(t, invoiceId)).toEqual(lines);
    }
  );

  it.each(["cancelled", "expired", "cancelled during checkout"])(
    "protects checkout when the payment link is %s",
    async (scenario) => {
      const t = await h.createTenant();
      const invoiceId = await draftInvoice(t);
      const backup = await snapshot(t);
      await issueInvoice(t, invoiceId);
      const lines = await journalLines(t, invoiceId);
      expect(lines.length).toBeGreaterThan(0);
      const { linkId, token } = await createPaymentLinkFixture(t, invoiceId);
      const sessionId = `cs_test_${linkId}`;
      const { cancelPaymentLink, setStripeFetch } = await import("../../server/services/payments");
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_au7");
      vi.stubEnv("INVOICE_PAYMENTS_ENABLED", "true");
      vi.stubEnv("STRIPE_INVOICE_WEBHOOK_SECRET", "whsec_test_au7");
      setStripeFetch(async () => {
        if (scenario === "cancelled during checkout") {
          expect(await cancelPaymentLink(t.company.id, linkId)).toBe(true);
          const response = await replace(t, backup);
          expect(response.status, response.text).toBe(200);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: sessionId,
            url: `https://checkout.stripe.com/c/pay/${sessionId}`,
          }),
        };
      });
      try {
        const checkout = await h.anon.get(`/api/portal/pay/${token}`);
        const linkRows = () =>
          h.sql("SELECT status, provider_session_id FROM payment_links WHERE id = $1", [linkId]);
        if (scenario === "cancelled during checkout") {
          expect(checkout.status, checkout.text).toBe(410);
          expect(checkout.body.code).toBe("PAYMENT_LINK_INACTIVE");
          expect(await linkRows()).toEqual([{ status: "cancelled", provider_session_id: null }]);
          return;
        }
        expect(checkout.status, checkout.text).toBe(303);
        if (scenario === "cancelled") {
          expect(await cancelPaymentLink(t.company.id, linkId)).toBe(true);
        } else {
          await h.sql(
            "UPDATE payment_links SET expires_at = now() - interval '1 day' WHERE id = $1",
            [linkId]
          );
          const expired = await h.anon.get(`/api/portal/pay/${token}`);
          expect(expired.status, expired.text).toBe(410);
          expect(expired.body.code).toBe("PAYMENT_LINK_EXPIRED");
        }
        await expectReplaceConflict(t, backup, "payment_links");
        expect(await linkRows()).toEqual([{ status: scenario, provider_session_id: sessionId }]);
        expect(await journalLines(t, invoiceId)).toEqual(lines);
      } finally {
        setStripeFetch(null);
        vi.unstubAllEnvs();
      }
    }
  );

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "checks payment-link eligibility after a concurrent replace commits",
    async () => {
      const t = await h.createTenant();
      const invoiceId = await draftInvoice(t);
      const backup = await snapshot(t);
      await issueInvoice(t, invoiceId);
      const bank = await accountByCode(t, "1020");
      const { pool } = await import("../../server/db");
      const gate = await pool.connect();
      const linkPath = `/api/companies/${t.company.id}/invoices/${invoiceId}/payment-links`;
      let restored: ReturnType<typeof replace> | undefined;
      let created: ReturnType<typeof t.as.post> | undefined;
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_au7");
      vi.stubEnv("INVOICE_PAYMENTS_ENABLED", "true");
      vi.stubEnv("STRIPE_INVOICE_WEBHOOK_SECRET", "whsec_test_au7");
      try {
        await gate.query("BEGIN");
        const {
          rows: [{ pid }],
        } = await gate.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid FROM invoices WHERE id = $1 FOR UPDATE",
          [invoiceId]
        );
        restored = replace(t, backup);
        const waitingRestore = () =>
          h.sql<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
             WHERE query LIKE 'SELECT count(*) FROM (%FOR UPDATE% locked'
               AND $1 = ANY(pg_blocking_pids(pid))`,
            [pid]
          );
        await expect.poll(waitingRestore, { timeout: 15000 }).toHaveLength(1);
        const [restore] = await waitingRestore();

        created = t.as.post(linkPath, { depositAccountId: bank.id });
        await expect
          .poll(
            async () => {
              const [row] = await h.sql<{ waiting: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                   WHERE pid <> $2::int AND pg_blocking_pids(pid) && ARRAY[$1::int, $2::int])
                   AS waiting`,
                [pid, restore.pid]
              );
              return row.waiting;
            },
            { timeout: 15000 }
          )
          .toBe(true);
        await gate.query("COMMIT");
        const replaced = await restored;
        expect(replaced.status, replaced.text).toBe(200);
        const link = await created;
        expect(link.status, link.text).toBe(409);
        expect(link.body.code).toBe("INVOICE_NOT_PAYABLE");
        expect(
          await h.sql("SELECT id FROM payment_links WHERE invoice_id = $1", [invoiceId])
        ).toEqual([]);
      } finally {
        await gate.query("ROLLBACK");
        gate.release();
        await Promise.allSettled([restored, created]);
        vi.unstubAllEnvs();
      }
    }
  );

  it.each(["invoices", "payment_links"])(
    "protects credit allocations and their journals when an invoice row covered by %s is unchanged",
    async (table) => {
      const t = await h.createTenant();
      const base = `/api/companies/${t.company.id}`;
      const contact = await t.as.post(`${base}/customer-contacts`, { name: "Fixture customer" });
      expect(contact.status, contact.text).toBe(200);
      const invoiceId = await draftInvoice(t, contact.body.id);
      await issueInvoice(t, invoiceId);
      const bank = await accountByCode(t, "1020");
      const deposit = await t.as.post(`${base}/customer-deposits`, {
        contactId: contact.body.id,
        date: new Date().toISOString().slice(0, 10),
        amount: "50",
        vatTreatment: "out_of_scope",
        paymentAccountId: bank.id,
      });
      expect(deposit.status, deposit.text).toBe(201);
      const applyCredit = () =>
        t.as.post(`${base}/customer-credits/${deposit.body.creditId}/apply`, {
          invoiceId,
          amount: "10",
        });
      const first = await applyCredit();
      expect(first.status, first.text).toBe(201);
      if (table === "invoices") {
        await h.sql(
          `INSERT INTO einvoice_documents (company_id, invoice_id, status)
           VALUES ($1, $2, 'submitted')`,
          [t.company.id, invoiceId]
        );
      }
      const invoiceRows = () => h.sql("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      const before = await invoiceRows();
      expect(before[0].status).toBe("partial");
      const backup = await snapshot(t);
      const second = await applyCredit();
      expect(second.status, second.text).toBe(201);
      expect(await invoiceRows()).toEqual(before);
      if (table === "payment_links") {
        const { linkId } = await createPaymentLinkFixture(t, invoiceId);
        await h.sql("UPDATE payment_links SET amount_fils = 10000 WHERE id = $1", [linkId]);
      }
      const allocations = () =>
        h.sql<{ id: string; journal_entry_id: string }>(
          "SELECT id, journal_entry_id FROM customer_credit_allocations WHERE invoice_id = $1 ORDER BY id",
          [invoiceId]
        );
      const applied = await allocations();
      expect(applied).toHaveLength(2);
      const lines = await journalLines(t, second.body.allocationId);
      expect(lines.length).toBeGreaterThan(0);
      await expectReplaceConflict(t, backup, table);

      const backupWithAllocations = await snapshot(t);
      await makeLegacy(backupWithAllocations.id, (tables) => {
        tables.journal_lines = tables.journal_lines.filter(
          (line) => (line as { entry_id: string }).entry_id !== second.body.journalEntryId
        );
      });
      await expectReplaceConflict(t, backupWithAllocations, table);
      expect(await invoiceRows()).toEqual(before);
      expect(await allocations()).toEqual(applied);
      expect(await journalLines(t, second.body.allocationId)).toEqual(lines);
    }
  );

  it("protects an issued credit note and its journal when checkout quotes the reduced balance", async () => {
    const t = await h.createTenant();
    const bank = await accountByCode(t, "1020");
    const invoiceId = await partiallyPaidInvoice(t, bank.id);
    const invoiceRows = () => h.sql("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    const before = await invoiceRows();
    expect(before[0].status).toBe("partial");
    const backup = await snapshot(t);

    const noteId = await issuePartialCreditNote(t, invoiceId);
    expect(await invoiceRows()).toEqual(before);
    await startCheckout(t, invoiceId, bank.id, 7000);
    const checkoutInvoice = await invoiceRows();

    const noteRows = () => h.sql("SELECT * FROM invoices WHERE id = $1", [noteId]);
    const issued = await noteRows();
    expect(issued).toHaveLength(1);
    const lines = await journalLines(t, noteId);
    expect(lines.length).toBeGreaterThan(0);
    await expectReplaceConflict(t, backup, "payment_links");

    const backupWithNote = await snapshot(t);
    for (const response of [
      await t.as.post(`/api/backups/${backupWithNote.id}/restore-preview`, { mode: "merge" }),
      await restore(t, backupWithNote, "merge"),
    ]) {
      expect(response.status, response.text).toBe(200);
    }
    await makeLegacy(backupWithNote.id, (tables) => {
      tables.journal_lines = tables.journal_lines.filter(
        (line) => (line as { entry_id: string }).entry_id !== lines[0].entry_id
      );
    });
    await expectReplaceConflict(t, backupWithNote, "payment_links");
    expect(await invoiceRows()).toEqual(checkoutInvoice);
    expect(await noteRows()).toEqual(issued);
    expect(await journalLines(t, noteId)).toEqual(lines);
  });

  it.each(["replace", "merge"] as const)(
    "rejects a %s snapshot-only credit note that would reduce an open checkout balance",
    async (mode) => {
      const t = await h.createTenant();
      const bank = await accountByCode(t, "1020");
      const invoiceId = await partiallyPaidInvoice(t, bank.id);
      const invoiceRows = () => h.sql("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
      const before = await invoiceRows();
      expect(before[0].status).toBe("partial");
      const backupWithoutNote = await snapshot(t);
      const noteId = await issuePartialCreditNote(t, invoiceId);
      expect(await invoiceRows()).toEqual(before);
      expect((await journalLines(t, noteId)).length).toBeGreaterThan(0);
      const backupWithNote = await snapshot(t);

      const restored = await replace(t, backupWithoutNote);
      expect(restored.status, restored.text).toBe(200);
      const noteRows = () => h.sql("SELECT id FROM invoices WHERE id = $1", [noteId]);
      expect(await noteRows()).toEqual([]);
      await startCheckout(t, invoiceId, bank.id, 9000);
      const checkoutInvoice = await invoiceRows();

      await expectRestoreConflict(t, backupWithNote, "payment_links", mode);
      expect(await invoiceRows()).toEqual(checkoutInvoice);
      expect(await noteRows()).toEqual([]);
      expect(await journalLines(t, noteId)).toEqual([]);
    }
  );

  it("keeps the effective deposit bank currency while checkout can still settle", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    await issueInvoice(t, invoiceId);
    const account = await accountByCode(t, "1020");
    const [bank] = await h.sql<{ id: string }>(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'Checkout deposits', 'Other', 'EUR', $2) RETURNING id`,
      [t.company.id, account.id]
    );
    const backup = await snapshot(t);
    await h.sql("UPDATE bank_accounts SET currency = 'AED' WHERE id = $1", [bank.id]);
    await startCheckout(t, invoiceId, account.id, 12000);

    await expectReplaceConflict(t, backup, "payment_links");
    expect(await h.sql("SELECT currency FROM bank_accounts WHERE id = $1", [bank.id])).toEqual([
      { currency: "AED" },
    ]);
  });

  it.each(["invoice_payments", "customer_credit_allocations"] as const)(
    "rejects Merge of checkout settlement rows in %s",
    async (table) => {
      const t = await h.createTenant();
      const base = `/api/companies/${t.company.id}`;
      const contact = await t.as.post(`${base}/customer-contacts`, { name: "Fixture customer" });
      expect(contact.status, contact.text).toBe(200);
      const bank = await accountByCode(t, "1020");
      const invoiceId = await partiallyPaidInvoice(t, bank.id, contact.body.id);
      const deposit = await t.as.post(`${base}/customer-deposits`, {
        contactId: contact.body.id,
        date: new Date().toISOString().slice(0, 10),
        amount: "50",
        vatTreatment: "out_of_scope",
        paymentAccountId: bank.id,
      });
      expect(deposit.status, deposit.text).toBe(201);
      const before = await snapshot(t);
      const settlement = () =>
        h.sql<{ journal_entry_id: string }>(
          `SELECT journal_entry_id FROM ${table} WHERE invoice_id = $1 ORDER BY id`,
          [invoiceId]
        );
      const originalRows = await settlement();
      if (table === "invoice_payments") {
        await recordPartialPayment(t, invoiceId, bank.id);
      } else {
        const applied = await t.as.post(`${base}/customer-credits/${deposit.body.creditId}/apply`, {
          invoiceId,
          amount: "10",
        });
        expect(applied.status, applied.text).toBe(201);
      }
      const added = (await settlement()).find(
        (row) =>
          !originalRows.some((original) => original.journal_entry_id === row.journal_entry_id)
      );
      expect(added?.journal_entry_id).toBeTruthy();
      const journal = () =>
        h.sql("SELECT id FROM journal_entries WHERE id = $1", [added?.journal_entry_id]);
      expect(await journal()).toHaveLength(1);
      const after = await snapshot(t);

      const restored = await replace(t, before);
      expect(restored.status, restored.text).toBe(200);
      await startCheckout(t, invoiceId, bank.id, 9000);
      for (const response of [
        await t.as.post(`/api/backups/${before.id}/restore-preview`, { mode: "merge" }),
        await restore(t, before, "merge"),
      ]) {
        expect(response.status, response.text).toBe(200);
      }
      await expectRestoreConflict(t, after, "payment_links", "merge");
      expect(await settlement()).toEqual(originalRows);
      expect(await journal()).toEqual([]);
    }
  );

  it("rejects Merge of a bank payment reversal when checkout still counts the payment", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    await issueInvoice(t, invoiceId);
    const gl = await accountByCode(t, "1020");
    const [bank] = await h.sql<{ id: string }>(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'Checkout deposits', 'Other', 'AED', $2) RETURNING id`,
      [t.company.id, gl.id]
    );
    const [line] = await h.sql<{ id: string }>(
      `INSERT INTO bank_transactions
         (company_id, bank_statement_account_id, bank_account_id, transaction_date, description, amount)
       VALUES ($1, $2, $3, now() AT TIME ZONE 'UTC', 'Partial invoice payment', 30) RETURNING id`,
      [t.company.id, bank.id, gl.id]
    );
    const match = `/api/companies/${t.company.id}/bank-statements/${line.id}/match`;
    const matched = await t.as.post(match, { matchedType: "invoice", matchedId: invoiceId });
    expect(matched.status, matched.text).toBe(201);
    const payments = () =>
      h.sql<{ id: string; journal_entry_id: string }>(
        "SELECT id, journal_entry_id FROM invoice_payments WHERE invoice_id = $1",
        [invoiceId]
      );
    const originalPayment = await payments();
    expect(originalPayment).toHaveLength(1);
    const before = await snapshot(t);

    const unmatched = await t.as.delete(match);
    expect(unmatched.status, unmatched.text).toBe(200);
    expect(await payments()).toEqual([]);
    const reversals = () =>
      h.sql(
        "SELECT id FROM journal_entries WHERE source = 'payment_reversal' AND reversed_entry_id = $1",
        [originalPayment[0].journal_entry_id]
      );
    expect(await reversals()).toHaveLength(1);
    const after = await snapshot(t);

    const restored = await replace(t, before);
    expect(restored.status, restored.text).toBe(200);
    expect(await payments()).toEqual(originalPayment);
    expect(await reversals()).toEqual([]);
    await startCheckout(t, invoiceId, gl.id, 9000);

    await expectRestoreConflict(t, after, "payment_links", "merge");
    expect(await payments()).toEqual(originalPayment);
    expect(await reversals()).toEqual([]);
  });

  it("rejects Merge of a bank account that changes the checkout deposit currency", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    await issueInvoice(t, invoiceId);
    const account = await accountByCode(t, "1020");
    const before = await snapshot(t);
    const [bank] = await h.sql<{ id: string }>(
      `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'Checkout deposits', 'Other', 'EUR', $2) RETURNING id`,
      [t.company.id, account.id]
    );
    const after = await snapshot(t);

    const restored = await replace(t, before);
    expect(restored.status, restored.text).toBe(200);
    await startCheckout(t, invoiceId, account.id, 12000);
    await expectRestoreConflict(t, after, "payment_links", "merge");
    expect(await h.sql("SELECT id FROM bank_accounts WHERE id = $1", [bank.id])).toEqual([]);
  });

  it.each(["configured account", "clearing fallback"])(
    "keeps the spot rate that a checkout receipt needs for its %s",
    async (deposit) => {
      const t = await h.createTenant();
      const invoiceId = await draftInvoice(t);
      await issueInvoice(t, invoiceId);
      const { ensureClearingAccount } = await import("../../server/services/payments");
      const accountId =
        deposit === "clearing fallback"
          ? await ensureClearingAccount(t.company.id)
          : (await accountByCode(t, "1020")).id;
      await h.sql(
        `INSERT INTO bank_accounts (company_id, name_en, bank_name, currency, gl_account_id)
       VALUES ($1, 'Checkout deposits', 'Other', 'EUR', $2)`,
        [t.company.id, accountId]
      );
      const before = await snapshot(t);
      const [rate] = await h.sql<{ id: string }>(
        `INSERT INTO exchange_rates (company_id, base_currency, target_currency, rate_type, rate, date)
       VALUES ($1, 'EUR', 'AED', 'spot', 4, now() AT TIME ZONE 'UTC') RETURNING id`,
        [t.company.id]
      );
      if (deposit === "clearing fallback") {
        await startCheckoutWithClearingFallback(t, invoiceId);
      } else {
        await startCheckout(t, invoiceId, accountId, 12000);
      }

      await expectReplaceConflict(t, before, "payment_links");
      const rateRows = () => h.sql("SELECT id FROM exchange_rates WHERE id = $1", [rate.id]);
      expect(await rateRows()).toEqual([rate]);

      // An inverse system spot rate is also sufficient, even when older than the usual FX window.
      const [systemRate] = await h.sql<{ id: string }>(
        `INSERT INTO exchange_rates (base_currency, target_currency, rate_type, rate, date)
       VALUES ('AED', 'EUR', 'spot', 0.25, (now() AT TIME ZONE 'UTC') - interval '10 days') RETURNING id`
      );
      try {
        for (const response of [
          await t.as.post(`/api/backups/${before.id}/restore-preview`, { mode: "replace" }),
          await replace(t, before),
        ]) {
          expect(response.status, response.text).toBe(200);
        }
        expect(await rateRows()).toEqual([]);
      } finally {
        await h.sql("DELETE FROM exchange_rates WHERE id = $1", [systemRate.id]);
      }
    }
  );

  it("keeps the configured deposit account eligible while checkout can still settle", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    await issueInvoice(t, invoiceId);
    const bank = await t.as.post(`/api/companies/${t.company.id}/accounts`, {
      code: "1029",
      nameEn: "Checkout deposits",
      type: "asset",
      subType: "bank",
    });
    expect(bank.status, bank.text).toBe(201);
    const accountId = bank.body.id;
    const archived = await t.as.post(`/api/accounts/${accountId}/archive`, {});
    expect(archived.status, archived.text).toBe(200);
    const backup = await snapshot(t);
    const unarchived = await t.as.post(`/api/accounts/${accountId}/unarchive`, {});
    expect(unarchived.status, unarchived.text).toBe(200);
    await startCheckout(t, invoiceId, accountId, 12000);

    await expectReplaceConflict(t, backup, "payment_links");
    expect(
      await h.sql("SELECT is_active, is_archived FROM accounts WHERE id = $1", [accountId])
    ).toEqual([{ is_active: true, is_archived: false }]);
  });

  it.each([
    { mode: "replace", deposit: "configured account" },
    { mode: "merge", deposit: "configured account" },
    { mode: "merge", deposit: "clearing fallback" },
  ] as const)(
    "rejects $mode restore that would make the checkout's $deposit a header",
    async ({ mode, deposit }) => {
      const t = await h.createTenant();
      const invoiceId = await draftInvoice(t);
      await issueInvoice(t, invoiceId);
      const url = `/api/companies/${t.company.id}/accounts`;
      let parentId: string;
      if (deposit === "clearing fallback") {
        const { ensureClearingAccount } = await import("../../server/services/payments");
        parentId = await ensureClearingAccount(t.company.id);
      } else {
        const parent = await t.as.post(url, {
          code: "1029",
          nameEn: "Checkout deposits",
          type: "asset",
          subType: "bank",
        });
        expect(parent.status, parent.text).toBe(201);
        parentId = parent.body.id;
      }
      const before = await snapshot(t);
      const child = await t.as.post(url, {
        code: "1031",
        nameEn: "Deposit sub-account",
        type: "asset",
        subType: "bank",
        parentId,
      });
      expect(child.status, child.text).toBe(201);
      const childRows = () =>
        h.sql("SELECT parent_id, is_archived FROM accounts WHERE id = $1", [child.body.id]);
      expect(await childRows()).toEqual([{ parent_id: parentId, is_archived: false }]);
      const backup = await snapshot(t);
      if (mode === "merge") {
        const restored = await replace(t, before);
        expect(restored.status, restored.text).toBe(200);
      } else {
        const archived = await t.as.post(`/api/accounts/${child.body.id}/archive`, {});
        expect(archived.status, archived.text).toBe(200);
      }
      const eligibleChildren = mode === "merge" ? [] : [{ parent_id: parentId, is_archived: true }];
      expect(await childRows()).toEqual(eligibleChildren);
      if (deposit === "clearing fallback") {
        await startCheckoutWithClearingFallback(t, invoiceId);
      } else {
        await startCheckout(t, invoiceId, parentId, 12000);
      }

      await expectRestoreConflict(t, backup, "payment_links", mode);
      expect(await childRows()).toEqual(eligibleChildren);
    }
  );

  it("rejects a restored posting lock that covers the checkout receipt date", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    await issueInvoice(t, invoiceId);
    const bank = await accountByCode(t, "1020");
    const now = new Date();
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
    const base = `/api/companies/${t.company.id}`;
    const lock = await t.as.post(`${base}/month-end/lock-period`, {
      periodEnd,
      overrideChecklist: true,
      lockType: "hard",
      reason: "AU7 checkout fixture",
    });
    expect(lock.status, lock.text).toBe(200);
    const backup = await snapshot(t);
    const unlock = await t.as.post(`${base}/period-lock/unlock`, {
      periodEnd,
      reason: "Accept payment on the issued invoice",
    });
    expect(unlock.status, unlock.text).toBe(200);
    await startCheckout(t, invoiceId, bank.id, 12000);

    await expectReplaceConflict(t, backup, "payment_links");
    expect(
      await h.sql("SELECT status FROM month_end_close WHERE company_id = $1", [t.company.id])
    ).toEqual([{ status: "open" }]);
  });

  it("keeps a payslip token and its payroll run through replace", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const [employee] = await h.sql(
      `INSERT INTO employees (company_id, full_name) VALUES ($1, 'Fixture employee') RETURNING id`,
      [t.company.id]
    );
    const [run] = await h.sql(
      `INSERT INTO payroll_runs (company_id, period_month, period_year)
       VALUES ($1, 1, 2025), ($1, 2, 2025) RETURNING id`,
      [t.company.id]
    );
    const [item] = await h.sql(
      `INSERT INTO payroll_items (payroll_run_id, employee_id) VALUES ($1, $2) RETURNING id`,
      [run.id, employee.id]
    );
    const [token] = await h.sql(
      `INSERT INTO payslip_tokens (company_id, payroll_item_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING *`,
      [t.company.id, item.id, randomUUID()]
    );

    const restored = await replace(t, backup);
    expect(restored.status, restored.text).toBe(200);
    expect(await h.sql("SELECT * FROM payslip_tokens WHERE id = $1", [token.id])).toEqual([token]);
    expect(await h.sql("SELECT id FROM payroll_items WHERE id = $1", [item.id])).toEqual([item]);
    expect(
      await h.sql("SELECT id FROM payroll_runs WHERE company_id = $1", [t.company.id])
    ).toEqual([run]);
    expect(await h.sql("SELECT id FROM employees WHERE id = $1", [employee.id])).toEqual([
      employee,
    ]);
  });

  it.each(["accrual", "payment and reversal journals"])(
    "rejects replace that would strip %s from an approved run with a payslip token",
    async (history) => {
      const t = await h.createTenant();
      const beforeApproval = await snapshot(t);
      const employee = await t.as.post(`/api/companies/${t.company.id}/employees`, {
        fullName: "Fixture employee",
        nationality: "IN",
        joinDate: "2025-01-01",
        basicSalary: "5000.00",
      });
      expect(employee.status, employee.text).toBe(201);
      const run = await t.as.post(`/api/companies/${t.company.id}/payroll-runs`, {
        periodMonth: 1,
        periodYear: 2025,
      });
      expect(run.status, run.text).toBe(201);
      const runId = run.body.id;
      const calculated = await t.as.post(`/api/payroll-runs/${runId}/calculate`, {});
      expect(calculated.status, calculated.text).toBe(200);
      const approved = await t.as.post(`/api/payroll-runs/${runId}/approve`, {});
      expect(approved.status, approved.text).toBe(200);
      const [item] = await h.sql(
        "SELECT id, journal_entry_id FROM payroll_items WHERE payroll_run_id = $1",
        [runId]
      );
      expect(item.journal_entry_id).toBeTruthy();
      const [token] = await h.sql(
        `INSERT INTO payslip_tokens (company_id, payroll_item_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day') RETURNING *`,
        [t.company.id, item.id, randomUUID()]
      );
      let backup = beforeApproval;
      if (history === "payment and reversal journals") {
        backup = await snapshot(t);
        const runRows = () => h.sql("SELECT * FROM payroll_runs WHERE id = $1", [runId]);
        const itemRows = () => h.sql("SELECT * FROM payroll_items WHERE id = $1", [item.id]);
        const approvedRun = await runRows();
        const approvedItem = await itemRows();
        const bank = await accountByCode(t, "1020");
        const paid = await t.as.post(`/api/payroll-runs/${runId}/pay`, {
          paymentAccountId: bank.id,
          paymentDate: new Date().toISOString().slice(0, 10),
        });
        expect(paid.status, paid.text).toBe(200);
        const unpaid = await t.as.post(`/api/payroll-runs/${runId}/unpay`, {
          reason: "Wrong bank",
        });
        expect(unpaid.status, unpaid.text).toBe(200);
        expect(await runRows()).toEqual(approvedRun);
        expect(await itemRows()).toEqual(approvedItem);
        expect(
          await h.sql(
            `SELECT entry_kind FROM journal_entries WHERE company_id = $1 AND source_id = $2
           AND source = 'payroll_payment'`,
            [t.company.id, runId]
          )
        ).toEqual(expect.arrayContaining([{ entry_kind: "reversal" }, { entry_kind: "standard" }]));
      }
      const lines = await journalLines(t, runId);
      expect(lines.length).toBeGreaterThan(0);

      await expectReplaceConflict(t, backup, "payroll_runs");

      expect(
        await h.sql("SELECT status, journal_entry_id FROM payroll_runs WHERE id = $1", [runId])
      ).toEqual([{ status: "approved", journal_entry_id: item.journal_entry_id }]);
      expect(
        await h.sql("SELECT id, journal_entry_id FROM payroll_items WHERE id = $1", [item.id])
      ).toEqual([item]);
      expect(await h.sql("SELECT * FROM payslip_tokens WHERE id = $1", [token.id])).toEqual([
        token,
      ]);
      expect(await journalLines(t, runId)).toEqual(lines);
    }
  );

  it("rejects replace that would remove an invoice with e-invoice transmission history", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const [invoice] = await h.sql(
      `INSERT INTO invoices (company_id, number, customer_name, date, total)
       VALUES ($1, 'AU7-TRANSMITTED', 'Fixture customer', now(), 120) RETURNING id`,
      [t.company.id]
    );
    const [document] = await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider_message_id)
       VALUES ($1, $2, 'submitted', 'au7-transmission') RETURNING *`,
      [t.company.id, invoice.id]
    );

    for (const response of [
      await t.as.post(`/api/backups/${backup.id}/restore-preview`, { mode: "replace" }),
      await replace(t, backup),
    ]) {
      expect(response.status, response.text).toBe(409);
      expect(response.body).toMatchObject({
        code: "BACKUP_RESTORE_CONFLICT",
        details: { table: "invoices" },
      });
    }
    expect(await h.sql("SELECT id FROM invoices WHERE id = $1", [invoice.id])).toEqual([invoice]);
    expect(await h.sql("SELECT * FROM einvoice_documents WHERE id = $1", [document.id])).toEqual([
      document,
    ]);
  });

  it("rejects replace that would rewind a transmitted invoice already in the backup", async () => {
    const t = await h.createTenant();
    const invoiceId = await draftInvoice(t);
    const backup = await snapshot(t);
    await issueInvoice(t, invoiceId);
    const [invoice] = await h.sql(
      `UPDATE invoices SET einvoice_status = 'submitted', einvoice_submitted_at = now(),
                           einvoice_provider_message_id = 'au7-transmission'
       WHERE id = $1 RETURNING *`,
      [invoiceId]
    );
    const [document] = await h.sql(
      `INSERT INTO einvoice_documents (company_id, invoice_id, status, provider_message_id)
       VALUES ($1, $2, 'submitted', 'au7-transmission') RETURNING *`,
      [t.company.id, invoiceId]
    );
    const lines = await journalLines(t, invoiceId);
    expect(lines.length).toBeGreaterThan(0);

    await expectReplaceConflict(t, backup, "invoices");

    expect(await h.sql("SELECT * FROM invoices WHERE id = $1", [invoiceId])).toEqual([invoice]);
    expect(await h.sql("SELECT * FROM einvoice_documents WHERE id = $1", [document.id])).toEqual([
      document,
    ]);
    expect(await journalLines(t, invoiceId)).toEqual(lines);
  });

  it("merge preserves a bank transaction's invoice match made after the snapshot", async () => {
    const t = await h.createTenant();
    const [invoice] = await h.sql<{ id: string }>(
      `INSERT INTO invoices (company_id, number, customer_name, date, total)
       VALUES ($1, 'AU7-1', 'Fixture customer', now(), 120) RETURNING id`,
      [t.company.id]
    );
    const [bank] = await h.sql<{ id: string }>(
      `INSERT INTO bank_transactions (company_id, transaction_date, description, amount)
       VALUES ($1, now(), 'Fixture payment', 120) RETURNING id`,
      [t.company.id]
    );
    const backup = await snapshot(t);
    await h.sql("UPDATE bank_transactions SET matched_invoice_id = $1 WHERE id = $2", [
      invoice.id,
      bank.id,
    ]);

    const response = await t.as.post(`/api/backups/${backup.id}/restore`, {
      mode: "merge",
      confirmRestore: true,
    });
    expect(response.status, response.text).toBe(200);
    expect(response.body.totals.update).toBe(0);
    const [stored] = await h.sql("SELECT matched_invoice_id FROM bank_transactions WHERE id = $1", [
      bank.id,
    ]);
    expect(stored.matched_invoice_id).toBe(invoice.id);
  });

  it("clone refuses a target with a purchase order and preserves the order", async () => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 purchase order target" });
    expect([200, 201]).toContain(target.status);
    const [order] = await h.sql<{ id: string }>(
      `INSERT INTO purchase_orders (company_id, number, vendor_name, date)
       VALUES ($1, 'AU7-PO', 'Fixture vendor', now()) RETURNING id`,
      [target.body.id]
    );
    const backup = await snapshot(t);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    const result = restoreBackupIntoCompany({
      backupId: backup.id,
      sourceCompanyId: t.company.id,
      targetCompanyId: target.body.id,
      userId: t.user.id,
      dryRun: false,
    });
    await expect(result).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
    expect(await h.sql("SELECT id FROM purchase_orders WHERE id = $1", [order.id])).toHaveLength(1);
  });

  it.each([
    [
      "tax_return_archive",
      `INSERT INTO tax_return_archive (company_id, return_type, period_label, period_start, period_end, filing_date)
       VALUES ($1, 'VAT', 'Q1', '2025-01-01', '2025-03-31', '2025-04-15')`,
    ],
    [
      "einvoice_archive",
      `INSERT INTO einvoice_archive (company_id, direction, kind, document_number, xml, sha256, retain_until)
       VALUES ($1, 'outbound', 'submitted', 'ARCHIVE-1', '<Invoice/>', repeat('a', 64), '2035-01-01')`,
    ],
    [
      "einvoice_documents",
      `INSERT INTO einvoice_documents (company_id, invoice_id, status)
       VALUES ($1, gen_random_uuid(), 'submitted')`,
    ],
    [
      "einvoice_document_events",
      `INSERT INTO einvoice_document_events (company_id, invoice_id, track, to_status)
       VALUES ($1, gen_random_uuid(), 'delivery', 'submitted')`,
    ],
  ])("clone refuses a target with only seeded accounts and %s history", async (table, insert) => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 archive target" });
    expect([200, 201]).toContain(target.status);
    await h.sql(insert, [target.body.id]);
    const backup = await snapshot(t);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    for (const dryRun of [true, false]) {
      await expect(
        restoreBackupIntoCompany({
          backupId: backup.id,
          sourceCompanyId: t.company.id,
          targetCompanyId: target.body.id,
          userId: t.user.id,
          dryRun,
        })
      ).rejects.toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY", details: { table, rows: 1 } });
    }
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres").each([
    ["base_currency = 'USD'", "BASE_CURRENCY_MISMATCH"],
    ["deleted_at = now()", "NOT_FOUND"],
  ])("clone checks target state after a concurrent update to %s", async (update, code) => {
    const t = await h.createTenant();
    const target = await t.as.post("/api/companies", { name: "AU7 concurrent company target" });
    expect([200, 201]).toContain(target.status);
    const backup = await snapshot(t);
    const { pool } = await import("../../server/db");
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    const writer = await pool.connect();
    let clone: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      const {
        rows: [{ pid }],
      } = await writer.query<{ pid: number }>(
        `UPDATE companies SET ${update} WHERE id = $1 RETURNING pg_backend_pid() AS pid`,
        [target.body.id]
      );
      clone = restoreBackupIntoCompany({
        backupId: backup.id,
        sourceCompanyId: t.company.id,
        targetCompanyId: target.body.id,
        userId: t.user.id,
        dryRun: false,
      }).catch((error: unknown) => error);
      await expect
        .poll(
          async () => {
            const [row] = await h.sql<{ waiting: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
             WHERE query LIKE '%FROM companies WHERE id = $1%FOR UPDATE%'
               AND $1::int = ANY(pg_blocking_pids(pid))) AS waiting`,
              [pid]
            );
            return row.waiting;
          },
          { timeout: 15000 }
        )
        .toBe(true);
      await writer.query("COMMIT");
      expect(await clone).toMatchObject({ code });
      expect(await h.sql("SELECT id FROM backups WHERE company_id = $1", [target.body.id])).toEqual(
        []
      );
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      await clone;
    }
  });

  it.skipIf(process.env.HARNESS_MODE !== "postgres")(
    "waits for the first target write even in a table without a company FK",
    async () => {
      const t = await h.createTenant();
      const target = await t.as.post("/api/companies", { name: "AU7 concurrent target" });
      expect([200, 201]).toContain(target.status);
      const backup = await snapshot(t);
      await h.sql(`CREATE TABLE au7_unlinked_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL
      )`);
      const { pool } = await import("../../server/db");
      const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
      const ordinaryWriter = await pool.connect();
      let clone: Promise<unknown> | undefined;
      try {
        await ordinaryWriter.query("BEGIN");
        await ordinaryWriter.query("INSERT INTO au7_unlinked_orders (company_id) VALUES ($1)", [
          target.body.id,
        ]);
        clone = restoreBackupIntoCompany({
          backupId: backup.id,
          sourceCompanyId: t.company.id,
          targetCompanyId: target.body.id,
          userId: t.user.id,
          dryRun: false,
        }).catch((error: unknown) => error);
        await expect
          .poll(
            async () => {
              const [row] = await h.sql<{ waiting: boolean }>(`
            SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation = 'au7_unlinked_orders'::regclass
                           AND mode = 'ShareRowExclusiveLock' AND NOT granted) AS waiting
          `);
              return row.waiting;
            },
            { timeout: 15000 }
          )
          .toBe(true);
        await ordinaryWriter.query("COMMIT");
        expect(await clone).toMatchObject({ code: "CLONE_TARGET_NOT_EMPTY" });
        expect(
          await h.sql("SELECT id FROM au7_unlinked_orders WHERE company_id = $1", [target.body.id])
        ).toHaveLength(1);
      } finally {
        await ordinaryWriter.query("ROLLBACK");
        ordinaryWriter.release();
        await clone;
        await h.sql("DROP TABLE au7_unlinked_orders");
      }
    }
  );

  it("replace preserves data in a table introduced after the snapshot", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    await makeLegacy(backup.id);
    // Simulate a forward migration in this test file's disposable database.
    await h.sql(`CREATE TABLE au7_project_charges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies(id),
      amount numeric(15, 2) NOT NULL
    )`);
    try {
      const [charge] = await h.sql<{ id: string }>(
        "INSERT INTO au7_project_charges (company_id, amount) VALUES ($1, 125) RETURNING id",
        [t.company.id]
      );
      const response = await replace(t, backup);
      expect(response.status, response.text).toBe(200);
      expect(
        await h.sql("SELECT amount::text AS amount FROM au7_project_charges WHERE id = $1", [
          charge.id,
        ])
      ).toEqual([{ amount: "125.00" }]);
    } finally {
      await h.sql("DROP TABLE au7_project_charges");
    }
  });

  it("uses a new column's database default on insert and retains existing values", async () => {
    const t = await h.createTenant();
    const contacts = await h.sql<{ id: string }>(
      `INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'First'), ($1, 'Second')
       RETURNING id`,
      [t.company.id]
    );
    const backup = await snapshot(t);
    await makeLegacy(backup.id);
    await h.sql(
      "ALTER TABLE customer_contacts ADD COLUMN au7_category text NOT NULL DEFAULT 'new'"
    );
    try {
      await h.sql("UPDATE customer_contacts SET au7_category = 'current' WHERE id = $1", [
        contacts[0].id,
      ]);
      await h.sql("DELETE FROM customer_contacts WHERE id = $1", [contacts[1].id]);
      const preview = await t.as.post(`/api/backups/${backup.id}/restore-preview`, {
        mode: "replace",
      });
      expect(preview.status, preview.text).toBe(200);
      const response = await replace(t, backup);
      expect(response.status, response.text).toBe(200);
      expect(
        await h.sql(
          "SELECT name, au7_category FROM customer_contacts WHERE company_id = $1 ORDER BY name",
          [t.company.id]
        )
      ).toEqual([
        { name: "First", au7_category: "current" },
        { name: "Second", au7_category: "new" },
      ]);

      await makeLegacy(backup.id, (tables) => {
        tables.customer_contacts = tables.customer_contacts.map((row) => ({
          ...(row as object),
          au7_category: null,
        }));
      });
      for (const result of [
        await t.as.post(`/api/backups/${backup.id}/restore-preview`, { mode: "replace" }),
        await replace(t, backup),
      ]) {
        expect(result.status, result.text).toBe(422);
        expect(result.body.code).toBe("BACKUP_SCHEMA_INCOMPATIBLE");
      }
    } finally {
      await h.sql("ALTER TABLE customer_contacts DROP COLUMN au7_category");
    }
  });

  it("keeps delivery receipts and live portal grants while ignoring legacy records on replace and clone", async () => {
    const t = await h.createTenant();
    const backup = await snapshot(t);
    const company = t.company.id;
    const target = await t.as.post("/api/companies", { name: "AU7 portal clone target" });
    expect([200, 201]).toContain(target.status);
    const [contact] = await h.sql<{ id: string }>(
      "INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Live portal contact') RETURNING id",
      [company]
    );
    const [grant] = await h.sql(
      `INSERT INTO customer_portal_accounts (company_id, contact_id, user_id, revoked_at)
       VALUES ($1, $2, $3, now()) RETURNING *`,
      [company, contact.id, t.user.id]
    );
    const [invite] = await h.sql(
      `INSERT INTO customer_portal_invitations (company_id, contact_id, email, token_hash, status, expires_at)
       VALUES ($1, $2, 'au7@example.test', $3, 'revoked', now()) RETURNING *`,
      [company, contact.id, randomUUID()]
    );
    const [event] = await h.sql(
      `INSERT INTO domain_event_outbox (company_id, event_type, entity_id, payload, status)
       VALUES ($1, 'au7.fixture', $2, '{}', 'dispatched') RETURNING *`,
      [company, contact.id]
    );
    await h.sql(
      "INSERT INTO domain_event_deliveries (event_id, handler) VALUES ($1, 'au7-handler')",
      [event.id]
    );
    await makeLegacy(backup.id, (tables) => {
      tables.customer_portal_accounts = [{ ...grant, revoked_at: null }];
      tables.customer_portal_invitations = [{ ...invite, status: "pending" }];
      tables.domain_event_outbox = [{ ...event, status: "pending" }];
      tables.domain_event_deliveries = [];
    });
    const restored = await replace(t, backup);
    expect(restored.status, restored.text).toBe(200);
    expect(await h.sql("SELECT id FROM customer_contacts WHERE id = $1", [contact.id])).toEqual([
      contact,
    ]);
    expect(await h.sql("SELECT * FROM customer_portal_accounts WHERE id = $1", [grant.id])).toEqual(
      [grant]
    );
    expect(
      await h.sql("SELECT * FROM customer_portal_invitations WHERE id = $1", [invite.id])
    ).toEqual([invite]);
    expect(await h.sql("SELECT status FROM domain_event_outbox WHERE id = $1", [event.id])).toEqual(
      [{ status: "dispatched" }]
    );
    expect(
      await h.sql("SELECT handler FROM domain_event_deliveries WHERE event_id = $1", [event.id])
    ).toEqual([{ handler: "au7-handler" }]);
    const { restoreBackupIntoCompany } = await import("../../server/services/backup.service");
    await restoreBackupIntoCompany({
      backupId: backup.id,
      sourceCompanyId: company,
      targetCompanyId: target.body.id,
      userId: t.user.id,
      dryRun: false,
    });
    for (const table of [
      "customer_portal_accounts",
      "customer_portal_invitations",
      "domain_event_outbox",
    ]) {
      expect(
        await h.sql(`SELECT id FROM ${table} WHERE company_id = $1`, [target.body.id])
      ).toEqual([]);
    }
  });

  it("preserves both legs of a group elimination and the intercompany account map on member replace", async () => {
    const t = await h.createTenant();
    const other = await h.createSecondTenant();
    const backup = await snapshot(t);
    const company = t.company.id;
    const [account] = await h.sql<{ id: string }>(
      "INSERT INTO accounts (company_id, code, name_en, type) VALUES ($1, 'AU7', 'AU7 account', 'asset') RETURNING id",
      [company]
    );
    const [otherAccount] = await h.sql<{ id: string }>(
      "INSERT INTO accounts (company_id, code, name_en, type) VALUES ($1, 'AU7', 'AU7 counterparty', 'liability') RETURNING id",
      [other.company.id]
    );
    const [group] = await h.sql<{ id: string }>(
      "INSERT INTO company_groups (name, parent_company_id) VALUES ('AU7 group', $1) RETURNING id",
      [other.company.id]
    );
    const [entry] = await h.sql<{ id: string }>(
      "INSERT INTO elimination_journals (group_id, date) VALUES ($1, CURRENT_DATE) RETURNING id",
      [group.id]
    );
    await h.sql(
      `INSERT INTO elimination_lines (journal_id, company_id, account_id, debit_minor, credit_minor)
       VALUES ($1, $2, $3, 12500, 0), ($1, $4, $5, 0, 12500)`,
      [entry.id, company, account.id, other.company.id, otherAccount.id]
    );
    const [map] = await h.sql<{ id: string }>(
      `INSERT INTO intercompany_account_maps (group_id, kind, company_a_id, account_a_id, company_b_id, account_b_id)
       VALUES ($1, 'receivable_payable', $2, $3, $4, $5) RETURNING id`,
      [group.id, company, account.id, other.company.id, otherAccount.id]
    );
    await makeLegacy(backup.id, (tables) => {
      tables.elimination_lines = [];
      tables.intercompany_account_maps = [];
    });
    const response = await replace(t, backup);
    expect(response.status, response.text).toBe(200);
    expect(
      await h.sql(
        `SELECT count(*)::int AS legs, sum(debit_minor - credit_minor)::text AS balance
       FROM elimination_lines WHERE journal_id = $1`,
        [entry.id]
      )
    ).toEqual([{ legs: 2, balance: "0" }]);
    expect(await h.sql("SELECT id FROM intercompany_account_maps WHERE id = $1", [map.id])).toEqual(
      [map]
    );
  });

  it("rolls back on mandatory audit failure and returns the committed receipt on retry", async () => {
    const t = await h.createTenant();
    const [contact] = await h.sql<{ id: string }>(
      "INSERT INTO customer_contacts (company_id, name) VALUES ($1, 'Snapshot') RETURNING id",
      [t.company.id]
    );
    const backup = await snapshot(t);
    await h.sql("UPDATE customer_contacts SET name = 'Current' WHERE id = $1", [contact.id]);
    const key = randomUUID();
    await h.sql(
      "ALTER TABLE audit_logs ADD CONSTRAINT au7_reject_restore CHECK (action <> 'backup.restore') NOT VALID"
    );
    try {
      const failed = await replace(t, backup, key);
      expect(failed.status, failed.text).toBeGreaterThanOrEqual(400);
      expect(await h.sql("SELECT name FROM customer_contacts WHERE id = $1", [contact.id])).toEqual(
        [{ name: "Current" }]
      );
      expect(
        await h.sql("SELECT last_restored_at FROM backups WHERE id = $1", [backup.id])
      ).toEqual([{ last_restored_at: null }]);
      expect(
        await h.sql(
          "SELECT id FROM backups WHERE company_id = $1 AND backup_type = 'pre_restore'",
          [t.company.id]
        )
      ).toEqual([]);
    } finally {
      await h.sql("ALTER TABLE audit_logs DROP CONSTRAINT au7_reject_restore");
    }
    const completed = await replace(t, backup, key);
    expect(completed.status, completed.text).toBe(200);
    await h.sql("UPDATE customer_contacts SET name = 'After success' WHERE id = $1", [contact.id]);
    const retried = await replace(t, backup, key);
    expect(retried.status, retried.text).toBe(200);
    expect(retried.body).toEqual(completed.body);
    expect(await h.sql("SELECT name FROM customer_contacts WHERE id = $1", [contact.id])).toEqual([
      { name: "After success" },
    ]);
    expect(
      await h.sql(
        "SELECT id FROM audit_logs WHERE action = 'backup.restore' AND resource_id = $1",
        [backup.id]
      )
    ).toHaveLength(1);
  });
});
