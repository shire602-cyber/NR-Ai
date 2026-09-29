// Integration tests for Phase 2 (operable product): live requests against a running server + Postgres.
//   2.1  monitoring/email status on /api/version, client-error sink
//   2.2  durable private uploads (documents, portal documents, tax-return archive, expense receipts)
//   2.3  email: unconfigured sends fail loudly (503 EMAIL_NOT_CONFIGURED)
//   2.4  trials + effective plan + would-block header + billing status; Stripe webhook needs config
//   2.6  15 parallel credit notes against one invoice do not starve the pool
//   BASE_URL=http://127.0.0.1:5056 DATABASE_URL=... node tests/integration/phase2.test.mjs
// Assumes the server runs with local-disk storage (development), no email provider,
// no Stripe keys and BILLING_ENFORCEMENT unset - the same setup as the other suites.

import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, p, { body, token, headers: extra, raw } = {}) {
  const headers = { "Content-Type": "application/json", ...(extra || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n" + "x".repeat(2000));
const PDF_B64 = PDF.toString("base64");

async function newUser(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  return { token: r.json.token, cid: r.json.company.id, userId: r.json.user.id };
}

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    // ───────── 2.1 monitoring + email status, client error sink ─────────
    {
      const v = await api("GET", "/api/version");
      ok("2.1: /api/version reports monitoring: not_configured with no SENTRY_DSN", v.json?.monitoring === "not_configured", v.json);
      ok("2.3: /api/version reports email: not_configured with no provider", v.json?.email === "not_configured", v.json);

      const xff = { "X-Forwarded-For": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7` };
      const c1 = await api("POST", "/api/client-errors", { body: { message: "boom", stack: "Error: boom\n at x", url: "https://app/x?token=abc" }, headers: xff });
      ok("2.1: client error sink accepts a report (204)", c1.status === 204, c1.status);
      const bad = await api("POST", "/api/client-errors", { body: { nope: 1 }, headers: xff });
      ok("2.1: client error sink rejects a bad payload (400)", bad.status === 400, bad.status);
      let limited = 0;
      for (let i = 0; i < 14; i++) {
        const r = await api("POST", "/api/client-errors", { body: { message: "flood " + i }, headers: xff });
        if (r.status === 429) limited++;
      }
      ok("2.1: client error sink is rate-limited (429 after the burst)", limited > 0, { limited });
    }

    // ───────── 2.2 uploads ─────────
    const A = await newUser("upa");
    const B = await newUser("upb");

    // documents (was a stub with a placeholder URL)
    let docA;
    {
      const up = await api("POST", `/api/companies/${A.cid}/documents`, {
        token: A.token,
        body: {
          name: "Trade licence", category: "trade_license", fileName: "licence.pdf", mimeType: "application/pdf",
          fileData: PDF_B64, fileUrl: "https://evil.example/steal.pdf", fileSize: 1,
        },
      });
      ok("2.2: document upload with a real PDF -> 201", up.status === 201, { s: up.status, t: up.text.slice(0, 200) });
      docA = up.json;
      ok("2.2: a client-supplied fileUrl is ignored (no external URL stored)", docA && !String(docA.fileUrl).includes("evil.example") && !/^https?:/.test(String(docA.fileUrl)), docA?.fileUrl);
      ok("2.2: stored key is namespaced by company", String(docA?.fileUrl).startsWith(A.cid + "/documents/"), docA?.fileUrl);
      ok("2.2: fileSize is the real byte length, not the client's claim", docA?.fileSize === PDF.length, docA?.fileSize);

      const dl = await api("GET", `/api/documents/${docA.id}/download`, { token: A.token, raw: true });
      ok("2.2: owner downloads the document byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status, len: dl.buf.length });
      ok("2.2: download is an attachment with the PDF content type", /attachment/.test(dl.headers.get("content-disposition") || "") && /application\/pdf/.test(dl.headers.get("content-type") || ""), { cd: dl.headers.get("content-disposition"), ct: dl.headers.get("content-type") });
      ok("2.2: download is never cached and never sniffed", /no-store/.test(dl.headers.get("cache-control") || "") && dl.headers.get("x-content-type-options") === "nosniff", [...dl.headers.entries()]);

      const other = await api("GET", `/api/documents/${docA.id}/download`, { token: B.token });
      ok("2.2: another company's user is refused (403)", other.status === 403 || other.status === 404, other.status);
      const anon = await api("GET", `/api/documents/${docA.id}/download`);
      ok("2.2: anonymous download is refused (401)", anon.status === 401, anon.status);

      const fake = await api("POST", `/api/companies/${A.cid}/documents`, {
        token: A.token,
        body: { name: "Fake", fileName: "fake.pdf", mimeType: "application/pdf", fileData: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") },
      });
      ok("2.2: a fake PDF (wrong magic bytes) is rejected with 400", fake.status === 400 && fake.json?.code === "FILE_CONTENT_MISMATCH", { s: fake.status, j: fake.json });
      const none = await api("POST", `/api/companies/${A.cid}/documents`, { token: A.token, body: { name: "No file", fileName: "x.pdf", mimeType: "application/pdf", fileUrl: "/uploads/placeholder.pdf" } });
      ok("2.2: no file data is rejected (the placeholder path is gone)", none.status === 400 && none.json?.code === "FILE_MISSING", { s: none.status, j: none.json });
      const svg = await api("POST", `/api/companies/${A.cid}/documents`, { token: A.token, body: { name: "svg", fileName: "a.svg", mimeType: "image/svg+xml", fileData: Buffer.from("<svg/>").toString("base64") } });
      ok("2.2: disallowed content type (svg) is rejected", svg.status === 400 && svg.json?.code === "FILE_TYPE_NOT_ALLOWED", { s: svg.status, j: svg.json });
      const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]).toString("base64");
      const huge = await api("POST", `/api/companies/${A.cid}/documents`, { token: A.token, body: { name: "big", fileName: "big.pdf", mimeType: "application/pdf", fileData: big } });
      ok("2.2: a file over 10 MB is rejected with 413", huge.status === 413, { s: huge.status, j: huge.json });
    }

    // tax return archive (was a stub)
    {
      const r = await api("POST", `/api/companies/${A.cid}/tax-returns-archive`, {
        token: A.token,
        body: {
          returnType: "vat", periodLabel: "Q1 2026", periodStart: "2026-01-01", periodEnd: "2026-03-31", filingDate: "2026-04-20",
          fileName: "vat-q1.pdf", mimeType: "application/pdf", fileData: PDF_B64, fileUrl: "https://evil.example/x.pdf",
        },
      });
      ok("2.2: tax return with an attached PDF -> 201 with a private key", r.status === 201 && String(r.json?.fileUrl).startsWith(A.cid + "/tax-returns/"), { s: r.status, j: r.json });
      const dl = await api("GET", `/api/tax-returns-archive/${r.json?.id}/download`, { token: A.token, raw: true });
      ok("2.2: tax return PDF downloads byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status, len: dl.buf.length });
      const other = await api("GET", `/api/tax-returns-archive/${r.json?.id}/download`, { token: B.token });
      ok("2.2: another company's user cannot download the tax return", other.status === 403 || other.status === 404, other.status);
      const noFile = await api("POST", `/api/companies/${A.cid}/tax-returns-archive`, {
        token: A.token,
        body: { periodLabel: "Q2 2026", periodStart: "2026-04-01", periodEnd: "2026-06-30", filingDate: "2026-07-20", fileUrl: "https://evil.example/y.pdf" },
      });
      ok("2.2: tax return without a file stores no URL at all", noFile.status === 201 && noFile.json?.fileUrl === null, noFile.json);
    }

    // client portal document (was a stub)
    {
      const P = await newUser("portal");
      await db.query("UPDATE users SET user_type = 'client_portal' WHERE id = $1", [P.userId]);
      const up = await api("POST", "/api/client-portal/documents", {
        token: P.token,
        body: { name: "Receipts", fileName: "r.pdf", mimeType: "application/pdf", fileData: PDF_B64, fileUrl: "http://169.254.169.254/x" },
      });
      ok("2.2: portal upload with a real PDF -> 201", up.status === 201, { s: up.status, t: up.text.slice(0, 200) });
      ok("2.2: portal upload ignores a client-supplied fileUrl", up.json && !/^https?:/.test(String(up.json.fileUrl)) && String(up.json.fileUrl).startsWith(P.cid + "/documents/"), up.json?.fileUrl);
      const dl = await api("GET", `/api/client-portal/documents/${up.json?.id}/download`, { token: P.token, raw: true });
      ok("2.2: portal user downloads their own document byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status, len: dl.buf.length });
      const cross = await api("GET", `/api/client-portal/documents/${docA.id}/download`, { token: P.token });
      ok("2.2: portal user cannot read another company's document", cross.status === 403 || cross.status === 404, cross.status);
      const viaGeneric = await api("GET", `/api/documents/${up.json?.id}/download`, { token: P.token });
      ok("2.2: portal accounts stay confined to the portal API", viaGeneric.status === 403, viaGeneric.status);
      // The owner of the company (customer user) can also read it.
      await db.query("UPDATE documents SET is_archived = true WHERE id = $1", [up.json?.id]);
      const archived = await api("GET", `/api/client-portal/documents/${up.json?.id}/download`, { token: P.token });
      ok("2.2: a document no longer shared (archived) is not downloadable by the portal user", archived.status === 404, archived.status);
    }

    // expense-claim receipt upload (was "upload coming soon")
    {
      const up = await api("POST", `/api/companies/${A.cid}/expense-claims/receipt-upload`, {
        token: A.token, body: { fileName: "taxi.pdf", mimeType: "application/pdf", fileData: PDF_B64 },
      });
      ok("2.2: expense receipt upload -> 201 with a storage key", up.status === 201 && String(up.json?.receiptKey).startsWith(A.cid + "/expense-receipts/"), { s: up.status, j: up.json });
      const item = (receipt_url) => ({ expense_date: ymd(-1), category: "travel", description: "Taxi", amount: 20, vat_amount: 1, receipt_url });
      const claim = await api("POST", `/api/companies/${A.cid}/expense-claims`, { token: A.token, body: { title: "Trip", items: [item(up.json?.receiptKey)] } });
      ok("2.2: claim with the uploaded receipt is created", claim.status === 200 && claim.json?.items?.[0]?.receipt_url === up.json?.receiptKey, { s: claim.status, j: claim.json });
      const dl = await api("GET", `/api/expense-claims/${claim.json?.id}/items/${claim.json?.items?.[0]?.id}/receipt`, { token: A.token, raw: true });
      ok("2.2: expense receipt downloads byte-identical", dl.status === 200 && dl.buf.equals(PDF), { s: dl.status, len: dl.buf.length });
      const other = await api("GET", `/api/expense-claims/${claim.json?.id}/items/${claim.json?.items?.[0]?.id}/receipt`, { token: B.token });
      ok("2.2: another company's user cannot download the receipt", other.status === 403 || other.status === 404, other.status);
      const url = await api("POST", `/api/companies/${A.cid}/expense-claims`, { token: A.token, body: { title: "Bad", items: [item("https://evil.example/r.jpg")] } });
      ok("2.2: a receipt URL is refused (only uploaded receipts)", url.status === 400, { s: url.status, j: url.json });
      const bUp = await api("POST", `/api/companies/${B.cid}/expense-claims/receipt-upload`, { token: B.token, body: { fileName: "b.pdf", mimeType: "application/pdf", fileData: PDF_B64 } });
      const steal = await api("POST", `/api/companies/${A.cid}/expense-claims`, { token: A.token, body: { title: "Steal", items: [item(bUp.json?.receiptKey)] } });
      ok("2.2: another company's receipt key cannot be attached", steal.status === 400, { s: steal.status, j: steal.json });
    }

    // storage usage is real
    {
      const u = await api("GET", `/api/companies/${A.cid}/billing/usage`, { token: A.token });
      const rows = await db.query("SELECT COALESCE(SUM(size_bytes),0)::int AS total FROM stored_files WHERE company_id = $1", [A.cid]);
      ok("2.2: billing usage reports real stored bytes", u.status === 200 && u.json?.usage?.storage?.usedBytes === rows.rows[0].total && rows.rows[0].total >= PDF.length * 3, { usage: u.json?.usage?.storage, db: rows.rows[0] });
      const other = await api("GET", `/api/companies/${B.cid}/billing/usage`, { token: B.token });
      ok("2.2: a company only counts its own files", other.json?.usage?.storage?.usedBytes < u.json?.usage?.storage?.usedBytes, { a: u.json?.usage?.storage, b: other.json?.usage?.storage });
    }

    // ───────── 2.3 email: loud when unconfigured ─────────
    {
      const co = await newUser("mail");
      const inv = await api("POST", `/api/companies/${co.cid}/invoices`, {
        token: co.token, body: { customerName: "Mail Co", date: ymd(-1), dueDate: ymd(20), lines: [{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }] },
      });
      const send = await api("POST", `/api/companies/${co.cid}/invoices/${inv.json?.id}/send-email`, { token: co.token, body: { to: "cust@example.com" } });
      ok("2.3: sending an invoice email with no provider -> 503 EMAIL_NOT_CONFIGURED", send.status === 503 && send.json?.code === "EMAIL_NOT_CONFIGURED", { s: send.status, j: send.json });
      const remind = await api("POST", `/api/companies/${co.cid}/invoices/${inv.json?.id}/send-reminder`, { token: co.token, body: { to: "cust@example.com" } });
      ok("2.3: sending a reminder with no provider -> 503 EMAIL_NOT_CONFIGURED", remind.status === 503 && remind.json?.code === "EMAIL_NOT_CONFIGURED", { s: remind.status, j: remind.json });
      const forgot = await api("POST", "/api/auth/forgot-password", { body: { email: `mail_${rnd}@example.com` } });
      const forgot2 = await api("POST", "/api/auth/forgot-password", { body: { email: `nobody_${rnd}@example.com` } });
      ok("2.3: forgot-password answers the same generic message for known and unknown emails", forgot.status === 200 && forgot2.status === 200 && forgot.json?.message === forgot2.json?.message, { known: forgot.json, unknown: forgot2.json });
    }

    // ───────── 2.4 trial + effective plan ─────────
    {
      const co = await newUser("trial");
      const st = await api("GET", `/api/billing/status?companyId=${co.cid}`, { token: co.token });
      ok("2.4: a new company is trialing on the advertised plan", st.status === 200 && st.json?.status === "trialing" && st.json?.plan === "professional", st.json);
      ok("2.4: the trial has 14 days left", st.json?.daysLeft === 14, st.json);
      ok("2.4: status reports enforcement off (flag unset)", st.json?.enforcement === false, st.json);
      const sub = (await db.query("SELECT status, plan_id, EXTRACT(EPOCH FROM (trial_ends_at - (now() at time zone 'utc'))) / 86400 AS days_left FROM subscriptions WHERE company_id = $1", [co.cid])).rows;
      ok("2.4: exactly one subscription row, trialing, ends ~14 days out", sub.length === 1 && sub[0].status === "trialing" && Math.abs(Number(sub[0].days_left) - 14) < 0.1, sub);
      const noArg = await api("GET", "/api/billing/status", { token: co.token });
      ok("2.4: status without companyId uses the user's company", noArg.status === 200 && noArg.json?.status === "trialing", noArg.json);

      const live = await api("GET", `/api/companies/${co.cid}/quotes`, { token: co.token });
      ok("2.4: gated feature works during the trial with no would-block header", live.status === 200 && !live.headers.get("x-billing-would-block"), { s: live.status, h: live.headers.get("x-billing-would-block") });

      await db.query("UPDATE subscriptions SET trial_ends_at = (now() at time zone 'utc') - interval '1 minute' WHERE company_id = $1", [co.cid]);
      const expired = await api("GET", `/api/companies/${co.cid}/quotes`, { token: co.token });
      ok("2.4: enforcement off -> the gated feature still works after the trial ends", expired.status === 200, expired.status);
      ok("2.4: ...but the response says what enforcement would block", expired.headers.get("x-billing-would-block") === "quotes", expired.headers.get("x-billing-would-block"));
      const st2 = await api("GET", `/api/billing/status?companyId=${co.cid}`, { token: co.token });
      ok("2.4: status flips to trial_expired with 0 days left", st2.json?.status === "trial_expired" && st2.json?.daysLeft === 0, st2.json);

      // Company that predates billing: no subscription row -> lazy trial counted from creation (already expired).
      const old = await newUser("oldco");
      await db.query("DELETE FROM subscriptions WHERE company_id = $1", [old.cid]);
      await db.query("UPDATE companies SET created_at = (now() at time zone 'utc') - interval '100 days' WHERE id = $1", [old.cid]);
      const oldGate = await api("GET", `/api/companies/${old.cid}/quotes`, { token: old.token });
      ok("2.4: old company without a row is not blocked while enforcement is off", oldGate.status === 200, oldGate.status);
      ok("2.4: ...and is flagged as would-be-blocked (its trial counted from creation)", oldGate.headers.get("x-billing-would-block") === "quotes", oldGate.headers.get("x-billing-would-block"));
      const oldRows = (await db.query("SELECT status FROM subscriptions WHERE company_id = $1", [old.cid])).rows;
      ok("2.4: the lazy trial row was created exactly once", oldRows.length === 1 && oldRows[0].status === "trialing", oldRows);
      await Promise.all([1, 2, 3, 4, 5].map(() => api("GET", `/api/companies/${old.cid}/quotes`, { token: old.token })));
      const oldRows2 = (await db.query("SELECT 1 FROM subscriptions WHERE company_id = $1", [old.cid])).rows;
      ok("2.4: concurrent first requests never create duplicate rows", oldRows2.length === 1, oldRows2.length);

      const hook = await api("POST", "/api/webhooks/stripe", { body: { id: "evt_x", type: "invoice.paid" }, headers: { "stripe-signature": "t=1,v1=bad" } });
      ok("2.4: Stripe webhook without keys is refused (503), never processed", hook.status === 503, { s: hook.status, j: hook.json });
    }

    // ───────── 2.6 credit-note pool safety ─────────
    {
      const co = await newUser("pool");
      await api("PATCH", `/api/companies/${co.cid}`, { token: co.token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
      const inv = await api("POST", `/api/companies/${co.cid}/invoices`, {
        token: co.token, body: { customerName: "Pool Co", date: ymd(-5), dueDate: ymd(25), lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] },
      });
      const issued = await api("PATCH", `/api/invoices/${inv.json?.id}/status`, { token: co.token, body: { status: "sent" } });
      ok("2.6: invoice issued for the credit-note burst", issued.status === 200, { s: issued.status, j: issued.json });

      const t0 = Date.now();
      const burst = await Promise.all(
        Array.from({ length: 15 }, () =>
          api("POST", `/api/companies/${co.cid}/invoices/${inv.json?.id}/credit-note`, { token: co.token, body: {} }).catch((e) => ({ status: 0, err: String(e) }))
        )
      );
      const elapsed = Date.now() - t0;
      const statuses = burst.map((r) => r.status);
      const created = statuses.filter((s) => s === 201).length;
      const clean4xx = statuses.filter((s) => s >= 400 && s < 500).length;
      ok("2.6: 15 parallel credit notes all answer (no timeouts, no 5xx)", statuses.every((s) => s === 201 || (s >= 400 && s < 500)), { statuses, elapsed });
      ok("2.6: exactly one full credit note is issued; the rest are clean 4xx", created === 1 && clean4xx === 14, { statuses });
      const ready = await api("GET", "/health/ready");
      ok("2.6: the server still answers /health/ready afterwards", ready.status === 200, ready.status);
      const cns = await db.query("SELECT COUNT(*)::int AS n FROM invoices WHERE original_invoice_id = $1 AND invoice_type = 'credit_note'", [inv.json?.id]);
      ok("2.6: one credit note row exists in the database", cns.rows[0].n === 1, cns.rows[0]);
    }
  } finally {
    await db.end();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
