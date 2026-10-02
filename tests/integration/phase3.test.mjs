// Phase 3 integration tests: nothing a customer can reach pretends to work.
//   3.1  e-commerce sync is honest (501), no secrets in integration rows
//   3.2  API keys: issuance is real since Phase 8 (scoped keys); a malformed request stores nothing, list never exposes the hash, revoke is soft
//   3.3  webhooks fire for the documented events, after commit, without ever failing the request
//   3.4  client-portal invite flow + portal user isolation
//   BASE_URL=http://127.0.0.1:5057 DATABASE_URL=... node tests/integration/phase3.test.mjs

import pg from "pg";
import crypto from "node:crypto";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
// Public (no-login) POSTs are CSRF-protected: fetch a token + cookies first, like the browser client does.
async function publicPost(p, body) {
  const t = await fetch(BASE + "/api/csrf-token");
  const csrf = (await t.json()).csrfToken;
  const cookie = (t.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrf, Cookie: cookie }, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const PASSWORD = "Password123!";

async function register(label) {
  const email = `${label}_${rnd}@example.com`;
  const r = await api("POST", "/api/auth/register", { body: { name: label, email, password: PASSWORD } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  return { token: r.json.token, userId: r.json.user.id, email, companyId: r.json.company?.id };
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const q = (sql, params) => db.query(sql, params);
  const denied = (r) => [401, 403, 404].includes(r.status);
  try {
    const cust = await register("cust");
    const cid = cust.companyId;

    // ───────── 3.1 e-commerce ─────────
    {
      let r = await api("POST", "/api/integrations/ecommerce/connect", { token: cust.token, body: { companyId: cid, platform: "shopify", apiKey: "sekret-key", accessToken: "sekret-token", shopDomain: "x.myshopify.com" } });
      ok("3.1: connect is 501 NOT_AVAILABLE", r.status === 501 && r.json?.code === "NOT_AVAILABLE" && typeof r.json?.message === "string", { s: r.status, j: r.json });
      const nStored = (await q(`SELECT count(*)::int AS n FROM ecommerce_integrations WHERE company_id = $1`, [cid])).rows[0].n;
      ok("3.1: connect stored nothing", nStored === 0, nStored);

      const row = (await q(
        `INSERT INTO ecommerce_integrations (company_id, platform, is_active, api_key, access_token, refresh_token, webhook_secret, sync_status, last_sync_at)
         VALUES ($1, 'shopify', true, 'sekret-key', 'sekret-token', 'sekret-refresh', 'sekret-hook', 'success', now() - interval '3 days') RETURNING id, last_sync_at`, [cid])).rows[0];

      r = await api("GET", `/api/integrations/ecommerce?companyId=${cid}`, { token: cust.token });
      const item = Array.isArray(r.json) ? r.json[0] : null;
      ok("3.1: list returns only id, platform, status, lastSyncAt, hasCredentials",
        r.status === 200 && item && JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["hasCredentials", "id", "lastSyncAt", "platform", "status"]) && item.hasCredentials === true, r.json);
      ok("3.1: list never contains a stored secret", !/sekret/.test(r.text), r.text);
      ok("3.1: list does not report a fake sync as real", item?.status !== "success" && item?.lastSyncAt === null, item);

      r = await api("POST", `/api/integrations/ecommerce/${row.id}/sync`, { token: cust.token });
      ok("3.1: sync is 501 NOT_AVAILABLE", r.status === 501 && r.json?.code === "NOT_AVAILABLE", { s: r.status, j: r.json });
      await sleep(2500); // the old fake sync flipped the status after 2s
      const after = (await q(`SELECT sync_status, last_sync_at FROM ecommerce_integrations WHERE id = $1`, [row.id])).rows[0];
      ok("3.1: sync never marks the integration synced or touches lastSyncAt", after.sync_status === "success" && +new Date(after.last_sync_at) === +new Date(row.last_sync_at) , after);

      r = await api("PATCH", `/api/integrations/ecommerce/${row.id}/toggle`, { token: cust.token, body: { isActive: false } });
      ok("3.1: toggle is 501 NOT_AVAILABLE", r.status === 501 && r.json?.code === "NOT_AVAILABLE", { s: r.status });
      r = await api("GET", `/api/integrations/ecommerce/transactions?companyId=${cid}`, { token: cust.token });
      ok("3.1: transactions read carries no secrets", r.status === 200 && !/sekret/.test(r.text), r.status);
    }

    // ───────── 3.2 API keys ─────────
    {
      let r = await api("POST", `/api/companies/${cid}/api-keys`, { token: cust.token, body: { name: "ci", scopes: "read" } });
      ok("3.2: a malformed create (scopes is not an array) is 400 and returns no key", r.status === 400 && r.json?.code === "VALIDATION_ERROR" && !r.json?.key, { s: r.status, j: r.json });
      const n0 = (await q(`SELECT count(*)::int AS n FROM api_keys WHERE company_id = $1`, [cid])).rows[0].n;
      ok("3.2: create stored nothing", n0 === 0, n0);

      const k = (await q(`INSERT INTO api_keys (company_id, name, key_hash, key_prefix, scopes, created_by) VALUES ($1, 'old key', 'HASHVALUE123', substr(md5(random()::text), 1, 8), 'read', $2) RETURNING id`, [cid, cust.userId])).rows[0];
      r = await api("GET", `/api/companies/${cid}/api-keys`, { token: cust.token });
      ok("3.2: list still works and never exposes the hash", r.status === 200 && r.json?.length === 1 && !/HASHVALUE123|keyHash/.test(r.text), { s: r.status, t: r.text });
      r = await api("PUT", `/api/api-keys/${k.id}`, { token: cust.token, body: { isActive: true } });
      ok("3.2: update (re-activate) is refused: keys are immutable (405)", r.status === 405 && r.json?.code === "API_KEY_IMMUTABLE", { s: r.status });
      r = await api("DELETE", `/api/api-keys/${k.id}`, { token: cust.token });
      const after = (await q(`SELECT is_active, revoked_at FROM api_keys WHERE id = $1`, [k.id])).rows[0];
      ok("3.2: revoke still works (soft: the row stays, inactive and stamped)", r.status === 200 && after?.is_active === false && after?.revoked_at !== null, { s: r.status, after });
    }

    // ───────── 3.3 webhooks ─────────
    {
      // An SSRF-blocked target: registration refuses it, so the wiring test inserts the
      // endpoint row directly. The dispatcher must still record the attempt (and refuse to connect).
      let r = await api("POST", `/api/companies/${cid}/webhooks`, { token: cust.token, body: { url: "http://127.0.0.1:9/hook", events: "invoice.created" } });
      ok("3.3: registering a loopback URL is refused by the SSRF guard", r.status === 400 && /Invalid webhook URL/.test(r.json?.message || ""), { s: r.status, j: r.json });

      const ep = (await q(
        `INSERT INTO webhook_endpoints (company_id, url, secret, events, is_active) VALUES ($1, 'http://127.0.0.1:9/hook', $2, '*', true) RETURNING id`,
        [cid, crypto.randomBytes(32).toString("hex")])).rows[0];
      const deliveries = async () => (await q(`SELECT event, success, attempt_number, response_body, payload FROM webhook_deliveries WHERE webhook_endpoint_id = $1 ORDER BY created_at`, [ep.id])).rows;
      const waitFor = async (event, ms = 6000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const rows = await deliveries();
          const hit = rows.filter((d) => d.event === event);
          if (hit.length) return hit;
          await sleep(150);
        }
        return [];
      };

      const accounts = (await api("GET", `/api/companies/${cid}/accounts`, { token: cust.token })).json ?? [];
      const bank = accounts.find((a) => a.code === "1020");
      const t0 = Date.now();
      r = await api("POST", `/api/companies/${cid}/invoices`, { token: cust.token, body: { customerName: "Hook Co", date: ymd(-2), dueDate: ymd(20), lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] } });
      const inv = r.json;
      ok("3.3: invoice creation succeeds and is not slowed by delivery", r.status === 200 && Date.now() - t0 < 4000, { s: r.status, ms: Date.now() - t0 });
      let d = await waitFor("invoice.created");
      ok("3.3: invoice.created delivery attempted", d.length >= 1, await deliveries());
      ok("3.3: SSRF-blocked target refused and not retried", d.length === 1 && d[0].success === false && /Blocked/.test(d[0].response_body || ""), d);
      const payload = JSON.parse(d[0]?.payload || "{}");
      ok("3.3: payload has ids and amounts, no secrets", payload.event === "invoice.created" && payload.data?.invoiceId === inv.id && payload.data?.total != null && !/secret|password|token/i.test(d[0]?.payload || ""), payload);

      r = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: cust.token, body: { status: "sent" } });
      ok("3.3: issuing succeeds", r.status === 200, { s: r.status, j: r.json });
      ok("3.3: invoice.issued fired", (await waitFor("invoice.issued")).length === 1, await deliveries());

      r = await api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, { token: cust.token, body: { amount: 1050, date: ymd(0), method: "cash", paymentAccountId: bank?.id } });
      ok("3.3: payment succeeds", r.status === 201, { s: r.status, j: r.json });
      ok("3.3: payment.received fired", (await waitFor("payment.received")).length === 1, await deliveries());
      ok("3.3: invoice.paid fired when the payment settles it", (await waitFor("invoice.paid")).length === 1, await deliveries());

      r = await api("POST", `/api/companies/${cid}/invoices`, { token: cust.token, body: { customerName: "Hook Co", date: ymd(-2), dueDate: ymd(20), lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] } });
      const inv2 = r.json;
      await api("PATCH", `/api/invoices/${inv2.id}/status`, { token: cust.token, body: { status: "sent" } });
      r = await api("PATCH", `/api/invoices/${inv2.id}/status`, { token: cust.token, body: { status: "void" } });
      ok("3.3: voiding succeeds", r.status === 200, { s: r.status, j: r.json });
      ok("3.3: invoice.voided fired", (await waitFor("invoice.voided")).length === 1, await deliveries());

      r = await api("POST", `/api/companies/${cid}/invoices`, { token: cust.token, body: { customerName: "Hook Co", date: ymd(-2), dueDate: ymd(20), lines: [{ description: "svc", quantity: 1, unitPrice: 200, vatRate: 0.05 }] } });
      const inv3 = r.json;
      await api("PATCH", `/api/invoices/${inv3.id}/status`, { token: cust.token, body: { status: "sent" } });
      r = await api("POST", `/api/companies/${cid}/invoices/${inv3.id}/credit-note`, { token: cust.token, body: {} });
      ok("3.3: credit note issued", r.status === 201, { s: r.status, j: r.json });
      ok("3.3: credit_note.created fired", (await waitFor("credit_note.created")).length === 1, await deliveries());

      r = await api("POST", `/api/companies/${cid}/bills`, { token: cust.token, body: { vendor_name: "Vendor", bill_number: "B-" + rnd, bill_date: ymd(-1), due_date: ymd(20), line_items: [{ description: "stuff", quantity: 1, unit_price: 100, vat_rate: 5 }] } });
      const bill = r.json;
      r = await api("POST", `/api/bills/${bill?.id}/approve`, { token: cust.token });
      ok("3.3: bill approval succeeds", r.status === 200, { s: r.status, j: r.json });
      ok("3.3: bill.approved fired", (await waitFor("bill.approved")).length === 1, await deliveries());

      // A subscription that names an unsupported event is refused, so nobody waits for an event that never fires.
      r = await api("POST", `/api/companies/${cid}/webhooks`, { token: cust.token, body: { url: "https://93.184.216.34/h", events: "vat_return.filed" } });
      ok("3.3: unsupported event subscriptions are refused", r.status === 400 && /Unsupported event/.test(r.json?.message || ""), { s: r.status, j: r.json });
      r = await api("POST", `/api/companies/${cid}/webhooks`, { token: cust.token, body: { url: "https://93.184.216.34/h", events: "invoice.paid,bill.approved" } });
      ok("3.3: a supported subscription registers and returns the secret once", r.status === 201 && /^[0-9a-f]{64}$/.test(r.json?.secret || ""), { s: r.status, j: r.json });
    }

    // ───────── 3.4 client-portal invites ─────────
    {
      const mkClient = async (name) => (await q(`INSERT INTO companies (name, company_type) VALUES ($1, 'client') RETURNING id`, [name + "_" + rnd])).rows[0].id;
      const C1 = await mkClient("PortalClientOne");
      const C2 = await mkClient("PortalClientTwo");
      const owner = await register("firmowner");
      const admin1 = await register("firmadmin1"); // assigned to C1
      const admin2 = await register("firmadmin2"); // NOT assigned
      await q(`UPDATE users SET firm_role = 'firm_owner' WHERE id = $1`, [owner.userId]);
      await q(`UPDATE users SET firm_role = 'firm_admin' WHERE id = ANY($1)`, [[admin1.userId, admin2.userId]]);
      await q(`INSERT INTO firm_staff_assignments (user_id, company_id, role) VALUES ($1, $2, 'accountant')`, [admin1.userId, C1]);

      const invite = (who, company, email) => api("POST", `/api/firm/clients/${company}/portal-invitations`, { token: who.token, body: { email } });
      const pEmail = (label) => `${label}_${rnd}@portal.example.com`;
      const acceptOf = (url) => url.split("/accept-invite/")[1];

      // access control
      let r = await invite(admin2, C1, pEmail("nope"));
      ok("3.4: firm_admin NOT assigned to the client cannot invite", r.status === 403, { s: r.status, j: r.json });
      r = await invite(cust, C1, pEmail("nope2"));
      ok("3.4: a SaaS customer cannot invite", r.status === 403, { s: r.status });
      r = await api("POST", `/api/firm/clients/${C1}/portal-invitations`, { body: { email: pEmail("anon") } });
      ok("3.4: unauthenticated cannot invite", r.status === 401, { s: r.status });
      r = await invite(admin1, cid, pEmail("notclient"));
      ok("3.4: cannot invite to a non-client (SaaS) company", [403, 404].includes(r.status), { s: r.status });
      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: admin2.token });
      ok("3.4: unassigned firm_admin cannot list portal users/invites", r.status === 403, { s: r.status });

      // invite (email is not configured on the test server: the API must say so)
      const p1 = pEmail("portal1");
      r = await invite(admin1, C1, p1);
      const emailConfigured = r.status === 201;
      ok("3.4: invite is honest about email: 201 only if sent, otherwise the email service's error", r.status === 201 ? r.json?.emailSent === true : (r.status === 503 && r.json?.code === "EMAIL_NOT_CONFIGURED" && r.json?.emailSent === false), { s: r.status, j: r.json });
      const url1 = r.json?.acceptUrl;
      const tok1 = url1 ? acceptOf(url1) : "";
      ok("3.4: accept link is returned outside production", /^[0-9a-f]{64}$/.test(tok1), r.json);
      const row1 = (await q(`SELECT token, status, user_type, EXTRACT(EPOCH FROM (expires_at - (now() AT TIME ZONE 'UTC')))/86400 AS days, company_id FROM invitations WHERE email = $1`, [p1])).rows[0];
      ok("3.4: token is stored hashed, never raw", row1 && row1.token === sha256(tok1) && row1.token !== tok1, row1);
      ok("3.4: invitation is client_portal, pending, bound to the client, expires in ~7 days",
        row1.user_type === "client_portal" && row1.status === "pending" && row1.company_id === C1 && Math.abs(Number(row1.days) - 7) < 0.1, row1);
      ok("3.4: invite response carries no token field", !("token" in (r.json?.invitation || {})), r.json?.invitation);

      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: admin1.token });
      ok("3.4: list shows the pending invite", r.status === 200 && r.json?.invitations?.some((i) => i.email === p1 && i.status === "pending"), r.json);
      ok("3.4: list never contains a token, raw or hashed", !r.text.includes(tok1) && !r.text.includes(sha256(tok1)) && !/"token"/.test(r.text), r.text);
      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: owner.token });
      ok("3.4: firm_owner can list too", r.status === 200, { s: r.status });

      // verify / hashed value is not a credential
      r = await api("GET", `/api/invitations/verify/${tok1}`);
      ok("3.4: verify accepts the emailed token", r.status === 200 && r.json?.email === p1 && r.json?.userType === "client_portal", { s: r.status, j: r.json });
      r = await api("GET", `/api/invitations/verify/${sha256(tok1)}`);
      ok("3.4: the stored hash cannot be used as a token", r.status === 404, { s: r.status });
      r = await publicPost(`/api/invitations/accept/${sha256(tok1)}`, { name: "X", password: PASSWORD });
      ok("3.4: accepting with the stored hash is rejected", r.status === 404, { s: r.status });

      // accept
      r = await publicPost(`/api/invitations/accept/${tok1}`, { name: "Portal One", password: "weak" });
      ok("3.4: accept enforces the password policy", r.status === 400, { s: r.status, j: r.json });
      r = await publicPost(`/api/invitations/accept/${tok1}`, { name: "Portal One", password: PASSWORD });
      ok("3.4: accept creates the portal user and signs them in", r.status === 200 && r.json?.user?.userType === "client_portal" && !!r.json?.token && !r.json?.user?.passwordHash, { s: r.status, j: r.json });
      const portal1 = { token: r.json?.token, userId: r.json?.user?.id, email: p1 };
      const u1 = (await q(`SELECT user_type, is_admin, firm_role, email_verified, password_hash FROM users WHERE id = $1`, [portal1.userId])).rows[0];
      ok("3.4: portal user is verified, not admin, no firm role", u1.user_type === "client_portal" && u1.email_verified === true && u1.is_admin === false && u1.firm_role === null, u1);
      ok("3.4: password hashed at the configured bcrypt cost (>= 12)", /^\$2[aby]\$(1[2-9])\$/.test(u1.password_hash), u1.password_hash.slice(0, 7));
      const links = (await q(`SELECT company_id, role FROM company_users WHERE user_id = $1`, [portal1.userId])).rows;
      ok("3.4: bound to exactly that one company with the portal role", links.length === 1 && links[0].company_id === C1 && links[0].role === "client_portal", links);
      const aud = (await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'portal.invite_accept' AND user_id = $1`, [portal1.userId])).rows[0].n;
      ok("3.4: acceptance is audit-logged", aud === 1, aud);

      r = await publicPost(`/api/invitations/accept/${tok1}`, { name: "Again", password: PASSWORD });
      ok("3.4: a used token cannot be reused", r.status === 400, { s: r.status, j: r.json });
      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: admin1.token });
      ok("3.4: accepted invite leaves pending; user appears in portal users", !r.json?.invitations?.some((i) => i.email === p1) && r.json?.users?.some((u) => u.email === p1 && u.active === true), r.json);

      // revoked / expired / resend
      const p2 = pEmail("portal2");
      r = await invite(admin1, C1, p2);
      const inv2 = r.json?.invitation, tok2 = acceptOf(r.json?.acceptUrl || "/accept-invite/");
      r = await api("POST", `/api/firm/portal-invitations/${inv2?.id}/revoke`, { token: admin2.token });
      ok("3.4: unassigned firm_admin cannot revoke", r.status === 403, { s: r.status });
      r = await api("POST", `/api/firm/portal-invitations/${inv2?.id}/revoke`, { token: admin1.token });
      ok("3.4: revoke works", r.status === 200 && r.json?.invitation?.status === "revoked", { s: r.status, j: r.json });
      r = await publicPost(`/api/invitations/accept/${tok2}`, { name: "Revoked", password: PASSWORD });
      ok("3.4: a revoked token is rejected", r.status === 400, { s: r.status, j: r.json });

      const p3 = pEmail("portal3");
      r = await invite(admin1, C1, p3);
      const tok3 = acceptOf(r.json?.acceptUrl || "/accept-invite/");
      await q(`UPDATE invitations SET expires_at = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE email = $1`, [p3]);
      r = await publicPost(`/api/invitations/accept/${tok3}`, { name: "Late", password: PASSWORD });
      ok("3.4: an expired token is rejected", r.status === 400, { s: r.status, j: r.json });
      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: admin1.token });
      ok("3.4: an expired invite is listed as expired (so it can be resent)", r.json?.invitations?.some((i) => i.email === p3 && i.status === "expired"), r.json?.invitations);
      const inv3 = r.json?.invitations?.find((i) => i.email === p3);
      r = await api("POST", `/api/firm/portal-invitations/${inv3?.id}/resend`, { token: admin1.token });
      const tok3b = acceptOf(r.json?.acceptUrl || "/accept-invite/");
      ok("3.4: resend issues a new link", /^[0-9a-f]{64}$/.test(tok3b) && tok3b !== tok3, { s: r.status, j: r.json });
      r = await api("GET", `/api/invitations/verify/${tok3}`);
      ok("3.4: the old link stops working after resend", r.status === 404, { s: r.status });
      r = await publicPost(`/api/invitations/accept/${tok3b}`, { name: "Portal Three", password: PASSWORD });
      ok("3.4: the resent link works once", r.status === 200 && r.json?.user?.userType === "client_portal", { s: r.status });
      const portal3 = { token: r.json?.token, userId: r.json?.user?.id, email: p3 };

      // existing account is never converted
      const existing = await register("existing");
      r = await invite(admin1, C1, existing.email);
      ok("3.4: inviting an existing account's email is 409", r.status === 409 && r.json?.code === "EMAIL_ALREADY_REGISTERED", { s: r.status, j: r.json });
      const p5 = pEmail("portal5");
      r = await invite(admin1, C1, p5);
      const tok5 = acceptOf(r.json?.acceptUrl || "/accept-invite/");
      const reg5 = await api("POST", "/api/auth/register", { body: { name: "Squatter", email: p5, password: PASSWORD } });
      r = await publicPost(`/api/invitations/accept/${tok5}`, { name: "Late Portal", password: PASSWORD });
      const u5 = (await q(`SELECT user_type FROM users WHERE email = $1`, [p5])).rows;
      ok("3.4: accepting when the email registered meanwhile is 409 and converts nothing", reg5.status < 300 && r.status === 409 && u5.length === 1 && u5[0].user_type === "customer", { s: r.status, u5 });

      // portal user isolation
      const P = portal1.token;
      r = await api("GET", "/api/client-portal/dashboard", { token: P });
      ok("3.4: portal user can use the portal", r.status === 200, { s: r.status });
      r = await api("GET", "/api/client-portal/company", { token: P });
      ok("3.4: portal company is exactly their client", r.status === 200 && r.json?.id === C1, r.json?.id);
      const probes = [
        ["GET", (c) => `/api/companies/${c}/invoices`], ["GET", (c) => `/api/companies/${c}/accounts`], ["GET", (c) => `/api/companies/${c}/journal-entries`],
        ["GET", (c) => `/api/companies/${c}/bills`], ["GET", (c) => `/api/companies/${c}/receipts`], ["GET", (c) => `/api/companies/${c}/team`],
        ["GET", (c) => `/api/companies/${c}/webhooks`], ["GET", (c) => `/api/companies/${c}/api-keys`], ["GET", (c) => `/api/companies/${c}/bank-transactions`],
        ["GET", (c) => `/api/integrations/ecommerce?companyId=${c}`], ["GET", (c) => `/api/companies/${c}`],
      ];
      for (const [label, company] of [["another client", C2], ["a SaaS customer", cid]]) {
        const leaks = [];
        for (const [m, path] of probes) { const x = await api(m, path(company), { token: P }); if (!denied(x)) leaks.push(`${m} ${path(company)} -> ${x.status}`); }
        ok(`3.4: portal user cannot read ${label}'s data (403/404)`, leaks.length === 0, leaks);
      }
      const own = [];
      for (const [m, path] of probes) { const x = await api(m, path(C1), { token: P }); if (!denied(x)) own.push(`${m} ${path(C1)} -> ${x.status}`); }
      ok("3.4: portal user cannot use the main accounting API even for their own company", own.length === 0, own);
      const priv = [];
      for (const [m, path, body] of [
        ["GET", "/api/firm/clients"], ["GET", "/api/firm/overview"], ["GET", "/api/admin/users"], ["GET", "/api/admin/invitations"],
        ["GET", `/api/firm/clients/${C1}/portal`], ["POST", `/api/firm/clients/${C1}/portal-invitations`, { email: pEmail("self") }],
        ["POST", `/api/firm/clients/${C1}/portal-users/${portal3.userId}/deactivate`],
      ]) { const x = await api(m, path, { token: P, body }); if (![401, 403].includes(x.status)) priv.push(`${m} ${path} -> ${x.status}`); }
      ok("3.4: portal user cannot call firm or admin routes", priv.length === 0, priv);

      // Portal users see only documents shared with the portal.
      {
        const PDF64 = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64");
        const mk = (body) => api("POST", `/api/companies/${C1}/documents`, { token: owner.token, body: { category: "other", fileName: "f.pdf", mimeType: "application/pdf", fileData: PDF64, ...body } });
        const internal = await mk({ name: "Internal payroll " + rnd });
        const shared = await mk({ name: "Shared letter " + rnd, sharedWithPortal: true });
        ok("3.4: firm can upload internal and shared documents", internal.status < 300 && shared.status < 300, { a: internal.status, b: shared.status });
        const pl = await api("GET", "/api/client-portal/documents", { token: P });
        const names = (Array.isArray(pl.json) ? pl.json : []).map((d) => d.name);
        ok("3.4: portal list shows the shared document", names.includes("Shared letter " + rnd), names);
        ok("3.4: portal list hides the internal document", !names.includes("Internal payroll " + rnd), names);
        const dShared = await api("GET", `/api/client-portal/documents/${shared.json?.id}/download`, { token: P });
        const dInternal = await api("GET", `/api/client-portal/documents/${internal.json?.id}/download`, { token: P });
        ok("3.4: portal can download the shared document", dShared.status === 200, { s: dShared.status });
        ok("3.4: portal cannot download the internal document", dInternal.status === 404, { s: dInternal.status });
        const own = await api("POST", "/api/client-portal/documents", { token: P, body: { name: "My upload " + rnd, category: "other", fileName: "m.pdf", mimeType: "application/pdf", fileData: PDF64 } });
        const pl2 = await api("GET", "/api/client-portal/documents", { token: P });
        ok("3.4: a portal user's own upload is visible to them", own.status < 300 && (Array.isArray(pl2.json) ? pl2.json : []).some((d) => d.name === "My upload " + rnd), { s: own.status });
      }

      // deactivate / reactivate
      r = await api("POST", `/api/firm/clients/${C1}/portal-users/${portal1.userId}/deactivate`, { token: admin2.token });
      ok("3.4: unassigned firm_admin cannot deactivate", r.status === 403, { s: r.status });
      r = await api("POST", `/api/firm/clients/${C2}/portal-users/${portal1.userId}/deactivate`, { token: owner.token });
      ok("3.4: a portal user is only manageable through their own client company", r.status === 404, { s: r.status });
      r = await api("POST", `/api/firm/clients/${C1}/portal-users/${portal1.userId}/deactivate`, { token: admin1.token });
      ok("3.4: deactivate works", r.status === 200 && r.json?.active === false, { s: r.status, j: r.json });
      r = await api("GET", "/api/client-portal/dashboard", { token: P });
      ok("3.4: a deactivated user's existing token stops working at once", r.status === 401, { s: r.status });
      r = await api("POST", "/api/auth/login", { body: { email: p1, password: PASSWORD } });
      ok("3.4: a deactivated user cannot log in", r.status === 401 && !r.json?.token, { s: r.status });
      // Password hashes never leave the server through firm or admin client views.
      {
        for (const path of [`/api/firm/clients/${C1}`, `/api/firm/clients/${C1}/portal`, `/api/companies/${C1}/team`]) {
          const v = await api("GET", path, { token: owner.token });
          ok(`3.4: no password hash in ${path.replace(C1, ":id")}`, !/passwordHash|password_hash|\$2[aby]\$\d\d\$/.test(v.text), { s: v.status });
        }
      }

      // A customer cannot mark a company firm-managed to escape billing.
      {
        const c = await register("escape");
        const made = await api("POST", "/api/companies", { token: c.token, body: { name: "Escape Co " + rnd, companyType: "client", baseCurrency: "AED" } });
        const newId = made.json?.id;
        const stored = newId ? (await q(`SELECT company_type FROM companies WHERE id = $1`, [newId])).rows[0]?.company_type : null;
        ok("3.4: companyType sent by a customer at create is ignored", made.status >= 400 || stored === "customer", { s: made.status, stored, j: made.json?.message });
        const st = await api("GET", "/api/billing/status" + (newId ? `?companyId=${newId}` : ""), { token: c.token });
        ok("3.4: that company is not billed as firm-managed", st.json?.status !== "managed", st.json);
      }

      // A password reset must never re-enable a deactivated account.
      {
        const fp = await publicPost("/api/auth/forgot-password", { email: p1 });
        const issued = (await q(`SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1`, [portal1.userId])).rows[0].n;
        ok("3.4: forgot-password gives the generic reply and issues no token when deactivated", fp.status === 200 && issued === 0, { s: fp.status, issued });
        const raw = crypto.randomBytes(32).toString("hex");
        await q(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [portal1.userId, sha256(raw)]);
        const before = (await q(`SELECT password_hash, is_active FROM users WHERE id = $1`, [portal1.userId])).rows[0];
        const rp = await publicPost("/api/auth/reset-password", { token: raw, password: "AnotherPass123!" });
        const after = (await q(`SELECT password_hash, is_active FROM users WHERE id = $1`, [portal1.userId])).rows[0];
        ok("3.4: reset-password is refused for a deactivated account", rp.status === 400, { s: rp.status, j: rp.json });
        ok("3.4: the account stays deactivated and its password is unchanged", after.is_active === false && after.password_hash === before.password_hash, after.is_active);
        const l2 = await api("POST", "/api/auth/login", { body: { email: p1, password: "AnotherPass123!" } });
        ok("3.4: the attempted new password does not log in", l2.status === 401, { s: l2.status });
        ok("3.4: deactivation does not alter the stored hash", /^\$2[aby]\$/.test(before.password_hash), before.password_hash.slice(0, 4));
      }
      r = await api("GET", `/api/firm/clients/${C1}/portal`, { token: admin1.token });
      ok("3.4: list shows the user as inactive", r.json?.users?.find((u) => u.email === p1)?.active === false, r.json?.users);
      r = await api("POST", `/api/firm/clients/${C1}/portal-users/${portal1.userId}/reactivate`, { token: admin1.token });
      ok("3.4: reactivate works", r.status === 200 && r.json?.active === true, { s: r.status });
      r = await api("POST", "/api/auth/login", { body: { email: p1, password: PASSWORD } });
      ok("3.4: a reactivated user can log in with the same password", r.status === 200 && !!r.json?.token, { s: r.status });
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
