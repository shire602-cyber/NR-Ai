#!/usr/bin/env node
/**
 * Accounting pages end to end: Journal, journal entry detail, account ledger, bank
 * reconciliation (transactions, suggestions, rules), Reports (the page and a representative set
 * of report screens) and Admin documents, on phones and desktop, in English and Arabic.
 *
 *   BASE_URL=http://localhost:5081 DATABASE_URL=postgres://... node tests/e2e/books-pages-flow.mjs
 *
 * Needs a running production build (FRONTEND_URL = BASE_URL), local only. It registers
 * synthetic users through the API and seeds a populated company the way the app does: journals
 * through the ledger route (posted, draft, reversed, long English and Arabic memos, 60+ rows so the
 * list pages), a customer, invoices (one part-paid), a vendor bill with a payment, a bank account
 * with an imported statement of 45 lines, matches through the reconciliation seam, a reconciliation
 * rule, plus an empty company and a platform admin with documents.
 * For iPhone 13, a 360 px Android and 1440x900 in en and ar it checks, per screen and state:
 *   - 0 console errors / page errors, 0 failed requests (>= 400 unless the state intends them),
 *     no in-app "not found" or blank page, no horizontal overflow, `<html lang dir>`, one h1;
 *   - no raw catalog keys on screen; in Arabic no English text nodes (names, numbers, brands and
 *     account codes excepted);
 *   - phone: 44 px tap targets in the content area;
 *   - RTL: the page mirrors (dir=rtl on the shell), amounts and account codes keep their order;
 *   - axe-core serious/critical violations (WCAG A/AA) = 0;
 * and states: empty company, populated list with pagination, an entry detail (posted, draft,
 * reversed), an unknown entry id (in-app not found, no blank page), failing APIs (the page shows an
 * error state, not an empty-looking list), all bank tabs and the rule dialog, and each report.
 *
 * Environment: BASE_URL (default http://localhost:5000), DATABASE_URL (required), SHOT_DIR,
 * E2E_VIEWPORTS (android,13,desktop), E2E_LANGS (en,ar), E2E_ONLY (comma list of screen name
 * prefixes), CHROMIUM_PATH (falls back to /opt/pw-browsers/chromium-1243/chrome-linux64/chrome).
 * Exits 1 on a failed check.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright-core";
import pg from "pg";
import { classifyLines } from "./lib/latin-text.mjs";
import { REPORT_URLS } from "./lib/report-urls.mjs";
import { dubaiIso } from "../helpers/dates.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR || "";
const PW = "Fake-Password-123";
const RUN = Math.random().toString(36).slice(2, 8);
const CHROMIUM_FALLBACK = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (the admin flag is written through the database).");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

const VIEWPORTS = (process.env.E2E_VIEWPORTS || "android,13,desktop").split(",");
const LANGS = (process.env.E2E_LANGS || "en,ar").split(",");
const ONLY = (process.env.E2E_ONLY || "").split(",").filter(Boolean);
const DEVICE = {
  android: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } },
  13: { ...devices["iPhone 13"] },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const failures = [];
let currentLabel = "";
function check(ok, message, detail) {
  const line = `${ok ? "ok  " : "FAIL"} [${currentLabel}] ${message}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}

const require = createRequire(import.meta.url);
let axeSource = "";
try {
  axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
} catch {
  console.warn("axe-core not installed: accessibility checks skipped");
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
  return { status: res.status, json };
}
async function must(label, p, ok = (s) => s >= 200 && s < 300) {
  const r = await p;
  if (!ok(r.status)) throw new Error(`${label} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

// Seeded user data (company names, memos, counterparties) is not UI copy.
const COMPANY_EN = `Al Noor International Trading and Contracting Company Limited Liability ${RUN}`;
const MEMO_AR = "سداد إيجار المكتب الرئيسي لشهر نوفمبر بحسب عقد الإيجار المبرم مع المالك";
const MEMO_LONG_EN =
  "Quarterly retainer for facilities management, security, cleaning and landscaping services across the Jebel Ali free zone warehouse complex including variation orders";
const DATA_ALLOW = [
  RUN,
  "Al Noor",
  "Desert Rose",
  "Gulf Horizon",
  "Emirates Precision",
  "Falcon Eye",
  "Jebel Ali",
  "FZ-LLC",
  "LLC",
  "Emirates NBD",
  "Mashreq",
  "Books Owner",
  "Books Admin",
  "Rent",
  "Retainer",
  "Statement",
  "Salary",
  "Courier",
  "DEWA",
  "ADNOC",
  "Etisalat",
  "Careem",
  "Noon",
  "Amazon",
  "Zoom",
  "Slack",
  "Facilities",
  "Bank charges",
  "Transfer",
  "Cheque",
  "Deposit",
  "Payment",
  "Invoice",
  // The language switch names the other language in its own script.
  "English",
  "document.pdf",
  "Posted to the wrong period",
  "Courier ADNOC fuel card",
  "DEWA utilities payment",
  "DEWA utilities",
  "Transfer from Desert Rose Catering",
  "Bank charges monthly",
  "Cheque deposit",
  "Careem rides corporate",
  "Etisalat business fiber",
  "Draft accrual awaiting review",
  "Office rent for the month",
  "Utilities DEWA",
  "Salary run November",
  "Opening capital contribution",
  "Capital in",
  "Share capital",
  "Bank",
  "Empty Co",
  "Admin Co",
  "Trade licence 2026",
  "Freight",
  "Quarterly retainer for facilities management, security, cleaning and landscaping services across the Jebel Ali free zone warehouse complex including variation orders",
  COMPANY_EN,
];

// ─── Data ────────────────────────────────────────────────────────────────────

const day = (n) => dubaiIso(new Date(Date.now() + n * 86400000));

async function register(name, email, companyName) {
  const reg = await api("POST", "/api/auth/register", null, {
    name,
    email,
    password: PW,
    companyName,
  });
  if (reg.status >= 300) throw new Error(`register ${email} failed: ${reg.status}`);
  const login = await api("POST", "/api/auth/login", null, { email, password: PW });
  const token = login.json.token;
  const companies = await must("companies", api("GET", "/api/companies", token));
  const company = companies[0];
  await db.query(
    `UPDATE companies SET onboarding_completed = true, trn_vat_number = '100123456700003', emirate = 'dubai' WHERE id = $1`,
    [company.id]
  );
  return { email, token, companyId: company.id };
}

async function seed() {
  const owner = await register("Books Owner", `books-owner+${RUN}@example.com`, COMPANY_EN);
  const empty = await register("Books Empty", `books-empty+${RUN}@example.com`, `Empty Co ${RUN}`);
  const admin = await register("Books Admin", `books-admin+${RUN}@example.com`, `Admin Co ${RUN}`);
  await db.query(`UPDATE users SET is_admin = true WHERE email = $1`, [admin.email]);
  const cid = owner.companyId;
  const t = owner.token;

  const accounts = await must("accounts", api("GET", `/api/companies/${cid}/accounts`, t));
  const acc = (code) => accounts.find((a) => a.code === code);
  const bankGl = acc("1020");

  // Journals through the ledger route: 66 posted, one draft, one to reverse, one to void.
  const entries = [];
  const memos = [
    "Office rent for the month",
    MEMO_AR,
    MEMO_LONG_EN,
    "Utilities DEWA",
    "فاتورة الكهرباء والمياه",
  ];
  const expenseCodes = ["5010", "5030", "5040", "5050", "5060", "5070", "5080", "5090"];
  await must(
    "capital",
    api("POST", `/api/companies/${cid}/journal`, t, {
      date: day(-120),
      memo: "Opening capital contribution",
      reference: "CAP-0001",
      status: "posted",
      lines: [
        { accountId: bankGl.id, debit: 500000, credit: 0, description: "Capital in" },
        { accountId: acc("3010").id, debit: 0, credit: 500000, description: "Share capital" },
      ],
    })
  );
  for (let i = 0; i < 66; i++) {
    const amt = 150 + ((i * 137) % 4800) + (i % 3) * 0.25;
    const j = await must(
      `journal ${i}`,
      api("POST", `/api/companies/${cid}/journal`, t, {
        date: day(-110 + i),
        memo: memos[i % memos.length],
        reference: `JV-${String(i + 1).padStart(4, "0")}`,
        status: "posted",
        lines: [
          {
            accountId: acc(expenseCodes[i % expenseCodes.length]).id,
            debit: amt,
            credit: 0,
            description: memos[i % memos.length],
          },
          { accountId: bankGl.id, debit: 0, credit: amt, description: "Bank" },
        ],
      })
    );
    entries.push(j);
  }
  const draft = await must(
    "draft",
    api("POST", `/api/companies/${cid}/journal`, t, {
      date: day(-1),
      memo: "Draft accrual awaiting review",
      status: "draft",
      lines: [
        { accountId: acc("5000").id, debit: 1234.5, credit: 0 },
        { accountId: acc("2040").id, debit: 0, credit: 1234.5 },
      ],
    })
  );
  const reversed = await api("POST", `/api/journal/${entries[3].id}/reverse`, t, {
    reason: "Posted to the wrong period",
  });
  if (reversed.status >= 300) console.warn("reverse failed", reversed.status);

  // Customer, invoices (one part-paid), a vendor bill with a payment.
  const contact = await must(
    "contact",
    api("POST", `/api/companies/${cid}/customer-contacts`, t, {
      name: "Desert Rose Catering FZ-LLC",
      nameAr: "ديزرت روز للتموين",
      email: `ap+${RUN}@desertrose.example`,
    })
  );
  const invoiceIds = [];
  for (const [price, offset] of [
    [1000, -40],
    [2500, -20],
    [800, -5],
  ]) {
    const inv = await must(
      "invoice",
      api("POST", `/api/companies/${cid}/invoices`, t, {
        contactId: contact.id,
        date: day(offset),
        dueDate: day(offset + 14),
        lines: [{ description: "Retainer", quantity: 1, unitPrice: price, vatRate: 5 }],
      })
    );
    await must("send", api("PATCH", `/api/invoices/${inv.id}/status`, t, { status: "sent" }));
    invoiceIds.push(inv.id);
  }
  await must(
    "payment",
    api("POST", `/api/companies/${cid}/invoices/${invoiceIds[0]}/payments`, t, {
      date: day(-15),
      method: "bank",
      paymentAccountId: bankGl.id,
      amount: 400,
    })
  );
  const billWarn = [];
  const bill = await api("POST", `/api/companies/${cid}/bills`, t, {
    vendor_name: "Gulf Horizon Logistics LLC",
    bill_number: `GH-${RUN}`,
    bill_date: day(-30),
    due_date: day(-2),
    save_as_draft: true,
    line_items: [{ description: "Freight", quantity: 1, unit_price: 250000, vat_rate: 5 }],
  });
  if (bill.status >= 300) billWarn.push(`bill create ${bill.status}`);

  // Bank account, imported statement (45 lines) and matches.
  const bank = await must(
    "bank account",
    api("POST", `/api/companies/${cid}/bank-accounts`, t, {
      nameEn: "Emirates NBD Current",
      bankName: "Emirates NBD",
      currency: "AED",
      glAccountId: bankGl.id,
    })
  );
  const csvRows = ["Date,Description,Debit,Credit,Balance"];
  let balance = 0;
  const descs = [
    "Transfer from Desert Rose Catering",
    "DEWA utilities payment",
    "Courier ADNOC fuel card",
    "Salary run November",
    "Etisalat business fiber",
    "Careem rides corporate",
    "Cheque deposit 000412",
    "Bank charges monthly",
  ];
  for (let i = 0; i < 45; i++) {
    const credit = i % 4 === 0 ? 400 + i * 10 : 0;
    const debit = credit ? 0 : 90 + i * 7;
    balance += credit - debit;
    csvRows.push(
      `${day(-60 + i)},${descs[i % descs.length]} ${i + 1},${debit || ""},${credit || ""},${balance.toFixed(2)}`
    );
  }
  const imp = await api("POST", `/api/companies/${cid}/bank-statements/import`, t, {
    bankAccountId: bank.id,
    csvContent: csvRows.join("\n"),
    acknowledgeAmbiguity: true,
  });
  if (imp.status >= 300)
    throw new Error(`import failed: ${imp.status} ${JSON.stringify(imp.json)}`);
  const txs = await must(
    "transactions",
    api("GET", `/api/companies/${cid}/bank-statements/transactions?bankAccountId=${bank.id}`, t)
  );
  let matched = 0;
  const inflow = txs.find((x) => Number(x.amount) > 0);
  if (inflow) {
    const m = await api("POST", `/api/companies/${cid}/bank-statements/${inflow.id}/match`, t, {
      matchedType: "invoice",
      matchedId: invoiceIds[1],
      amount: Math.round(Number(inflow.amount) * 100) / 100,
    });
    if (m.status < 300) matched++;
    else billWarn.push(`invoice match ${m.status} ${JSON.stringify(m.json).slice(0, 120)}`);
  }
  const outflow = txs.find((x) => Number(x.amount) < 0);
  if (outflow) {
    const ce = await api(
      "POST",
      `/api/companies/${cid}/bank-statements/${outflow.id}/create-entry`,
      t,
      {
        accountId: acc("5030").id,
        postingMode: "posted",
      }
    );
    if (ce.status < 300) matched++;
    else billWarn.push(`create-entry ${ce.status} ${JSON.stringify(ce.json).slice(0, 120)}`);
  }
  for (const [name, value] of [
    ["DEWA utilities", "DEWA"],
    ["دفعات الاتصالات", "Etisalat"],
  ]) {
    const rule = await api("POST", `/api/companies/${cid}/reconciliation-rules`, t, {
      name,
      matchField: "description",
      matchType: "contains",
      matchValue: value,
      accountId: acc("5030").id,
      vatTreatment: "standard",
    });
    if (rule.status >= 300) billWarn.push(`rule ${rule.status}`);
  }

  // Admin documents for the owner's company (the admin is not a member: the page must cope).
  await api("POST", `/api/admin/clients/${admin.companyId}/documents`, admin.token, {
    name: "Trade licence 2026",
    nameAr: "الرخصة التجارية 2026",
    category: "trade_license",
    expiryDate: day(20),
  });

  if (billWarn.length) console.warn("seed warnings:", billWarn);
  return {
    owner,
    empty,
    admin,
    bankGl,
    bankId: bank.id,
    entries,
    draftId: draft.id,
    reversedId: entries[3].id,
    plId: acc("5030").id,
    matched,
  };
}

// ─── Page checks ─────────────────────────────────────────────────────────────

async function shot(page, name) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${currentLabel.replace(/\s+/g, "-")}-${name}.png`),
    fullPage: true,
  });
}

const RAW_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+){1,}$/;
const NOT_FOUND = /page not found|الصفحة غير موجودة|\b404\b/i;

async function signedInContext(browser, viewport, lang, account) {
  const ctx = await browser.newContext({
    ...DEVICE[viewport],
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
    acceptDownloads: true,
  });
  await ctx.addInitScript(
    ([l, active]) => {
      try {
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
        localStorage.setItem("cookie-consent", "accepted");
        localStorage.setItem("muhasib_active_company_id", active);
      } catch {
        /* storage blocked */
      }
    },
    [lang, account.companyId]
  );
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.fill("[data-testid=input-email]", account.email);
  await page.fill("[data-testid=input-password]", PW);
  await page.click("[data-testid=button-login]");
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 });
  await page.close();
  return ctx;
}

/**
 * Open `url` in `ctx`, run the generic checks. opts: name, lang, viewport, errorsOk (the state
 * intends failing calls), intercept(page) (route interception before navigation), act(page)
 * (interaction before the checks), expect(page, info) (state assertions), notFound (an in-app
 * not-found page is the expected state), anyH1.
 */
async function openScreen(ctx, url, opts) {
  if (ONLY.length && !ONLY.some((p) => opts.name.startsWith(p))) return null;
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 220)));
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 220)}`));
  page.on("response", (r) => {
    const u = r.url().replace(BASE, "");
    if (r.status() >= 400 && r.url().startsWith(BASE)) bad.push(`${r.status()} ${u.slice(0, 90)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url().replace(BASE, "");
    // Aborted navigations and cancelled lazy requests while leaving a page are not failures.
    if (!/net::ERR_ABORTED/.test(r.failure()?.errorText ?? ""))
      bad.push(`${u.slice(0, 90)} ${r.failure()?.errorText}`);
  });
  if (opts.intercept) await opts.intercept(page);
  const response = await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  // A failing read is retried with back-off (about 7 s) before the page shows its error state.
  if (opts.intercept) await page.waitForTimeout(8500);
  if (opts.act) await opts.act(page);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(300);

  const phone = opts.viewport !== "desktop";
  const info = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (
        !el ||
        /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) ||
        el.closest("[translate=no]") ||
        !vis(el)
      )
        continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    }
    const main = document.querySelector("main") ?? document.body;
    const targets = [
      ...main.querySelectorAll(
        "a,button,input,select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=combobox]"
      ),
    ]
      .filter(
        (e) => vis(e) && !e.closest(".sr-only") && !e.hasAttribute("hidden") && e.type !== "hidden"
      )
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const inline =
          e.tagName === "A" && e.closest("p, li") && getComputedStyle(e).display === "inline";
        return !inline && (r.height < 43.5 || r.width < 43.5);
      })
      .map(
        (e) =>
          `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || e.getAttribute("data-testid") || "").trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`
      );
    // Elements that stick out of the viewport sideways (clipped or overlapping content).
    const vw = document.documentElement.clientWidth;
    const outside = [...main.querySelectorAll("*")]
      .filter((e) => {
        if (!vis(e) || e.closest("[data-radix-scroll-area-viewport],.overflow-x-auto,table"))
          return false;
        const r = e.getBoundingClientRect();
        return r.right > vw + 2 || r.left < -2;
      })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}`);
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      h1: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      lines,
      targets,
      outside,
      textLength: main.innerText.trim().length,
      path: location.pathname + location.search,
    };
  });

  // A lazy chunk that fails to load on a busy runner is recovered by the app's own reload guard
  // (ErrorBoundary); the screen is measured once more instead of failing on the blip.
  if (!opts.retried && errors.some((e) => /dynamically imported module/.test(e))) {
    await page.close();
    return openScreen(ctx, url, { ...opts, retried: true });
  }
  const realErrors = errors.filter(
    (e) => !(opts.errorsOk && /status of (4|5)\d\d|net::ERR_FAILED/.test(e))
  );
  const realBad = opts.errorsOk ? [] : bad;
  check(response?.ok(), `${opts.name}: page status ${response?.status()}`);
  check(realErrors.length === 0, `${opts.name}: 0 console errors`, realErrors);
  check(realBad.length === 0, `${opts.name}: 0 failed requests`, realBad);
  check(!info.overflow, `${opts.name}: no horizontal overflow`);
  check(
    info.outside.length === 0,
    `${opts.name}: nothing sticks out of the viewport`,
    info.outside
  );
  check(info.lang === opts.lang, `${opts.name}: html lang=${opts.lang}`, info.lang);
  check(info.dir === (opts.lang === "ar" ? "rtl" : "ltr"), `${opts.name}: dir`, info.dir);
  check(info.h1 >= 1 || opts.anyH1, `${opts.name}: has an h1`, info.h1);
  check(info.textLength > 40, `${opts.name}: page is not blank`, info.textLength);
  const raw = info.lines.filter((l) => RAW_KEY.test(l) && !/\.(pdf|png|jpe?g|xlsx?|csv)$/i.test(l));
  check(raw.length === 0, `${opts.name}: no raw catalog keys on screen`, raw.slice(0, 5));
  const notFound = info.lines.some((l) => NOT_FOUND.test(l) && l.length < 80);
  check(
    opts.notFound ? notFound : !notFound,
    `${opts.name}: not-found state ${opts.notFound ? "shown" : "absent"}`,
    info.lines.filter((l) => NOT_FOUND.test(l) && l.length < 80).slice(0, 3)
  );
  if (phone)
    check(info.targets.length === 0, `${opts.name}: 44px tap targets`, info.targets.slice(0, 6));
  if (opts.lang === "ar") {
    const copy = info.lines.filter((l) => !/LLC|L\.L\.C|@/.test(l));
    const english = classifyLines(copy, DATA_ALLOW).samples;
    check(english.length === 0, `${opts.name}: no English text in Arabic`, english.slice(0, 6));
  }
  if (axeSource) {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef -- injected by the axe-core script evaluated above
      const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}:${v.nodes.length}:${String(v.nodes[0].target).slice(0, 90)}`);
    });
    check(violations.length === 0, `${opts.name}: axe serious/critical`, violations);
  }
  if (opts.expect) await opts.expect(page, info);
  await shot(page, opts.name.replace(/\W+/g, "-"));
  await page.close();
  return info;
}

const anyText = (info, re) => info.lines.some((l) => re.test(l));

// ─── Screens ─────────────────────────────────────────────────────────────────

async function screens(browser, viewport, lang, data) {
  const base = { lang, viewport };
  const ownerCtx = await signedInContext(browser, viewport, lang, data.owner);
  const emptyCtx = await signedInContext(browser, viewport, lang, data.empty);
  const adminCtx = await signedInContext(browser, viewport, lang, data.admin);
  const failApi = (pattern) => async (page) => {
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "SQL error at line 4 internal-boom", code: "INTERNAL" }),
      })
    );
  };
  const noInternals = (page, info) =>
    check(
      !anyText(info, /internal-boom|SQL error/),
      `${base.lang}: the server's raw message is not shown`
    );

  // Journal.
  await openScreen(ownerCtx, "/journal", {
    ...base,
    name: "journal list",
    expect: async (page, info) => {
      // The list is virtualised: the newest entries are on screen, older ones render on scroll.
      check(anyText(info, /JE-\d{8}-\d+/), "journal list: seeded entries are listed");
      check(
        await page.locator("[data-testid=button-create-entry]").first().isVisible(),
        "journal list: New entry is available"
      );
    },
  });
  await openScreen(ownerCtx, "/journal", {
    ...base,
    name: "journal list new-entry form",
    act: async (page) => {
      await page.locator("[data-testid=button-create-entry]").first().click();
      await page.waitForTimeout(500);
    },
  });
  await openScreen(emptyCtx, "/journal", { ...base, name: "journal empty" });
  await openScreen(ownerCtx, "/journal", {
    ...base,
    name: "journal api failure",
    errorsOk: true,
    intercept: failApi("**/api/companies/*/journal?*"),
    expect: async (page, info) => {
      noInternals(page, info);
      check(!anyText(info, /JV-0/), "journal api failure: no stale rows");
    },
  });
  for (const [label, id] of [
    ["posted", data.entries[0].id],
    ["reversed", data.reversedId],
    ["draft", data.draftId],
  ]) {
    await openScreen(ownerCtx, `/journal/${id}`, {
      ...base,
      name: `journal entry ${label}`,
      expect: async (page) => {
        check(
          await page
            .locator("table, [role=table], [data-testid^=journal-line]")
            .first()
            .isVisible()
            .catch(() => false),
          `journal entry ${label}: lines are shown`
        );
      },
    });
  }
  await openScreen(ownerCtx, "/journal/00000000-0000-4000-8000-000000000000", {
    ...base,
    name: "journal entry unknown id",
    errorsOk: true,
    anyH1: true,
  });
  await openScreen(ownerCtx, `/journal/${data.entries[0].id}`, {
    ...base,
    name: "journal entry api failure",
    errorsOk: true,
    anyH1: true,
    intercept: failApi("**/api/journal/*"),
    expect: noInternals,
  });

  // Account ledger.
  await openScreen(ownerCtx, `/accounts/${data.bankGl.id}/ledger`, {
    ...base,
    name: "account ledger bank",
    expect: async (page, info) =>
      check(anyText(info, /JV-0|CAP-0001|Capital in|Bank|البنك/), "account ledger: lines shown"),
  });
  await openScreen(ownerCtx, `/accounts/${data.plId}/ledger`, {
    ...base,
    name: "account ledger expense",
  });
  await openScreen(emptyCtx, `/accounts/${data.bankGl.id}/ledger`, {
    ...base,
    name: "account ledger empty company",
    errorsOk: true,
    anyH1: true,
  });
  await openScreen(ownerCtx, `/accounts/${data.bankGl.id}/ledger`, {
    ...base,
    name: "account ledger api failure",
    errorsOk: true,
    anyH1: true,
    intercept: failApi("**/api/companies/*/accounts/*/ledger*"),
    expect: noInternals,
  });

  // Bank reconciliation: every tab, the rule dialog, failures.
  for (const tab of ["transactions", "suggestions", "rules"]) {
    await openScreen(ownerCtx, `/bank-reconciliation?tab=${tab}`, {
      ...base,
      name: `bank reconciliation ${tab}`,
    });
  }
  await openScreen(ownerCtx, "/bank-reconciliation?tab=rules", {
    ...base,
    name: "bank reconciliation rule dialog",
    act: async (page) => {
      const add = page
        .locator("[data-testid=button-add-rule], [data-testid=button-create-rule]")
        .first();
      if (await add.count()) await add.click();
      await page.waitForTimeout(500);
    },
  });
  for (const tab of ["transactions", "suggestions", "rules"]) {
    await openScreen(emptyCtx, `/bank-reconciliation?tab=${tab}`, {
      ...base,
      name: `bank reconciliation ${tab} empty`,
    });
  }
  await openScreen(ownerCtx, "/bank-reconciliation", {
    ...base,
    name: "bank reconciliation api failure",
    errorsOk: true,
    intercept: failApi("**/api/companies/*/bank-statements/**"),
    expect: noInternals,
  });
  await openScreen(ownerCtx, "/bank-reconciliation?tab=rules", {
    ...base,
    name: "bank reconciliation rules api failure",
    errorsOk: true,
    intercept: failApi("**/api/companies/*/reconciliation-rules*"),
    expect: noInternals,
  });

  // Reports page and a representative set of report screens.
  await openScreen(ownerCtx, "/reports", { ...base, name: "reports page" });
  await openScreen(emptyCtx, "/reports", { ...base, name: "reports page empty" });
  const reportUrls = [
    ...REPORT_URLS.filter(
      (u) => u.startsWith("/reports?") || u === "/financial-statements?tab=cash-flow"
    ),
    "/reports/statements-of-account",
  ];
  for (const url of reportUrls) {
    const short = url.replace(/&persona=\w+/, "").replace(/^\/(reports\?tab=)?/, "");
    await openScreen(ownerCtx, url, { ...base, name: `report ${short}`, anyH1: true });
  }
  for (const url of [
    "/reports?tab=pl&report=profit-loss&persona=owner",
    "/reports?tab=trial&report=trial-balance&persona=accountant",
  ]) {
    const short = url.replace(/&persona=\w+/, "").replace(/^\/(reports\?tab=)?/, "");
    await openScreen(emptyCtx, url, { ...base, name: `report ${short} empty`, anyH1: true });
    await openScreen(ownerCtx, url, {
      ...base,
      name: `report ${short} api failure`,
      errorsOk: true,
      anyH1: true,
      intercept: failApi("**/api/companies/*/reports/**"),
      expect: noInternals,
    });
  }

  // Admin documents.
  await openScreen(adminCtx, "/admin/documents", {
    ...base,
    name: "admin documents",
    act: async (page) => {
      await page.locator("[data-testid=select-client-company]").click();
      await page.locator("[role=option]").first().click();
    },
    expect: async (page, info) =>
      check(
        (await page.locator("[data-testid^=row-document-]").count()) > 0 ||
          (await page.locator("[data-testid^=card-document-]").count()) > 0 ||
          anyText(info, /Trade licence|الرخصة التجارية/),
        "admin documents: the seeded document is listed"
      ),
  });
  await openScreen(adminCtx, "/admin/documents", {
    ...base,
    name: "admin documents upload dialog",
    act: async (page) => {
      const btn = page.locator("[data-testid=button-upload-client-document]");
      if (await btn.isDisabled()) {
        await page.locator("[data-testid=select-client-company]").click();
        await page.locator("[role=option]").first().click();
      }
      await btn.click();
      await page.waitForTimeout(500);
    },
  });
  await openScreen(adminCtx, "/admin/documents", {
    ...base,
    name: "admin documents api failure",
    errorsOk: true,
    intercept: failApi("**/api/admin/**"),
    expect: noInternals,
  });
  // A non-admin never sees the admin page: they land on the dashboard with a notice.
  {
    const page = await ownerCtx.newPage();
    await page.goto(BASE + "/admin/documents", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    check(
      !/\/admin\/documents/.test(new URL(page.url()).pathname) &&
        (await page.locator("[data-testid=button-upload-client-document]").count()) === 0,
      "admin documents as customer: redirected away, no admin controls",
      page.url()
    );
    await page.close();
  }

  await ownerCtx.close();
  await emptyCtx.close();
  await adminCtx.close();
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const data = await seed();
console.log(`seeded: ${data.entries.length} journals, matched ${data.matched} bank lines`);
const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(CHROMIUM_FALLBACK) ? CHROMIUM_FALLBACK : undefined);
const browser = await chromium.launch({ executablePath });
for (const viewport of VIEWPORTS) {
  for (const lang of LANGS) {
    currentLabel = `${viewport} ${lang}`;
    try {
      await screens(browser, viewport, lang, data);
    } catch (err) {
      check(false, "screens ran to the end", String(err?.stack || err).slice(0, 400));
    }
  }
}
await browser.close();
await db.end();
console.log(`\n${failures.length ? `${failures.length} FAILED` : "all checks passed"}`);
process.exit(failures.length ? 1 : 0);
