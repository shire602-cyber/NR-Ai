// Integration tests for Phase 6 stream B: weighted-average inventory costing and COGS posting.
// Live requests against a running server + Postgres.
//   BASE_URL=http://localhost:5062 DATABASE_URL=... node tests/integration/phase6-inventory.test.mjs
// Prints "N passed, M failed" and exits non-zero on any failure.

import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
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
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const today = new Date().toISOString().slice(0, 10);
let db;

async function newCompany(label) {
  const r = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  if (!r.json?.token) throw new Error("register failed " + r.status + " " + r.text);
  const token = r.json.token, cid = r.json.company.id, userId = r.json.user.id;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  const balances = async () => {
    const rows = (await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit) AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted' GROUP BY a.code`, [cid])).rows;
    const out = {};
    for (const row of rows) out[row.code] = Math.round(n(row.net) * 100) / 100;
    return out;
  };
  const cogsEntries = async () =>
    (await db.query(`SELECT * FROM journal_entries WHERE company_id = $1 AND source = 'inventory_cogs' ORDER BY created_at`, [cid])).rows;
  const product = async (extra = {}) => {
    const r = await api("POST", `/api/companies/${cid}/products`, {
      token, body: { name: "Widget " + Math.random().toString(36).slice(2, 6), unitPrice: "100", vatRate: "0.05", trackInventory: true, ...extra },
    });
    if (!r.json?.id) throw new Error("product failed " + r.status + " " + r.text.slice(0, 200));
    return r.json;
  };
  const movement = (productId, body) => api("POST", `/api/products/${productId}/movements`, { token, body });
  const getProduct = async (id) => (await api("GET", `/api/products/${id}`, { token })).json;
  const draftInvoice = async (lines) => {
    const r = await api("POST", `/api/companies/${cid}/invoices`, {
      token, body: { customerName: "Buyer", date: today, dueDate: today, lines },
    });
    if (!r.json?.id) throw new Error("invoice failed " + r.status + " " + r.text.slice(0, 300));
    return r.json;
  };
  const issue = (id) => api("PATCH", `/api/invoices/${id}/status`, { token, body: { status: "sent" } });
  const setCosting = (enabled) => api("PATCH", `/api/companies/${cid}/preferences`, { token, body: { inventoryCostingEnabled: enabled } });
  return { token, cid, userId, balances, cogsEntries, product, movement, getProduct, draftInvoice, issue, setCosting };
}

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await costingAndIssue();
    await insufficientStock();
    await voidReturnsStock();
    await settingOff();
    await journalProtection();
    await creditNoteRestock();
    await quoteConversion();
    await onDemandAccountAndRace();
    await foreignProductRejected();
    await voidCreditNoteUndoesRestock();
    await usageCapsAreObserveOnly();
    await ledgerTieOut();
    await roundingResidue();
    await openingJournal();
    await costUnknownRefused();
    await productWithMovementsCannotBeDeleted();
  } finally {
    await db.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

// 10 @ 40 then 10 @ 60 -> average 50; invoice 5 units -> stock 15, COGS 250.
async function costingAndIssue() {
  const C = await newCompany("costA");
  const on = await C.setCosting(true);
  ok("setting toggles on via preferences", on.status === 200 && on.json?.inventoryCostingEnabled === true, on.text?.slice(0, 200));

  const p = await C.product();
  ok("product created with trackInventory", p.trackInventory === true && n(p.averageCost) === 0, p);
  const m1 = await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  ok("first purchase accepted", m1.status === 200 && m1.json.newStock === 10, m1.text.slice(0, 200));
  const m2 = await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "60" });
  ok("second purchase accepted", m2.status === 200 && m2.json.newStock === 20, m2.text.slice(0, 200));
  const afterBuy = await C.getProduct(p.id);
  ok("average cost is 50 after 10@40 + 10@60", n(afterBuy.averageCost) === 50, afterBuy.averageCost);

  const inv = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  const line = (await db.query(`SELECT product_id FROM invoice_lines WHERE invoice_id = $1`, [inv.id])).rows[0];
  ok("invoice line keeps product_id", line?.product_id === p.id, line);
  const draftBal = await C.balances();
  ok("draft invoice posts nothing", draftBal["5200"] === undefined, draftBal);

  const issued = await C.issue(inv.id);
  ok("issue succeeds", issued.status === 200, issued.text.slice(0, 300));
  const after = await C.getProduct(p.id);
  ok("stock reduced to 15", after.currentStock === 15, after.currentStock);
  const sale = (after.movements ?? []).find((m) => m.type === "sale");
  ok("sale movement recorded at average cost", sale && sale.quantity === 5 && n(sale.unitCost) === 50, sale);
  ok("average cost unchanged by a sale", n(after.averageCost) === 50, after.averageCost);

  const entries = await C.cogsEntries();
  ok("exactly one COGS journal", entries.length === 1 && entries[0].status === "posted" && entries[0].source_id === inv.id, entries);
  const lines = (await db.query(
    `SELECT a.code, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`,
    [entries[0].id])).rows;
  const dr = lines.find((l) => l.code === "5200"), cr = lines.find((l) => l.code === "1070");
  ok("journal is Dr 5200 250 / Cr 1070 250", dr && cr && n(dr.debit) === 250 && n(cr.credit) === 250 && lines.length === 2, lines);
  const invDate = (await db.query(`SELECT date FROM invoices WHERE id = $1`, [inv.id])).rows[0].date;
  const revDate = (await db.query(`SELECT date FROM journal_entries WHERE company_id = $1 AND source = 'invoice' AND source_id = $2`, [C.cid, inv.id])).rows[0].date;
  ok("journal is dated the invoice date, like the revenue journal",
    new Date(entries[0].date).getTime() === new Date(invDate).getTime() && new Date(revDate).getTime() === new Date(invDate).getTime(),
    { cogs: entries[0].date, rev: revDate, invDate });

  const bal = await C.balances();
  ok("ledger: COGS 250 debit; inventory 750 (1,000 bought - 250 sold); GRNI 1,000 credit; revenue untouched", bal["5200"] === 250 && bal["1070"] === 750 && bal["2015"] === -1000 && bal["4010"] === -500, bal);

  const pl = await api("GET", `/api/companies/${C.cid}/financial-statements/profit-loss?startDate=${today.slice(0, 8)}01&endDate=${today}`, { token: C.token });
  const flat = JSON.stringify(pl.json);
  ok("P&L shows Cost of Goods Sold", pl.status === 200 && flat.includes("Cost of Goods Sold") && flat.includes("250"), pl.text.slice(0, 400));

  // Re-issuing is a no-op: the invoice is no longer a draft, and COGS never posts twice.
  const again = await C.issue(inv.id);
  ok("second issue does not double-post COGS", (await C.cogsEntries()).length === 1 && (await C.getProduct(p.id)).currentStock === 15, again.status);
}

async function insufficientStock() {
  const C = await newCompany("costB");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 3, unitCost: "10" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 4, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  const r = await C.issue(inv.id);
  ok("short stock refuses the issue with 422 INSUFFICIENT_STOCK", r.status === 422 && r.json?.code === "INSUFFICIENT_STOCK", r.text.slice(0, 300));
  const status = (await db.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0]?.status;
  ok("invoice stays draft", status === "draft", status);
  const posted = (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source <> 'inventory_movement'`, [C.cid])).rows[0].c;
  ok("nothing was posted (no revenue, no COGS; only the purchase movement journal exists)", posted === 0, posted);
  const prod = await C.getProduct(p.id);
  ok("stock and movements untouched", prod.currentStock === 3 && (prod.movements ?? []).filter((m) => m.type === "sale").length === 0, prod);

  // A refused manual sale must not leave a movement behind either.
  const manual = await C.movement(p.id, { type: "sale", quantity: 99 });
  ok("manual oversell is 422", manual.status === 422 && manual.json?.code === "INSUFFICIENT_STOCK", manual.text.slice(0, 200));
  const rows = (await db.query(`SELECT count(*)::int AS c FROM inventory_movements WHERE product_id = $1`, [p.id])).rows[0].c;
  ok("refused manual sale leaves no movement row", rows === 1, rows);
}

async function voidReturnsStock() {
  const C = await newCompany("costC");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "60" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  await C.issue(inv.id);
  const v = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } });
  ok("void succeeds", v.status === 200, v.text.slice(0, 300));
  const prod = await C.getProduct(p.id);
  ok("void brings stock back to 20", prod.currentStock === 20, prod.currentStock);
  ok("void leaves the average cost at 50", n(prod.averageCost) === 50, prod.averageCost);
  const ret = (prod.movements ?? []).find((m) => m.type === "return");
  ok("return movement at the cost it left at", ret && ret.quantity === 5 && n(ret.unitCost) === 50, ret);
  const entries = await C.cogsEntries();
  ok("COGS journal reversed (original + reversal)", entries.length === 2 && entries.some((e) => e.reversed_entry_id), entries.length);
  const bal = await C.balances();
  ok("COGS nets to zero after void and inventory is back at the full 1,000", (bal["5200"] ?? 0) === 0 && bal["1070"] === 1000, bal);
  const v2 = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } });
  ok("second void is refused and returns no more stock", v2.status === 409 && (await C.getProduct(p.id)).currentStock === 20, v2.status);
}

async function settingOff() {
  const C = await newCompany("costD");
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  const r = await C.issue(inv.id);
  ok("issue works with the setting off", r.status === 200, r.text.slice(0, 200));
  ok("setting off: no COGS journal", (await C.cogsEntries()).length === 0, null);
  ok("setting off: stock untouched", (await C.getProduct(p.id)).currentStock === 10, null);

  // Setting on but product not tracked: also nothing.
  await C.setCosting(true);
  const plain = await C.product({ trackInventory: false });
  const inv2 = await C.draftInvoice([{ description: "Plain", quantity: 2, unitPrice: 10, vatRate: 0.05, productId: plain.id }]);
  const r2 = await C.issue(inv2.id);
  ok("untracked product is ignored", r2.status === 200 && (await C.cogsEntries()).length === 0, r2.text.slice(0, 200));
}

async function journalProtection() {
  const C = await newCompany("costE");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 2, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  await C.issue(inv.id);
  const [entry] = await C.cogsEntries();
  const rev = await api("POST", `/api/journal/${entry.id}/reverse`, { token: C.token, body: { reason: "try" } });
  ok("COGS journal cannot be reversed from the journal route", rev.status === 409 && rev.json?.code === "SYSTEM_ENTRY_NOT_REVERSIBLE", rev.text.slice(0, 300));
  const del = await api("DELETE", `/api/journal/${entry.id}`, { token: C.token });
  ok("COGS journal cannot be deleted", [409, 400, 403].includes(del.status), del.status);
}

async function creditNoteRestock() {
  // Full credit note with restock: everything comes back, COGS reverses to zero.
  const C = await newCompany("costF");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 4, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  await C.issue(inv.id);
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: { restock: true } });
  ok("restocking credit note created", cn.status === 201, cn.text.slice(0, 300));
  const prod = await C.getProduct(p.id);
  ok("restock: stock back to 10", prod.currentStock === 10, prod.currentStock);
  const bal = await C.balances();
  ok("restock: COGS nets to zero and inventory is back at the full 400", (bal["5200"] ?? 0) === 0 && bal["1070"] === 400, bal);

  // Credit note without restock: no stock effect, COGS stays.
  const D = await newCompany("costG");
  await D.setCosting(true);
  const q = await D.product();
  await D.movement(q.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv2 = await D.draftInvoice([{ description: "Widget", quantity: 4, unitPrice: 100, vatRate: 0.05, productId: q.id }]);
  await D.issue(inv2.id);
  const cn2 = await api("POST", `/api/companies/${D.cid}/invoices/${inv2.id}/credit-note`, { token: D.token, body: {} });
  ok("credit note without restock created", cn2.status === 201, cn2.text.slice(0, 300));
  const prod2 = await D.getProduct(q.id);
  const bal2 = await D.balances();
  ok("no restock: stock stays 6 and COGS 160 stands", prod2.currentStock === 6 && bal2["5200"] === 160, { stock: prod2.currentStock, bal: bal2 });

  // Partial credit note with restock for part of a line.
  const E = await newCompany("costH");
  await E.setCosting(true);
  const r = await E.product();
  await E.movement(r.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv3 = await E.draftInvoice([{ description: "Widget", quantity: 4, unitPrice: 100, vatRate: 0.05, productId: r.id }]);
  await E.issue(inv3.id);
  const lineId = (await db.query(`SELECT id FROM invoice_lines WHERE invoice_id = $1`, [inv3.id])).rows[0].id;
  const cn3 = await api("POST", `/api/companies/${E.cid}/invoices/${inv3.id}/credit-note`, {
    token: E.token,
    body: { restock: true, lines: [{ description: "Widget", quantity: 1, unitPrice: 100, vatRate: 0.05, originalLineId: lineId }] },
  });
  ok("partial restocking credit note created", cn3.status === 201, cn3.text.slice(0, 300));
  const prod3 = await E.getProduct(r.id);
  const bal3 = await E.balances();
  ok("partial restock: 1 unit back, COGS 120 stands", prod3.currentStock === 7 && bal3["5200"] === 120 && bal3["1070"] === 280, { stock: prod3.currentStock, bal: bal3 });
}

async function quoteConversion() {
  const C = await newCompany("costI");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const q = await api("POST", `/api/companies/${C.cid}/quotes`, {
    token: C.token,
    body: { customerName: "Buyer", date: today, expiryDate: today, lines: [{ description: "Widget", quantity: 2, unitPrice: 100, vatRate: 0.05, productId: p.id }] },
  });
  if (!q.json?.id) { ok("quote created", false, q.text.slice(0, 300)); return; }
  const ql = (await db.query(`SELECT product_id FROM quote_lines WHERE quote_id = $1`, [q.json.id])).rows[0];
  ok("quote line keeps product_id", ql?.product_id === p.id, ql);
  const conv = await api("POST", `/api/quotes/${q.json.id}/convert-to-invoice`, { token: C.token, body: {} });
  const invId = conv.json?.invoice?.id;
  const il = invId ? (await db.query(`SELECT product_id FROM invoice_lines WHERE invoice_id = $1`, [invId])).rows[0] : null;
  ok("quote conversion copies product_id", conv.status === 200 && il?.product_id === p.id, { status: conv.status, il });
}

async function onDemandAccountAndRace() {
  // An older chart without 5200: the account is created on demand when COGS first posts.
  const C = await newCompany("costJ");
  await C.setCosting(true);
  await db.query(`DELETE FROM accounts WHERE company_id = $1 AND code = '5200'`, [C.cid]);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 5, unitCost: "40" });
  const a = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  const b = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  const [ra, rb] = await Promise.all([C.issue(a.id), C.issue(b.id)]);
  const statuses = [ra.status, rb.status].sort();
  ok("two parallel issues of the same stock: one wins, one is 422", statuses[0] === 200 && statuses[1] === 422, statuses);
  const acct = (await db.query(`SELECT is_system_account, type FROM accounts WHERE company_id = $1 AND code = '5200'`, [C.cid])).rows;
  ok("5200 created on demand as a system expense account", acct.length === 1 && acct[0].is_system_account && acct[0].type === "expense", acct);
  const prod = await C.getProduct(p.id);
  const bal = await C.balances();
  ok("stock is 0 (never negative) and COGS is posted once (200)", prod.currentStock === 0 && bal["5200"] === 200, { stock: prod.currentStock, bal });
}

// A line naming another company's product is a 400 INVALID_PRODUCT everywhere a line is saved,
// never a sale whose COGS is silently skipped.
async function foreignProductRejected() {
  const A = await newCompany("prodA");
  const B = await newCompany("prodB");
  await A.setCosting(true);
  const foreign = await B.product();
  const own = await A.product();
  const line = (productId) => ({ description: "Widget", quantity: 1, unitPrice: 100, vatRate: 0.05, productId });
  const mine = await A.draftInvoice([line(own.id)]);

  const create = await api("POST", `/api/companies/${A.cid}/invoices`, {
    token: A.token, body: { customerName: "Buyer", date: today, dueDate: today, lines: [line(foreign.id)] },
  });
  ok("invoice create with another company's product is 400 INVALID_PRODUCT", create.status === 400 && create.json?.code === "INVALID_PRODUCT", create.text.slice(0, 200));
  const update = await api("PUT", `/api/invoices/${mine.id}`, {
    token: A.token, body: { customerName: "Buyer", date: today, dueDate: today, lines: [line(foreign.id)] },
  });
  ok("invoice update with another company's product is 400 INVALID_PRODUCT", update.status === 400 && update.json?.code === "INVALID_PRODUCT", update.text.slice(0, 200));
  const stillOwn = (await db.query(`SELECT product_id FROM invoice_lines WHERE invoice_id = $1`, [mine.id])).rows;
  ok("rejected update left the invoice lines untouched", stillOwn.length === 1 && stillOwn[0].product_id === own.id, stillOwn);

  const qBody = (productId) => ({ customerName: "Buyer", date: today, expiryDate: today, lines: [line(productId)] });
  const qCreate = await api("POST", `/api/companies/${A.cid}/quotes`, { token: A.token, body: qBody(foreign.id) });
  ok("quote create with another company's product is 400 INVALID_PRODUCT", qCreate.status === 400 && qCreate.json?.code === "INVALID_PRODUCT", qCreate.text.slice(0, 200));
  const goodQuote = await api("POST", `/api/companies/${A.cid}/quotes`, { token: A.token, body: qBody(own.id) });
  ok("quote with the company's own product is accepted", goodQuote.status === 201, goodQuote.text.slice(0, 200));
  const qUpdate = await api("PUT", `/api/quotes/${goodQuote.json?.id}`, { token: A.token, body: qBody(foreign.id) });
  ok("quote update with another company's product is 400 INVALID_PRODUCT", qUpdate.status === 400 && qUpdate.json?.code === "INVALID_PRODUCT", qUpdate.text.slice(0, 200));
}

// Voiding a credit note that restocked takes the units back out (sale movements) and re-posts the
// COGS it reversed, dated the void date; refused when those units were sold again.
async function voidCreditNoteUndoesRestock() {
  const C = await newCompany("cnvoid");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "40" });
  await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "60" });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  await C.issue(inv.id);
  ok("setup: stock 15 after issuing 5 units", (await C.getProduct(p.id)).currentStock === 15, null);
  const cn = await api("POST", `/api/companies/${C.cid}/invoices/${inv.id}/credit-note`, { token: C.token, body: { restock: true } });
  ok("setup: restocking credit note created", cn.status === 201, cn.text.slice(0, 200));
  const cnId = cn.json?.creditNote?.id ?? cn.json?.id;
  const afterCn = await C.getProduct(p.id);
  const balAfterCn = await C.balances();
  ok("setup: restock put stock back to 20 and COGS to 0", afterCn.currentStock === 20 && (balAfterCn["5200"] ?? 0) === 0, { stock: afterCn.currentStock, bal: balAfterCn });

  const v = await api("PATCH", `/api/invoices/${cnId}/status`, { token: C.token, body: { status: "void" } });
  ok("voiding the restocking credit note succeeds", v.status === 200, v.text.slice(0, 300));
  const prod = await C.getProduct(p.id);
  ok("void: stock back to 15", prod.currentStock === 15, prod.currentStock);
  ok("void: average cost unchanged at 50", n(prod.averageCost) === 50, prod.averageCost);
  const bal = await C.balances();
  ok("void: COGS journals net to the original 250 (5200 Dr 250 / 1070 Cr 250)", bal["5200"] === 250 && bal["1070"] === 750, bal);
  const entries = await C.cogsEntries();
  const undo = entries.find((e) => e.source_id === cnId && e.reversed_entry_id && entries.some((r) => r.id === e.reversed_entry_id && r.source_id === cnId));
  // The invoice was issued today, so the void date is the original COGS journal's date (same UAE day).
  const today0 = new Date(entries.find((e) => !e.reversed_entry_id).date).getTime();
  ok("void: an undo COGS journal exists, dated the void date", !!undo && new Date(undo.date).getTime() === today0, entries.map((e) => ({ id: e.id, src: e.source_id, rev: e.reversed_entry_id, date: e.date })));
  const sales = (prod.movements ?? []).filter((m) => m.type === "sale");
  ok("void: a second sale movement of 5 at cost 50 was recorded", sales.length === 2 && sales.every((m) => m.quantity === 5 && n(m.unitCost) === 50), sales);

  // The invoice's own void still reverses exactly what stands (250), landing 5200 / 1070 on zero.
  const vi = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } });
  const balAfterInvoiceVoid = await C.balances();
  ok("invoice void after credit note void returns the stock and zeroes COGS",
    vi.status === 200 && (balAfterInvoiceVoid["5200"] ?? 0) === 0 && balAfterInvoiceVoid["1070"] === 1000 && (await C.getProduct(p.id)).currentStock === 20,
    { status: vi.status, bal: balAfterInvoiceVoid });

  // Restocked units sold again: voiding the credit note would drive stock negative -> 409.
  const D = await newCompany("cnvoid2");
  await D.setCosting(true);
  const q = await D.product();
  await D.movement(q.id, { type: "purchase", quantity: 10, unitCost: "40" });
  const inv2 = await D.draftInvoice([{ description: "Widget", quantity: 5, unitPrice: 100, vatRate: 0.05, productId: q.id }]);
  await D.issue(inv2.id);
  const cn2 = await api("POST", `/api/companies/${D.cid}/invoices/${inv2.id}/credit-note`, { token: D.token, body: { restock: true } });
  const cn2Id = cn2.json?.creditNote?.id ?? cn2.json?.id;
  const inv3 = await D.draftInvoice([{ description: "Widget", quantity: 8, unitPrice: 100, vatRate: 0.05, productId: q.id }]);
  const sold = await D.issue(inv3.id);
  ok("setup: the restocked units were sold again (stock 2)", sold.status === 200 && (await D.getProduct(q.id)).currentStock === 2, sold.text.slice(0, 200));
  const before = { bal: await D.balances(), entries: (await D.cogsEntries()).length };
  const refused = await api("PATCH", `/api/invoices/${cn2Id}/status`, { token: D.token, body: { status: "void" } });
  ok("void refused with 409 STOCK_ALREADY_CONSUMED", refused.status === 409 && refused.json?.code === "STOCK_ALREADY_CONSUMED", refused.text.slice(0, 300));
  const status = (await db.query(`SELECT status FROM invoices WHERE id = $1`, [cn2Id])).rows[0]?.status;
  const after = { bal: await D.balances(), entries: (await D.cogsEntries()).length };
  ok("refused void changed nothing (status, stock, ledger)",
    status !== "void" && (await D.getProduct(q.id)).currentStock === 2 && JSON.stringify(before) === JSON.stringify(after), { status, before, after });
}

// Plan usage caps (checkUsageLimit): without BILLING_ENFORCEMENT a free-plan company keeps creating
// invoices past the 20-a-month cap; the request is only flagged.
async function usageCapsAreObserveOnly() {
  const C = await newCompany("usage");
  const line = [{ description: "Service", quantity: 1, unitPrice: 10, vatRate: 0.05 }];
  const body = { customerName: "Buyer", date: today, dueDate: today, lines: line };
  const first = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body });
  ok("usage: first invoice created", first.status === 200 || first.status === 201, first.text.slice(0, 200));
  // Put the company on the free plan (the lazily created trial would otherwise lift the cap).
  const upd = await db.query(`UPDATE subscriptions SET plan_id = 'free', status = 'active', trial_ends_at = NULL WHERE company_id = $1`, [C.cid]);
  ok("usage: company is on the free plan", upd.rowCount === 1, upd.rowCount);
  let created = 1, last = first;
  for (let i = 0; i < 21; i++) {
    last = await api("POST", `/api/companies/${C.cid}/invoices`, { token: C.token, body });
    if (last.status === 200 || last.status === 201) created++;
  }
  ok("usage: a free company can create more than the 20-a-month cap (22 created) when billing is not enforced", created === 22, { created, last: last.text.slice(0, 200) });
  ok("usage: past the cap the response is only flagged (X-Billing-Would-Block)", last.headers.get("x-billing-would-block") === "usage:invoices", last.headers.get("x-billing-would-block"));
}


// Account 1070 equals stock x average to the cent after every kind of movement.
async function ledgerTieOut() {
  const C = await newCompany("tie");
  await C.setCosting(true);
  const p = await C.product();
  const tied = async (label) => {
    const prod = await C.getProduct(p.id);
    const bal = await C.balances();
    const expected = Math.round(prod.currentStock * n(prod.averageCost) * 100) / 100;
    ok(`tie-out after ${label}: 1070 (${bal["1070"]}) = stock x average (${expected}) = inventory_value (${prod.inventoryValue})`,
      Math.abs((bal["1070"] ?? 0) - expected) < 0.005 && Math.abs((bal["1070"] ?? 0) - n(prod.inventoryValue)) < 0.005, { bal1070: bal["1070"], expected, value: prod.inventoryValue });
    return bal;
  };
  let r = await C.movement(p.id, { type: "purchase", quantity: 10, unitCost: "100" });
  ok("tie-out: purchase accepted", r.status === 200, r.text.slice(0, 200));
  let bal = await tied("purchase 10 @ 100");
  ok("purchase posts Dr 1070 / Cr 2015 (GRNI) 1,000", bal["1070"] === 1000 && bal["2015"] === -1000, bal);

  r = await C.movement(p.id, { type: "adjustment", quantity: 2, unitCost: "90" });
  bal = await tied("adjustment +2 @ 90");
  ok("adjustment in posts Dr 1070 / Cr 5210 180", bal["1070"] === 1180 && bal["5210"] === -180, bal);

  const inv = await C.draftInvoice([{ description: "Widget", quantity: 4, unitPrice: 200, vatRate: 0.05, productId: p.id }]);
  const issued = await C.issue(inv.id);
  ok("tie-out: invoice of 4 issued", issued.status === 200, issued.text.slice(0, 200));
  bal = await tied("invoice sale of 4");
  ok("invoice COGS 393.33 (4 x 98.333333)", bal["5200"] === 393.33, bal);

  r = await C.movement(p.id, { type: "sale", quantity: 1 });
  ok("tie-out: manual sale accepted", r.status === 200, r.text.slice(0, 200));
  bal = await tied("manual sale of 1");
  ok("manual sale posts Dr 5200 / Cr 1070 at the average (98.33)", bal["5200"] === 491.66, bal);

  r = await C.movement(p.id, { type: "return", quantity: 1 });
  ok("tie-out: manual return accepted", r.status === 200, r.text.slice(0, 200));
  bal = await tied("manual return of 1");
  ok("manual return posts Dr 1070 / Cr 5200 at the average (98.33)", bal["5200"] === 393.33, bal);

  r = await C.movement(p.id, { type: "adjustment", quantity: -3 });
  bal = await tied("adjustment -3");
  ok("adjustment out posts Dr 5210 / Cr 1070 3 x average (295.00): 5210 nets -180 + 295 = 115", r.status === 200 && bal["5210"] === 115, bal);
  ok("2015 stays at the 1,000 received (the vendor bill coded to 2015 clears it)", bal["2015"] === -1000, bal);

  const movJournals = (await db.query(`SELECT source, status FROM journal_entries WHERE company_id = $1 AND source = 'inventory_movement'`, [C.cid])).rows;
  ok("movement journals are system-owned entries of source inventory_movement", movJournals.length === 5 && movJournals.every((j) => j.status === "posted"), movJournals);
  const je = (await db.query(`SELECT id FROM journal_entries WHERE company_id = $1 AND source = 'inventory_movement' LIMIT 1`, [C.cid])).rows[0];
  const rev = await api("POST", `/api/journal/${je.id}/reverse`, { token: C.token, body: {} });
  ok("a movement journal cannot be reversed from the journal screen (409)", rev.status === 409, { s: rev.status, j: rev.json });

  // 2015 clears when the vendor bill is coded to it.
  const acct = ((await api("GET", `/api/companies/${C.cid}/accounts`, { token: C.token })).json ?? []).find((a) => a.code === "2015");
  ok("account 2015 Goods Received Not Invoiced exists as a liability", acct?.type === "liability", acct);
  const bill = await api("POST", `/api/companies/${C.cid}/bills`, { token: C.token, body: { vendor_name: "Supplier", bill_date: today, due_date: today, currency: "AED", line_items: [{ description: "Widgets", quantity: 1, unit_price: 1000, vat_rate: 0, account_id: acct.id }] } });
  const ap = await api("POST", `/api/bills/${bill.json?.id}/approve`, { token: C.token, body: {} });
  bal = await C.balances();
  ok("the vendor bill coded to 2015 clears it to zero", [200, 201].includes(ap.status) && (bal["2015"] ?? 0) === 0, { s: ap.status, bal });
}

// 3 units at 3.333333 sold one at a time cost exactly 10.00 in total, not 9.99.
async function roundingResidue() {
  const C = await newCompany("round");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 3, unitCost: "3.333333" });
  for (let k = 0; k < 3; k++) {
    const inv = await C.draftInvoice([{ description: "W", quantity: 1, unitPrice: 10, vatRate: 0.05, productId: p.id }]);
    const r = await C.issue(inv.id);
    if (r.status !== 200) ok("rounding: invoice issue " + k, false, r.text.slice(0, 200));
  }
  const bal = await C.balances();
  const prod = await C.getProduct(p.id);
  ok("rounding: total COGS is exactly 10.00 and inventory lands on 0.00", bal["5200"] === 10 && (bal["1070"] ?? 0) === 0 && prod.currentStock === 0 && n(prod.inventoryValue) === 0, { bal, stock: prod.currentStock, value: prod.inventoryValue });
}

// Switching costing on posts the stock already held: Dr 1070 / Cr Opening Balance Equity.
async function openingJournal() {
  const C = await newCompany("open");
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 5, unitCost: "20" });
  ok("opening: with the setting off a purchase posts nothing", Object.keys(await C.balances()).length === 0, await C.balances());
  await C.setCosting(true);
  let bal = await C.balances();
  const entries = (await db.query(`SELECT id, source, date FROM journal_entries WHERE company_id = $1 AND source = 'inventory_opening'`, [C.cid])).rows;
  ok("opening: switching on posts one inventory_opening journal dated today", entries.length === 1 && String(entries[0].date).length > 0, entries);
  const lines = (await db.query(`SELECT a.code, a.type, jl.debit, jl.credit FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.entry_id = $1`, [entries[0]?.id])).rows;
  ok("opening: Dr 1070 100 / Cr Opening Balance Equity 100", lines.some((l) => l.code === "1070" && n(l.debit) === 100) && lines.some((l) => l.type === "equity" && n(l.credit) === 100), lines);
  ok("opening: 1070 = stock x average = 100", bal["1070"] === 100, bal);
  await C.setCosting(true);
  ok("opening: switching on again posts nothing more", (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'inventory_opening'`, [C.cid])).rows[0].c === 1, null);

  // a product that starts being tracked while it holds stock, with the setting on
  const u = await C.product({ trackInventory: false });
  await C.movement(u.id, { type: "purchase", quantity: 4, unitCost: "10" });
  const pr = await api("PATCH", `/api/products/${u.id}`, { token: C.token, body: { trackInventory: true } });
  bal = await C.balances();
  ok("opening: tracking a product that holds stock journals its stock value (140 in total)", pr.status === 200 && bal["1070"] === 140, { s: pr.status, bal });
}

// A tracked product holding stock at an unknown cost cannot be invoiced.
async function costUnknownRefused() {
  const C = await newCompany("unk");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 5 });
  const inv = await C.draftInvoice([{ description: "Widget", quantity: 2, unitPrice: 50, vatRate: 0.05, productId: p.id }]);
  const r = await C.issue(inv.id);
  ok("cost unknown: issue refused with 422 PRODUCT_COST_UNKNOWN", r.status === 422 && r.json?.code === "PRODUCT_COST_UNKNOWN", { s: r.status, t: r.text.slice(0, 200) });
  const status = (await db.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0]?.status;
  const posted = (await db.query(`SELECT count(*)::int AS c FROM journal_entries WHERE company_id = $1`, [C.cid])).rows[0].c;
  ok("cost unknown: nothing posted, invoice still draft, stock untouched", status === "draft" && posted === 0 && (await C.getProduct(p.id)).currentStock === 5, { status, posted });
}

// A product with movements is part of the books: deactivate it instead.
async function productWithMovementsCannotBeDeleted() {
  const C = await newCompany("del");
  await C.setCosting(true);
  const p = await C.product();
  await C.movement(p.id, { type: "purchase", quantity: 5, unitCost: "50" });
  const inv = await C.draftInvoice([{ description: "W", quantity: 2, unitPrice: 100, vatRate: 0.05, productId: p.id }]);
  await C.issue(inv.id);
  const del = await api("DELETE", `/api/products/${p.id}`, { token: C.token });
  ok("delete: a product with movements is refused (409 PRODUCT_HAS_MOVEMENTS)", del.status === 409 && del.json?.code === "PRODUCT_HAS_MOVEMENTS", { s: del.status, j: del.json });
  ok("delete: the product still exists", (await C.getProduct(p.id))?.id === p.id, null);
  const v = await api("PATCH", `/api/invoices/${inv.id}/status`, { token: C.token, body: { status: "void" } });
  const bal = await C.balances();
  ok("delete: voiding the invoice afterwards still reverses its COGS and returns the stock", v.status === 200 && (bal["5200"] ?? 0) === 0 && bal["1070"] === 250 && (await C.getProduct(p.id)).currentStock === 5, { s: v.status, bal });
  const fresh = await C.product();
  const del2 = await api("DELETE", `/api/products/${fresh.id}`, { token: C.token });
  ok("delete: a product without movements can be deleted", del2.status === 200, { s: del2.status, j: del2.json });
}

main().catch((e) => { console.error(e); process.exit(1); });