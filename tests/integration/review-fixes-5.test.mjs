// Integration tests for the fifth round of review fixes (defects proved with live requests):
//   A  a full credit note with the wrong VAT mix is refused; lines are built from the remainder
//   B  parallel void / cancel requests reverse an invoice exactly once (also a credit note void)
//   C  a credit note needs a POSTED invoice
//   D  PATCH /api/vat-returns/:id cannot move a period, skip the period-end rule or edit a filed return
//   E  0% out-of-scope sales are in none of Boxes 1-5
//   F  POST /api/companies/:id/bank-transactions validates its body and works
// Drives real HTTP against a running server + Postgres.
//   BASE_URL=http://127.0.0.1:5056 node tests/integration/review-fixes-5.test.mjs

import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
async function api(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const today = ymd(0);
const n = (v) => Number(v ?? 0);
const close = (a, b, t = 0.005) => Math.abs(n(a) - n(b)) <= t;
const monthStartOf = (y, m0) => new Date(Date.UTC(y, m0, 1)).toISOString().slice(0, 10);
const monthEndOf = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).toISOString().slice(0, 10);
const ty = +today.slice(0, 4), tm = +today.slice(5, 7) - 1;
const prevStart = monthStartOf(ty, tm - 1), prevEnd = monthEndOf(ty, tm - 1);
const prev2Start = monthStartOf(ty, tm - 2), prev2End = monthEndOf(ty, tm - 2);
const curStart = monthStartOf(ty, tm), curEnd = monthEndOf(ty, tm);
const prevInvoiceDate = prevEnd.slice(0, 8) + "15";
const prevCreditDate = prevEnd.slice(0, 8) + "20";

async function freshCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user?.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const balances = async () => {
    const j = (await api("GET", `/api/companies/${cid}/journal`, { token })).json ?? [];
    const out = {};
    for (const e of j) {
      if (e.status && e.status !== "posted") continue;
      for (const l of e.lines ?? []) {
        const code = l.account?.code;
        out[code] = Math.round(((out[code] ?? 0) + n(l.debit) - n(l.credit)) * 100) / 100;
      }
    }
    return out;
  };
  const mk = (extra) => api("POST", `/api/companies/${cid}/invoices`, { token, body: { customerName: "Review Co", date: today, ...extra } });
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const setStatus = (id, status) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status } });
  const creditNote = (invId, body) => api("POST", `/api/companies/${cid}/invoices/${invId}/credit-note`, { token, body });
  const account = async (code) => ((await api("GET", `/api/companies/${cid}/accounts`, { token })).json ?? []).find((a) => a.code === code);
  const vat201 = (start, end) => api("POST", `/api/companies/${cid}/vat-returns/generate`, { token, body: { periodStart: start, periodEnd: end } });
  return { token, cid, userId, balances, mk, issue, setStatus, creditNote, account, vat201 };
}

const AR = "1040", VAT = "2020", REV = "4010", ZERO = "4060";
const allZero = (b) => [AR, VAT, REV, ZERO].every((c) => close(b[c] ?? 0, 0));

async function main() {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const entriesOf = async (sourceId) => (await db.query("SELECT id, status, reversed_entry_id FROM journal_entries WHERE source = 'invoice' AND source_id = $1", [sourceId])).rows;
  try {
    // ───────── Defect A: credit note lines must agree with what the journal reverses ─────────
    {
      const c = await freshCompany("a1");
      let r = await c.mk({ date: prevInvoiceDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { description: "export", quantity: 1, unitPrice: 105, vatRate: 0 },
      ] });
      const inv = r.json;
      r = await c.issue(inv.id);
      ok("A1: invoice 100@5% + 105@0% (210) issued", r.status === 200, { s: r.status, j: r.json });
      const posted = await c.balances();
      ok("A1: ledger has AR 210, VAT 5", close(posted[AR], 210) && close(posted[VAT], -5), posted);
      r = await c.vat201(prevStart, prevEnd);
      ok("A1: before the credit note VAT 201 shows 100 / 5 / 105", close(r.json?.box1bDubaiAmount, 100) && close(r.json?.box1bDubaiVat, 5) && close(r.json?.box4ZeroRatedAmount, 105), r.json);

      // the proven scenario: 200 @5% brings the invoice to fully credited with the wrong mix
      r = await c.creditNote(inv.id, { date: prevCreditDate, lines: [{ description: "everything", quantity: 1, unitPrice: 200, vatRate: 0.05 }] });
      ok("A1: 200@5% (total 210) is refused 422 CREDIT_NOTE_LINES_MISMATCH", r.status === 422 && r.json?.code === "CREDIT_NOTE_LINES_MISMATCH", { s: r.status, j: r.json });
      ok("A1: the response carries the expected buckets", Array.isArray(r.json?.expectedBuckets) && r.json.expectedBuckets.length === 2
        && r.json.expectedBuckets.some((b) => close(b.vatRate, 0.05) && close(b.net, 100))
        && r.json.expectedBuckets.some((b) => close(b.vatRate, 0) && close(b.net, 105)), r.json);
      const afterRefusal = await c.balances();
      ok("A1: nothing was posted by the refused request", close(afterRefusal[AR], 210) && close(afterRefusal[VAT], -5), afterRefusal);

      // omitted lines: the server builds the document from the remainder
      r = await c.creditNote(inv.id, { date: prevCreditDate });
      ok("A1: the full credit note (no lines) is accepted", r.status === 201, { s: r.status, j: r.json });
      const cn = r.json;
      const cnLines = (await api("GET", `/api/invoices/${cn?.id}`, { token: c.token })).json?.lines ?? [];
      const netAt = (rate) => cnLines.filter((l) => close(l.vatRate, rate)).reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0);
      ok("A1: the document lines mirror the invoice: -100 at 5% and -105 at 0%", close(netAt(0.05), -100) && close(netAt(0), -105), cnLines);
      const fully = await c.balances();
      ok("A1: AR, revenue, VAT and zero-rated revenue are back to 0.00", allZero(fully), fully);
      r = await c.vat201(prevStart, prevEnd);
      ok("A1: VAT 201 for the period: standard net 0, VAT 0, zero-rated 0", close(r.json?.box1bDubaiAmount, 0) && close(r.json?.box1bDubaiVat, 0) && close(r.json?.box4ZeroRatedAmount, 0) && close(r.json?.box8TotalVat, 0), r.json);
    }

    {
      // explicit lines that match the remainder are accepted and stored as the remainder
      const c = await freshCompany("a2");
      let r = await c.mk({ date: prevInvoiceDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { description: "export", quantity: 1, unitPrice: 105, vatRate: 0 },
      ] });
      const inv = r.json;
      await c.issue(inv.id);
      r = await c.creditNote(inv.id, { date: prevCreditDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { description: "export", quantity: 1, unitPrice: 105, vatRate: 0 },
      ] });
      ok("A2: explicit full credit with the exact mix is accepted", r.status === 201, { s: r.status, j: r.json });
      const b = await c.balances();
      ok("A2: books at 0.00", allZero(b), b);
      r = await c.vat201(prevStart, prevEnd);
      ok("A2: VAT 201 nets to 0 in every box", close(r.json?.box1bDubaiAmount, 0) && close(r.json?.box1bDubaiVat, 0) && close(r.json?.box4ZeroRatedAmount, 0), r.json);

      // partial then final: wrong final mix refused, right one accepted
      const d = await freshCompany("a3");
      r = await d.mk({ date: prevInvoiceDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { description: "export", quantity: 1, unitPrice: 105, vatRate: 0 },
      ] });
      const inv2 = r.json;
      await d.issue(inv2.id);
      r = await d.creditNote(inv2.id, { date: prevCreditDate, lines: [{ description: "taxed", quantity: 1, unitPrice: 40, vatRate: 0.05 }] });
      ok("A3: partial credit of 40@5% accepted", r.status === 201, { s: r.status, j: r.json });
      r = await d.creditNote(inv2.id, { date: prevCreditDate, lines: [{ description: "rest", quantity: 1, unitPrice: 160, vatRate: 0.05 }] });
      ok("A3: a final credit with the wrong mix is refused", r.status === 422 && r.json?.code === "CREDIT_NOTE_LINES_MISMATCH", { s: r.status, j: r.json });
      r = await d.creditNote(inv2.id, { date: prevCreditDate });
      ok("A3: the final credit note for the remainder is accepted", r.status === 201, { s: r.status, j: r.json });
      const b3 = await d.balances();
      ok("A3: books at 0.00 after partial + final", allZero(b3), b3);
      r = await d.vat201(prevStart, prevEnd);
      ok("A3: VAT 201 nets to 0 after partial + final", close(r.json?.box1bDubaiAmount, 0) && close(r.json?.box1bDubaiVat, 0) && close(r.json?.box4ZeroRatedAmount, 0), r.json);
    }

    {
      // partial path: capped per VAT bucket even when both buckets post to the same revenue account
      const c = await freshCompany("a4");
      const rev = await c.account(REV);
      let r = await c.mk({ date: prevInvoiceDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05, revenueAccountId: rev?.id },
        { description: "export", quantity: 1, unitPrice: 105, vatRate: 0, revenueAccountId: rev?.id },
      ] });
      const inv = r.json;
      await c.issue(inv.id);
      const before = await c.balances();
      r = await c.creditNote(inv.id, { date: prevCreditDate, lines: [{ description: "export", quantity: 1, unitPrice: 150, vatRate: 0, vatSupplyType: "zero_rated" }] });
      ok("A4: crediting 150 at 0% when only 105 remains at 0% is refused (409 CREDIT_EXCEEDS_VAT_BUCKET)", r.status === 409 && r.json?.code === "CREDIT_EXCEEDS_VAT_BUCKET", { s: r.status, j: r.json });
      const after = await c.balances();
      ok("A4: nothing posted", close(after[REV], before[REV]) && close(after[AR], before[AR]), { before, after });
      r = await c.creditNote(inv.id, { date: prevCreditDate, lines: [{ description: "export", quantity: 1, unitPrice: 100, vatRate: 0, vatSupplyType: "zero_rated" }] });
      ok("A4: a credit within the 0% bucket is accepted", r.status === 201, { s: r.status, j: r.json });
    }

    // ───────── Defect B: void is atomic and idempotent ─────────
    {
      const c = await freshCompany("b1");
      let r = await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] });
      const inv = r.json;
      await c.issue(inv.id);
      const posted = await c.balances();
      ok("B1: invoice posted AR 1050 / VAT 50", close(posted[AR], 1050) && close(posted[VAT], -50), posted);
      const res = await Promise.all(Array.from({ length: 10 }, () => c.setStatus(inv.id, "void")));
      const wins = res.filter((x) => x.status === 200);
      const losers = res.filter((x) => x.status !== 200);
      ok("B1: exactly one of 10 parallel voids succeeds", wins.length === 1, res.map((x) => x.status));
      ok("B1: the others are 409 INVOICE_ALREADY_VOID", losers.length === 9 && losers.every((x) => x.status === 409 && x.json?.code === "INVOICE_ALREADY_VOID"), losers.map((x) => [x.status, x.json?.code]));
      const es = await entriesOf(inv.id);
      ok("B1: exactly ONE reversal journal entry exists", es.filter((e) => e.reversed_entry_id).length === 1 && es.length === 2, es);
      const b = await c.balances();
      ok("B1: AR, revenue and VAT are back to 0.00", allZero(b), b);
      r = await c.setStatus(inv.id, "void");
      ok("B1: a later void is 409 INVOICE_ALREADY_VOID", r.status === 409 && r.json?.code === "INVOICE_ALREADY_VOID", { s: r.status, j: r.json });
      r = await api("GET", `/api/invoices/${inv.id}`, { token: c.token });
      ok("B1: the invoice is void", r.json?.status === "void", r.json?.status);
    }

    {
      // a draft cancelled in parallel: one wins, no reversal (nothing was posted)
      const c = await freshCompany("b2");
      const inv = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 100, vatRate: 0.05 }] })).json;
      const res = await Promise.all(Array.from({ length: 6 }, () => c.setStatus(inv.id, "cancelled")));
      ok("B2: exactly one of 6 parallel cancels of a draft succeeds", res.filter((x) => x.status === 200).length === 1, res.map((x) => x.status));
      ok("B2: the others are 409", res.filter((x) => x.status !== 200).every((x) => x.status === 409), res.map((x) => [x.status, x.json?.code]));
      ok("B2: no journal entry was created", (await entriesOf(inv.id)).length === 0);
    }

    {
      // voiding a credit note in parallel
      const c = await freshCompany("b3");
      const inv = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 1000, vatRate: 0.05 }] })).json;
      await c.issue(inv.id);
      let r = await c.creditNote(inv.id, { lines: [{ description: "part", quantity: 1, unitPrice: 400, vatRate: 0.05 }] });
      ok("B3: partial credit note 400 issued", r.status === 201, { s: r.status, j: r.json });
      const cn = r.json;
      const afterCn = await c.balances();
      ok("B3: ledger after the credit note: AR 630, VAT 30", close(afterCn[AR], 630) && close(afterCn[VAT], -30), afterCn);
      const res = await Promise.all(Array.from({ length: 10 }, () => c.setStatus(cn.id, "void")));
      ok("B3: exactly one of 10 parallel credit-note voids succeeds", res.filter((x) => x.status === 200).length === 1, res.map((x) => x.status));
      ok("B3: the others are 409 INVOICE_ALREADY_VOID", res.filter((x) => x.status !== 200).every((x) => x.status === 409 && x.json?.code === "INVOICE_ALREADY_VOID"), res.map((x) => [x.status, x.json?.code]));
      const es = await entriesOf(cn.id);
      const cnEntry = es.find((e) => !es.some((o) => o.id === e.reversed_entry_id));
      ok("B3: exactly ONE reversal of the credit note's entry", es.length === 2 && es.filter((e) => e.reversed_entry_id === cnEntry?.id).length === 1, es);
      const b = await c.balances();
      ok("B3: books are back to the invoice alone: AR 1050, revenue 1000, VAT 50", close(b[AR], 1050) && close(b[REV], -1000) && close(b[VAT], -50), b);
    }

    // ───────── Defect C: a credit note needs a posted invoice ─────────
    {
      const c = await freshCompany("c1");
      const draft = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] })).json;
      let r = await c.creditNote(draft.id, { lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] });
      ok("C1: credit note (lines) on a draft invoice -> 409 INVOICE_NOT_POSTED", r.status === 409 && r.json?.code === "INVOICE_NOT_POSTED", { s: r.status, j: r.json });
      r = await c.creditNote(draft.id, {});
      ok("C1: full credit note on a draft invoice -> 409 INVOICE_NOT_POSTED", r.status === 409 && r.json?.code === "INVOICE_NOT_POSTED", { s: r.status, j: r.json });
      ok("C1: no journal entry was posted", Object.keys(await c.balances()).length === 0 || allZero(await c.balances()));
      const list = (await api("GET", `/api/companies/${c.cid}/credit-notes`, { token: c.token })).json ?? [];
      ok("C1: no credit note document was created", list.length === 0, list);

      const inv = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] })).json;
      await c.issue(inv.id);
      await c.setStatus(inv.id, "void");
      r = await c.creditNote(inv.id, {});
      ok("C1: credit note on a VOID invoice -> 409 INVOICE_NOT_POSTED", r.status === 409 && r.json?.code === "INVOICE_NOT_POSTED", { s: r.status, j: r.json });
      const cancelled = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] })).json;
      await c.setStatus(cancelled.id, "cancelled");
      r = await c.creditNote(cancelled.id, {});
      ok("C1: credit note on a CANCELLED invoice -> 409 INVOICE_NOT_POSTED", r.status === 409 && r.json?.code === "INVOICE_NOT_POSTED", { s: r.status, j: r.json });

      const good = (await c.mk({ lines: [{ description: "svc", quantity: 1, unitPrice: 500, vatRate: 0.05 }] })).json;
      await c.issue(good.id);
      r = await c.creditNote(good.id, {});
      ok("C1: an issued invoice can still be credited", r.status === 201, { s: r.status, j: r.json });

      r = await api("POST", `/api/companies/${c.cid}/credit-notes`, { token: c.token, body: { customerName: "X", lines: [] } });
      ok("C1: the standalone credit-note write stays retired (410), not a 500", r.status === 410, { s: r.status, j: r.json });
    }

    // ───────── Defect D: PATCH /api/vat-returns/:id ─────────
    {
      const c = await freshCompany("d1");
      let r = await c.vat201(prevStart, prevEnd);
      const vrId = r.json?.id;
      ok("D1: a return for last month was generated", !!vrId, { s: r.status, j: r.json });
      const stored = () => api("GET", `/api/companies/${c.cid}/vat-returns`, { token: c.token }).then((x) => (x.json ?? []).find((v) => v.id === vrId));

      r = await api("PATCH", `/api/vat-returns/${vrId}`, { token: c.token, body: { periodStart: curStart, periodEnd: curEnd, status: "pending_review", box8TotalVat: 1 } });
      ok("D1: moving the period into the current month is refused (400 VAT_PERIOD_IMMUTABLE)", r.status === 400 && r.json?.code === "VAT_PERIOD_IMMUTABLE", { s: r.status, j: r.json });
      let now = await stored();
      ok("D1: the stored return is unchanged (period, status, box)", now?.periodStart?.slice(0, 10) === prevStart && now?.periodEnd?.slice(0, 10) === prevEnd && now?.status === "draft" && close(now?.box8TotalVat, 0), now);
      r = await api("PATCH", `/api/vat-returns/${vrId}`, { token: c.token, body: { periodEnd: curEnd } });
      ok("D1: changing only periodEnd is refused too", r.status === 400 && r.json?.code === "VAT_PERIOD_IMMUTABLE", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${vrId}`, { token: c.token, body: { periodStart: prevStart, periodEnd: prevEnd, notes: "same period" } });
      ok("D1: sending the stored period back is accepted", r.status === 200, { s: r.status, j: r.json });
      // a manual edit of a figure now needs a written reason (10+ characters) in the same request
      r = await api("PATCH", `/api/vat-returns/${vrId}`, { token: c.token, body: { box8TotalVat: 12.5, adjustmentReason: "Test edit: hand-corrected total" } });
      ok("D1: manual box edits on a DRAFT return still work (with a reason)", r.status === 200 && close(r.json?.box8TotalVat, 12.5), { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${vrId}`, { token: c.token, body: { status: "pending_review" } });
      ok("D1: a closed period may move to pending_review", r.status === 200 && r.json?.status === "pending_review", { s: r.status, j: r.json });

      // an OPEN-period return (as a legacy/buggy row) cannot become non-draft
      const open = (await db.query(
        `INSERT INTO vat_returns (company_id, period_start, period_end, due_date, status, created_by) VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING id`,
        [c.cid, curStart, curEnd, curEnd, c.userId]
      )).rows[0];
      r = await api("PATCH", `/api/vat-returns/${open.id}`, { token: c.token, body: { status: "pending_review" } });
      ok("D1: an open-period return cannot go to pending_review (400 PERIOD_NOT_ENDED)", r.status === 400 && r.json?.code === "PERIOD_NOT_ENDED", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${open.id}`, { token: c.token, body: { notes: "still a draft" } });
      ok("D1: a draft note on it is fine", r.status === 200, { s: r.status, j: r.json });
      const openRow = (await db.query("SELECT status FROM vat_returns WHERE id = $1", [open.id])).rows[0];
      ok("D1: it is still a draft", openRow?.status === "draft", openRow);

      // a submitted return is immutable
      r = await c.vat201(prev2Start, prev2End);
      const vr2 = r.json?.id;
      r = await api("POST", `/api/vat-returns/${vr2}/submit`, { token: c.token, body: {} });
      ok("D1: a second closed return was submitted", r.status === 200 && r.json?.status === "submitted", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${vr2}`, { token: c.token, body: { box8TotalVat: 1 } });
      ok("D1: editing box figures of a submitted return -> 409 VAT_RETURN_LOCKED", r.status === 409 && r.json?.code === "VAT_RETURN_LOCKED", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${vr2}`, { token: c.token, body: { status: "draft" } });
      ok("D1: a submitted return cannot be re-opened via PATCH", r.status === 409 && r.json?.code === "VAT_RETURN_LOCKED", { s: r.status, j: r.json });
      r = await api("PATCH", `/api/vat-returns/${vr2}`, { token: c.token, body: { notes: "payment reference noted" } });
      ok("D1: notes on a submitted return still save", r.status === 200, { s: r.status, j: r.json });
    }

    // ───────── Defect E: 0% out-of-scope sales are in none of Boxes 1-5 ─────────
    {
      const c = await freshCompany("e1");
      let r = await c.mk({ date: prevInvoiceDate, lines: [
        { description: "taxed", quantity: 1, unitPrice: 100, vatRate: 0.05 },
        { description: "zero", quantity: 1, unitPrice: 50, vatRate: 0, vatSupplyType: "zero_rated" },
        { description: "oos", quantity: 1, unitPrice: 70, vatRate: 0, vatSupplyType: "out_of_scope" },
        { description: "exempt", quantity: 1, unitPrice: 30, vatRate: 0, vatSupplyType: "exempt" },
      ] });
      const inv = r.json;
      await c.issue(inv.id);
      r = await c.vat201(prevStart, prevEnd);
      ok("E1: Box 1 = 100 / 5, Box 4 = 50 (the 70 out-of-scope is excluded), Box 5 = 30",
        close(r.json?.box1bDubaiAmount, 100) && close(r.json?.box1bDubaiVat, 5) && close(r.json?.box4ZeroRatedAmount, 50) && close(r.json?.box5ExemptAmount, 30), r.json);
    }

    // ───────── Defect F: POST bank-transactions ─────────
    {
      const c = await freshCompany("f1");
      const url = `/api/companies/${c.cid}/bank-transactions`;
      let r = await api("POST", url, { token: c.token, body: { transactionDate: ymd(-3), description: "Deposit A", amount: 250.5 } });
      ok("F1: a plain YYYY-MM-DD date creates the transaction (201)", r.status === 201 && r.json?.id, { s: r.status, j: r.json });
      ok("F1: it is stored on that calendar day", String(r.json?.transactionDate).slice(0, 10) === ymd(-3) && close(r.json?.amount, 250.5), r.json);
      r = await api("POST", url, { token: c.token, body: { transactionDate: new Date(Date.now() - 2 * 86400000).toISOString(), description: "Deposit B", amount: -40 } });
      ok("F1: an ISO datetime creates the transaction (201)", r.status === 201 && r.json?.id, { s: r.status, j: r.json });
      r = await api("POST", url, { token: c.token, body: { transactionDate: "not-a-date", description: "bad", amount: 1 } });
      ok("F1: an invalid date is a 400", r.status === 400, { s: r.status, j: r.json });
      r = await api("POST", url, { token: c.token, body: { transactionDate: ymd(20), description: "future", amount: 1 } });
      ok("F1: a future date is refused (422)", r.status === 422 && /future/i.test(r.json?.message ?? ""), { s: r.status, j: r.json });
      r = await api("POST", url, { token: c.token, body: { transactionDate: ymd(-1), amount: 1 } });
      ok("F1: a missing description is a 400", r.status === 400, { s: r.status, j: r.json });
      r = await api("POST", url, { token: c.token, body: { transactionDate: ymd(-1), description: "x", amount: "abc" } });
      ok("F1: a non-numeric amount is a 400", r.status === 400, { s: r.status, j: r.json });
      r = await api("POST", url, { token: c.token, body: { transactionDate: ymd(-1), description: "sneaky", amount: 5, isReconciled: true, companyId: "00000000-0000-0000-0000-000000000000" } });
      ok("F1: reconciliation state and tenant scope cannot be set by the client", r.status === 201 && r.json?.isReconciled === false && r.json?.companyId === c.cid, { s: r.status, j: r.json });
      r = await api("GET", url, { token: c.token });
      ok("F1: the created transactions are listed", (r.json ?? []).length === 3, (r.json ?? []).length);
    }
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(fails.join("\n")); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
