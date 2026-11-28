// Concurrency and integrity regressions.
//
// Every case here was a REAL defect found by firing parallel requests at the
// running app. Unit tests cannot see any of them — they only appear when two
// requests interleave between a check and the write it guards.
//
// The same cases run in-process on the real-Postgres harness
// (tests/db/concurrency.test.ts, `npm run test:db`). This script smoke-tests a
// live server:
//   BASE_URL=http://127.0.0.1:5000 node tests/integration/concurrency.test.mjs
//
// It fires ~50 writes in a few seconds. At the default write budget
// (RL_API_MAX=100/min) some requests get 429; throttledFetch waits out the
// server's Retry-After and retries, so every case still runs (slower). Raise
// RL_API_MAX on the server to keep the bursts truly parallel.

import { fail as abort, rateLimitRetries, throttledFetch } from "./_http.mjs";
import { withRegisterLogin } from "./register-compat.mjs";
import { dubaiToday } from "../helpers/dates.mjs";

const api = withRegisterLogin(apiRaw, { status: "s", body: "j" });
const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0,
  fail = 0;
const fails = [];
const ok = (name, cond, detail) => {
  // 429s are retried by throttledFetch (Retry-After); one that still reaches
  // an assertion is a real failure, never a skip.
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    fails.push(name + " :: " + JSON.stringify(detail));
    console.log("FAIL  " + name + "  " + JSON.stringify(detail));
  }
};
async function apiRaw(m, p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = "Bearer " + o.token;
  const r = await throttledFetch(BASE + p, {
    method: m,
    headers: h,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const t = await r.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  return { s: r.status, j, t };
}
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.02) => Math.abs(n(a) - n(b)) <= tol;
const today = dubaiToday();

async function main() {
  const s = Math.random().toString(36).slice(2, 8);
  const reg = await api("POST", "/api/auth/register", {
    body: { name: "Conc", email: `conc_${s}@e.com`, password: "Password123!" },
  });
  if (!reg.j?.token)
    abort("registration failed (after rate-limit retries)", {
      status: reg.s,
      body: reg.t?.slice(0, 200),
    });
  const token = reg.j.token,
    cid = reg.j.company.id;
  await api("PATCH", `/api/companies/${cid}`, {
    token,
    body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" },
  });
  const accs = (await api("GET", `/api/companies/${cid}/accounts`, { token })).j;
  const bank = accs.find((a) => a.code === "1020");

  const mkInvoice = async (price) => {
    const r = await api("POST", `/api/companies/${cid}/invoices`, {
      token,
      body: {
        customerName: "C",
        date: today,
        lines: [{ description: "x", quantity: 1, unitPrice: price, vatRate: 5 }],
      },
    });
    return r.j;
  };

  // 1. Invoice numbering must stay unique and gap-free under load (FTA Art. 78)
  {
    const res = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api("POST", `/api/companies/${cid}/invoices`, {
          token,
          body: {
            customerName: `P${i}`,
            date: today,
            lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }],
          },
        })
      )
    );
    const nums = res
      .filter((r) => r.s === 200)
      .map((r) => r.j?.number)
      .filter(Boolean);
    ok("20 parallel invoices get unique numbers", new Set(nums).size === nums.length, {
      got: nums.length,
      uniq: new Set(nums).size,
    });
    const seq = nums.map((x) => Number(String(x).split("-").pop())).sort((a, b) => a - b);
    const gaps = seq.filter((v, i) => i > 0 && v !== seq[i - 1] + 1);
    ok("invoice sequence is gap-free", gaps.length === 0, { gaps });
  }

  // 2. Revenue must be recognised exactly once (was 10x)
  {
    const inv = await mkInvoice(500);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } })
      )
    );
    const je = (await api("GET", `/api/companies/${cid}/journal`, { token })).j;
    const mine = (Array.isArray(je) ? je : je?.entries || []).filter((e) => e.sourceId === inv.id);
    ok("10 parallel issues recognise revenue once", mine.length === 1, { entries: mine.length });
  }

  // 3. One invoice cannot be fully credited more than once (was 5x)
  {
    const inv = await mkInvoice(800);
    await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });
    const res = await Promise.all(
      Array.from({ length: 5 }, () =>
        api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: {} })
      )
    );
    ok("5 parallel credit notes produce exactly one", res.filter((r) => r.s < 400).length === 1, {
      accepted: res.filter((r) => r.s < 400).length,
    });
  }

  // 4. One invoice cannot be paid twice in full
  {
    const inv = await mkInvoice(1000);
    await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
          token,
          body: { amount: 1050, date: today, method: "cash", paymentAccountId: bank.id },
        })
      )
    );
    ok("10 parallel full payments accept exactly one", res.filter((r) => r.s < 400).length === 1, {
      accepted: res.filter((r) => r.s < 400).length,
    });
  }

  // 5. Journal integrity
  {
    let r = await api("POST", `/api/companies/${cid}/journal`, {
      token,
      body: {
        date: today,
        description: "neg",
        lines: [
          { accountId: bank.id, debit: -100, credit: 0 },
          { accountId: bank.id, debit: 0, credit: -100 },
        ],
      },
    });
    ok(
      "negative journal amounts rejected",
      r.s === 422 && r.j?.code === "NEGATIVE_JOURNAL_AMOUNT",
      { status: r.s, code: r.j?.code }
    );
    r = await api("POST", `/api/companies/${cid}/journal`, {
      token,
      body: {
        date: today,
        description: "both",
        lines: [
          { accountId: bank.id, debit: 100, credit: 100 },
          { accountId: bank.id, debit: 0, credit: 0 },
        ],
      },
    });
    ok(
      "a line with both debit and credit is rejected",
      r.s === 422 && r.j?.code === "LINE_HAS_BOTH_SIDES",
      { status: r.s, code: r.j?.code }
    );
  }

  // 6. Privilege: a customer cannot promote their own company type
  {
    // R17-05: the field is server-owned, so the request is refused (403), not
    // silently ignored, and the stored company type does not change.
    const before = await api("GET", `/api/companies/${cid}`, { token });
    const r = await api("PATCH", `/api/companies/${cid}`, { token, body: { companyType: "nra" } });
    const after = await api("GET", `/api/companies/${cid}`, { token });
    ok("companyType self-promotion is refused with 403", r.s === 403, {
      status: r.s,
      body: r.j,
    });
    ok(
      "companyType is unchanged after the refused self-promotion",
      after.s === 200 &&
        after.j?.companyType !== "nra" &&
        after.j?.companyType === before.j?.companyType,
      { before: before.j?.companyType, after: after.j?.companyType }
    );
  }

  // 7. Ledger still balances after all of that
  {
    const r = await api("GET", `/api/companies/${cid}/reports/trial-balance`, { token });
    const rows = r.j?.rows || [];
    const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
    const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
    ok("trial balance still balances after concurrent abuse", close(dr, cr, 0.02), { dr, cr });
  }

  console.log(
    `\n==== ${pass} passed, ${fail} failed (${rateLimitRetries} rate-limit retries) ====`
  );
  if (fail) {
    console.log("FAILURES:\n - " + fails.join("\n - "));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error("CRASH", e);
  process.exit(2);
});
