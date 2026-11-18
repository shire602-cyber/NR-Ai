/**
 * W4-D customer portal: R16-04, R16-05, R16-06, R16-07, R16-15, R16-16, R16-19 (+ R11-15 supplier
 * statement carry-over).
 */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { useHarness, type Tenant } from "./harness";

const h = useHarness();
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeEach(async () => {
  const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
  resetPortalThrottle();
});

async function contact(t: Tenant, name: string, email?: string) {
  const r = await t.as.post(`/api/companies/${t.company.id}/customer-contacts`, {
    name,
    ...(email ? { email } : {}),
  });
  expect(r.status, r.text).toBeLessThan(300);
  return r.body.id as string;
}

async function invoice(t: Tenant, contactId: string, issue = true, unitPrice = 1000) {
  const c = await t.as.post(`/api/companies/${t.company.id}/invoices`, {
    contactId,
    date: iso(new Date(Date.now() - 20 * DAY)),
    lines: [{ description: "Service", quantity: 1, unitPrice, vatRate: 5 }],
  });
  expect(c.status, c.text).toBe(200);
  if (issue) {
    const s = await t.as.patch(`/api/invoices/${c.body.id}/status`, { status: "sent" });
    expect(s.status, s.text).toBe(200);
  }
  return c.body as { id: string; number: string };
}

async function portalLink(t: Tenant, contactId: string) {
  const r = await t.as.post("/api/portal/generate-access", { contactId });
  expect(r.status, r.text).toBe(200);
  return r.body as { token: string; expiresAt: string; portalUrl: string };
}

describe("W4-D portal identity and visibility", () => {
  it("[R16-04] drafts are not listed in the portal and their PDF is 404; issued invoices are", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Portal Customer");
    const draft = await invoice(t, cid, false);
    const issued = await invoice(t, cid, true);
    const { token } = await portalLink(t, cid);
    const list = await h.anon.get(`/api/portal/${token}/invoices`);
    expect(list.status).toBe(200);
    const ids = list.body.map((i: { id: string }) => i.id);
    expect(ids).toContain(issued.id);
    expect(ids).not.toContain(draft.id);
    expect((await h.anon.get(`/api/portal/${token}/invoices/${draft.id}/pdf`)).status).toBe(404);
    const pdf = await h.anon.get(`/api/portal/${token}/invoices/${issued.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    // A share link cannot be minted for a draft, and a draft's share token shows nothing.
    expect((await t.as.post(`/api/invoices/${draft.id}/share`)).status).toBe(409);
  });

  it("[R16-06] identity is the contact id: renaming keeps access and same-name contacts are isolated", async () => {
    const t = await h.createTenant();
    const a = await contact(t, "Twin Trading");
    const b = await contact(t, "Twin Trading");
    const invA = await invoice(t, a);
    const invB = await invoice(t, b);
    const linkA = await portalLink(t, a);
    const seen = async (token: string) =>
      (await h.anon.get(`/api/portal/${token}/invoices`)).body.map((i: { id: string }) => i.id);
    expect(await seen(linkA.token)).toEqual([invA.id]);
    expect((await h.anon.get(`/api/portal/${linkA.token}/invoices/${invB.id}/pdf`)).status).toBe(
      404
    );
    const rename = await t.as.put(`/api/companies/${t.company.id}/customer-contacts/${a}`, {
      name: "Twin Trading (Renamed) LLC",
    });
    expect(rename.status, rename.text).toBeLessThan(300);
    expect(await seen(linkA.token)).toEqual([invA.id]);
  });

  it("[R16-07] tokens are hashed, shown once, 90-day, revocable; 60 bad tokens get 429; access is logged", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Token Customer");
    await invoice(t, cid);
    const link = await portalLink(t, cid);
    const days = (Date.parse(link.expiresAt) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    const hash = crypto.createHash("sha256").update(link.token).digest("hex");
    const rows = await h.sql(`SELECT token_hash FROM portal_access_tokens WHERE contact_id = $1`, [
      cid,
    ]);
    expect(rows.map((r) => r.token_hash)).toEqual([hash]);
    const contactRow = await h.sql(
      `SELECT portal_access_token FROM customer_contacts WHERE id = $1`,
      [cid]
    );
    expect(contactRow[0].portal_access_token).toBeNull();
    const contacts = await t.as.get(`/api/companies/${t.company.id}/customer-contacts`);
    expect(contacts.text).not.toContain(link.token);
    expect((await h.anon.get(`/api/portal/${link.token}/info`)).status).toBe(200);

    // Regenerate: the old link is revoked; revoke-access kills the new one.
    const second = await portalLink(t, cid);
    expect((await h.anon.get(`/api/portal/${link.token}/info`)).status).toBe(410);
    expect((await t.as.post("/api/portal/revoke-access", { contactId: cid })).status).toBe(200);
    const revoked = await h.anon.get(`/api/portal/${second.token}/info`);
    expect(revoked.status).toBe(410);
    expect(revoked.body.code).toBe("PORTAL_LINK_REVOKED");

    const { resetPortalThrottle } = await import("../../server/services/portal-access.service");
    resetPortalThrottle();
    const statuses: number[] = [];
    for (let i = 0; i < 60; i++) {
      statuses.push(
        (await h.anon.get(`/api/portal/${crypto.randomBytes(32).toString("hex")}/info`)).status
      );
    }
    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(30);
    // The share-link endpoints share the same guard.
    expect(
      (await h.anon.get(`/api/public/invoices/${crypto.randomBytes(16).toString("hex")}`)).status
    ).toBe(429);
    const log = await h.sql(
      `SELECT outcome, path FROM portal_access_log WHERE outcome IN ('invalid', 'throttled', 'revoked')`
    );
    expect(log.some((l) => l.outcome === "throttled")).toBe(true);
    expect(log.every((l) => !String(l.path).includes(link.token))).toBe(true);
    const access = await t.as.get(`/api/portal/contacts/${cid}/access`);
    expect(access.status).toBe(200);
    expect(access.body.links.length).toBe(2);
    expect(JSON.stringify(access.body)).not.toContain(hash);
    // Another tenant cannot mint or read access for this contact.
    const other = await h.createSecondTenant();
    expect((await other.as.post("/api/portal/generate-access", { contactId: cid })).status).toBe(
      404
    );
  });

  it("[R16-05] a client-portal user sees only their contact's invoices and customer thread, never staff threads", async () => {
    const t = await h.createTenant();
    const mine = await contact(t, "Bound Customer");
    const theirs = await contact(t, "Other Customer");
    const myInv = await invoice(t, mine);
    await invoice(t, theirs);
    const pu = await h.createSecondTenant({ userType: "client_portal" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      pu.user.id,
    ]);
    // Not linked yet → no data at all.
    const unlinked = await pu.as.get("/api/client-portal/invoices");
    expect(unlinked.status).toBe(403);
    expect(unlinked.body.code).toBe("PORTAL_CONTACT_NOT_LINKED");
    const bind = await t.as.post(`/api/portal/contacts/${mine}/portal-users`, {
      userId: pu.user.id,
    });
    expect(bind.status, bind.text).toBe(201);
    const list = await pu.as.get("/api/client-portal/invoices");
    expect(list.status).toBe(200);
    expect(list.body.map((i: { id: string }) => i.id)).toEqual([myInv.id]);

    const staff = await t.as.post(`/api/companies/${t.company.id}/messages`, {
      content: "internal: chase this customer",
    });
    expect(staff.status).toBe(201);
    const toCustomer = await t.as.post(`/api/companies/${t.company.id}/messages`, {
      content: "Hello, your statement is ready",
      contactId: mine,
    });
    expect(toCustomer.status, toCustomer.text).toBe(201);
    await t.as.post(`/api/companies/${t.company.id}/messages`, {
      content: "for the other customer",
      contactId: theirs,
    });
    const msgs = await pu.as.get("/api/client-portal/messages");
    expect(msgs.status).toBe(200);
    expect(msgs.body.map((m: { content: string }) => m.content)).toEqual([
      "Hello, your statement is ready",
    ]);
    const reply = await pu.as.post("/api/client-portal/messages", { content: "Thanks!" });
    expect(reply.status, reply.text).toBe(201);
    expect(reply.body.contactId).toBe(mine);
    expect(reply.body.visibility).toBe("customer");
    // Statements are the customer's statement of account, not the company P&L.
    const st = await pu.as.get("/api/client-portal/statements");
    expect(st.status).toBe(200);
    expect(st.body.kind).toBe("customer");
    expect(st.body.party.id).toBe(mine);
    expect(st.body.profitAndLoss).toBeUndefined();
  });
});

describe("W4-D statements of account", () => {
  it("[R16-15] the customer statement ties to the customer's AR balance and the aging report", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Statement Customer");
    const a = await invoice(t, cid);
    const b = await invoice(t, cid, true, 2000);
    const bank = await h.sql(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [
      t.company.id,
    ]);
    const pay = await t.as.post(`/api/companies/${t.company.id}/invoices/${a.id}/payments`, {
      date: iso(new Date()),
      method: "bank",
      paymentAccountId: bank[0].id,
      amount: 300,
    });
    expect(pay.status, pay.text).toBeLessThan(300);
    const st = await t.as.get(`/api/companies/${t.company.id}/customer-statements/${cid}`);
    expect(st.status, st.text).toBe(200);
    expect(st.body.sections.length).toBe(1);
    const sec = st.body.sections[0];
    expect(sec.currency).toBe("AED");
    // 1050 + 2100 − 300
    expect(sec.closingBalance).toBe(2850);
    expect(sec.lines.map((l: { type: string }) => l.type)).toEqual([
      "invoice",
      "invoice",
      "payment",
    ]);
    expect(sec.lines[2].balance).toBe(2850);
    expect(sec.aging.total).toBe(2850);
    const open = await h.sql(
      `SELECT SUM(i.total - coalesce((SELECT SUM(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0))::float8 AS ar
         FROM invoices i WHERE i.contact_id = $1 AND i.status IN ('sent', 'partial')`,
      [cid]
    );
    expect(open[0].ar).toBe(2850);
    const aging = await t.as.get(
      `/api/companies/${t.company.id}/reports/aged-receivables?asOf=${iso(new Date())}`
    );
    expect(aging.status, aging.text).toBe(200);
    const row = aging.body.rows.find((r: { name: string }) => r.name === "Statement Customer");
    expect(row.total).toBe(2850);
    // Opening balance: everything before `from`.
    const later = await t.as.get(
      `/api/companies/${t.company.id}/customer-statements/${cid}?from=${iso(new Date(Date.now() - DAY))}`
    );
    expect(later.body.sections[0].openingBalance).toBe(3150);
    expect(later.body.sections[0].closingBalance).toBe(2850);
    void b;
    const pdf = await t.as.get(
      `/api/companies/${t.company.id}/customer-statements/${cid}?format=pdf`
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    // The portal shows the same statement.
    const { token } = await portalLink(t, cid);
    const portal = await h.anon.get(`/api/portal/${token}/statement`);
    expect(portal.body.sections[0].closingBalance).toBe(2850);
    // Emailing it queues the PDF through the outbox (no provider → honest 202).
    const mail = await t.as.post(
      `/api/companies/${t.company.id}/customer-statements/${cid}/email`,
      { to: "billing@statement.example" }
    );
    expect(mail.status, mail.text).toBe(202);
    expect(mail.body.status).toBe("blocked_no_provider");
    expect(mail.body.message).toContain("Email not configured");
    const att = await h.sql(
      `SELECT a.content_type FROM email_outbox_attachments a JOIN email_outbox o ON o.id = a.outbox_id
        WHERE o.id = $1`,
      [mail.body.id]
    );
    expect(att[0].content_type).toBe("application/pdf");
    // Other tenants cannot read it.
    const other = await h.createSecondTenant();
    expect(
      (await other.as.get(`/api/companies/${t.company.id}/customer-statements/${cid}`)).status
    ).toBe(403);
  });

  it("[R11-15] supplier statement: bills less payments, closing balance and aging", async () => {
    const t = await h.createTenant();
    const v = await h.sql(
      `INSERT INTO vendors (company_id, name) VALUES ($1, 'Paper Supplies FZE') RETURNING id`,
      [t.company.id]
    );
    const bill = await h.sql(
      `INSERT INTO vendor_bills (company_id, vendor_id, vendor_name, bill_number, bill_date, due_date,
              currency, subtotal, vat_amount, total_amount, status)
       VALUES ($1, $2, 'Paper Supplies FZE', 'B-1', now() - interval '40 days', now() - interval '10 days',
               'AED', 1000, 50, 1050, 'approved') RETURNING id`,
      [t.company.id, v[0].id]
    );
    await h
      .sql(
        `INSERT INTO bill_payments (bill_id, amount, payment_date, payment_method) VALUES ($1, 50, now(), 'bank')`,
        [bill[0].id]
      )
      .catch(async () =>
        h.sql(`INSERT INTO bill_payments (bill_id, amount, payment_date) VALUES ($1, 50, now())`, [
          bill[0].id,
        ])
      );
    const st = await t.as.get(`/api/companies/${t.company.id}/supplier-statements/${v[0].id}`);
    expect(st.status, st.text).toBe(200);
    expect(st.body.kind).toBe("supplier");
    expect(st.body.sections[0].closingBalance).toBe(1000);
    expect(st.body.sections[0].aging.days30).toBe(1000);
  });
});

describe("W4-D customer self-service", () => {
  it("[R16-16] one-time-code login, quote acceptance and customer upload into the vault", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "Self Service Co", "buyer@selfservice.example");
    const req = await h.anon.post("/api/portal/login/request", {
      companyId: t.company.id,
      email: "buyer@selfservice.example",
    });
    expect(req.status, req.text).toBe(200);
    // Unknown emails get the same answer and no code.
    const unknown = await h.anon.post("/api/portal/login/request", {
      companyId: t.company.id,
      email: "nobody@else.example",
    });
    expect(unknown.body).toEqual(req.body);
    const [mail] = await h.sql(
      `SELECT subject, status FROM email_outbox WHERE category = 'portal_login' AND to_address = $1`,
      ["buyer@selfservice.example"]
    );
    expect(mail.status).toBe("blocked_no_provider");
    const code = /(\d{6})$/.exec(mail.subject)![1];
    const bad = await h.anon.post("/api/portal/login/verify", {
      companyId: t.company.id,
      email: "buyer@selfservice.example",
      code: code === "000000" ? "111111" : "000000",
    });
    expect(bad.status).toBe(401);
    const ok = await h.anon.post("/api/portal/login/verify", {
      companyId: t.company.id,
      email: "buyer@selfservice.example",
      code,
    });
    expect(ok.status, ok.text).toBe(200);
    const session = ok.body.token as string;
    const info = await h.anon.get(`/api/portal/${session}/info`);
    expect(info.status).toBe(200);
    expect(info.body.customerName).toBe("Self Service Co");
    // A code is single-use.
    expect(
      (
        await h.anon.post("/api/portal/login/verify", {
          companyId: t.company.id,
          email: "buyer@selfservice.example",
          code,
        })
      ).status
    ).toBe(401);

    const q = await h.sql(
      `INSERT INTO quotes (company_id, number, customer_name, contact_id, date, status, total)
       VALUES ($1, 'QT-1', 'Self Service Co', $2, now(), 'sent', 525) RETURNING id`,
      [t.company.id, cid]
    );
    const quotes = await h.anon.get(`/api/portal/${session}/quotes`);
    expect(quotes.body.map((x: { id: string }) => x.id)).toEqual([q[0].id]);
    const accept = await h.anon.post(`/api/portal/${session}/quotes/${q[0].id}/respond`, {
      decision: "accepted",
      signerName: "Fatima Buyer",
    });
    expect(accept.status, accept.text).toBe(200);
    expect(accept.body.status).toBe("accepted");
    expect(
      (
        await h.anon.post(`/api/portal/${session}/quotes/${q[0].id}/respond`, {
          decision: "declined",
          signerName: "Fatima Buyer",
        })
      ).status
    ).toBe(409);
    const resp = await h.sql(
      `SELECT decision, signer_name FROM portal_quote_responses WHERE quote_id = $1`,
      [q[0].id]
    );
    expect(resp[0]).toEqual({ decision: "accepted", signer_name: "Fatima Buyer" });

    const pdf = Buffer.from("%PDF-1.4\n% customer trade licence\n%%EOF\n");
    const up = await h.anon.post(`/api/portal/${session}/documents`, {
      fileData: `data:application/pdf;base64,${pdf.toString("base64")}`,
      fileName: "licence.pdf",
      category: "trade_license",
    });
    expect(up.status, up.text).toBe(201);
    const [doc] = await h.sql(
      `SELECT source, contact_id, storage_key, sha256 FROM documents WHERE id = $1`,
      [up.body.id]
    );
    expect(doc.source).toBe("customer_portal");
    expect(doc.contact_id).toBe(cid);
    expect(doc.sha256).toBe(crypto.createHash("sha256").update(pdf).digest("hex"));
    const dl = await t.as.get(`/api/documents/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.text).toContain("customer trade licence");
  });

  it("[R16-19] the portal shows the e-invoice status and serves the e-invoice XML when one exists", async () => {
    const t = await h.createTenant();
    const cid = await contact(t, "E-Invoice Co");
    const inv = await invoice(t, cid);
    await h.sql(
      `UPDATE invoices SET einvoice_status = 'accepted', einvoice_uuid = 'uuid-123',
              einvoice_xml = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'
        WHERE id = $1`,
      [inv.id]
    );
    const { token } = await portalLink(t, cid);
    const list = await h.anon.get(`/api/portal/${token}/invoices`);
    expect(list.body[0].einvoice).toEqual({ status: "accepted", uuid: "uuid-123", hasXml: true });
    const xml = await h.anon.get(`/api/portal/${token}/invoices/${inv.id}/einvoice`);
    expect(xml.status).toBe(200);
    expect(xml.headers.get("content-type")).toContain("application/xml");
    expect(xml.text).toContain("ubl:schema");
  });
});

describe("J4 portal link management follows the company role", () => {
  it("J4: a viewer can list link metadata but cannot mint or revoke links; the owner can", async () => {
    const t = await h.createTenant({ name: "PortalRole" });
    const cid = await contact(t, "Role Customer");
    const v = await h.createTenant({ name: "PortalViewer" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      v.user.id,
    ]);
    const gen = await v.as.post("/api/portal/generate-access", { contactId: cid });
    expect(gen.status).toBe(403);
    const rev = await v.as.post("/api/portal/revoke-access", { contactId: cid });
    expect(rev.status).toBe(403);
    const list = await v.as.get(`/api/portal/contacts/${cid}/access`);
    expect(list.status).toBe(200);

    const { token, expiresAt } = await portalLink(t, cid);
    const { PORTAL_LINK_TTL_DAYS } = await import("../../shared/validators/portal");
    const days = Math.round((new Date(expiresAt).getTime() - Date.now()) / DAY);
    expect(days).toBe(PORTAL_LINK_TTL_DAYS);
    expect((await t.as.post("/api/portal/revoke-access", { contactId: cid })).status).toBe(200);
    expect((await h.anon.get(`/api/portal/${token}/invoices`)).status).toBe(410);
  });
});

describe("PR-62 client-portal users are confined to the portal API", () => {
  it("PR-62: a bound client_portal member cannot read the company's books, dashboard or team", async () => {
    const t = await h.createTenant();
    const pu = await h.createSecondTenant({ userType: "client_portal" });
    await h.sql(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
      t.company.id,
      pu.user.id,
    ]);
    for (const p of [
      "reports/profit-loss",
      "reports/balance-sheet",
      "dashboard/stats",
      "team",
      "invoices",
    ]) {
      const r = await pu.as.get(`/api/companies/${t.company.id}/${p}`);
      expect(r.status, p).toBe(403);
      if (r.body?.code) expect(r.body.code).toBe("PORTAL_SCOPE");
    }
    expect((await pu.as.get("/api/companies")).status).toBe(403);
    // The portal API and the session endpoints stay open.
    expect((await pu.as.get("/api/auth/me")).status).toBe(200);
    expect((await pu.as.get("/api/client-portal/invoices")).status).toBe(403); // unbound: own guard
    // A staff member of the same company is unaffected.
    expect((await t.as.get(`/api/companies/${t.company.id}/reports/profit-loss`)).status).toBe(200);
  });
});
