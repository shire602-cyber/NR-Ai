#!/usr/bin/env node
/**
 * Firm and accountant tools: dashboard, client list, switching ("Open books"), client profile,
 * e-invoicing status views and the invoice list in a client's books, on phones and desktop, in
 * English and Arabic.
 *
 *   BASE_URL=http://localhost:5052 DATABASE_URL=postgres://... node tests/e2e/firm-tools-flow.mjs
 *
 * Needs a running production build (FRONTEND_URL = BASE_URL), local only. It registers synthetic
 * users through the API: an NR firm owner whose own company is NOT onboarded (the reproducer for
 * "Open books" landing in the staffer's own wizard), an assigned preparer and an unassigned
 * preparer (firm_role is written through DATABASE_URL), then 28 clients (more than one page of
 * the portfolio), two assignments, a contact, two invoices (one part-paid) and e-invoice states.
 * For iPhone 13, a 360 px Android and 1440x900 in en and ar it checks, per screen:
 *   - 0 console errors, 0 failed requests, no horizontal overflow, `<html lang dir>`, one h1;
 *   - no raw catalog keys on screen; in Arabic no English text nodes;
 *   - phone: 44 px tap targets in the content area (the command-centre checkboxes included);
 *   - axe-core serious/critical violations (WCAG A/AA) = 0;
 *   - the firm workspace does not download the report catalog or the admin catalogs;
 * and flow assertions:
 *   - the portfolio shows each client's assigned staff, counts "Unassigned" correctly, pages
 *     (25 per page) and, on phones, renders cards with "Open books" inside the viewport;
 *   - "Open books" lands on that client's /dashboard with the "Managing" banner and never
 *     visits /onboarding, although the staffer's own company is not onboarded;
 *   - the client profile has an h1 and, in Arabic, "بيانات الاتصال" for the contact card;
 *   - a failing client list / command centre / invoice list shows a localized error state with
 *     Retry, never "No clients yet", zeroed tiles or the raw server message;
 *   - the portfolio accepts CSV and XLSX, rejects legacy XLS, and localizes file and row errors;
 *   - an unassigned preparer sees an "assigned to you" empty state, no Add/Import controls and
 *     no client names from /api/firm/client-links;
 *   - firm A/R in the overview equals the settlement figure (partial payment respected);
 *   - first-load budget (defect 14), iPhone 13 profile with 4x CPU and Slow 4G (562 ms RTT,
 *     1.44 Mbps), cold cache, both landing screens in en and ar: the document is the firm build,
 *     no motion/pdf/report chunks, at most 50 requests and 25 scripts up to the largest
 *     contentful paint (about 30 and 16 measured; 131-148 requests before), and a largest contentful paint under 9 s (4.6-4.9 s measured,
 *     11.9-15.3 s before). The numbers leave about 2x margin so a slow runner does not flake, and
 *     still fail on a return to the shared-chunk layout.
 *
 * Environment: BASE_URL (default http://localhost:5000), DATABASE_URL (required), SHOT_DIR,
 * E2E_VIEWPORTS (android,13,desktop), E2E_LANGS (en,ar), CHROMIUM_PATH (falls back to
 * /opt/pw-browsers/chromium-1243/chrome-linux64/chrome when present). Exits 1 on a failure.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright-core";
import pg from "pg";
import { classifyLines } from "./lib/latin-text.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR || "";
const PW = "Fake-Password-123";
const RUN = Math.random().toString(36).slice(2, 8);
const CHROMIUM_FALLBACK = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (firm roles are written through the database).");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

const VIEWPORTS = (process.env.E2E_VIEWPORTS || "android,13,desktop").split(",");
const LANGS = (process.env.E2E_LANGS || "en,ar").split(",");
const DEVICE = {
  android: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } },
  13: { ...devices["iPhone 13"] },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const failures = [];
const log = [];
let currentLabel = "";
function check(ok, message, detail) {
  const line = `${ok ? "ok  " : "FAIL"} [${currentLabel}] ${message}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`;
  log.push(line);
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

const CLIENT_COUNT = 28;
// Seeded user data (names, contacts, other audit data in a shared database) is not UI copy.
const DATA_ALLOW = [
  RUN,
  "Firm Owner Home",
  "Assigned Preparer Home",
  "Unassigned Preparer Home",
  "Assigned Preparer",
  "Unassigned Preparer",
  "Firm Owner",
  "Audit Client",
  "Desert Rose Catering",
  "FZ-LLC",
  "Omar Haddad",
  "Al Noor Trading",
  // The long seeded client name (LONG_CLIENT) is data, shown in full where the list has room.
  "Al Noor International Trading and Contracting Company Limited Liability",
  "Palm Crest Real Estate",
  "Blue Lagoon Marine Services",
  "LLC",
  "English",
];
const ARABIC_CLIENT = `شركة النور للتجارة ${RUN}`;
const LONG_CLIENT = `Al Noor International Trading and Contracting Company Limited Liability ${RUN}`;

// ─── Data ────────────────────────────────────────────────────────────────────

async function registerUser(name, email, firmRole) {
  const reg = await api("POST", "/api/auth/register", null, {
    name,
    email,
    password: PW,
    companyName: `${name} Home ${RUN}`,
  });
  if (reg.status >= 300) throw new Error(`register ${email} failed: ${reg.status}`);
  if (firmRole)
    await db.query(`UPDATE users SET firm_role = $2 WHERE email = $1`, [email, firmRole]);
  const login = await api("POST", "/api/auth/login", null, { email, password: PW });
  return { email, token: login.json.token, id: login.json.user?.id };
}

async function seed() {
  const owner = await registerUser("Firm Owner", `firm-owner+${RUN}@example.com`, "firm_owner");
  const assigned = await registerUser("Assigned Preparer", `prep-a+${RUN}@example.com`, "preparer");
  const unassigned = await registerUser(
    "Unassigned Preparer",
    `prep-u+${RUN}@example.com`,
    "preparer"
  );
  // The owner's own company must not be onboarded: that is what used to trap "Open books".
  await db.query(
    `UPDATE companies SET onboarding_completed = false WHERE id IN
       (SELECT company_id FROM company_users WHERE user_id = (SELECT id FROM users WHERE email = $1))`,
    [owner.email]
  );

  const clients = [];
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const name =
      i === 1
        ? ARABIC_CLIENT
        : i === 2
          ? LONG_CLIENT
          : `Audit Client ${String(i).padStart(2, "0")} ${RUN}`;
    const r = await api("POST", "/api/firm/clients", owner.token, {
      name,
      trnVatNumber: "100123456700003",
      emirate: "dubai",
      vatFilingFrequency: i % 5 === 0 ? "monthly" : "quarterly",
    });
    if (r.status >= 300)
      throw new Error(`client ${name} failed: ${r.status} ${JSON.stringify(r.json)}`);
    clients.push({ id: r.json.id, name });
  }
  // Newest first in the list: clients[0] is created first, so it is the last row. Use the two
  // assigned ones for the flows below.
  const mine = [clients[0], clients[1]];
  const staffRows = await db.query(`SELECT id, email FROM users WHERE email = ANY($1)`, [
    [assigned.email, unassigned.email],
  ]);
  const staffId = (email) => staffRows.rows.find((r) => r.email === email).id;
  for (const c of mine) {
    const a = await api("POST", `/api/firm/clients/${c.id}/assign-staff`, owner.token, {
      staffUserId: staffId(assigned.email),
      action: "assign",
    });
    if (a.status >= 300) throw new Error(`assign failed: ${a.status}`);
  }

  // Invoices for clients[0]: one overdue and part-paid, one e-invoice rejected.
  const cid = clients[0].id;
  const contact = await api("POST", `/api/companies/${cid}/customer-contacts`, owner.token, {
    name: "Desert Rose Catering FZ-LLC",
    email: `ap+${RUN}@desertrose.example`,
  });
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const invoiceIds = [];
  for (const price of [1000, 2500]) {
    const inv = await api("POST", `/api/companies/${cid}/invoices`, owner.token, {
      contactId: contact.json.id,
      date: day(-40),
      dueDate: day(-10),
      lines: [{ description: "Retainer", quantity: 1, unitPrice: price, vatRate: 5 }],
    });
    if (inv.status >= 300)
      throw new Error(`invoice failed: ${inv.status} ${JSON.stringify(inv.json)}`);
    const sent = await api("PATCH", `/api/invoices/${inv.json.id}/status`, owner.token, {
      status: "sent",
    });
    if (sent.status >= 300) throw new Error(`send failed: ${sent.status}`);
    invoiceIds.push(inv.json.id);
  }
  const accounts = await api("GET", `/api/companies/${cid}/accounts`, owner.token);
  const bank = accounts.json.find((a) => a.code === "1020");
  const pay = await api(
    "POST",
    `/api/companies/${cid}/invoices/${invoiceIds[0]}/payments`,
    owner.token,
    {
      date: day(-5),
      method: "bank",
      paymentAccountId: bank.id,
      amount: 400,
    }
  );
  if (pay.status >= 300)
    throw new Error(`payment failed: ${pay.status} ${JSON.stringify(pay.json)}`);
  await db.query(`UPDATE invoices SET einvoice_status = 'rejected' WHERE id = $1`, [invoiceIds[1]]);
  return { owner, assigned, unassigned, clients, mine, expectedOpenAr: 650 + 2625 };
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
const HEAVY_FOR_FIRM =
  /\/(reportCatalog|reportCatalogText|reportCatalogApi|adminConsole)-[\w-]+\.js/;

async function signedInContext(browser, viewport, lang, account, activeCompanyId) {
  const ctx = await browser.newContext({
    ...DEVICE[viewport],
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
  });
  await ctx.addInitScript(
    ([l, active]) => {
      try {
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
        localStorage.setItem("cookie-consent", "accepted");
        if (active) localStorage.setItem("muhasib_active_company_id", active);
        else localStorage.removeItem("muhasib_active_company_id");
      } catch {
        /* storage blocked */
      }
    },
    [lang, activeCompanyId ?? null]
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

/** Open `url` in `ctx`, run the generic checks. opts: lang, viewport, name, errorsOk, act. */
async function openScreen(ctx, url, opts) {
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  const requests = [];
  const visited = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) =>
    bad.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`)
  );
  page.on(
    "framenavigated",
    (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname)
  );
  page.on("response", (r) => {
    const u = r.url().replace(BASE, "");
    requests.push(u);
    if (r.status() >= 400 && r.url().startsWith(BASE) && !opts.errorsOk)
      bad.push(`${r.status()} ${u}`);
  });
  page.removeAllListeners("requestfailed");
  page.on("requestfailed", (r) => {
    if (!opts.errorsOk) bad.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`);
  });
  if (opts.before) await opts.before(page);
  const response = await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => undefined);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  if (opts.act) await opts.act(page);

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
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      h1: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      lines,
      targets,
      path: location.pathname,
    };
  });

  const realErrors = errors.filter(
    (e) => !(opts.errorsOk && /status of (4|5)\d\d|net::ERR_FAILED/.test(e))
  );
  check(response?.ok(), `${opts.name}: page status ${response?.status()}`);
  check(realErrors.length === 0, `${opts.name}: 0 console errors`, realErrors);
  check(bad.length === 0, `${opts.name}: 0 failed requests`, bad);
  check(!info.overflow, `${opts.name}: no horizontal overflow`);
  check(info.lang === opts.lang, `${opts.name}: html lang=${opts.lang}`, info.lang);
  check(info.dir === (opts.lang === "ar" ? "rtl" : "ltr"), `${opts.name}: dir`, info.dir);
  check(info.h1 >= 1, `${opts.name}: has an h1`, info.h1);
  const raw = info.lines.filter((l) => RAW_KEY.test(l));
  check(raw.length === 0, `${opts.name}: no raw catalog keys on screen`, raw.slice(0, 5));
  if (phone)
    check(info.targets.length === 0, `${opts.name}: 44px tap targets`, info.targets.slice(0, 6));
  if (opts.lang === "ar") {
    // Company names and e-mail addresses are seeded user data, not UI copy.
    const copy = info.lines.filter((l) => !/LLC|L\.L\.C|@/.test(l));
    const english = classifyLines(copy, opts.allow || []).samples;
    check(english.length === 0, `${opts.name}: no English text in Arabic`, english.slice(0, 6));
  }
  if (axeSource) {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef -- injected by the axe-core script evaluated above
      const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}:${v.nodes.length}`);
    });
    check(violations.length === 0, `${opts.name}: axe serious/critical`, violations);
  }
  if (opts.firmChunks) {
    const heavy = requests.filter((u) => HEAVY_FOR_FIRM.test(u));
    check(heavy.length === 0, `${opts.name}: no report-catalog or admin chunks`, heavy);
  }
  await shot(page, opts.name.replace(/\W+/g, "-"));
  return { page, info, visited, requests };
}

// ─── Screens ─────────────────────────────────────────────────────────────────

async function ownerScreens(browser, viewport, lang, data) {
  const base = { lang, viewport, allow: DATA_ALLOW };
  const phone = viewport !== "desktop";
  const ctx = await signedInContext(browser, viewport, lang, data.owner);

  // Command centre (dashboard).
  const cc = await openScreen(ctx, "/firm/command-center", {
    ...base,
    name: "firm dashboard",
    firmChunks: true,
  });
  await cc.page.close();

  // Client list.
  const list = await openScreen(ctx, "/firm/clients", {
    ...base,
    name: "client list",
    firmChunks: true,
  });
  const { page } = list;
  const cards = await page.locator("[data-testid=clients-cards]").isVisible();
  const table = await page.locator("[data-testid=clients-table]").isVisible();
  check(
    phone ? cards && !table : table && !cards,
    "client list: cards on phones, table on desktop",
    {
      cards,
      table,
    }
  );
  const openBooks = phone
    ? page.locator("[data-testid^=button-open-books-]").first()
    : page.getByRole("button", { name: /Open books|فتح الدفاتر/ }).first();
  const box = await openBooks.boundingBox();
  const vw = page.viewportSize().width;
  check(
    !!box && box.x >= 0 && box.x + box.width <= vw + 1,
    "client list: Open books is inside the viewport without scrolling sideways",
    { box, vw }
  );
  const range = (await page.locator("[data-testid=clients-range]").innerText()).replace(
    /\s+/g,
    " "
  );
  check(/25/.test(range) || /٢٥/.test(range), "client list: 25 rows per page", range);
  check(
    (await page.locator("[data-testid=clients-next]").count()) === 1,
    "client list: pagination offers a next page"
  );
  const unassignedText = await page.locator("[data-testid=filter-unassigned]").innerText();
  const unassignedCount = Number(
    unassignedText.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632)
  );
  check(
    unassignedCount >= CLIENT_COUNT - data.mine.length && unassignedCount <= CLIENT_COUNT + 200,
    "client list: Unassigned counts only clients without staff (assignments are shown)",
    unassignedText
  );
  // Arabic-aware search finds the Arabic client by a word without the article.
  await page.fill("[data-testid=input-client-search]", "نور");
  await page.waitForTimeout(400);
  const found = await page.locator("body").innerText();
  check(found.includes(ARABIC_CLIENT), "client list: Arabic search finds 'النور' by 'نور'");
  await page.fill("[data-testid=input-client-search]", "zzzz-no-such-client");
  await page.waitForTimeout(300);
  const none = await page.locator("body").innerText();
  check(
    !/No clients yet|لا يوجد عملاء بعد/.test(none) &&
      (lang === "ar" ? !/Try adjusting/.test(none) : /Try adjusting/.test(none)),
    "client list: a no-match search says so (localized), not 'No clients yet'"
  );
  await page.close();

  // Open books: the owner's own company is not onboarded; the click must land on the client.
  const nav = await openScreen(ctx, "/firm/clients", { ...base, name: "open books" });
  await nav.page.fill("[data-testid=input-client-search]", data.mine[0].name);
  const target = phone
    ? nav.page.locator(`[data-testid=button-open-books-${data.mine[0].id}]`)
    : nav.page
        .getByRole("row")
        .filter({ hasText: data.mine[0].name })
        .getByRole("button", { name: /Open books|فتح الدفاتر/ });
  await target.click();
  await nav.page
    .waitForURL((u) => /^\/dashboard/.test(u.pathname), { timeout: 15000 })
    .catch(() => undefined);
  await nav.page.getByRole("heading", { level: 1 }).first().waitFor();
  const landed = new URL(nav.page.url()).pathname;
  check(landed === "/dashboard", "open books: lands on the client's /dashboard", landed);
  check(
    !nav.visited.some((p) => /onboarding/.test(p)),
    "open books: never visits the onboarding wizard",
    nav.visited
  );
  check(
    await nav.page.locator("[data-testid=firm-context-banner]").isVisible(),
    "open books: the Managing banner is shown"
  );
  const bannerName = await nav.page.locator("[data-testid=firm-context-company-name]").innerText();
  check(bannerName.includes(data.mine[0].name), "open books: banner names the client", bannerName);
  await nav.page.close();

  // Client profile.
  const prof = await openScreen(ctx, `/firm/clients/${data.mine[0].id}`, {
    ...base,
    name: "client profile",
    firmChunks: true,
  });
  if (lang === "ar") {
    const t = await prof.page.locator("body").innerText();
    check(
      t.includes("بيانات الاتصال") && !t.includes("اتصل بنا"),
      "client profile: Contact card reads 'بيانات الاتصال'"
    );
  }
  await prof.page.close();

  // A client the owner cannot reach (random id): not-found state, not a crash.
  const missing = await openScreen(ctx, "/firm/clients/00000000-0000-4000-8000-0000000000aa", {
    ...base,
    name: "client profile not found",
    errorsOk: true,
  });
  await missing.page.close();
  await ctx.close();

  // Inside the client's books: invoice list and e-invoicing status views.
  const cctx = await signedInContext(browser, viewport, lang, data.owner, data.mine[0].id);
  const inv = await openScreen(cctx, "/invoices", { ...base, name: "client invoice list" });
  const rows = await inv.page.locator("body").innerText();
  check(
    /Retainer|Desert Rose|1,050|2,625|1050|2625/.test(rows) || /Desert Rose/.test(rows),
    "invoice list: shows the client's invoices"
  );
  check(
    (await inv.page.locator("[data-testid=invoices-load-error]").count()) === 0,
    "invoice list: no error state when the API works"
  );
  await inv.page.close();
  const einv = await openScreen(cctx, "/settings/einvoicing", {
    ...base,
    name: "e-invoicing settings",
  });
  await einv.page.close();
  const failing = await openScreen(cctx, "/invoices", {
    ...base,
    name: "invoice list with a failing API",
    errorsOk: true,
    act: (p) =>
      p
        .waitForSelector("[data-testid=invoices-load-error]", { timeout: 25000 })
        .catch(() => undefined),
    before: (p) =>
      p.route(/\/api\/companies\/[^/]+\/invoices(\?|$)/, (r) =>
        r.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"message":"Internal error injected"}',
        })
      ),
  });
  const failText = await failing.page.locator("body").innerText();
  check(
    (await failing.page.locator("[data-testid=invoices-load-error]").count()) === 1,
    "invoice list: a failing API shows an error state with Retry"
  );
  check(
    !/Internal error injected/.test(failText),
    "invoice list: the raw server message is not shown"
  );
  check(
    (await failing.page.locator("[data-testid=invoice-status-tiles]").count()) === 0,
    "invoice list: zeroed status tiles are hidden on error"
  );
  await failing.page.close();
  if (viewport === "desktop") {
    const editor = await cctx.newPage();
    await editor.goto(`${BASE}/invoices/new`);
    const description = editor.getByTestId("input-line-description-0");
    await description.fill("Unsaved retainer for the first client");
    const switcher = editor.getByTestId("button-company-switcher");
    await switcher.click();
    const next = data.mine[1];
    const search = editor.getByTestId("company-switcher-search");
    if (await search.isVisible()) await search.fill(next.name);
    await editor.getByTestId(`company-switcher-item-${next.id}`).click();
    await switcher.filter({ hasText: next.name }).waitFor();
    await description.waitFor();
    check(
      new URL(editor.url()).pathname === "/invoices/new" && (await description.inputValue()) === "",
      "switching clients in the invoice editor clears the previous client's unsaved draft"
    );
    await editor.close();
  }
  await cctx.close();

  // Failing portfolio and command centre.
  const fctx = await signedInContext(browser, viewport, lang, data.owner);
  const failList = await openScreen(fctx, "/firm/clients", {
    ...base,
    name: "client list with a failing API",
    errorsOk: true,
    before: (p) =>
      p.route(/\/api\/firm\/clients(\?|$)/, (r) =>
        r.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"message":"Internal error injected"}',
        })
      ),
    act: (p) =>
      p
        .waitForSelector("[data-testid=portfolio-load-error]", { timeout: 25000 })
        .catch(() => undefined),
  });
  const failListText = await failList.page.locator("body").innerText();
  check(
    (await failList.page.locator("[data-testid=portfolio-load-error]").count()) === 1,
    "client list: a failing API shows the error state with Retry"
  );
  check(
    !/No clients yet|لا يوجد عملاء بعد|Internal error injected/.test(failListText),
    "client list: no false empty portfolio and no raw server message"
  );
  await failList.page.close();
  const failCc = await openScreen(fctx, "/firm/command-center", {
    ...base,
    name: "dashboard with a failing API",
    errorsOk: true,
    before: (p) => p.route(/\/api\/firm\/command-center\/dashboard/, (r) => r.abort("failed")),
    act: (p) =>
      p
        .waitForSelector("[data-testid=firm-command-center-error]", { timeout: 25000 })
        .catch(() => undefined),
  });
  const failCcText = await failCc.page.locator("body").innerText();
  check(
    (await failCc.page.locator("[data-testid=firm-command-center-error]").count()) === 1 &&
      !/Failed to fetch/.test(failCcText),
    "dashboard: a network failure shows localized copy, never 'Failed to fetch'"
  );
  await failCc.page.close();
  await fctx.close();
}

async function staffScreens(browser, viewport, lang, data) {
  const base = { lang, viewport, allow: DATA_ALLOW };
  const uctx = await signedInContext(browser, viewport, lang, data.unassigned);
  const empty = await openScreen(uctx, "/firm/clients", {
    ...base,
    name: "unassigned staff client list",
    firmChunks: true,
  });
  const text = await empty.page.locator("body").innerText();
  check(
    /No clients are assigned to you yet|لم يُعيَّن لك أي عميل بعد/.test(text),
    "unassigned staff: the empty state says no clients are assigned to them"
  );
  check(
    (await empty.page.locator("[data-testid=button-add-client]").count()) === 0 &&
      !/Add first client|Import clients/.test(text),
    "unassigned staff: no Add/Import controls"
  );
  await empty.page.close();
  await uctx.close();

  const actx = await signedInContext(browser, viewport, lang, data.assigned);
  const mine = await openScreen(actx, "/firm/clients", {
    ...base,
    name: "assigned staff client list",
  });
  const body = await mine.page.locator("body").innerText();
  check(
    body.includes(data.mine[0].name) && !body.includes("Audit Client 05"),
    "assigned staff: sees their clients only"
  );
  check(
    (await mine.page.locator("[data-testid=button-add-client]").count()) === 0,
    "assigned staff: no Add client for a preparer"
  );
  await mine.page.close();
  const links = await openScreen(actx, "/firm/practice", { ...base, name: "practice workspace" });
  await links.page.getByRole("tab", { name: /Client links|روابط العملاء/ }).click();
  await links.page.waitForTimeout(500);
  check(
    (await links.page.locator("#firm-invitee-email").count()) === 0,
    "assigned staff: no invite form for a preparer (firm.clients.link)"
  );
  await links.page.close();
  // The client's books as the assigned preparer: no forbidden calls (payroll, approver links).
  const bctx = await signedInContext(browser, viewport, lang, data.assigned, data.mine[0].id);
  const dash = await openScreen(bctx, "/dashboard", {
    ...base,
    name: "assigned staff client dashboard",
  });
  await dash.page.close();
  const einv = await openScreen(bctx, "/settings/einvoicing", {
    ...base,
    name: "assigned staff e-invoicing settings",
  });
  await einv.page.close();
  await bctx.close();
  await actx.close();
}

async function apiChecks(data) {
  currentLabel = "api";
  console.log(`\n=== ${currentLabel} ===`);
  const list = await api("GET", "/api/firm/clients", data.owner.token);
  const row = list.json.find((c) => c.id === data.mine[0].id);
  check(
    row?.assignedStaff?.length === 1,
    "api: client list carries the assigned staff",
    row?.assignedStaff
  );
  check(!JSON.stringify(list.json).match(/iban|wps/i), "api: the client list has no bank details");
  check(
    Math.abs((row?.outstandingAr ?? 0) - data.expectedOpenAr) < 0.01,
    "api: client A/R follows the settlement rule (part-paid invoice)",
    { got: row?.outstandingAr, want: data.expectedOpenAr }
  );
  const links = await api("GET", "/api/firm/client-links", data.unassigned.token);
  check(
    links.status === 200 &&
      links.json.links.length === 0 &&
      !JSON.stringify(links.json).includes(RUN),
    "api: an unassigned preparer gets no client links",
    links.json
  );
  const aLinks = await api("GET", "/api/firm/client-links", data.assigned.token);
  check(
    aLinks.json.links.length === data.mine.length,
    "api: an assigned preparer gets only their clients' links",
    aLinks.json.links?.length
  );
  const other = await api("GET", `/api/firm/comms/log/${data.owner.id}`, data.owner.token);
  check(other.status === 404, "api: another tenant's id is a 404 on the comms log", other.status);
}

async function clientCsvImport(browser, lang, owner) {
  currentLabel = `${lang} client CSV import`;
  const context = await signedInContext(browser, "desktop", lang, owner);
  try {
    const page = await context.newPage();
    await page.goto(BASE + "/firm/clients");
    const label = lang === "ar" ? "استيراد العملاء" : "Import clients";
    const name = `${lang === "ar" ? "شركة اختبار الاستيراد" : "CSV Import Test Company"} ${RUN}`;
    await page.getByRole("button", { name: label, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    const fileInput = dialog.locator("input#import-file");
    const submit = dialog.getByTestId("button-import-clients");
    const upload = async (filename, text) => {
      await fileInput.setInputFiles({
        name: filename,
        mimeType: "text/csv",
        buffer: Buffer.from(text),
      });
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) =>
            new URL(res.url()).pathname === "/api/firm/clients/import" &&
            res.request().method() === "POST"
        ),
        submit.click(),
      ]);
      return response;
    };

    const instructions = await dialog.getByText(/Upload a CSV|ارفع ملف CSV/).innerText();
    check(
      instructions.startsWith(lang === "ar" ? "ارفع ملف CSV" : "Upload a CSV") &&
        instructions.includes("XLSX") &&
        instructions.includes("Company Name") &&
        (await submit.innerText()) === (lang === "ar" ? "استيراد" : "Import"),
      "the dialog shows localized instructions and action text",
      instructions
    );
    check(
      (await fileInput.getAttribute("accept")) === ".csv,.xlsx",
      "the file picker advertises only CSV and XLSX"
    );
    await fileInput.setInputFiles({
      name: "clients.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: Buffer.from("legacy spreadsheet"),
    });
    const fileTypeMessage = lang === "ar" ? "اختر ملف CSV أو XLSX." : "Choose a CSV or XLSX file.";
    await page.getByText(fileTypeMessage, { exact: true }).waitFor();
    check(await submit.isDisabled(), "the legacy XLS file is rejected before submission");

    const invalid = await upload("invalid.csv", 'Company Name\n"unterminated');
    check(
      invalid.status() === 400 && (await invalid.json()).code === "CLIENT_IMPORT_UNREADABLE",
      "malformed CSV returns a structured import error"
    );
    const unreadableMessage =
      lang === "ar"
        ? "تعذّرت قراءة ملف الاستيراد. تحقّق من صيغة الملف وحاول مرة أخرى."
        : "The import file could not be read. Check the file format and try again.";
    await page.getByText(unreadableMessage, { exact: true }).waitFor();
    check(
      await page.getByText(unreadableMessage, { exact: true }).isVisible(),
      "the file error is localized"
    );

    const response = await upload("clients.csv", `Company Name,Emirate\n${name},Dubai\n`);
    check(
      response.status() === 200,
      "valid CSV submitted through the portfolio returns 200",
      response.status()
    );
    if (!response.ok()) return;
    const result = await response.json();
    check(
      result.errors.length === 0 && result.created.length === 1 && result.created[0].name === name,
      "the named company is imported without row errors",
      result
    );
    const duplicate = await upload("duplicate.csv", `Company Name,Emirate\n${name},Dubai\n`);
    const message =
      lang === "ar" ? "يوجد عميل بهذا الاسم بالفعل." : "A client with this name already exists.";
    await dialog.getByText(message, { exact: false }).waitFor();
    check(
      duplicate.ok() &&
        (await duplicate.json()).errors[0].code === "DUPLICATE_CLIENT" &&
        (await dialog.getByText(message, { exact: false }).isVisible()),
      "duplicate row feedback is localized"
    );
  } finally {
    await context.close();
  }
}

// ─── First-load budget (defect 14) ───────────────────────────────────────────

const BUDGET = { requests: 50, scripts: 25, lcpMs: 9000 };
// The realtime client (vendor-socketio) is loaded after the first paint on purpose, so it is not listed.
const NOT_ON_FIRST_LOAD = /vendor-(motion|pdf|pdfjs|tesseract)|reportCatalog|adminConsole/;

async function firstLoadBudget(browser, lang, data) {
  currentLabel = `13 ${lang} first load`;
  const signedIn = await signedInContext(browser, "13", lang, data.owner);
  const state = await signedIn.storageState();
  await signedIn.close();
  for (const route of ["/firm/clients", "/firm/command-center"]) {
    const ctx = await browser.newContext({
      ...DEVICE[13],
      storageState: state,
      locale: lang === "ar" ? "ar-AE" : "en-US",
      timezoneId: "Asia/Dubai",
    });
    await ctx.addInitScript(
      ([l]) => {
        try {
          localStorage.setItem(
            "i18n-storage",
            JSON.stringify({ state: { locale: l }, version: 0 })
          );
          localStorage.setItem("cookie-consent", "accepted");
          localStorage.removeItem("muhasib_active_company_id");
        } catch {
          /* storage blocked */
        }
        window.__lcp = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      },
      [lang]
    );
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 562.5,
      downloadThroughput: 180000,
      uploadThroughput: 84375,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // Requests are counted up to the largest contentful paint: what the first screen costs. Later
    // ones (the idle download of the other firm catalogs, notifications) depend on timing and are
    // not part of the first load.
    const started = [];
    cdp.on("Network.requestWillBeSent", (e) =>
      started.push({ type: e.type, url: e.request.url, at: e.timestamp })
    );
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(500);
    const lcp = await page.evaluate(() => window.__lcp);
    const entry = await page.evaluate(
      () => document.querySelector("script[type=module]")?.getAttribute("src") ?? ""
    );
    const first = started.find((r) => r.type === "Document")?.at ?? started[0]?.at ?? 0;
    const early = started.filter((r) => (r.at - first) * 1000 <= lcp);
    const finished = early.length;
    const urls = early.map((r) => r.url.replace(BASE, ""));
    const scripts = early.filter((r) => r.type === "Script").length;
    const label = `${route} (${lang})`;
    check(entry.startsWith("/firm-assets/"), `${label}: served from the firm build`, entry);
    check(
      urls.filter((u) => NOT_ON_FIRST_LOAD.test(u)).length === 0,
      `${label}: no motion, pdf or report chunks`,
      urls.filter((u) => NOT_ON_FIRST_LOAD.test(u))
    );
    check(
      finished <= BUDGET.requests,
      `${label}: ${finished} requests before LCP (budget ${BUDGET.requests})`,
      finished
    );
    check(
      scripts <= BUDGET.scripts,
      `${label}: ${scripts} scripts before LCP (budget ${BUDGET.scripts})`,
      scripts
    );
    check(
      lcp > 0 && lcp < BUDGET.lcpMs,
      `${label}: LCP ${Math.round(lcp)} ms on Slow 4G, 4x CPU (budget ${BUDGET.lcpMs} ms)`,
      lcp
    );
    await ctx.close();
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(CHROMIUM_FALLBACK) ? CHROMIUM_FALLBACK : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const data = await seed();
  await apiChecks(data);
  for (const viewport of VIEWPORTS)
    for (const lang of LANGS) {
      currentLabel = `${viewport} ${lang}`;
      console.log(`\n=== ${currentLabel} ===`);
      await ownerScreens(browser, viewport, lang, data);
      await staffScreens(browser, viewport, lang, data);
    }
  for (const lang of LANGS) await firstLoadBudget(browser, lang, data);
  for (const lang of LANGS) await clientCsvImport(browser, lang, data.owner);
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
