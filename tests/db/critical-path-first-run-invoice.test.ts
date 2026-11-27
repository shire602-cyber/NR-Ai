import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { uaeToday } from "../../shared/uae-date";
import { useHarness } from "./harness";

const h = useHarness();

describe("first run: sign-up -> first company -> issue -> send", () => {
  it("issues and emails an invoice from the company provisioned at signup", async () => {
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
    const companyId = rows[0].company_id;
    const owner = h.client(token);
    const base = `/api/companies/${companyId}`;

    const accounts = await h.sql<{ code: string }>(
      `SELECT code FROM accounts WHERE company_id = $1`,
      [companyId]
    );
    const codes = new Set(accounts.map((a) => a.code));
    // The default chart includes receivables, output VAT and revenue accounts.
    for (const code of ["1040", "2020"]) expect(codes.has(code), `account ${code}`).toBe(true);
    expect([...codes].some((c) => c.startsWith("4"))).toBe(true);

    const buyerEmail = "buyer@critical.example";
    const contact = await owner.post(`${base}/customer-contacts`, {
      name: "Critical Customer LLC",
      email: buyerEmail,
      emirate: "dubai",
    });
    expect(contact.status, contact.text).toBeLessThan(300);

    const inv = await owner.post(`${base}/invoices`, {
      contactId: contact.body.id,
      date: uaeToday(),
      placeOfSupplyEmirate: "dubai",
      lines: [
        {
          description: "Service",
          quantity: 2,
          unitPrice: 500,
          vatRate: 0,
          vatSupplyType: "out_of_scope",
        },
      ],
    });
    expect(inv.status, inv.text).toBe(200);
    expect(inv.body.status).toBe("draft");
    const invoiceId = inv.body.id;

    // A draft has no ledger effect.
    const before = await h.sql(`SELECT 1 FROM journal_entries WHERE company_id = $1`, [companyId]);
    expect(before).toHaveLength(0);

    const statusPath = `/api/invoices/${invoiceId}/status`;
    const issued = await owner.patch(statusPath, { status: "sent" });
    expect(issued.status, issued.text).toBe(200);
    expect(issued.body.status).toBe("sent");
    // Re-issuing is idempotent: still exactly one entry.
    const reissued = await owner.patch(statusPath, { status: "sent" });
    expect(reissued.status, reissued.text).toBe(200);

    const entries = await h.sql<{ id: string; status: string }>(
      `SELECT id, status FROM journal_entries WHERE company_id = $1`,
      [companyId]
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
    expect(Number(tot.d)).toBe(100000); // AED 1,000 in fils for the company as provisioned.
    expect(Number(tot.ar)).toBe(100000);

    const sendPath = `${base}/invoices/${invoiceId}/send-email`;
    const send = await owner.post(sendPath, { to: buyerEmail });
    expect(send.status, send.text).toBe(202);
    expect(send.body).toMatchObject({ queued: true, sent: false });
    const outbox = await h.sql<{ id: string; html: string; text_body: string }>(
      `SELECT id, html, text_body FROM email_outbox WHERE category = 'invoice' AND to_address = $1`,
      [buyerEmail]
    );
    expect(outbox).toHaveLength(1);
    const [invoice] = await h.sql<{ share_token: string }>(
      `SELECT share_token FROM invoices WHERE id = $1 AND company_id = $2`,
      [invoiceId, companyId]
    );
    const link = outbox[0].text_body.match(
      /https?:\/\/[^\s]+\/view\/invoice\/([0-9a-f]{32})(?=\s|$)/
    );
    expect(link).not.toBeNull();
    const [url, shareToken] = link!;
    expect(shareToken).toBe(invoice.share_token);
    expect(outbox[0].html).toContain(`href="${url}"`);
    const publicInvoice = await h.anon.get(`/api/public/invoices/${shareToken}`);
    expect(publicInvoice.status, publicInvoice.text).toBe(200);
    expect(publicInvoice.body.invoice).toMatchObject({
      number: issued.body.number,
      customerName: contact.body.name,
      status: "sent",
    });
    const logs = await h.sql(
      `SELECT 1 FROM activity_logs WHERE company_id = $1 AND action = 'send' AND entity_id = $2`,
      [companyId, invoiceId]
    );
    expect(logs).toHaveLength(1);

    const viewer = await h.createSecondTenant({ name: "Viewer", vatRegistered: false });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      companyId,
      viewer.user.id,
    ]);
    const denied = await viewer.as.post(sendPath, { to: "viewer-attempt@example.test" });
    expect(denied.status, denied.text).toBe(403);

    const stranger = await h.createSecondTenant({ name: "Stranger", vatRegistered: false });
    const crossOwn = await stranger.as.post(
      `/api/companies/${stranger.company.id}/invoices/${invoiceId}/send-email`,
      { to: "stranger-attempt@example.test" }
    );
    expect(crossOwn.status, crossOwn.text).toBe(404);

    const queued = await h.sql<{ id: string }>(
      `SELECT id FROM email_outbox WHERE category = 'invoice'`
    );
    expect(queued).toEqual([{ id: outbox[0].id }]);
  });
});
