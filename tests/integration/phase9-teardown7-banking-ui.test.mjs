// Browser tests for the Teardown 7 banking UI (v4): exchange-rate fields on receipts, the credit card account type,
// "Revalue at closing rate" and its month-end item, the disposal dialog with VAT and a computed gain, asset linking, the
// closed-period message, Arabic labels and 375 px.
//   BASE_URL=http://localhost:5076 DATABASE_URL=... node tests/integration/phase9-teardown7-banking-ui.test.mjs
// Skipped when playwright-core or a browser is not available.

import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:5000";
const DB_URL = process.env.DATABASE_URL;
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; fails.push(name + "  :: " + JSON.stringify(detail)); console.log("FAIL  " + name + "  " + JSON.stringify(detail)); }
}
const skip = (name, why) => console.log("SKIP  " + name + "  (" + why + ")");
async function api(method, p, { body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const rnd = Math.random().toString(36).slice(2, 8);
const n = (v) => Number(v ?? 0);
const close = (a, b, tol = 0.005) => Math.abs(n(a) - n(b)) <= tol;
const ymd = (d) => d.toISOString().slice(0, 10);
const day = (offset) => ymd(new Date(Date.now() + offset * 86400000));
const today = day(0);
const amountOf = (t) => (String(t).includes("-") ? -1 : 1) * Math.abs(Number(String(t).replace(/[^0-9.]/g, "")));
let db;

async function main() {
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  let chromium;
  try { ({ chromium } = await import("playwright-core")); } catch { skip("t7 UI", "playwright-core is not installed"); await db.end(); return; }
  let browser;
  try { browser = await chromium.launch({ headless: true }); } catch (e) { skip("t7 UI", "no browser: " + String(e.message).split("\n")[0].slice(0, 80)); await db.end(); return; }
  try { await run(browser); } finally { await browser.close(); await db.end(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n" + fails.join("\n")); process.exit(1); }
}

async function run(browser) {
  // ── setup through the API: a company with an AED bank, a USD bank and a USD invoice ──
  const label = "t7ui";
  const reg = await api("POST", "/api/auth/register", { body: { name: label, email: `${label}_${rnd}@example.com`, password: "Password123!" } });
  const token = reg.json.token, cid = reg.json.company.id, email = `${label}_${rnd}@example.com`;
  await api("PATCH", `/api/companies/${cid}`, { token, body: { trnVatNumber: "100123456700003", vatRegistered: true, emirate: "dubai" } });
  await db.query(`UPDATE companies SET onboarding_completed = true WHERE id = $1`, [cid]);
  await api("PATCH", "/api/onboarding", { token, body: { showTour: false } });
  const post = (p, body) => api("POST", p, { token, body });
  const get = (p) => api("GET", p, { token });
  const accounts = (await get(`/api/companies/${cid}/accounts`)).json;
  const acct = (c) => accounts.find((a) => a.code === c);
  const aed = (await post(`/api/companies/${cid}/bank-accounts`, { nameEn: "ADCB Current", bankName: "ADCB", currency: "AED", createLedgerAccount: true })).json;
  const usd = (await post(`/api/companies/${cid}/bank-accounts`, { nameEn: "ADCB USD", bankName: "ADCB", currency: "USD", createLedgerAccount: true })).json;
  await post(`/api/companies/${cid}/journal`, { date: day(-90), status: "posted", confirmBackdated: true, memo: "Opening", lines: [{ accountId: aed.glAccountId, debit: 300000, credit: 0 }, { accountId: acct("3010")?.id ?? acct("3000").id, debit: 0, credit: 300000 }] });
  const rate = (date, value) => post(`/api/companies/${cid}/exchange-rates`, { fromCurrency: "USD", toCurrency: "AED", rate: value, effectiveDate: date });
  await rate(day(-40), 3.6725);
  await rate(today, 3.6735);
  const inv = await post(`/api/companies/${cid}/invoices`, { customerName: "Falcon Exports", date: day(-30), dueDate: day(10), currency: "USD", exchangeRate: 3.6725, lines: [{ description: "Export", quantity: 1, unitPrice: 5000, vatRate: 0 }] });
  await api("PATCH", `/api/invoices/${inv.json?.id}/status`, { token, body: { status: "sent" } });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (c) => { await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) }); }, { email, password: "Password123!" });
  const dismiss = async (pg) => { const b = pg.locator("[data-testid=button-skip-onboarding]"); if (await b.isVisible({ timeout: 1500 }).catch(() => false)) { await b.click(); await b.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {}); } };
  const open = async (path, pg = page) => { await pg.goto(BASE + path, { waitUntil: "domcontentloaded" }); await pg.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await dismiss(pg); };
  const pick = async (trigger, name) => { await page.locator(trigger).click(); await page.getByRole("option", { name }).first().click(); };

  // 4: a credit card is a liability
  await open("/bank-reconciliation");
  await page.locator("[data-testid=tab-bank-accounts]").click();
  await page.locator("[data-testid=button-add-bank-account]").click();
  await pick("[data-testid=select-bank-kind]", /Credit card/);
  await page.locator("[data-testid=input-bank-name]").fill("ADCB Visa");
  await pick("[data-testid=select-bank-bank]", "ADCB");
  await page.locator("[data-testid=button-save-bank-account]").click();
  await page.waitForTimeout(1500);
  const card = (await db.query(`SELECT a.type, a.code FROM bank_accounts ba JOIN accounts a ON a.id = ba.gl_account_id WHERE ba.company_id = $1 AND ba.name_en = 'ADCB Visa'`, [cid])).rows[0];
  ok("t7-11 UI: a credit card can be added from the screen and its ledger account is a LIABILITY (2xxx)", card?.type === "liability" && /^2\d{3}$/.test(card.code), card);
  await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {}); await page.locator("[data-testid=tab-bank-accounts]").click();
  const panelText = await page.locator("[data-testid=bank-accounts-panel]").innerText();
  ok("t7-11 UI: the account list says it is a credit card", /Credit card/.test(panelText), panelText.slice(0, 900));

  // 1: the receipt dialog for a USD invoice: rate defaulted from the rate on file, editable, with the gain
  await open("/invoices");
  const row = page.locator(`[data-testid="row-invoice-${inv.json.id}"], tr:has-text("Falcon Exports")`).first();
  await page.getByRole("button", { name: /record payment/i }).first().click().catch(async () => {
    await page.locator(`[data-testid=button-add-payment-${inv.json.id}]`).first().click();
  });
  await page.locator("[data-testid=invoice-payment-fx-field]").waitFor({ timeout: 10000 });
  const defaultRate = await page.locator("[data-testid=invoice-payment-fx-rate]").inputValue();
  ok("t7-1 UI: a USD invoice's receipt dialog shows the exchange rate, defaulted from the rates on file for the day", Math.abs(Number(defaultRate) - 3.6735) < 1e-9, defaultRate);
  await page.locator('[role=dialog] input[type=number]').first().fill("5000");
  await page.waitForTimeout(500);
  const gl = await page.locator("[data-testid=invoice-payment-fx-preview]").getAttribute("data-gain-loss");
  ok("t7-1 UI: it shows the realised exchange gain before posting (USD 5,000 at 3.6735 against 3.6725 = AED 5.00)", close(gl, 5), gl);
  await page.locator("[data-testid=invoice-payment-fx-rate]").fill("3.6715");
  await page.waitForTimeout(300);
  ok("t7-1 UI: the rate is editable and the preview follows (a lower rate is a loss of AED 5.00)", close(await page.locator("[data-testid=invoice-payment-fx-preview]").getAttribute("data-gain-loss"), -5));
  await page.locator("[data-testid=invoice-payment-fx-rate]").fill("3.6735");
  await page.getByRole("combobox").filter({ hasText: /select account/i }).first().click().catch(() => {});
  const depositOptions = await page.getByRole("option").allInnerTexts();
  ok("t7-9 UI: the deposit account list offers the bank accounts by name (ADCB USD, ADCB Current)", depositOptions.some((t) => /ADCB USD/.test(t)) && depositOptions.some((t) => /ADCB Current/.test(t)) && !depositOptions.some((t) => /^1020\b/.test(t.trim())), depositOptions);
  await page.getByRole("option", { name: /ADCB USD/ }).first().click();
  await page.getByRole("button", { name: /^record payment$/i }).last().click();
  await page.waitForTimeout(2000);
  const fx4090 = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0)::float8 AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND a.code = '4090'`, [cid])).rows[0].c;
  ok("t7-1 UI: posting books the realised gain (4090 = 5.00)", close(fx4090, 5), fx4090);

  // 2: revalue a foreign bank account at the closing rate
  const usdGl = usd.glAccountId;
  await post(`/api/companies/${cid}/bank-statements/import`, { bankAccountId: usd.id, format: "csv", content: ["Date,Description,Debit,Credit,Balance", `${day(-40)},USD DEPOSIT,,1000.00,1000.00`].join("\n") });
  const usdLine = (await get(`/api/companies/${cid}/bank-statements/transactions?bankAccountId=${usd.id}`)).json.find((t) => /DEPOSIT/.test(t.description));
  const create = await post(`/api/companies/${cid}/bank-statements/${usdLine.id}/create-entry`, { accountId: acct("4010").id });
  ok("t7-2 setup: a USD 1,000 deposit is booked at the rate of its day", create.status === 201, create.json);
  await open("/bank-reconciliation");
  await page.locator("[data-testid=tab-bank-accounts]").click();
  await page.locator(`[data-testid=button-revalue-${usd.id}]`).click();
  await page.locator("[data-testid=revalue-preview]").waitFor({ timeout: 10000 });
  await page.locator("[data-testid=input-revalue-rate]").fill("3.74");
  await page.waitForTimeout(1200);
  const diff = amountOf(await page.locator("[data-testid=revalue-preview]").getAttribute("data-difference"));
  ok("t7-2 UI: the revaluation dialog previews the difference: USD 6,000 at 3.74 against 22,040 on the books (a gain of 400)", close(diff, 400, 1), diff);
  await page.locator("[data-testid=button-post-revalue]").click();
  await page.waitForTimeout(1800);
  const rv = (await db.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE company_id = $1 AND source = 'fx_revaluation_bank'`, [cid])).rows[0].c;
  ok("t7-2 UI: posting writes one revaluation journal", rv === 1, rv);
  await page.locator(`[data-testid=button-revalue-${usd.id}]`).click();
  await page.locator("[data-testid=revalue-preview]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  ok("t7-2 UI: a second run for the same day says it is already posted and cannot be posted again", await page.locator("[data-testid=button-post-revalue]").isDisabled() && /JE-/.test(await page.locator("[data-testid=revalue-already-posted]").innerText().catch(() => "")));
  await page.keyboard.press("Escape");

  // reconciliation: the revaluation reads as a rate difference, not a deposit in transit
  await page.getByRole("tab", { name: "Reconciliation" }).click();
  await page.locator("[data-testid=select-recon-account]").click();
  await page.getByRole("option", { name: /ADCB USD/ }).click();
  await page.waitForTimeout(1500);
  const items = await page.locator("[data-testid=reconciliation-items]").innerText();
  ok("t7-2 UI: the revaluation journal is not listed as an unreconciled item on the USD reconciliation", !/revaluation/i.test(items), items.slice(0, 200));

  // 2: the month-end item opens the revaluation
  const pmEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0));
  const pmStart = new Date(Date.UTC(pmEnd.getUTCFullYear(), pmEnd.getUTCMonth(), 1));
  await rate(ymd(pmEnd), 3.7);
  await open("/month-end");
  await page.waitForTimeout(1500);
  const detail = page.locator("[data-testid=checklist-detail-8]");
  ok("t7-2 UI: the month-end checklist has the foreign-currency revaluation item", (await detail.count()) === 1, await page.locator("body").innerText().then((t) => t.slice(0, 120)));
  const revBtn = page.locator(`[data-testid=button-revalue-checklist-${usd.id}]`);
  if (await revBtn.count()) {
    await revBtn.click();
    await page.locator("[data-testid=revalue-dialog]").waitFor({ timeout: 8000 });
    ok("t7-2 UI: the item's button opens the revaluation for that account at the month end", (await page.locator("[data-testid=input-revalue-asof]").inputValue()) === ymd(pmEnd), await page.locator("[data-testid=input-revalue-asof]").inputValue());
    await page.keyboard.press("Escape");
  } else {
    skip("t7-2 UI: the item's button", "the previous month is already revalued or has no difference");
  }

  // 3: fixed assets: the disposal dialog with VAT and the computed gain
  const van = (await post(`/api/companies/${cid}/fixed-assets`, { assetName: "Delivery Van", category: "Vehicles", purchaseDate: day(-120), purchaseCost: 84000, salvageValue: 8400, usefulLifeYears: 4, paymentAccountId: aed.glAccountId })).json;
  const vanId = (van?.asset ?? van)?.id;
  await open("/fixed-assets");
  await page.locator('button[title="Dispose"]').first().click();
  await page.locator("[data-testid=dispose-preview]").waitFor();
  await page.locator('input[type=number][step="0.01"]').first().fill("40000");
  await pick("[data-testid=select-disposal-vat]", /Standard rate/);
  await page.waitForTimeout(1500);
  const vatLine = await page.locator("[data-testid=dispose-vat]").innerText().catch(() => "");
  const gainText = await page.locator("[data-testid=dispose-gainloss]").getAttribute("data-value");
  ok("t7-5 UI: the dialog shows 5% VAT on the sale (AED 2,000) and the total from the buyer (42,000)", /2,000\.00/.test(vatLine) && /42,000\.00/.test(await page.locator("[data-testid=dispose-total]").innerText().catch(() => "")), vatLine);
  ok("t7-4 UI: and the computed gain or loss (proceeds less the book value at the disposal date)", gainText !== null && Number.isFinite(Number(gainText)) && Math.abs(Number(gainText)) > 0, gainText);
  await page.locator("[data-testid=input-disposal-buyer]").fill("Gulf Haulage LLC");
  await page.getByRole("button", { name: /^dispose asset$/i }).last().click();
  await page.waitForTimeout(2500);
  const out2020 = (await db.query(`SELECT COALESCE(SUM(jl.credit - jl.debit),0)::float8 AS c FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id JOIN accounts a ON a.id = jl.account_id WHERE je.company_id = $1 AND a.code = '2020'`, [cid])).rows[0].c;
  ok("t7-5 UI: posting the disposal puts the VAT on the sale into 2020 (2,000)", close(out2020, 2000), out2020);

  // 3: the register: linked vs unlinked
  const laptop = (await post(`/api/companies/${cid}/fixed-assets`, { assetName: "Forklift", category: "Equipment", purchaseDate: day(-100), purchaseCost: 12000, salvageValue: 0, usefulLifeYears: 5 })).json;
  const laptopId = (laptop?.asset ?? laptop)?.id;
  await open("/fixed-assets");
  await page.getByRole("tab", { name: /asset register/i }).click();
  await page.locator("[data-testid=register-totals]").waitFor({ timeout: 15000 });
  const unlinkedBtn = page.locator(`[data-testid=button-link-asset-${laptopId}]`);
  ok("t7-3 UI: the register marks an asset that is not tied to a document and offers 'Link to bill or journal'", (await unlinkedBtn.count()) === 1 && /Not linked/.test(await page.locator(`[data-testid=register-link-${laptopId}]`).innerText()));
  const probe = await api("POST", `/api/fixed-assets/${laptopId}/link`, { token, body: {} });
  if (probe.status === 404 && !probe.json) skip("t7-3 UI: linking", "the link route is not on this server yet");
  else {
    const bill = await post(`/api/companies/${cid}/bills`, { vendor_name: "Forklift Co", bill_number: "FK-1", bill_date: day(-100), due_date: day(-70), line_items: [{ description: "Forklift", quantity: 1, unit_price: 12000, vat_rate: 0, account_id: acct("1290").id }] });
    await post(`/api/bills/${bill.json?.id}/approve`, {});
    await unlinkedBtn.click();
    await page.locator("[data-testid=link-asset-dialog]").waitFor();
    await page.locator("[data-testid=select-link-bill]").click();
    await page.getByRole("option", { name: /FK-1/ }).click();
    await page.locator("[data-testid=button-link-asset]").click();
    await page.waitForTimeout(1800);
    ok("t7-3 UI: linking the asset to its bill ties it to the books (the row says Bill FK-1)", /FK-1/.test(await page.locator(`[data-testid=register-link-${laptopId}]`).innerText()), await page.locator(`[data-testid=register-link-${laptopId}]`).innerText());
  }

  // 3: a clear message for a locked period
  const lockMonth = ymd(new Date(Date.UTC(new Date().getUTCFullYear() - 1, 0, 1))).slice(0, 7);
  const lock = await post(`/api/companies/${cid}/month-end/lock-period`, { period: lockMonth, periodStart: `${lockMonth}-01`, periodEnd: `${lockMonth}-28` });
  if (lock.status >= 300) skip("t7-7 UI: the closed-period message", "could not lock a period here: " + lock.status);
  else {
    const probeAsset = await post(`/api/companies/${cid}/fixed-assets`, { assetName: "Probe", category: "Equipment", purchaseDate: `${lockMonth}-10`, purchaseCost: 1000, salvageValue: 0, usefulLifeYears: 5 });
    await open("/fixed-assets");
    await page.getByRole("button", { name: /add asset/i }).first().click();
    const dlg = page.locator("[role=dialog]");
    await dlg.locator("input").first().fill("Old Truck");
    await dlg.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await dlg.locator('input[type=date]').first().fill(`${lockMonth}-10`);
    const nums = dlg.locator("input[type=number]");
    await nums.nth(0).fill("5000");
    await dlg.getByRole("button", { name: /^(add asset|save|create)/i }).last().click();
    await page.getByText(/Nothing was posted there/).first().waitFor({ timeout: 10000 }).catch(() => {});
    const msg = await page.getByText(/Nothing was posted there/).first().innerText().catch(() => "");
    ok("t7-7 UI: adding an asset in a locked period says so (registered, nothing posted there, depreciation caught up later) instead of silence", /locked period|closed financial year/.test(msg) && /Nothing was posted there/.test(msg), { msg });
    // with a payment account the capitalization journal cannot post there: the form says why
    await page.getByRole("button", { name: /add asset/i }).first().click();
    const dlg2 = page.locator("[role=dialog]");
    await dlg2.locator("input").first().fill("Old Truck 2");
    await dlg2.getByRole("combobox").first().click();
    await page.getByRole("option").first().click();
    await dlg2.locator("input[type=date]").first().fill(`${lockMonth}-10`);
    await dlg2.locator("input[type=number]").nth(0).fill("5000");
    const payBox = dlg2.getByRole("combobox").filter({ hasText: /payment|account|none/i });
    if (await payBox.count()) {
      await payBox.last().click();
      await page.getByRole("option", { name: /ADCB Current/ }).first().click().catch(() => {});
      await dlg2.getByRole("button", { name: /^(add asset|save|create)/i }).last().click();
      await page.locator("[data-testid=asset-form-error]").waitFor({ timeout: 10000 }).catch(() => {});
      const err = await page.locator("[data-testid=asset-form-error]").innerText().catch(() => "");
      ok("t7-7 UI: with a payment account in a locked period the form shows why it was refused", /lock|closed|period/i.test(err) && err.length > 20, { err });
    } else skip("t7-7 UI: payment account refusal", "no payment account picker on the add form");
  }

  ok("t7 UI: no uncaught page errors", errors.length === 0, errors.slice(0, 3));

  // 5: Arabic labels and 375 px
  const ar = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: "ar-AE" });
  await ar.addInitScript(() => localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 })));
  const ap = await ar.newPage();
  await ap.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await ap.evaluate(async (c) => { await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) }); }, { email, password: "Password123!" });
  await open("/dashboard", ap);
  for (const route of ["/bank-reconciliation", "/fixed-assets", "/month-end"]) {
    await open(route, ap);
    await ap.waitForTimeout(1200);
    const m = await ap.evaluate(() => ({ dir: document.documentElement.dir, ok: document.documentElement.scrollWidth <= window.innerWidth + 1, text: document.body.innerText }));
    ok(`t7-20 UI Arabic 375px ${route}: right-to-left and no horizontal scroll`, m.dir === "rtl" && m.ok, { dir: m.dir, ok: m.ok });
    if (route === "/bank-reconciliation") {
      await ap.locator("[data-testid=tab-bank-accounts]").click();
      await ap.locator(`[data-testid=button-revalue-${usd.id}]`).click();
      await ap.locator("[data-testid=revalue-dialog]").waitFor({ timeout: 10000 });
      await ap.waitForTimeout(800);
      const dm = await ap.evaluate(() => { const d = document.querySelector("[data-testid=revalue-dialog]"); return { fits: d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, text: d.innerText }; });
      ok("t7-20 UI Arabic 375px: the revaluation dialog fits and is in Arabic", dm.fits && !/Revalue|closing rate|Post/.test(dm.text), dm);
      await ap.keyboard.press("Escape");
    }
    if (route === "/fixed-assets") {
      await ap.locator("table button[title], table button[aria-label]").first().waitFor({ timeout: 8000 }).catch(() => {});
      const disposeBtn = ap.locator("[data-testid^=button-dispose-], button[title*='استبعاد'], button[title*='بيع']").first();
      if (await disposeBtn.count()) {
        await disposeBtn.click();
        await ap.locator("[data-testid=dispose-preview]").waitFor({ timeout: 8000 }).catch(() => {});
        const dd = await ap.evaluate(() => { const d = document.querySelector("[role=dialog]"); return d ? { fits: d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, text: d.innerText.slice(0, 400) } : null; });
        ok("t7-20 UI Arabic 375px: the disposal dialog fits", !!dd?.fits, dd);
        await ap.keyboard.press("Escape");
      } else skip("t7-20 disposal dialog at 375px", "no dispose button found by Arabic title");
    }
    if (route === "/fixed-assets") ok("t7-17 UI Arabic: the asset table has no 'NBV' header and no English dates", !/\bNBV\b/.test(m.text) && !/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b/.test(m.text), m.text.slice(0, 300));
    if (route === "/month-end") ok("t7-17 UI Arabic: the month-end checklist items are Arabic", /تسوية|ترحيل|إعادة تقييم/.test(m.text) && !/Bank Reconciliation Complete|All Invoices Posted|Depreciation Entries Posted/.test(m.text), m.text.slice(0, 300));
  }
  await ctx.close();
  await ar.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
