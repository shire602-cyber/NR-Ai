// Concurrency and integrity regressions.
//
// Every case here was a REAL defect found by firing parallel requests at the
// running app. Unit tests cannot see any of them — they only appear when two
// requests interleave between a check and the write it guards.
//
// Run against a live server:
//   RL_API_MAX=100000 RL_READ_MAX=100000 RL_AUTH_MAX=1000 npm start
//   BASE_URL=http://127.0.0.1:5000 node tests/integration/concurrency.test.mjs
//
// The raised limits are REQUIRED: this suite deliberately fires ~50 writes in a
// few seconds, which trips the production write budget (100/min). A 429 here
// means the rate limiter is working, not that the assertion failed — so the
// suite treats an unexpected 429 as an environment problem and says so.

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0, fail = 0; const fails = [];
let rateLimited = 0;
const ok = (name, cond, detail) => {
  // A 429 is the rate limiter doing its job, not a failed assertion. Surface it
  // as an environment problem so nobody "fixes" a limiter that is working.
  if (!cond && detail && (detail.status === 429 || detail.s === 429)) {
    rateLimited++;
    console.log("SKIP  " + name + "  (rate-limited — raise RL_API_MAX for this suite)");
    return;
  }
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + " :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
};
async function api(m, p, o = {}) {
  const h = { "Content-Type": "application/json" };
  if (o.token) h.Authorization = "Bearer " + o.token;
  const r = await fetch(BASE + p, { method: m, headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
}
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.02) => Math.abs(n(a) - n(b)) <= tol;
const today = new Date().toISOString().slice(0, 10);

async function main() {
  const s = Math.random().toString(36).slice(2, 8);
  const reg = await api("POST", "/api/auth/register", { body: { name: "Conc", email: `conc_${s}@e.com`, password: "Password123!" } });
  if (!reg.j?.token) { console.log("SKIP: registration rate-limited"); process.exit(0); }
  const token = reg.j.token, cid = reg.j.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const accs = (await api("GET", `/api/companies/${cid}/accounts`, { token })).j;
  const bank = accs.find((a) => a.code === "1020");

  const mkInvoice = async (price) => {
    const r = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "C", date: today, lines: [{ description: "x", quantity: 1, unitPrice: price, vatRate: 5 }] },
    });
    return r.j;
  };

  // 1. Invoice numbering must stay unique and gap-free under load (FTA Art. 78)
  {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      api("POST", `/api/companies/${cid}/invoices`, {
        token, body: { customerName: `P${i}`, date: today, lines: [{ description: "x", quantity: 1, unitPrice: 100, vatRate: 5 }] },
      })));
    const nums = res.filter((r) => r.s === 200).map((r) => r.j?.number).filter(Boolean);
    ok("20 parallel invoices get unique numbers", new Set(nums).size === nums.length, { got: nums.length, uniq: new Set(nums).size });
    const seq = nums.map((x) => Number(String(x).split("-").pop())).sort((a, b) => a - b);
    const gaps = seq.filter((v, i) => i > 0 && v !== seq[i - 1] + 1);
    ok("invoice sequence is gap-free", gaps.length === 0, { gaps });
  }

  // 2. Revenue must be recognised exactly once (was 10x)
  {
    const inv = await mkInvoice(500);
    await Promise.all(Array.from({ length: 10 }, () =>
      api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } })));
    const je = (await api("GET", `/api/companies/${cid}/journal`, { token })).j;
    const mine = (Array.isArray(je) ? je : je?.entries || []).filter((e) => e.sourceId === inv.id);
    ok("10 parallel issues recognise revenue once", mine.length === 1, { entries: mine.length });
  }

  // 3. One invoice cannot be fully credited more than once (was 5x)
  {
    const inv = await mkInvoice(800);
    await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });
    const res = await Promise.all(Array.from({ length: 5 }, () =>
      api("POST", `/api/companies/${cid}/invoices/${inv.id}/credit-note`, { token, body: {} })));
    ok("5 parallel credit notes produce exactly one", res.filter((r) => r.s < 400).length === 1,
      { accepted: res.filter((r) => r.s < 400).length });
  }

  // 4. One invoice cannot be paid twice in full
  {
    const inv = await mkInvoice(1000);
    await api("PATCH", `/api/invoices/${inv.id}/status`, { token, body: { status: "sent" } });
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      api("POST", `/api/companies/${cid}/invoices/${inv.id}/payments`, {
        token, body: { amount: 1050, date: today, method: "cash", paymentAccountId: bank.id },
      })));
    ok("10 parallel full payments accept exactly one", res.filter((r) => r.s < 400).length === 1,
      { accepted: res.filter((r) => r.s < 400).length });
  }

  // 5. Journal integrity
  {
    let r = await api("POST", `/api/companies/${cid}/journal`, {
      token, body: { date: today, description: "neg", lines: [
        { accountId: bank.id, debit: -100, credit: 0 }, { accountId: bank.id, debit: 0, credit: -100 }] },
    });
    ok("negative journal amounts rejected", r.s === 422 && r.j?.code === "NEGATIVE_JOURNAL_AMOUNT", { status: r.s, code: r.j?.code });
    r = await api("POST", `/api/companies/${cid}/journal`, {
      token, body: { date: today, description: "both", lines: [
        { accountId: bank.id, debit: 100, credit: 100 }, { accountId: bank.id, debit: 0, credit: 0 }] },
    });
    ok("a line with both debit and credit is rejected", r.s === 422 && r.j?.code === "LINE_HAS_BOTH_SIDES", { status: r.s, code: r.j?.code });
  }

  // 6. Privilege: a customer cannot promote their own company type
  {
    const r = await api("PATCH", `/api/companies/${cid}`, { token, body: { companyType: "nra" } });
    ok("companyType self-promotion is ignored, not a 500", r.s === 200 && r.j?.companyType !== "nra",
      { status: r.s, companyType: r.j?.companyType });
  }

  // 7. Ledger still balances after all of that
  {
    const r = await api("GET", `/api/companies/${cid}/reports/trial-balance`, { token });
    const rows = r.j?.rows || [];
    const dr = rows.reduce((s, x) => s + n(x.debit ?? x.totalDebit), 0);
    const cr = rows.reduce((s, x) => s + n(x.credit ?? x.totalCredit), 0);
    ok("trial balance still balances after concurrent abuse", close(dr, cr, 0.02), { dr, cr });
  }

  console.log(`\n==== ${pass} passed, ${fail} failed${rateLimited ? `, ${rateLimited} skipped (rate-limited)` : ""} ====`);
  if (rateLimited) {
    console.log("NOTE: run the server with RL_API_MAX=100000 RL_READ_MAX=100000 to exercise every case.");
  }
  if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("CRASH", e); process.exit(2); });
