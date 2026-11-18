#!/usr/bin/env node
/**
 * Sign-in, password recovery, pricing and the signed-in client portal, on phones and desktop, in
 * English and Arabic.
 *
 *   BASE_URL=http://localhost:5052 DATABASE_URL=postgres://... node tests/e2e/auth-portal-flow.mjs
 *
 * Needs a running production build (FRONTEND_URL = BASE_URL), local only. It registers a synthetic
 * company, a customer and a sent invoice, then a second synthetic user who is turned into a
 * client-portal member of that customer (rows written through DATABASE_URL, like the e-mail
 * outbox reads of customer-links-flow). For iPhone SE (375x667), a small Android (360x740),
 * iPhone 13 and 1440x900 in en and ar it opens:
 *   /login (empty, wrong password, keyboard open), /forgot-password (and its sent state),
 *   /reset-password (with and without a token), /pricing, and the five /client-portal/* pages,
 * and checks, per screen:
 *   - 0 console errors (the browser's own 401/429 line for a refused sign-in excepted), 0 failed
 *     requests, no horizontal overflow, `<html lang dir>`, one h1, a title;
 *   - phone: 16 px inputs (no iOS zoom), 44 px tap targets, the focused field stays above the
 *     keyboard; no text under 12 px;
 *   - Arabic: no English text nodes (names, numbers, brands and acronyms excepted);
 *   - axe-core serious/critical violations (WCAG A/AA) = 0;
 *   - login: e-mail is the saved `username`, password `current-password`; reset: `new-password`;
 *   - pricing: the Enterprise mailto subject follows the language, address unchanged;
 *   - client portal: the light root (no signed-in app, motion or socket; JS under 330 KB),
 *     one h1, the invoice PDF downloads, a refused PDF shows a localized message.
 *
 * Environment: BASE_URL (default http://localhost:5000), DATABASE_URL (required), SHOT_DIR,
 * E2E_VIEWPORTS (se,android,13,desktop), E2E_LANGS (en,ar), CHROMIUM_PATH. Exits 1 on a failure.
 * Wrong-password attempts are throttled per IP: restart the app between runs.
 */
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
const SUPPORT_ADDRESS = "support@muhasib.ai";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (the portal member is bound through the database).");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

const VIEWPORTS = (process.env.E2E_VIEWPORTS || "se,android,13,desktop").split(",");
const LANGS = (process.env.E2E_LANGS || "en,ar").split(",");
const DEVICE = {
  se: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } },
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

// ─── Data ────────────────────────────────────────────────────────────────────

async function seed() {
  const owner = `owner+${RUN}@example.com`;
  const reg = await api("POST", "/api/auth/register", null, {
    name: "Layla Owner",
    email: owner,
    password: PW,
    companyName: `Al Noor Trading ${RUN} LLC`,
  });
  if (reg.status >= 300) throw new Error(`register failed: ${reg.status}`);
  const login = await api("POST", "/api/auth/login", null, { email: owner, password: PW });
  const token = login.json.token;
  const companies = await api("GET", "/api/companies", token);
  const companyId = companies.json[0].id;
  // A tax invoice needs the seller's TRN and an emirate before it can be sent.
  await api("PATCH", `/api/companies/${companyId}`, token, {
    trnVatNumber: "100123456700003",
    contactEmail: `billing+${RUN}@alnoor.example`,
    emirate: "dubai",
  });
  const contact = await api("POST", `/api/companies/${companyId}/customer-contacts`, token, {
    name: "Desert Rose Catering FZ-LLC",
    nameAr: "ديزرت روز للتموين",
    email: `ap+${RUN}@desertrose.example`,
  });
  const today = Date.now();
  const day = (n) => new Date(today + n * 86400000).toISOString().slice(0, 10);
  const lines = Array.from({ length: 12 }, (_, i) => ({
    description: `Consulting line ${i + 1}`,
    quantity: i + 1,
    unitPrice: 1250.5,
    vatRate: 5,
  }));
  const invoice = await api("POST", `/api/companies/${companyId}/invoices`, token, {
    contactId: contact.json.id,
    date: day(-40),
    dueDate: day(-10),
    lines,
  });
  if (invoice.status >= 300) throw new Error(`invoice failed: ${invoice.status}`);
  const sent = await api("PATCH", `/api/invoices/${invoice.json.id}/status`, token, {
    status: "sent",
  });
  if (sent.status >= 300)
    throw new Error(`send failed: ${sent.status} ${JSON.stringify(sent.json)}`);

  const member = `client+${RUN}@example.com`;
  await api("POST", "/api/auth/register", null, {
    name: "Layla Al Hashimi",
    email: member,
    password: PW,
    companyName: `Layla Personal ${RUN}`,
  });
  const { rows } = await db.query(
    `UPDATE users SET user_type = 'client_portal' WHERE email = $1 RETURNING id`,
    [member]
  );
  const userId = rows[0].id;
  await db.query(
    `INSERT INTO company_users (company_id, user_id, role) VALUES ($1, $2, 'viewer')
       ON CONFLICT DO NOTHING`,
    [companyId, userId]
  );
  const bind = await api("POST", `/api/portal/contacts/${contact.json.id}/portal-users`, token, {
    userId,
  });
  if (bind.status >= 300)
    throw new Error(`bind failed: ${bind.status} ${JSON.stringify(bind.json)}`);
  return { member };
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

const BROWSER_OWN_ERROR =
  /Failed to load resource: the server responded with a status of (401|429)/;
const LEAN_BAD = /vendor-motion|vendor-socketio|\/App-|reportCatalog/;

async function openContext(browser, viewport, lang, { signedIn }) {
  const ctx = await browser.newContext({
    ...DEVICE[viewport],
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
    acceptDownloads: true,
  });
  await ctx.addInitScript(
    ([l, hint]) => {
      try {
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
        localStorage.setItem("cookie-consent", "accepted");
        if (hint) localStorage.setItem("muhasib_auth_hint", "1");
      } catch {
        /* storage blocked */
      }
    },
    [lang, signedIn]
  );
  return ctx;
}

/** Open `url` and run the generic checks. opts: lang, viewport, allow, errorsOk, lean, name, act. */
async function openScreen(ctx, url, opts) {
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  let jsBytes = 0;
  const requests = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) =>
    bad.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`)
  );
  page.on("response", (r) => {
    const u = r.url().replace(BASE, "");
    requests.push(u);
    if (/\.js(\?|$)/.test(u)) jsBytes += Number(r.headers()["content-length"] || 0);
    if (r.status() >= 400 && r.url().startsWith(BASE) && !opts.errorsOk)
      bad.push(`${r.status()} ${u}`);
  });
  const response = await page.goto(BASE + url, { waitUntil: "load" });
  await page
    .waitForLoadState("networkidle", { timeout: 10000 })
    .catch(() => errors.push("NETWORK-NOT-IDLE"));
  if (opts.act) await opts.act(page);
  await page.waitForTimeout(300);

  const phone = opts.viewport !== "desktop";
  const info = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const lines = [];
    const tiny = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) || !vis(el)) continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const own = el.closest("[lang]");
      if (!(own && !own.getAttribute("lang").startsWith(document.documentElement.lang)))
        lines.push(text);
      if (parseFloat(getComputedStyle(el).fontSize) < 12) tiny.push(text.slice(0, 20));
    }
    const targets = [
      ...document.querySelectorAll(
        "a,button,input,select,textarea,[role=button],[role=tab],[role=radio]"
      ),
    ]
      .filter(
        (e) =>
          vis(e) &&
          !e.closest(".sr-only") &&
          !e.hasAttribute("hidden") &&
          e.type !== "hidden" &&
          e.type !== "file"
      )
      .filter((e) => {
        const r = e.getBoundingClientRect();
        // A link inside a sentence is exempt (WCAG 2.5.8); everything else needs 44 px of height.
        const inline =
          e.tagName === "A" && e.closest("p, li") && getComputedStyle(e).display === "inline";
        return !inline && r.height < 43.5;
      })
      .map(
        (e) =>
          `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || e.id || "").trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().height)}`
      );
    const smallInputs = [...document.querySelectorAll("input,select,textarea")]
      .filter((e) => vis(e) && e.type !== "file" && parseFloat(getComputedStyle(e).fontSize) < 16)
      .map((e) => `${e.id || e.name}:${getComputedStyle(e).fontSize}`);
    const ae = document.activeElement;
    const ar = ae && ae.tagName === "INPUT" ? ae.getBoundingClientRect() : null;
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      title: document.title,
      h1: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      lines,
      tiny,
      targets,
      smallInputs,
      focusedVisible: ar ? ar.top >= 0 && ar.bottom <= window.innerHeight : null,
    };
  });

  const realErrors = errors.filter((e) => !(opts.errorsOk && BROWSER_OWN_ERROR.test(e)));
  check(response?.ok(), `${opts.name}: page status ${response?.status()}`);
  check(realErrors.length === 0, `${opts.name}: 0 console errors`, realErrors);
  check(bad.length === 0, `${opts.name}: 0 failed requests`, bad);
  check(!info.overflow, `${opts.name}: no horizontal overflow`);
  check(info.lang === opts.lang, `${opts.name}: html lang=${opts.lang}`, info.lang);
  check(info.dir === (opts.lang === "ar" ? "rtl" : "ltr"), `${opts.name}: dir`, info.dir);
  check(info.h1 === 1, `${opts.name}: one h1`, info.h1);
  check(
    !!info.title && !/AI-Assisted Accounting/.test(info.title),
    `${opts.name}: page title`,
    info.title
  );
  check(info.tiny.length === 0, `${opts.name}: no text under 12px`, info.tiny.slice(0, 4));
  if (phone) {
    check(info.targets.length === 0, `${opts.name}: 44px tap targets`, info.targets.slice(0, 5));
    check(
      info.smallInputs.length === 0,
      `${opts.name}: 16px inputs (no iOS zoom)`,
      info.smallInputs
    );
  }
  if (opts.keyboard)
    check(
      info.focusedVisible !== false,
      `${opts.name}: focused field stays visible above the keyboard`
    );
  if (opts.lang === "ar") {
    const english = classifyLines(info.lines, opts.allow || []).samples;
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
  if (opts.lean) {
    const heavy = requests.filter((u) => LEAN_BAD.test(u));
    check(heavy.length === 0, `${opts.name}: light root (no signed-in app, motion, socket)`, heavy);
    check(
      jsBytes < 330 * 1024,
      `${opts.name}: ${(jsBytes / 1024).toFixed(0)} KB JS (< 330)`,
      jsBytes
    );
  }
  await shot(page, opts.name.replace(/\W+/g, "-"));
  return { page, info };
}

// ─── Screens ─────────────────────────────────────────────────────────────────

async function signedOutScreens(browser, viewport, lang, member) {
  const phone = viewport !== "desktop";
  const base = { lang, viewport };
  const ctx = await openContext(browser, viewport, lang, { signedIn: false });

  // Login: empty, wrong password, keyboard open.
  const login = await openScreen(ctx, "/login", {
    ...base,
    name: "login",
    keyboard: phone,
    act: async (p) => {
      if (!phone) return;
      const vp = p.viewportSize();
      await p.setViewportSize({ width: vp.width, height: Math.round(vp.height * 0.45) });
      await p.locator('[data-testid="input-password"]').focus();
    },
  });
  const email = login.page.locator('[data-testid="input-email"]');
  const pw = login.page.locator('[data-testid="input-password"]');
  check(
    (await email.getAttribute("autocomplete")) === "username",
    "login: e-mail is the saved username"
  );
  check((await email.getAttribute("inputmode")) === "email", "login: e-mail keyboard");
  check((await pw.getAttribute("autocomplete")) === "current-password", "login: current-password");
  await login.page.close();

  const wrong = await openScreen(ctx, "/login", {
    ...base,
    name: "login wrong password",
    errorsOk: true,
    act: async (p) => {
      await p.fill('[data-testid="input-email"]', "nobody@example.com");
      await p.fill('[data-testid="input-password"]', "wrong-password-1");
      await p.click('[data-testid="button-login"]');
      await p.waitForSelector('[data-testid="login-error"]', { timeout: 8000 });
    },
  });
  const message = (await wrong.page.locator('[data-testid="login-error"]').innerText()).trim();
  check(
    lang === "ar" ? !/[A-Za-z]{4,}/.test(message) : message.length > 0,
    "login: error message is localized",
    message
  );
  await wrong.page.close();

  const forgot = await openScreen(ctx, "/forgot-password", {
    ...base,
    name: "forgot password",
    keyboard: phone,
  });
  check(
    (await forgot.page.locator('[data-testid="input-email"]').getAttribute("dir")) === "ltr",
    "forgot: e-mail field is left-to-right"
  );
  await forgot.page.close();
  const forgotDone = await openScreen(ctx, "/forgot-password", {
    ...base,
    name: "forgot password sent",
    act: async (p) => {
      // The server throttles reset requests per IP; the screen state is what is checked here.
      await p.route("**/api/auth/forgot-password", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      );
      await p.fill('[data-testid="input-email"]', member);
      await p.click('[data-testid="button-send-reset"]');
      await p.waitForSelector('[data-testid="text-forgot-result"]', { timeout: 8000 });
    },
  });
  await forgotDone.page.close();

  const reset = await openScreen(ctx, `/reset-password?token=${"a".repeat(40)}`, {
    ...base,
    name: "reset password",
    keyboard: phone,
  });
  const fields = reset.page.locator('input[autocomplete="new-password"]');
  check((await fields.count()) === 2, "reset: both fields are new-password");
  await reset.page.close();
  const noToken = await openScreen(ctx, "/reset-password", {
    ...base,
    name: "reset password no token",
  });
  await noToken.page.close();

  // Pricing: the Enterprise mailto subject follows the language.
  const pricing = await openScreen(ctx, "/pricing", { ...base, name: "pricing" });
  const hrefs = await pricing.page.$$eval('a[href^="mailto:"]', (as) =>
    as.map((a) => a.getAttribute("href"))
  );
  const subjects = hrefs
    .map((h) => new URL(h))
    .filter((u) => u.searchParams.has("subject"))
    .map((u) => ({ to: u.pathname, subject: u.searchParams.get("subject") }));
  check(subjects.length > 0, "pricing: Enterprise mailto present");
  check(
    subjects.every((s) => s.to === SUPPORT_ADDRESS),
    "pricing: mailto address unchanged",
    subjects
  );
  check(
    subjects.every((s) =>
      lang === "ar"
        ? /المؤسسات/.test(s.subject) && !/Enterprise/.test(s.subject)
        : s.subject === "Muhasib.ai Enterprise"
    ),
    "pricing: mailto subject follows the language",
    subjects
  );
  await pricing.page.close();
  await ctx.close();
}

async function portalScreens(browser, viewport, lang, member) {
  const base = {
    lang,
    viewport,
    lean: true,
    allow: [
      "Desert",
      "Rose",
      "Catering",
      "Al",
      "Noor",
      "Trading",
      "Layla",
      "Hashimi",
      "Personal",
      RUN,
    ],
  };
  const ctx = await openContext(browser, viewport, lang, { signedIn: true });
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: member, password: PW },
  });
  check(res.ok(), "client portal member signs in", res.status());
  for (const section of ["dashboard", "invoices", "documents", "statements", "messages"]) {
    const s = await openScreen(ctx, `/client-portal/${section}`, {
      ...base,
      name: `client portal ${section}`,
    });
    if (section === "invoices") {
      // Desktop shows the PDF button on the row; phones keep one 44px "more" button that opens it.
      const pdfAction = async () => {
        const inline = s.page.getByRole("button", { name: /PDF/ }).first();
        if ((await inline.count()) && (await inline.isVisible())) return inline.click();
        await s.page.locator("table button[aria-haspopup='menu']").first().click();
        return s.page.getByRole("menuitem", { name: /PDF/ }).first().click();
      };
      const download = s.page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
      await pdfAction();
      const file = await download;
      check(
        !!file && /\.pdf$/.test(file.suggestedFilename()),
        "client portal: invoice PDF downloads",
        file?.suggestedFilename()
      );
      // A refused PDF is a localized message, not silence.
      await s.page.route("**/api/client-portal/invoices/*/pdf", (r) =>
        r.fulfill({ status: 500, body: "{}" })
      );
      await pdfAction();
      await s.page.waitForTimeout(600);
      const shown = await s.page.locator("body").innerText();
      check(
        shown.includes(lang === "ar" ? "تعذّر تنزيل ملف PDF" : "The PDF could not be downloaded"),
        "client portal: failed PDF shows a localized message"
      );
    }
    await s.page.close();
  }
  await ctx.close();
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const { member } = await seed();
  for (const viewport of VIEWPORTS)
    for (const lang of LANGS) {
      currentLabel = `${viewport} ${lang}`;
      console.log(`\n=== ${currentLabel} ===`);
      await signedOutScreens(browser, viewport, lang, member);
      await portalScreens(browser, viewport, lang, member);
    }
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
