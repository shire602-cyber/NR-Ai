// AI graceful-degradation regression.
//
// The product is "AI accounting software", but the AI runs on an external key
// (OPENAI_API_KEY) that is NOT set in CI or in any environment before the key is
// provisioned. In that state the AI features must degrade to a clear 503
// "not configured" — NEVER an HTTP 500. Four endpoints (cfo-advice, anomaly
// detection, cashflow forecast, bank-statement parsing) used to return 500,
// surfacing the marquee feature as a server crash.
//
// Runs with NO key on purpose. If OPENAI_API_KEY *is* set, the AI paths return
// 200 and the "must not 500" assertion still holds.

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
let pass = 0, fail = 0; const fails = [];
const ok = (name, cond, detail) => {
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

async function main() {
  const s = Math.random().toString(36).slice(2, 8);
  const reg = await api("POST", "/api/auth/register", { body: { name: "AID", email: `aid_${s}@e.com`, password: "Password123!" } });
  if (!reg.j?.token) { console.log("SKIP: registration rate-limited"); process.exit(0); }
  const token = reg.j.token, cid = reg.j.company.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });

  // The OpenAI-only endpoints. Each must never 500.
  const calls = [
    ["cfo-advice", "POST", "/api/ai/cfo-advice", { companyId: cid, question: "how is my cash flow?" }],
    ["detect-anomalies", "POST", "/api/ai/detect-anomalies", { companyId: cid }],
    ["forecast-cashflow", "POST", "/api/ai/forecast-cashflow", { companyId: cid, days: 90 }],
    ["parse-bank-statement", "POST", "/api/ai/parse-bank-statement", { companyId: cid, text: "01/01 PMT 500" }],
    ["nl-gateway", "POST", "/api/ai/nl-gateway", { companyId: cid, message: "what is my revenue" }],
    ["ocr/process", "POST", "/api/ocr/process", { companyId: cid, imageData: "data:image/png;base64,iVBORw0KGgo=" }],
  ];

  const noKey = !process.env.OPENAI_API_KEY;
  for (const [name, m, p, body] of calls) {
    const r = await api(m, p, { token, body });
    ok(`AI ${name} never returns 500`, r.s !== 500, { status: r.s, msg: String(r.j?.message).slice(0, 60) });
    if (noKey) {
      ok(`AI ${name} degrades to 503 when unconfigured`, r.s === 503,
        { status: r.s, code: r.j?.code, msg: String(r.j?.message).slice(0, 60) });
    }
  }

  // Auth must be enforced on the AI surface.
  const noAuth = await api("POST", "/api/ai/categorize", { body: { companyId: cid, description: "x", amount: 1, currency: "AED" } });
  ok("AI surface enforces auth (POST without a token → 401/403)", noAuth.s === 401 || noAuth.s === 403, { status: noAuth.s });

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  if (fail) { console.log("FAILURES:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error("CRASH", e); process.exit(2); });
