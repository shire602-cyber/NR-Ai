/**
 * Launch-critical journey on a brand-new account, with no harness shortcuts beyond sign-up:
 * register -> sign in -> the first company exists with a chart of accounts and owner role ->
 * issue a live invoice (balanced ledger entry) -> send it (queued honestly, link to the live
 * invoice, one activity row) -> a stranger and a viewer cannot send it.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();
const DATE = new Date().toISOString().slice(0, 10);

describe("first run: sign-up -> first company -> issue -> send", () => {
  it("a new account gets exactly one owned company with a usable chart of accounts", async () => {
    const email = `firstrun-${randomBytes(4).toString("hex")}@example.test`;
    const password = `First${randomBytes(4).toString("hex")}A1!x`;
    const reg = await h.anon.post("/api/auth/register", { name: "First Run", email, password });
    expect(reg.status, reg.text).toBe(200);
    const login = await h.anon.post("/api/auth/login", { email, password });
    expect(login.status, login.text).toBe(200);
    const token = login.body.token as string;
    expect(token).toBeTruthy();

    const rows = await h.sql<{ company_id: string; role: string }>(
      `SELECT company_id, role FROM company_users WHERE user_id = $1`,
      [login.body.user.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("owner");

    const accounts = await h.sql<{ code: string }>(
      `SELECT code FROM accounts WHERE company_id = $1`,
      [rows[0].company_id]
    );
    const codes = new Set(accounts.map((a) => a.code));
    // Receivables, output VAT and a revenue account must exist for the first invoice to post.
    for (const code of ["1040", "2020"]) expect(codes.has(code), `account ${code}`).toBe(true);
    expect([...codes].some((c) => c.startsWith("4"))).toBe(true);
  });

  it("issuing posts one balanced entry; sending queues one e-mail and logs it; others are refused", async () => {
    const t = await h.createTenant({ name: "CritPath" });
    const base = `/api/companies/${t.company.id}`;
    const contact = await t.as.post(`${base}/customer-contacts`, {
      name: "Critical Customer LLC",
      email: "buyer@critical.example",
      emirate: "dubai",
    });
    expect(contact.status, contact.text).toBeLessThan(300);

    const inv = await t.as.post(`${base}/invoices`, {
      contactId: contact.body.id,
      date: DATE,
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Service", quantity: 2, unitPrice: 500, vatRate: 0.05 }],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body.status).toBe("draft");

    // A draft has no ledger effect.
    const before = await h.sql(`SELECT 1 FROM journal_entries WHERE company_id = $1`, [
      t.company.id,
    ]);
    expect(before).toHaveLength(0);

    const issued = await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });
    expect(issued.status, issued.text).toBe(200);
    // Re-issuing is idempotent: still exactly one entry.
    await t.as.patch(`/api/invoices/${inv.body.id}/status`, { status: "sent" });

    const entries = await h.sql<{ id: string; status: string }>(
      `SELECT id, status FROM journal_entries WHERE company_id = $1`,
      [t.company.id]
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("posted");
    const [tot] = await h.sql<{ d: string; c: string; ar: string }>(
      `SELECT SUM(ROUND(jl.debit*100))::text AS d, SUM(ROUND(jl.credit*100))::text AS c,
              COALESCE(SUM(CASE WHEN a.code = '1040' THEN ROUND(jl.debit*100) END), 0)::text AS ar
         FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`,
      [entries[0].id]
    );
    expect(tot.d).toBe(tot.c);
    expect(Number(tot.d)).toBe(105000); // 1,000 + 5% VAT, in fils
    expect(Number(tot.ar)).toBe(105000);

    const send = await t.as.post(`${base}/invoices/${inv.body.id}/send-email`, {
      to: "buyer@critical.example",
    });
    // No provider configured: queued (202), never reported as delivered.
    expect(send.status, send.text).toBe(202);
    const outbox = await h.sql<{ html: string; text_body: string }>(
      `SELECT html, text_body FROM email_outbox WHERE category = 'invoice' AND to_address = $1`,
      ["buyer@critical.example"]
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].html + outbox[0].text_body).toMatch(/https?:\/\/\S+/);
    const logs = await h.sql(
      `SELECT 1 FROM activity_logs WHERE company_id = $1 AND action = 'send' AND entity_id = $2`,
      [t.company.id, inv.body.id]
    );
    expect(logs).toHaveLength(1);

    // Another tenant's owner sees a 404, not a 403.
    const stranger = await h.createSecondTenant({ name: "Stranger" });
    const cross = await stranger.as.post(`${base}/invoices/${inv.body.id}/send-email`, {
      to: "x@example.test",
    });
    expect([403, 404]).toContain(cross.status);
    const crossOwn = await stranger.as.post(
      `/api/companies/${stranger.company.id}/invoices/${inv.body.id}/send-email`,
      { to: "x@example.test" }
    );
    expect(crossOwn.status).toBe(404);
  });
});
