/**
 * CASH-SERIES (owner decision 2026-11-18): cash sales take their numbers from their own series
 * (doc type "cash_sale", default prefix CS, Settings › Numbering), never from the tax-invoice
 * series, against the real app and a fresh database.
 *
 *   CASH-SERIES-parallel   two parallel cash sales get consecutive, distinct numbers
 *   CASH-SERIES-isolated   cash sales and invoices issued concurrently keep their own sequences
 *   CASH-SERIES-migration  0130 leaves existing cash sales unchanged, starts the series above any
 *                          number already written in its format, and avoids a "CS" prefix clash
 *   CASH-SERIES-settings   a prefix change applies to the next cash sale only; prefixes stay
 *                          unique against invoices; the next number only moves forward
 *   CASH-SERIES-rollback   a cash sale that fails after allocating rolls its number back (the
 *                          same guarantee as the invoice series: allocation is in the insert tx)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";
import { repoRoot } from "./pg-admin";

const h = useHarness();
const base = (t: Tenant) => `/api/companies/${t.company.id}`;
const DATE = "2026-11-10";
const migration = fs.readFileSync(
  path.join(repoRoot, "migrations/0130_cash_sale_numbering.sql"),
  "utf8"
);
const runMigration = async () => {
  for (const stmt of migration.split("--> statement-breakpoint")) await h.sql(stmt);
};

async function bankGl(t: Tenant): Promise<string> {
  const r = await t.as.post(`${base(t)}/bank-accounts`, {
    nameEn: "Emirates NBD",
    bankName: "Emirates NBD",
  });
  expect(r.status, r.text).toBe(201);
  return r.body.glAccountId as string;
}

function cashSale(t: Tenant, bank: string, amount = 100) {
  return t.as.post(`${base(t)}/cash-sales`, {
    date: DATE,
    placeOfSupplyEmirate: "dubai",
    paymentAccountId: bank,
    lines: [{ description: "Counter sale", quantity: 1, unitPrice: amount, vatRate: 0.05 }],
  });
}

function invoice(t: Tenant) {
  return t.as.post(`${base(t)}/invoices`, {
    date: DATE,
    customerName: "Gulf Retail LLC",
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
  });
}

async function sequences(t: Tenant) {
  const rows = await h.sql<{ doc_type: string; year: number; last_value: string }>(
    `SELECT doc_type, year, last_value::text FROM invoice_number_sequences
      WHERE company_id = $1 ORDER BY doc_type, year`,
    [t.company.id]
  );
  return Object.fromEntries(rows.map((r) => [`${r.doc_type}:${r.year}`, Number(r.last_value)]));
}

describe("CASH-SERIES own number series", () => {
  it("[CASH-SERIES-parallel] two parallel cash sales get consecutive distinct numbers", async () => {
    const t = await h.createTenant();
    const bank = await bankGl(t);
    const both = await Promise.all([cashSale(t, bank), cashSale(t, bank, 200)]);
    expect(
      both.map((r) => r.status),
      both.map((r) => r.text).join("\n")
    ).toEqual([201, 201]);
    expect(both.map((r) => r.body.number).sort()).toEqual(["CS-2026-00001", "CS-2026-00002"]);
    expect(both.every((r) => r.body.source === "cash_sale")).toBe(true);
    // The tax-invoice series was never touched.
    expect(await sequences(t)).toEqual({ "cash_sale:2026": 2 });
    const inv = await invoice(t);
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body.number).toBe("INV-2026-00001");
  });

  it("[CASH-SERIES-isolated] cash sales and invoices issued concurrently keep their own sequences", async () => {
    const t = await h.createTenant();
    const bank = await bankGl(t);
    expect((await invoice(t)).body.number).toBe("INV-2026-00001");
    const all = await Promise.all([
      cashSale(t, bank),
      invoice(t),
      cashSale(t, bank),
      invoice(t),
      cashSale(t, bank),
    ]);
    expect(
      all.map((r) => r.status),
      all.map((r) => r.text).join("\n")
    ).toEqual([201, 200, 201, 200, 201]);
    const cash = [all[0], all[2], all[4]].map((r) => r.body.number).sort();
    const inv = [all[1], all[3]].map((r) => r.body.number).sort();
    expect(cash).toEqual(["CS-2026-00001", "CS-2026-00002", "CS-2026-00003"]);
    expect(inv).toEqual(["INV-2026-00002", "INV-2026-00003"]);
    expect(await sequences(t)).toEqual({ "cash_sale:2026": 3, "invoice:2026": 3 });
    // Listed with their own numbers (the list search filters these numbers client-side).
    const listed = await t.as.get(`${base(t)}/invoices?source=cash_sale`);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.body.items.map((i: { number: string }) => i.number).sort()).toEqual(cash);
  });

  it("[CASH-SERIES-migration] existing cash sales keep their numbers; the series starts above any existing number", async () => {
    const t = await h.createTenant();
    const bank = await bankGl(t);
    // Before this change cash sales were numbered in the invoice series.
    const old = await cashSale(t, bank);
    expect(old.status, old.text).toBe(201);
    await h.sql(`UPDATE invoices SET number = 'INV-2026-00007' WHERE id = $1`, [old.body.id]);
    // A hand-numbered / imported document already written in the cash-sale format.
    const imported = await invoice(t);
    await h.sql(`UPDATE invoices SET number = 'CS-2026-00005' WHERE id = $1`, [imported.body.id]);
    await h.sql(
      `UPDATE invoice_number_sequences SET last_value = 7
        WHERE company_id = $1 AND doc_type = 'invoice'`,
      [t.company.id]
    );
    // Rewind to the pre-0130 state: no cash-sale series yet.
    await h.sql(
      `DELETE FROM invoice_number_sequences WHERE company_id = $1 AND doc_type = 'cash_sale'`,
      [t.company.id]
    );
    const snapshot = await h.sql(
      `SELECT id, number, status, total::text FROM invoices WHERE company_id = $1 ORDER BY id`,
      [t.company.id]
    );

    // A second company already used "CS" for another document type.
    const u = await h.createTenant({ name: "Clash" });
    const ubank = await bankGl(u);
    await h.sql(
      `INSERT INTO document_numbering_settings (company_id, doc_type, prefix, padding, yearly_reset)
       VALUES ($1, 'quote', 'CS', 5, true)`,
      [u.company.id]
    );

    const cashSequence = () =>
      h.sql(
        `SELECT last_value::text, updated_at::text FROM invoice_number_sequences
          WHERE company_id = $1 AND doc_type = 'cash_sale' AND year = 2026`,
        [t.company.id]
      );
    await runMigration();
    const seededSequence = await cashSequence();
    await runMigration();
    expect(await cashSequence()).toEqual(seededSequence);

    expect(
      await h.sql(
        `SELECT id, number, status, total::text FROM invoices WHERE company_id = $1 ORDER BY id`,
        [t.company.id]
      )
    ).toEqual(snapshot);
    expect(await sequences(t)).toEqual({ "cash_sale:2026": 5, "invoice:2026": 7 });
    const next = await cashSale(t, bank);
    expect(next.status, next.text).toBe(201);
    expect(next.body.number).toBe("CS-2026-00006");
    expect((await invoice(t)).body.number).toBe("INV-2026-00008");
    await h.sql(
      `UPDATE invoice_number_sequences SET last_value = 9
        WHERE company_id = $1 AND doc_type = 'cash_sale' AND year = 2026`,
      [t.company.id]
    );
    const advancedSequence = await cashSequence();
    await runMigration();
    expect(await cashSequence()).toEqual(advancedSequence);

    const [setting] = await h.sql<{ prefix: string }>(
      `SELECT prefix FROM document_numbering_settings WHERE company_id = $1 AND doc_type = 'cash_sale'`,
      [u.company.id]
    );
    expect(setting.prefix).toBe("CSL");
    expect((await cashSale(u, ubank)).body.number).toBe("CSL-2026-00001");
  });

  it("[CASH-SERIES-settings] a prefix change applies to the next cash sale only; next number only moves forward", async () => {
    const t = await h.createTenant();
    const bank = await bankGl(t);
    const first = await cashSale(t, bank);
    expect(first.body.number).toBe("CS-2026-00001");
    const url = `${base(t)}/numbering/cash_sale`;

    const view = await t.as.get(`${base(t)}/numbering`);
    expect(
      view.body.numbering.find((n: { docType: string }) => n.docType === "cash_sale")
    ).toMatchObject({ prefix: "CS", padding: 5, yearlyReset: true });

    // Prefixes stay unique against the invoice series, both ways.
    const clash = await t.as.put(url, { prefix: "INV", padding: 5, yearlyReset: true });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("NUMBERING_PREFIX_IN_USE");
    const clash2 = await t.as.put(`${base(t)}/numbering/invoice`, {
      prefix: "cs",
      padding: 5,
      yearlyReset: true,
    });
    expect(clash2.status).toBe(409);
    expect(clash2.body.code).toBe("NUMBERING_PREFIX_IN_USE");

    const save = await t.as.put(url, { prefix: "pos", padding: 4, yearlyReset: true });
    expect(save.status, save.text).toBe(200);
    // Settings are by issue date (2026 here), the view by today: check the stored row directly.
    const [stored] = await h.sql<{ prefix: string; padding: number }>(
      `SELECT prefix, padding FROM document_numbering_settings WHERE company_id = $1 AND doc_type = 'cash_sale'`,
      [t.company.id]
    );
    expect(stored).toEqual({ prefix: "POS", padding: 4 });
    const second = await cashSale(t, bank);
    expect(second.body.number).toBe("POS-2026-0002");
    const [kept] = await h.sql<{ number: string }>(`SELECT number FROM invoices WHERE id = $1`, [
      first.body.id,
    ]);
    expect(kept.number).toBe("CS-2026-00001");

    // Forward only, on the sequence of the year being numbered.
    const thisYear = new Date().getUTCFullYear();
    if (thisYear === 2026) {
      const low = await t.as.put(url, {
        prefix: "POS",
        padding: 4,
        yearlyReset: true,
        nextNumber: 2,
      });
      expect(low.status).toBe(409);
      expect(low.body.code).toBe("NUMBERING_BELOW_ISSUED");
      const fwd = await t.as.put(url, {
        prefix: "POS",
        padding: 4,
        yearlyReset: true,
        nextNumber: 50,
      });
      expect(fwd.status, fwd.text).toBe(200);
      expect((await cashSale(t, bank)).body.number).toBe("POS-2026-0050");
    }
    // The invoice series never moved.
    expect((await invoice(t)).body.number).toBe("INV-2026-00001");
  });

  it("[CASH-SERIES-rollback] a cash sale that fails after allocating does not burn its number", async () => {
    const t = await h.createTenant();
    const bank = await bankGl(t);
    // Another document already carries the number the series would give next.
    const blocker = await invoice(t);
    await h.sql(`UPDATE invoices SET number = 'CS-2026-00001' WHERE id = $1`, [blocker.body.id]);
    const before = await h.sql(
      `SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`,
      [t.company.id]
    );
    const failed = await cashSale(t, bank);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect((await sequences(t))["cash_sale:2026"] ?? 0).toBe(0);
    expect(
      await h.sql(`SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1`, [
        t.company.id,
      ])
    ).toEqual(before);
    expect(
      await h.sql(`SELECT id FROM invoices WHERE company_id = $1 AND source = 'cash_sale'`, [
        t.company.id,
      ])
    ).toEqual([]);
    // Once the clash is gone the series continues with no gap.
    await h.sql(`UPDATE invoices SET number = 'INV-2026-00001' WHERE id = $1`, [blocker.body.id]);
    const ok = await cashSale(t, bank);
    expect(ok.status, ok.text).toBe(201);
    expect(ok.body.number).toBe("CS-2026-00001");
  });
});
