#!/usr/bin/env node
/**
 * Customer links end to end: the pages and e-mails a customer or approver actually receives.
 *
 *   BASE_URL=http://localhost:5052 DATABASE_URL=postgres://... node tests/e2e/customer-links-flow.mjs
 *
 * Needs a running app (production build) whose FRONTEND_URL and BASE_URL equal BASE_URL, no
 * e-mail provider (mail is read from the `email_outbox` table through DATABASE_URL) and no
 * payment gateway. For three set-ups (an English company, an Arabic company, an Arabic-preferring
 * contact of an English company) and two screens (iPhone 13, 1440x900) it registers a synthetic
 * company, creates a customer and an invoice, sends the invoice, a reminder, a quote, a statement
 * and an EmaraTax approval request, reads each message from the outbox, opens the links in a
 * signed-out browser and checks:
 *   - language: `<html lang dir>` of the pages and e-mails; no English text in Arabic pages and
 *     e-mails (names, numbers, brands and acronyms excepted, tests/e2e/lib/latin-text.mjs);
 *   - links: absolute in every e-mail and each one resolves;
 *   - pages: no console error (invalid/expired tokens may log the browser's own 404/410 line),
 *     no failed /api call on valid flows, no horizontal overflow, 44 px primary targets, one h1,
 *     a title, the invoice PDF downloads, the print view hides the controls, Pay is absent without
 *     a gateway, the page stays free of the signed-in app and of zod;
 *   - the EmaraTax approval page and its API show the company name only (no TRN) and approve;
 *   - invalid and expired invoice and approver links show their own localized state.
 *
 * Bad links are throttled per IP by the server (429 after about 20 in ten minutes): restart the
 * app between runs.
 *
 * Environment: BASE_URL (default http://localhost:5000), DATABASE_URL (required), SHOT_DIR (save
 * screenshots there), E2E_SCENARIOS (comma list of en,ar,en-ar-contact), E2E_VIEWPORTS
 * (phone,desktop), CHROMIUM_PATH. Exits 1 on any failed check.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "playwright-core";
import pg from "pg";
import { classifyLines } from "./lib/latin-text.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR || "";
const PW = "Fake-Password-123";
const TRN = "100123456700003";
const RUN = Math.random().toString(36).slice(2, 8);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (the e-mails are read from the outbox table).");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

const ALL_SCENARIOS = [
  { id: "en", companyLocale: "en", contactLang: null, lang: "en" },
  { id: "ar", companyLocale: "ar", contactLang: null, lang: "ar" },
  { id: "en-ar-contact", companyLocale: "en", contactLang: "ar", lang: "ar" },
];
const wantedScenarios = (process.env.E2E_SCENARIOS || "en,ar,en-ar-contact").split(",");
const SCENARIOS = ALL_SCENARIOS.filter((s) => wantedScenarios.includes(s.id));
const VIEWPORTS = (process.env.E2E_VIEWPORTS || "phone,desktop").split(",");

const failures = [];
const log = [];
let currentLabel = "";
function check(ok, message, detail) {
  const line = `${ok ? "ok  " : "FAIL"} [${currentLabel}] ${message}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`;
  log.push(line);
  console.log(line);
  if (!ok) failures.push(line);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function api(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

async function outbox(category, to) {
  for (let i = 0; i < 20; i++) {
    const { rows } = await db.query(
      `SELECT subject, html, text_body FROM email_outbox
        WHERE category = $1 AND to_address = $2 ORDER BY created_at DESC LIMIT 1`,
      [category, to]
    );
    if (rows[0]) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const htmlToLines = (html) =>
  html
    .replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|a)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const hrefsOf = (html) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

/** Assert one e-mail: language, absolute resolving links, no English in Arabic, no TRN. */
async function checkEmail(row, kind, scenario, allow, { expect, links = true }) {
  const label = `${kind} e-mail`;
  check(!!row, `${label} is in the outbox`);
  if (!row) return [];
  const lang = (row.html.match(/<html[^>]*\blang="([a-z]+)"/) || [])[1];
  if (expect === "ar") {
    check(
      lang === "ar" && /<html[^>]*dir="rtl"/.test(row.html),
      `${label}: html lang=ar dir=rtl`,
      lang
    );
    const english = [
      ...classifyLines([row.subject], allow).samples,
      ...classifyLines(htmlToLines(row.html), allow).samples,
      ...classifyLines(
        row.text_body
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        allow
      ).samples,
    ];
    check(
      english.length === 0,
      `${label}: no English text in the Arabic message`,
      english.slice(0, 5)
    );
  } else {
    check(
      row.html.includes('lang="en"') && row.html.includes('lang="ar"'),
      `${label}: both languages`
    );
  }
  check(!(row.html + row.text_body).includes(TRN), `${label}: no seller TRN`);
  const hrefs = hrefsOf(row.html).filter((h) => !/^(mailto:|tel:)/.test(h));
  // A statement travels as the attached PDF and has no link of its own.
  if (links) check(hrefs.length > 0, `${label}: has links`);
  const relative = hrefs.filter((h) => !/^https?:\/\//.test(h));
  check(relative.length === 0, `${label}: every link is absolute`, relative);
  const own = hrefs.filter((h) => h.startsWith(BASE));
  for (const url of new Set(own)) {
    const r = await fetch(url, { redirect: "follow" });
    check(
      r.status < 400,
      `${label}: link resolves (${new URL(url).pathname.slice(0, 22)}...)`,
      r.status
    );
  }
  const textLinks = row.text_body.match(/https?:\/\/[^\s)]+/g) || [];
  if (links) check(textLinks.length > 0, `${label}: plain-text part carries the link`);
  return own;
}

// ─── Pages ───────────────────────────────────────────────────────────────────

const LEAN_BAD = /vendor-forms|vendor-motion|vendor-socketio|\/App-|zod-config/;

async function shot(page, name) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${currentLabel.replace(/\s+/g, "-")}-${name}.png`),
    fullPage: true,
  });
}

/**
 * Open `url` in a fresh signed-out context and run the generic page checks.
 * opts: lang (expected html lang), allow (names), valid (no error responses allowed),
 *       lean (no signed-in app / zod), name (screenshot name), locale (browser language).
 */
async function openPage(browser, viewport, url, opts) {
  const base =
    viewport === "phone"
      ? { ...devices["iPhone 13"] }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({
    ...base,
    locale: opts.locale || "en-US",
    timezoneId: "Asia/Dubai",
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  const badApi = [];
  const requests = [];
  let jsBytes = 0;
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 240)));
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 240)}`));
  page.on("requestfailed", (r) =>
    badApi.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`)
  );
  page.on("response", async (r) => {
    const u = r.url().replace(BASE, "");
    requests.push(u);
    if (/\.js(\?|$)/.test(u)) jsBytes += Number(r.headers()["content-length"] || 0);
    if (u.startsWith("/api/") && r.status() >= 400) badApi.push(`${r.status()} ${u}`);
  });
  const response = await page.goto(BASE + url, { waitUntil: "load" });
  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => errors.push("NETWORK-NOT-IDLE"));
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    title: document.title,
    h1: document.querySelectorAll("h1").length,
    main: document.querySelectorAll("main").length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    // Visible text nodes outside elements marked as another language (the language switch).
    lines: (() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
        const own = el.closest("[lang]");
        if (own && !own.getAttribute("lang").startsWith(document.documentElement.lang)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const t = n.textContent.replace(/\s+/g, " ").trim();
        if (t) out.push(t);
      }
      return out;
    })(),
    html: document.body.innerHTML,
  }));
  const ignorable = opts.valid
    ? () => false
    : (e) => /Failed to load resource: the server responded with a status of (404|410)/.test(e);
  const realErrors = errors.filter((e) => !ignorable(e));
  const apiBad = opts.valid ? badApi : badApi.filter((e) => !/^(404|410) \/api\//.test(e));
  check(response?.ok(), `page status ${response?.status()}`);
  check(realErrors.length === 0, "0 console errors", realErrors);
  check(
    apiBad.length === 0,
    opts.valid ? "0 failed /api calls" : "no unexpected failed requests",
    apiBad
  );
  check(!info.overflow, "no horizontal overflow");
  check(info.lang === opts.lang, `html lang=${opts.lang}`, info.lang);
  check(
    info.dir === (opts.lang === "ar" ? "rtl" : "ltr"),
    `html dir=${opts.lang === "ar" ? "rtl" : "ltr"}`,
    info.dir
  );
  check(info.h1 === 1 && info.main === 1, "one h1 and one main landmark", {
    h1: info.h1,
    main: info.main,
  });
  check(!!info.title && !/AI-Assisted Accounting/.test(info.title), "own page title", info.title);
  if (opts.lang === "ar") {
    const english = classifyLines(info.lines, opts.allow || []).samples;
    check(english.length === 0, "no English text in the Arabic page", english.slice(0, 6));
  }
  if (opts.lean) {
    const heavy = requests.filter((u) => LEAN_BAD.test(u));
    check(heavy.length === 0, "no signed-in app, motion, socket or zod on the page", heavy);
    check(jsBytes < 330 * 1024, `light page (${(jsBytes / 1024).toFixed(0)} KB JS)`, jsBytes);
  }
  if (opts.name) await shot(page, opts.name);
  return { ctx, page, info, requests, jsBytes };
}

async function checkTargets(page, testIds) {
  for (const id of testIds) {
    const box = await page
      .locator(`[data-testid="${id}"]`)
      .first()
      .boundingBox()
      .catch(() => null);
    check(
      !!box && box.height >= 43.5,
      `${id} is at least 44 px tall`,
      box && Math.round(box.height)
    );
  }
}

// ─── One scenario on one screen ──────────────────────────────────────────────

async function runScenario(browser, scenario, viewport) {
  currentLabel = `${scenario.id} ${viewport}`;
  console.log(`\n=== ${currentLabel} ===`);
  const ar = scenario.lang === "ar";
  const email = `e2e+${RUN}${scenario.id}${viewport}@example.com`;
  const companyName =
    scenario.companyLocale === "ar" ? "شركة النور للتجارة" : "Al Noor Trading LLC";
  const customerName = "Desert Rose Catering LLC";
  const allow = [
    companyName,
    customerName,
    "Monthly accounting retainer",
    "Payroll setup",
    "Khalid Al Mansoori",
    "Platform ACube Technologies LLC",
    email,
  ];
  const reg = await api("POST", "/api/auth/register", null, {
    name: "E2E Owner",
    email,
    password: PW,
    companyName,
  });
  check(reg.status < 300, "register", reg.status);
  const login = await api("POST", "/api/auth/login", null, { email, password: PW });
  const tok = login.json.token;
  const cid = (await api("GET", "/api/companies", tok)).json[0].id;
  await api("PATCH", `/api/companies/${cid}`, tok, {
    trnVatNumber: TRN,
    contactEmail: `billing+${RUN}@alnoor.example`,
    locale: scenario.companyLocale,
    emirate: "dubai",
  });
  await api("PUT", `/api/companies/${cid}/einvoicing/partner`, tok, { partner: "acube" });

  // Customer: through the form in the signed-in app once (Arabic-preferring contact, desktop).
  let contactId;
  const cEmail = `ap+${RUN}${scenario.id}${viewport}@desertrose.example`;
  if (scenario.contactLang && viewport === "desktop") {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      timezoneId: "Asia/Dubai",
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(PW);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
    // A new account lands in onboarding first: express set-up, then skip to the app.
    const express = page.locator('[data-testid="onboarding-express"]');
    await express.waitFor({ timeout: 10000 }).catch(() => undefined);
    if (await express.count()) {
      await express.click();
      await page.waitForTimeout(3500);
      for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
        const next = page.locator(`[data-testid="${id}"]`);
        if (await next.count()) {
          await next.click();
          await page.waitForTimeout(1500);
        }
      }
    }
    await page.goto(`${BASE}/contacts`, { waitUntil: "load" });
    await page.getByTestId("button-add-contact").waitFor({ timeout: 15000 });
    await shot(page, "contacts-list");
    await page.getByTestId("button-add-contact").click();
    await page.getByTestId("input-contact-name").fill(customerName);
    await page.getByTestId("input-contact-name-ar").fill("ديزرت روز للتموين");
    await page.getByTestId("input-contact-email").fill(cEmail);
    const sel = page.getByTestId("select-contact-language");
    await sel.scrollIntoViewIfNeeded();
    await sel.click();
    await page.getByRole("option", { name: "العربية" }).click();
    await shot(page, "contact-form-language");
    await page.getByTestId("button-save-contact").click();
    await page.waitForTimeout(1500);
    await ctx.close();
    const list = (await api("GET", `/api/companies/${cid}/customer-contacts`, tok)).json;
    const found = (Array.isArray(list) ? list : list.items || []).find((c) => c.email === cEmail);
    check(
      found?.preferredLanguage === "ar",
      "contact form saved the preferred language",
      found?.preferredLanguage
    );
    contactId = found?.id;
  }
  if (!contactId) {
    const ct = await api("POST", `/api/companies/${cid}/customer-contacts`, tok, {
      name: customerName,
      nameAr: "ديزرت روز للتموين",
      email: cEmail,
      emirate: "dubai",
      ...(scenario.contactLang ? { preferredLanguage: scenario.contactLang } : {}),
    });
    check(ct.status < 300, "create customer", ct.status);
    contactId = ct.json.id;
  }
  const today = new Date();
  const d = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  const inv = await api("POST", `/api/companies/${cid}/invoices`, tok, {
    contactId,
    date: d(-40),
    dueDate: d(-10),
    placeOfSupplyEmirate: "dubai",
    lines: [
      { description: "Monthly accounting retainer", quantity: 1, unitPrice: 12500, vatRate: 0.05 },
    ],
  });
  check(inv.status === 200, "create invoice", inv.text.slice(0, 120));
  const sent = await api("PATCH", `/api/invoices/${inv.json.id}/status`, tok, { status: "sent" });
  check(sent.status === 200, "mark invoice sent", sent.status);
  const expectMail = ar ? "ar" : "both";

  // Invoice e-mail -> link -> page.
  const to = `inv+${RUN}${scenario.id}${viewport}@customer.example`;
  const send = await api("POST", `/api/companies/${cid}/invoices/${inv.json.id}/send-email`, tok, {
    to,
  });
  check(send.status === 202, "send invoice e-mail", send.status);
  const mail = await outbox("invoice", to);
  const links = await checkEmail(mail, "invoice", scenario, allow, { expect: expectMail });
  const invoiceLink = links.find((l) => /\/view\/invoice\/[0-9a-f]{32}/.test(l));
  check(!!invoiceLink, "invoice e-mail links to /view/invoice/<token>");
  const invPath = new URL(invoiceLink).pathname;
  const lean = { lean: true, valid: true, lang: scenario.lang, allow };
  const v = await openPage(browser, viewport, invPath, { ...lean, name: "invoice" });
  const page = v.page;
  check(
    v.info.title.includes(inv.json.number),
    "page title carries the invoice number",
    v.info.title
  );
  check(
    (await page.getByTestId("public-invoice-pay-now").count()) === 0,
    "Pay button absent without a payment gateway"
  );
  await checkTargets(page, ["public-invoice-download", "invoice-language"]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("public-invoice-download").click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const pdf = Buffer.concat(chunks);
  check(
    pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 2000,
    "PDF downloads",
    pdf.length
  );
  await page.emulateMedia({ media: "print" });
  const hidden = await page.evaluate(() =>
    ["public-invoice-download", "invoice-language"].every((id) => {
      const e = document.querySelector(`[data-testid="${id}"]`);
      return !e || getComputedStyle(e).display === "none" || !e.getClientRects().length;
    })
  );
  check(hidden, "print view hides the controls");
  const printPdf = await page.pdf({ format: "A4" });
  check(printPdf.subarray(0, 5).toString() === "%PDF-", "print renders to PDF");
  await page.emulateMedia({ media: "screen" });
  // The language switch changes the page language and back.
  await page.getByTestId("invoice-language").click();
  await page.waitForTimeout(500);
  const flipped = await page.evaluate(() => document.documentElement.lang);
  check(flipped === (ar ? "en" : "ar"), "language switch flips the page", flipped);
  await v.ctx.close();

  // Reminder.
  const rto = `rem+${RUN}${scenario.id}${viewport}@customer.example`;
  const rem = await api(
    "POST",
    `/api/companies/${cid}/invoices/${inv.json.id}/send-reminder`,
    tok,
    { to: rto }
  );
  check(rem.status === 202, "send reminder", rem.status);
  const rmail = await outbox("reminder", rto);
  const rlinks = await checkEmail(rmail, "reminder", scenario, allow, { expect: expectMail });
  if (!ar)
    check(
      !rmail.subject.includes(" / "),
      "reminder subject is one language or the bilingual pipe form",
      rmail.subject
    );

  // Record a payment: the page shows the new status and balance.
  const bank = (
    await db.query(`SELECT id FROM accounts WHERE company_id = $1 AND code = '1020'`, [cid])
  ).rows[0];
  const pay = await api("POST", `/api/companies/${cid}/invoices/${inv.json.id}/payments`, tok, {
    date: d(0),
    method: "bank",
    paymentAccountId: bank.id,
    amount: 2000,
    exchangeRate: 1,
  });
  check(pay.status === 201, "record a payment", pay.text.slice(0, 120));
  const afterPay = await openPage(
    browser,
    viewport,
    new URL(rlinks.find((l) => /\/view\/invoice\//.test(l))).pathname,
    {
      ...lean,
      name: "invoice-after-payment",
    }
  );
  const status = await afterPay.page.getByTestId("public-invoice-payment-status").textContent();
  const due = await afterPay.page.getByTestId("public-invoice-amount-due").textContent();
  check(
    /13,125\.00/.test(due.replace(/[^\d.,]/g, "")) === false && /11,125\.00/.test(due),
    "amount due shows 11,125.00 after paying 2,000.00",
    due
  );
  check(!!status && status.trim().length > 0, "payment status badge shows", status);
  await afterPay.ctx.close();

  // Quote and statement.
  const quote = await api("POST", `/api/companies/${cid}/quotes`, tok, {
    contactId,
    date: d(-2),
    expiryDate: d(28),
    lines: [{ description: "Payroll setup", quantity: 1, unitPrice: 3000, vatRate: 0.05 }],
  });
  check(quote.status < 300, "create quote", quote.text.slice(0, 100));
  await api("PATCH", `/api/quotes/${quote.json.id}/status`, tok, { status: "sent" });
  const qto = `quote+${RUN}${scenario.id}${viewport}@customer.example`;
  const qsend = await api("POST", `/api/quotes/${quote.json.id}/send-email`, tok, { to: qto });
  check(qsend.status < 300, "send quote", qsend.status);
  const qlinks = await checkEmail(await outbox("quote", qto), "quote", scenario, allow, {
    expect: expectMail,
  });
  const portalLink = qlinks.find((l) => /\/portal\/[^/]+$/.test(l));
  check(!!portalLink, "quote e-mail links to the customer portal");
  if (portalLink) {
    const p = await openPage(browser, viewport, new URL(portalLink).pathname, {
      ...lean,
      name: "portal-from-quote",
    });
    await checkTargets(p.page, ["portal-language"]);
    await p.ctx.close();
  }
  const sto = `st+${RUN}${scenario.id}${viewport}@customer.example`;
  const st = await api(
    "POST",
    `/api/companies/${cid}/customer-statements/${contactId}/email`,
    tok,
    { to: sto }
  );
  check(st.status < 300, "send statement", st.text.slice(0, 100));
  await checkEmail(await outbox("statement", sto), "statement", scenario, allow, {
    expect: expectMail,
    links: false,
  });

  // EmaraTax approval.
  const ato = `appr+${RUN}${scenario.id}${viewport}@alnoor.example`;
  const ap = await api("POST", `/api/companies/${cid}/einvoicing/approver-links`, tok, {
    approverName: "Khalid Al Mansoori",
    approverEmail: ato,
  });
  check(ap.status < 300, "request the EmaraTax approval", ap.text.slice(0, 120));
  const alinks = await checkEmail(
    await outbox("einvoice_approver_link", ato),
    "approver",
    scenario,
    allow,
    {
      expect: scenario.companyLocale === "ar" ? "ar" : "both",
    }
  );
  const approverLink = alinks.find((l) => /einvoicing-approve\//.test(l));
  check(!!approverLink, "approver e-mail links to the approval page");
  const apiView = await fetch(
    BASE + new URL(approverLink).pathname.replace("/portal/", "/api/portal/")
  );
  const apiText = await apiView.text();
  check(apiView.ok && !apiText.includes(TRN), "approval API shows no TRN");
  const apLang = scenario.companyLocale === "ar" ? "ar" : "en";
  const ap1 = await openPage(browser, viewport, new URL(approverLink).pathname, {
    ...lean,
    lang: apLang,
    name: "approve",
    locale: apLang === "ar" ? "ar-AE" : "en-US",
  });
  const bodyText = await ap1.page.evaluate(() => document.body.innerText);
  check(!bodyText.includes(TRN) && !ap1.info.html.includes(TRN), "approval page shows no TRN");
  check(bodyText.includes(companyName), "approval page names the company");
  await checkTargets(ap1.page, ["approve-done", "approve-language"]);
  await ap1.page.getByTestId("approve-done").click();
  await ap1.page
    .getByTestId("approve-completed")
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  check(
    (await ap1.page.getByTestId("approve-completed").count()) === 1,
    "approval is confirmed on the page"
  );
  await shot(ap1.page, "approve-done");
  await ap1.ctx.close();
  const done = await db.query(
    `SELECT subject, html, text_body FROM email_outbox WHERE category = 'einvoice_approver_done' AND company_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [cid]
  );
  await checkEmail(done.rows[0] ?? null, "approval done", scenario, allow, {
    expect: scenario.companyLocale === "ar" ? "ar" : "both",
  }).catch(() => undefined);

  // Invalid and expired links, in the browser's language.
  const bl = ar ? "ar-AE" : "en-US";
  const bad = await openPage(browser, viewport, `/view/invoice/${"0".repeat(32)}`, {
    lean: true,
    valid: false,
    lang: ar ? "ar" : "en",
    allow,
    locale: bl,
    name: "invoice-invalid",
  });
  check(
    (await bad.page.getByTestId("public-invoice-state").count()) === 1,
    "invalid invoice link shows its state"
  );
  await bad.ctx.close();
  await db.query(
    `UPDATE invoices SET share_token_expires_at = now() - interval '1 day' WHERE id = $1`,
    [inv.json.id]
  );
  const exp = await openPage(browser, viewport, invPath, {
    lean: true,
    valid: false,
    lang: ar ? "ar" : "en",
    allow,
    locale: bl,
    name: "invoice-expired",
  });
  const expTitle = await exp.page.locator("h1").textContent();
  check(/expired|انتهت/.test(expTitle), "expired invoice link says expired", expTitle);
  await exp.ctx.close();
  // Each bad link counts against the per-IP portal throttle (429 after about 20), so the bad
  // approver link is tried on the desktop runs only.
  if (viewport === "desktop") {
    const badApprove = await openPage(
      browser,
      viewport,
      `/portal/einvoicing-approve/${"z".repeat(32)}`,
      {
        lean: true,
        valid: false,
        lang: ar ? "ar" : "en",
        allow,
        locale: bl,
        name: "approve-invalid",
      }
    );
    await badApprove.ctx.close();
  }
}

// ─── Public pages keep working without zod ───────────────────────────────────

async function publicPages(browser) {
  currentLabel = "public";
  console.log(`\n=== ${currentLabel} ===`);
  for (const route of ["/", "/pricing"]) {
    const p = await openPage(browser, "phone", route, { valid: true, lang: "en", lean: false });
    const zod = p.requests.filter((u) => /vendor-forms|zod-config/.test(u));
    check(zod.length === 0, `${route} downloads no zod`, zod);
    await p.ctx.close();
  }
  for (const route of ["/login", "/register"]) {
    const p = await openPage(browser, "phone", route, { valid: true, lang: "en", lean: false });
    check(
      p.requests.some((u) => /zod-config/.test(u)),
      `${route} loads the zod configuration first`
    );
    check((await p.page.locator("input").count()) >= 2, `${route} renders its form`);
    await p.ctx.close();
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const scenario of SCENARIOS)
    for (const viewport of VIEWPORTS) await runScenario(browser, scenario, viewport);
  await publicPages(browser);
} finally {
  await browser.close();
  await db.end();
}
if (SHOT_DIR) await writeFile(path.join(SHOT_DIR, "results.txt"), log.join("\n") + "\n");
console.log(`\n${log.length - failures.length}/${log.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n${failures.join("\n")}`);
  process.exit(1);
}
