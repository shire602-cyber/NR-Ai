/**
 * Persona fixture for the broken-path sweep and the core-flow suite (tests/e2e/broken-path-sweep.mjs,
 * tests/e2e/core-flows.mjs). Creates, through the app's own API (plus a local Postgres promotion for
 * the staff roles that have no self-service path), one disposable account per persona:
 *
 *   trial      new owner on the 14-day trial, onboarding done, no books
 *   owner      owner with populated books (tests/e2e/report-audit-fixture.mjs) + links/tokens
 *   accountant invited into the owner's company as `accountant`
 *   viewer     invited into the owner's company as `viewer`
 *   firmStaff  firm `preparer` assigned to the owner's company
 *   admin      NR admin (users.is_admin, firm_owner)
 *   portal     client-portal user bound to one customer contact of the owner's company
 *   visitor    signed out (no account)
 *
 * The result is cached in tests/e2e/.artifacts/sweep-personas.json; SWEEP_REUSE=true reuses it so
 * a delta run does not re-seed. Local targets only (it writes to DATABASE_URL).
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACT_DIR = path.join(__dirname, "..", ".artifacts");
const CACHE = path.join(ARTIFACT_DIR, "sweep-personas.json");
export const PASSWORD = "SweepPass123!";

export function assertLocal(base) {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(base)) {
    throw new Error(`Refusing to seed personas on ${base}: local disposable targets only.`);
  }
  const db = process.env.DATABASE_URL || "";
  if (!db) throw new Error("DATABASE_URL is required (staff personas are promoted in Postgres).");
  if (/muhasib_e2e/.test(db)) throw new Error("Refusing to use the muhasib_e2e database.");
}

const BASE_OF = new WeakMap();

export function apiClient(base) {
  // Signed-out state-changing calls (invitation accept) need the cookie + X-CSRF-Token pair;
  // Bearer calls are CSRF-exempt.
  const jar = new Map();
  const remember = (res) => {
    for (const header of res.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  let csrf = "";
  const api = async function api(token, method, url, body) {
    if (!token && method !== "GET" && !url.startsWith("/api/auth/")) {
      const res = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie() } });
      remember(res);
      csrf = (await res.json().catch(() => ({}))).csrfToken ?? "";
    }
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : { Cookie: cookie() }),
        ...(!token && csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!token) remember(res);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  };
  BASE_OF.set(api, base);
  return api;
}

async function withDb(fn) {
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

async function login(api, email) {
  const res = await api("", "POST", "/api/auth/login", { email, password: PASSWORD });
  if (res.status >= 300)
    throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function register(api, email, name, companyName) {
  const res = await api("", "POST", "/api/auth/register", {
    email,
    password: PASSWORD,
    name,
    companyName,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`register ${email}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return login(api, email);
}

async function firstCompany(api, token) {
  const res = await api(token, "GET", "/api/companies");
  const list = Array.isArray(res.body) ? res.body : (res.body?.items ?? []);
  return list[0];
}

async function invite(api, ownerToken, companyId, email, role, name) {
  const res = await api(ownerToken, "POST", `/api/companies/${companyId}/team/invite`, {
    email,
    role,
  });
  if (res.status !== 201)
    throw new Error(`invite ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  const token = new URL(res.body.inviteUrl).searchParams.get("teamInvite");
  // A fresh cookie jar: a signed-in session cookie would make the accept a "different e-mail".
  const accept = await apiClient(BASE_OF.get(api))(
    "",
    "POST",
    `/api/team-invitations/${token}/accept`,
    {
      name,
      password: PASSWORD,
    }
  );
  if (accept.status >= 300) {
    throw new Error(`accept ${role}: ${accept.status} ${JSON.stringify(accept.body)}`);
  }
  return login(api, email);
}

/** Records behind param routes and public token pages, created in the owner's company. */
async function seedLinks(api, token, companyId) {
  const out = {};
  const accounts = await api(token, "GET", `/api/companies/${companyId}/accounts`);
  const accountList = Array.isArray(accounts.body) ? accounts.body : (accounts.body?.items ?? []);
  out.accountId = accountList.find((a) => a.code === "1010")?.id ?? accountList[0]?.id;
  const journal = await api(token, "GET", `/api/companies/${companyId}/journal`);
  const entries = Array.isArray(journal.body) ? journal.body : (journal.body?.items ?? []);
  out.journalId = entries[0]?.id;
  const pick = async (url, pred = () => true) => {
    const res = await api(token, "GET", url);
    const list = Array.isArray(res.body) ? res.body : (res.body?.items ?? res.body?.data ?? []);
    return Array.isArray(list) ? list.find(pred) : undefined;
  };
  const invoices = await api(token, "GET", `/api/companies/${companyId}/invoices`);
  const invoiceList = Array.isArray(invoices.body) ? invoices.body : (invoices.body?.items ?? []);
  out.invoiceId = invoiceList.find((i) => i.status === "draft")?.id ?? invoiceList[0]?.id;
  const issued = invoiceList.find((i) => i.status !== "draft" && i.status !== "cancelled");
  if (issued) {
    const share = await api(token, "POST", `/api/invoices/${issued.id}/share`, {});
    out.shareToken = share.body?.token;
  }
  out.quoteId = (await pick(`/api/companies/${companyId}/quotes`))?.id;
  out.purchaseOrderId = (await pick(`/api/companies/${companyId}/purchase-orders`))?.id;
  out.billId = (await pick(`/api/companies/${companyId}/bills`))?.id;
  out.recurringId = (await pick(`/api/companies/${companyId}/recurring-invoices`))?.id;
  const contacts = await api(token, "GET", `/api/companies/${companyId}/customer-contacts`);
  const contactList = Array.isArray(contacts.body) ? contacts.body : (contacts.body?.items ?? []);
  out.contactId = contactList[0]?.id;
  if (out.contactId) {
    const access = await api(token, "POST", "/api/portal/generate-access", {
      contactId: out.contactId,
    });
    const url = access.body?.url ?? access.body?.portalUrl ?? access.body?.link ?? "";
    out.portalToken = access.body?.token ?? String(url).split("/portal/")[1];
  }
  // The approver link needs a chosen e-invoicing partner (409 EINVOICE_PARTNER_REQUIRED otherwise).
  const partners = await api(token, "GET", `/api/companies/${companyId}/einvoicing/partner`);
  const partnerId = partners.body?.partners?.[0]?.id;
  if (partnerId) {
    await api(token, "PUT", `/api/companies/${companyId}/einvoicing/partner`, {
      partner: partnerId,
    });
  }
  const approver = await api(
    token,
    "POST",
    `/api/companies/${companyId}/einvoicing/approver-links`,
    {
      approverName: "مُعتمِد التجربة",
    }
  );
  out.approverToken = approver.body?.url ? String(approver.body.url).split("/").pop() : undefined;
  return out;
}

export async function setupPersonas(base, { log = console.log } = {}) {
  assertLocal(base);
  await mkdir(ARTIFACT_DIR, { recursive: true });
  if (process.env.SWEEP_REUSE === "true") {
    try {
      const cached = JSON.parse(await readFile(CACHE, "utf8"));
      if (cached.base === base) {
        log(`personas: reusing ${CACHE}`);
        const api = apiClient(base);
        for (const persona of Object.values(cached.personas)) {
          if (persona.email) persona.token = await login(api, persona.email);
        }
        return cached;
      }
    } catch {
      /* no cache yet */
    }
  }
  const api = apiClient(base);
  const stamp = Date.now();
  const mail = (who) => `sweep-${who}+${stamp}@test.local`;
  const personas = {};

  // Owner with populated books: the report audit fixture registers and fills the company.
  const ownerEmail = mail("owner");
  log("personas: seeding the populated owner (report-audit-fixture) ...");
  const fixture = spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "report-audit-fixture.mjs")],
    {
      env: {
        ...process.env,
        BASE_URL: base,
        REPORT_AUDIT_EMAIL: ownerEmail,
        REPORT_AUDIT_PASSWORD: PASSWORD,
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (fixture.status !== 0) {
    throw new Error(
      `report-audit-fixture failed:\n${(fixture.stdout + fixture.stderr).slice(-3000)}`
    );
  }
  const ownerToken = await login(api, ownerEmail);
  const ownerCompany = await firstCompany(api, ownerToken);
  personas.owner = { email: ownerEmail, token: ownerToken, companyId: ownerCompany.id };

  const trialEmail = mail("trial");
  // Arabic names: the trial persona is the strict "no English in Arabic mode" check, so its own
  // records must not be English user data.
  const trialToken = await register(api, trialEmail, "سارة التجريبية", "شركة الواحة التجريبية");
  personas.trial = {
    email: trialEmail,
    token: trialToken,
    companyId: (await firstCompany(api, trialToken)).id,
  };

  for (const role of ["accountant", "viewer"]) {
    const email = mail(role);
    const token = await invite(api, ownerToken, ownerCompany.id, email, role, `Sweep ${role}`);
    personas[role] = { email, token, companyId: ownerCompany.id };
  }

  // Client-portal user: invited as a viewer, made a portal user, bound to one contact.
  const portalEmail = mail("portal");
  await invite(api, ownerToken, ownerCompany.id, portalEmail, "viewer", "Sweep Portal");

  const staffEmail = mail("firmstaff");
  const adminEmail = mail("admin");
  const staffToken = await register(api, staffEmail, "Sweep Firm Staff", "Sweep Staff Co");
  const adminToken = await register(api, adminEmail, "Sweep NR Admin", "Sweep Admin Co");
  void staffToken;
  void adminToken;

  const links = await seedLinks(api, ownerToken, ownerCompany.id);
  await withDb(async (db) => {
    await db.query(`UPDATE users SET user_type = 'client_portal' WHERE email = $1`, [portalEmail]);
    await db.query(
      `UPDATE users SET firm_role = 'preparer', user_type = 'admin', email_verified = true WHERE email = $1`,
      [staffEmail]
    );
    await db.query(
      `UPDATE users SET is_admin = true, user_type = 'admin', firm_role = 'firm_owner', email_verified = true WHERE email = $1`,
      [adminEmail]
    );
    await db
      .query(
        `INSERT INTO firm_staff_assignments (user_id, company_id, role)
         SELECT u.id, $2, 'accountant' FROM users u WHERE u.email = $1
         ON CONFLICT DO NOTHING`,
        [staffEmail, ownerCompany.id]
      )
      .catch((error) => log(`personas: staff assignment skipped (${error.message})`));
  });
  const portalToken = await login(api, portalEmail);
  if (links.contactId) {
    const me = await api(portalToken, "GET", "/api/auth/me");
    const userId = me.body?.user?.id ?? me.body?.id;
    const bind = await api(
      ownerToken,
      "POST",
      `/api/portal/contacts/${links.contactId}/portal-users`,
      {
        userId,
      }
    );
    if (bind.status !== 201)
      log(`personas: portal bind ${bind.status} ${JSON.stringify(bind.body)}`);
  }
  personas.portal = { email: portalEmail, token: portalToken, companyId: ownerCompany.id };
  personas.firmStaff = {
    email: staffEmail,
    token: await login(api, staffEmail),
    companyId: ownerCompany.id,
  };
  personas.admin = {
    email: adminEmail,
    token: await login(api, adminEmail),
    companyId: (await firstCompany(api, await login(api, adminEmail)))?.id,
  };
  personas.visitor = {};

  const result = { base, createdAt: new Date().toISOString(), personas, links };
  const cacheable = JSON.parse(JSON.stringify(result));
  for (const persona of Object.values(cacheable.personas)) delete persona.token;
  await writeFile(CACHE, JSON.stringify(cacheable, null, 2));
  return result;
}
