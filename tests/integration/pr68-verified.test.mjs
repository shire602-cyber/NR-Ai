// PR #68 end-to-end verification against a real server and a real Postgres (the merged #67 line):
// every route, endpoint and permission PR #68 touched, exercised the way a user would.
//
//   - team member PUT/DELETE scoped to the URL company (PR-65)
//   - firm client edit / summary / switch / archive: NR client, invited customer, never-invited
//     company, revoked link (PR-65 + owner decision on invited customers)
//   - member lists carry no credentials (firm summary, admin client detail) (PR-62)
//   - client-portal users confined to the portal API (PR-62)
//   - Stripe billing webhook verifies a signed raw body; a replay is a no-op (PR-62)
//   - payment chasing net of credit notes (PR-61); Art. 53 on expense claims (PR-61)
//   - month-end checklist for a quarterly filer (PR-66 / E3)
//   - e-invoice pre-flight: buyer without TRN or endpoint gets EINVOICE_BUYER_ENDPOINT_MISSING
//   - migration 0127: both settlement indexes exist, are valid and are used by the planner
//
// Requires BASE_URL (running server, started with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET set
// to test values; without them the Stripe checks are skipped) and DATABASE_URL (to set up roles
// there is deliberately no API for: firm_owner, platform admin, client_portal).
import pg from "pg";
import { createHmac } from "node:crypto";
import { withRegisterLogin } from "./register-compat.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
let pass = 0;
let fail = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    fails.push(name + " :: " + JSON.stringify(detail)?.slice(0, 400));
    console.log("FAIL  " + name + "  " + JSON.stringify(detail)?.slice(0, 400));
  }
};
async function rawApi(method, path, { body, token, headers, raw } = {}) {
  const h = { ...(headers ?? {}) };
  if (!raw) h["Content-Type"] = "application/json";
  if (token) h.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}
const api = withRegisterLogin(rawApi);
const rnd = Math.random().toString(36).slice(2, 8);
const iso = (d) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const TRN = "100000000000003";

async function signup(label) {
  const email = `${label}_${rnd}@example.com`.toLowerCase();
  const r = await api("POST", "/api/auth/register", {
    body: { name: label, email, password: "Password123!" },
  });
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`signup ${label} failed: ${r.status} ${r.text.slice(0, 200)}`);
  }
  return { token: r.json.token, companyId: r.json.company.id, userId: r.json.user.id, email };
}
async function relogin(t) {
  const r = await rawApi("POST", "/api/auth/login", {
    body: { email: t.email, password: "Password123!" },
  });
  return { ...t, token: r.json?.token ?? t.token };
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  // ── tenants ────────────────────────────────────────────────────────────────
  const A = await signup("pr68-a");
  const B = await signup("pr68-b");
  const staffB = await signup("pr68-staffb");
  const staffA = await signup("pr68-staffa");
  await q(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [
    B.companyId,
    staffB.userId,
  ]);
  await q(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'employee')`, [
    A.companyId,
    staffA.userId,
  ]);
  const memberId = async (companyId, userId) =>
    (
      await q(`SELECT id FROM company_users WHERE company_id=$1 AND user_id=$2`, [
        companyId,
        userId,
      ])
    )[0].id;
  const bStaff = await memberId(B.companyId, staffB.userId);
  const aStaff = await memberId(A.companyId, staffA.userId);

  // ── team member scoping (PR-65) ────────────────────────────────────────────
  {
    const put = await api("PUT", `/api/companies/${A.companyId}/team/${bStaff}`, {
      token: A.token,
      body: { role: "owner" },
    });
    ok("team: A cannot change B's member via A's URL (404)", put.status === 404, put);
    const del = await api("DELETE", `/api/companies/${A.companyId}/team/${bStaff}`, {
      token: A.token,
    });
    ok("team: A cannot remove B's member via A's URL (404)", del.status === 404, del);
    const row = await q(`SELECT company_id, role FROM company_users WHERE id=$1`, [bStaff]);
    ok(
      "team: B's membership row unchanged",
      row[0]?.role === "accountant" && row[0]?.company_id === B.companyId,
      row
    );
    const list = await api("GET", `/api/companies/${A.companyId}/team`, { token: A.token });
    ok(
      "team: own team list loads (200, no hashes)",
      list.status === 200 && !/passwordHash|password_hash/.test(list.text),
      list.status
    );
    const own = await api("PUT", `/api/companies/${A.companyId}/team/${aStaff}`, {
      token: A.token,
      body: { role: "accountant" },
    });
    ok(
      "team: owner changes own member's role (200)",
      own.status === 200 && own.json?.role === "accountant",
      own
    );
    const rm = await api("DELETE", `/api/companies/${A.companyId}/team/${aStaff}`, {
      token: A.token,
    });
    ok("team: owner removes own member (204)", rm.status === 204, rm);
  }

  // ── firm clients (PR-65 + invited-customer decision) ───────────────────────
  const nr = await signup("pr68-nrowner");
  await q(`UPDATE users SET firm_role='firm_owner' WHERE id=$1`, [nr.userId]);
  const nrT = await relogin(nr);
  {
    const created = await api("POST", "/api/firm/clients", {
      token: nrT.token,
      body: { name: `PR68 Client ${rnd} LLC`, trnVatNumber: TRN },
    });
    ok("firm: NR owner creates a client (201)", created.status === 201, created);
    const cid = created.json?.id;
    const edit = await api("PUT", `/api/firm/clients/${cid}`, {
      token: nrT.token,
      body: { industry: "Retail" },
    });
    ok("firm: edits own NR client (200)", edit.status === 200, edit);
    const member = await signup("pr68-clientmember");
    await q(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'accountant')`, [
      cid,
      member.userId,
    ]);
    const summary = await api("GET", `/api/firm/clients/${cid}/summary`, { token: nrT.token });
    ok(
      "firm: client summary loads with members and no credentials (200)",
      summary.status === 200 &&
        summary.text.includes(member.email) &&
        !/passwordHash|password_hash|tokenVersion|\$2[aby]\$/.test(summary.text),
      summary.status
    );
    const sw = await api("POST", `/api/firm/clients/${cid}/switch`, { token: nrT.token });
    ok("firm: switch into own client (200)", sw.status === 200, sw);
    const listC = await api("GET", "/api/firm/clients", { token: nrT.token });
    ok(
      "firm: client list includes it (200)",
      listC.status === 200 && JSON.stringify(listC.json).includes(cid),
      listC.status
    );

    // A self-signup SaaS company that never invited the firm: another tenant, 404, untouched.
    const before = await q(`SELECT name, trn_vat_number FROM companies WHERE id=$1`, [B.companyId]);
    for (const [m, p, body] of [
      ["PUT", `/api/firm/clients/${B.companyId}`, { name: "Hijacked LLC" }],
      ["GET", `/api/firm/clients/${B.companyId}/summary`],
      ["POST", `/api/firm/clients/${B.companyId}/switch`],
      ["DELETE", `/api/firm/clients/${B.companyId}`],
    ]) {
      const r = await api(m, p, { token: nrT.token, body });
      ok(
        `firm: ${m} ${p.replace(B.companyId, ":never-invited")} is 404`,
        r.status === 404,
        r.status
      );
    }
    const after = await q(`SELECT name, trn_vat_number, deleted_at FROM companies WHERE id=$1`, [
      B.companyId,
    ]);
    ok(
      "firm: never-invited company unchanged",
      after[0].name === before[0].name && after[0].deleted_at === null,
      after
    );

    // Invited customer: the inviting firm keeps profile edits; a revoked link ends them.
    const cust = await signup("pr68-invited");
    const inv = await api("POST", "/api/firm/client-links", {
      token: nrT.token,
      body: { inviteeEmail: cust.email },
    });
    ok("firm: NR firm invites a customer (201)", inv.status === 201, inv);
    const acc = await api("POST", `/api/firm-invitations/${inv.json?.link?.id}/accept`, {
      token: cust.token,
      body: { companyId: cust.companyId },
    });
    ok("firm: customer accepts (200)", acc.status === 200, acc);
    const e1 = await api("PUT", `/api/firm/clients/${cust.companyId}`, {
      token: nrT.token,
      body: { name: `PR68 Invited ${rnd} LLC` },
    });
    ok("firm: inviting firm edits invited customer's profile (200)", e1.status === 200, e1);
    const links = await api("GET", `/api/companies/${cust.companyId}/firm-links`, {
      token: cust.token,
    });
    const rv = await api(
      "POST",
      `/api/companies/${cust.companyId}/firm-links/${links.json?.links?.[0]?.id}/revoke`,
      {
        token: cust.token,
        body: { reason: "Changed accountant" },
      }
    );
    ok("firm: customer revokes the link (200)", rv.status === 200, rv);
    const e2 = await api("PUT", `/api/firm/clients/${cust.companyId}`, {
      token: nrT.token,
      body: { name: "After revoke" },
    });
    ok("firm: after revoke the firm's edit is 404", e2.status === 404, e2.status);

    // Admin client detail: member list without credentials.
    const admin = await signup("pr68-admin");
    await q(`UPDATE users SET is_admin=true WHERE id=$1`, [admin.userId]);
    const adminT = await relogin(admin);
    const detail = await api("GET", `/api/admin/clients/${cid}`, { token: adminT.token });
    ok(
      "admin: client detail loads without credentials (200)",
      detail.status === 200 && !/passwordHash|password_hash|\$2[aby]\$/.test(detail.text),
      detail.status
    );
  }

  // ── client-portal confinement (PR-62) ──────────────────────────────────────
  {
    const pu = await signup("pr68-portal");
    await q(`UPDATE users SET user_type='client_portal' WHERE id=$1`, [pu.userId]);
    await q(`INSERT INTO company_users (company_id, user_id, role) VALUES ($1,$2,'viewer')`, [
      A.companyId,
      pu.userId,
    ]);
    const puT = await relogin(pu);
    for (const p of [
      "reports/profit-loss",
      "reports/balance-sheet",
      "dashboard/stats",
      "team",
      "invoices",
    ]) {
      const r = await api("GET", `/api/companies/${A.companyId}/${p}`, { token: puT.token });
      ok(`portal: ${p} refused for a portal user (403)`, r.status === 403, r.status);
    }
    const companies = await api("GET", "/api/companies", { token: puT.token });
    ok(
      "portal: app-shell company list answers [] (200, no supplier row)",
      companies.status === 200 && Array.isArray(companies.json) && companies.json.length === 0,
      companies
    );
    const me = await api("GET", "/api/auth/me", { token: puT.token });
    ok("portal: /api/auth/me still works (200)", me.status === 200, me.status);
    const contact = await api("POST", `/api/companies/${A.companyId}/customer-contacts`, {
      token: A.token,
      body: { name: `Portal Customer ${rnd}`, email: `pc_${rnd}@example.com` },
    });
    ok("portal: staff creates a customer contact (2xx)", contact.status < 300, contact);
    const bind = await api("POST", `/api/portal/contacts/${contact.json?.id}/portal-users`, {
      token: A.token,
      body: { userId: pu.userId },
    });
    ok("portal: staff binds the portal user to the contact (201)", bind.status === 201, bind);
    for (const p of ["dashboard", "invoices", "statements", "messages", "documents", "company"]) {
      const r = await api("GET", `/api/client-portal/${p}`, { token: puT.token });
      ok(`portal: /api/client-portal/${p} loads (200)`, r.status === 200, r.status);
    }
  }

  // ── Stripe webhook raw body (PR-62) ────────────────────────────────────────
  if (STRIPE_SECRET) {
    const id = `evt_pr68_${rnd}${Date.now()}`;
    const payload = JSON.stringify({
      id,
      object: "event",
      type: "pr68.unhandled",
      data: { object: {} },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", STRIPE_SECRET).update(`${t}.${payload}`).digest("hex");
    const headers = { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` };
    const r1 = await rawApi("POST", "/api/webhooks/stripe", { raw: payload, headers });
    ok(
      "stripe: signed raw-body event verifies (200)",
      r1.status === 200 && r1.json?.received === true,
      r1
    );
    const r2 = await rawApi("POST", "/api/webhooks/stripe", { raw: payload, headers });
    ok(
      "stripe: replay is a no-op (200, one event row)",
      r2.status === 200 && (await q(`SELECT 1 FROM stripe_events WHERE id=$1`, [id])).length === 1,
      r2.status
    );
    const bad = await rawApi("POST", "/api/webhooks/stripe", {
      raw: payload.replace("pr68", "evil"),
      headers,
    });
    ok("stripe: tampered body refused (400)", bad.status === 400, bad.status);
  } else {
    console.log("SKIP  stripe webhook checks (server started without STRIPE_WEBHOOK_SECRET)");
  }

  // ── chasing net of credit notes (PR-61) ────────────────────────────────────
  {
    // A VAT invoice needs a supplier TRN and a place of supply; a fresh signup has neither yet.
    await q(`UPDATE companies SET trn_vat_number=$2, emirate='dubai' WHERE id=$1`, [
      A.companyId,
      TRN,
    ]);
    const created = await api("POST", `/api/companies/${A.companyId}/invoices`, {
      token: A.token,
      body: {
        customerName: "Late Payer LLC",
        date: iso(new Date(Date.now() - 60 * DAY)),
        dueDate: iso(new Date(Date.now() - 30 * DAY)),
        lines: [{ description: "Consulting", quantity: 1, unitPrice: 1000, vatRate: 5 }],
      },
    });
    ok("chasing: invoice created (200)", created.status === 200, created);
    const id = created.json?.id;
    const sent = await api("PATCH", `/api/invoices/${id}/status`, {
      token: A.token,
      body: { status: "sent" },
    });
    ok("chasing: invoice issued (200)", sent.status === 200, sent);
    const cn = await api("POST", `/api/companies/${A.companyId}/credit-notes`, {
      token: A.token,
      body: {
        invoiceId: id,
        lines: [{ description: "Damaged", quantity: 1, unitPrice: 100, vatRate: 5 }],
        reason: "Damaged goods",
      },
    });
    const issued = await api("POST", `/api/credit-notes/${cn.json?.id}/issue`, {
      token: A.token,
      body: {},
    });
    ok("chasing: credit note issued (201/200)", cn.status === 201 && issued.status === 200, {
      cn: cn.status,
      issued: issued.status,
    });
    const overdue = await api("GET", `/api/chasing/overdue/${A.companyId}`, { token: A.token });
    const row = overdue.json?.rows?.find((r) => r.invoice.id === id);
    ok(
      "chasing: overdue row is net of the credit note (945)",
      overdue.status === 200 && row?.outstanding === 945,
      row ?? overdue
    );
    const queue = await api("GET", `/api/chasing/queue/${A.companyId}`, { token: A.token });
    ok("chasing: queue loads (200)", queue.status === 200, queue.status);

    // ── e-invoice pre-flight: buyer without TRN or endpoint ──────────────────
    const v = await api("GET", `/api/invoices/${id}/einvoice/validate`, { token: A.token });
    const codes = (v.json?.issues ?? []).map((i) => i.code).filter(Boolean);
    ok(
      "einvoice: validate names EINVOICE_BUYER_ENDPOINT_MISSING for a buyer without TRN (200)",
      v.status === 200 && codes.includes("EINVOICE_BUYER_ENDPOINT_MISSING"),
      { status: v.status, codes }
    );
  }

  // ── Art. 53 on expense claims (PR-61) ──────────────────────────────────────
  {
    const item = (category) => ({
      expense_date: iso(new Date(Date.now() - 5 * DAY)),
      category,
      description: category,
      amount: 100,
      vat_amount: 5,
      has_tax_invoice: true,
    });
    const c = await api("POST", `/api/companies/${A.companyId}/expense-claims`, {
      token: A.token,
      body: { title: "Dinner and taxi", items: [item("Entertainment"), item("Travel")] },
    });
    ok("claims: claim created (200)", c.status === 200, c);
    const rows = await q(
      `SELECT category, vat_recoverable FROM expense_claim_items WHERE claim_id=$1 ORDER BY category`,
      [c.json?.id]
    );
    ok(
      "claims: entertainment VAT not recoverable, travel VAT recoverable",
      rows.length === 2 && rows[0].vat_recoverable === false && rows[1].vat_recoverable === true,
      rows
    );
  }

  // ── month-end checklist (PR-66 / E3) ───────────────────────────────────────
  {
    await q(
      `UPDATE companies SET vat_filing_frequency='quarterly', vat_period_start_month=1 WHERE id=$1`,
      [A.companyId]
    );
    const r = await api("GET", `/api/companies/${A.companyId}/month-end/checklist?period=2025-07`, {
      token: A.token,
    });
    const step = r.json?.checklist?.find((c) => c.id === 7);
    ok(
      "month-end: quarterly mid-period month is not blocked (200, complete)",
      r.status === 200 && step?.status === "complete",
      step ?? r.status
    );
  }

  // ── migration 0127 ─────────────────────────────────────────────────────────
  {
    const idx = await q(
      `SELECT indexrelid::regclass::text AS name, indisvalid FROM pg_index
        WHERE indexrelid::regclass::text IN ('idx_invoices_original_invoice_id','idx_credit_notes_invoice_id')`
    );
    ok(
      "0127: both settlement indexes exist and are valid",
      idx.length === 2 && idx.every((i) => i.indisvalid),
      idx
    );
    const ledger = await q(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    ok("0127: migration ledger includes 0127 (127+ rows)", ledger[0].n >= 127, ledger);
    await q("SET enable_seqscan = off");
    const plan = await q(
      `EXPLAIN SELECT 1 FROM invoices c WHERE c.original_invoice_id = $1::uuid`,
      [A.companyId]
    );
    await q("SET enable_seqscan = on");
    ok(
      "0127: the planner can use idx_invoices_original_invoice_id",
      JSON.stringify(plan).includes("idx_invoices_original_invoice_id"),
      plan
    );
  }

  await db.end();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) {
    for (const f of fails) console.log(" - " + f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
