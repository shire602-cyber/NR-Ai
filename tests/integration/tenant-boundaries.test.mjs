// Tenant-boundary integration test against a real server + real Postgres.
//
// Two classes of cross-tenant write that static route sweeps cannot see
// because the handlers DO check "does the caller own :companyId" and then
// mutate a row addressed by a second id:
//
//   1. Team members — PUT/DELETE /api/companies/:companyId/team/:memberId used
//      to mutate company_users by :memberId alone, so an owner of A could
//      change or remove a member of B by supplying B's membership row id.
//   2. Firm client edits — PUT /api/firm/clients/:companyId checked that the
//      client was *accessible* (a firm_owner's accessible set is "all") but not
//      that it was an NRA client, so a firm owner could rewrite a self-signup
//      SaaS customer's company (name, TRN, emirate, filing frequency).
//
// Requires BASE_URL (running server) and DATABASE_URL (to promote a user to
// firm_owner — there is deliberately no API for that).
import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0,
  fail = 0;
const fails = [];
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    fails.push(name + " :: " + JSON.stringify(detail));
    console.log("FAIL  " + name + "  " + JSON.stringify(detail));
  }
};
async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}
const rnd = Math.random().toString(36).slice(2, 8);
async function signup(label) {
  const email = `${label}_${rnd}@example.com`.toLowerCase();
  const r = await api("POST", "/api/auth/register", {
    body: { name: label, email, password: "Password123!" },
  });
  if (r.status !== 200 || !r.json?.token)
    throw new Error(`signup ${label} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.token, companyId: r.json.company.id, email };
}

async function main() {
  const A = await signup("tb-tenant-a");
  const B = await signup("tb-tenant-b");

  // ── 1. Team-member rows are scoped to the URL's company ────────────────
  const teamA = (await api("GET", `/api/companies/${A.companyId}/team`, { token: A.token })).json;
  const teamB = (await api("GET", `/api/companies/${B.companyId}/team`, { token: B.token })).json;
  const rowA = teamA?.[0]?.id,
    rowB = teamB?.[0]?.id;
  ok("setup: each tenant has one owner membership row", !!rowA && !!rowB, { rowA, rowB });

  let r = await api("PUT", `/api/companies/${A.companyId}/team/${rowB}`, {
    token: A.token,
    body: { role: "employee" },
  });
  ok("TEAM: owner of A cannot change B's member role via B's row id (404)", r.status === 404, {
    status: r.status,
  });
  r = await api("DELETE", `/api/companies/${A.companyId}/team/${rowB}`, { token: A.token });
  ok("TEAM: owner of A cannot remove B's member via B's row id (404)", r.status === 404, {
    status: r.status,
  });
  const teamB2 = (await api("GET", `/api/companies/${B.companyId}/team`, { token: B.token })).json;
  ok(
    "TEAM: B's membership is untouched (still 1 owner)",
    Array.isArray(teamB2) && teamB2.length === 1 && teamB2[0].role === "owner",
    teamB2
  );
  r = await api("PUT", `/api/companies/${B.companyId}/team/${rowB}`, {
    token: A.token,
    body: { role: "employee" },
  });
  ok("TEAM: A is not an owner of B (403)", r.status === 403, { status: r.status });
  r = await api("DELETE", `/api/companies/${A.companyId}/team/${rowA}`, { token: A.token });
  ok(
    "TEAM: the last owner cannot remove themselves (422 LAST_OWNER)",
    r.status === 422 && r.json?.code === "LAST_OWNER",
    { status: r.status, code: r.json?.code }
  );
  r = await api("PUT", `/api/companies/${A.companyId}/team/${rowA}`, {
    token: A.token,
    body: { role: "superuser" },
  });
  ok("TEAM: unknown role is rejected (400)", r.status === 400, { status: r.status });

  // ── 2. Firm staff can only edit NRA clients ────────────────────────────
  if (!process.env.DATABASE_URL) {
    console.log("SKIP  FIRM checks: DATABASE_URL not set (needed to promote a firm_owner)");
  } else {
    const F = await signup("tb-firm-owner");
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`UPDATE users SET firm_role = 'firm_owner' WHERE email = $1`, [F.email]);
    } finally {
      await client.end();
    }

    const before = (await api("GET", `/api/companies/${A.companyId}`, { token: A.token })).json;
    r = await api("PUT", `/api/firm/clients/${A.companyId}`, {
      token: F.token,
      body: { name: "PWNED BY FIRM", trnVatNumber: "100000000000003" },
    });
    const after = (await api("GET", `/api/companies/${A.companyId}`, { token: A.token })).json;
    ok("FIRM: firm_owner cannot edit a self-signup SaaS company (400)", r.status === 400, {
      status: r.status,
      json: r.json,
    });
    ok(
      "FIRM: SaaS company name and TRN unchanged",
      after?.name === before?.name && after?.trnVatNumber === before?.trnVatNumber,
      { before: [before?.name, before?.trnVatNumber], after: [after?.name, after?.trnVatNumber] }
    );

    r = await api("POST", "/api/firm/clients", {
      token: F.token,
      body: { name: `TB Client ${rnd}`, emirate: "dubai" },
    });
    const clientId = r.json?.id ?? r.json?.company?.id;
    ok(
      "FIRM: firm_owner can create an NRA client",
      (r.status === 200 || r.status === 201) && !!clientId,
      { status: r.status }
    );
    if (clientId) {
      r = await api("PUT", `/api/firm/clients/${clientId}`, {
        token: F.token,
        body: { name: `TB Client ${rnd} Renamed` },
      });
      ok(
        "FIRM: firm_owner can still edit a real NRA client (200)",
        r.status === 200 && r.json?.name === `TB Client ${rnd} Renamed`,
        { status: r.status, name: r.json?.name }
      );
    }
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) {
    console.log(fails.join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
