#!/usr/bin/env node
/**
 * Arabic runtime completeness crawl (R18-02, R18-11).
 *
 *   BASE_URL=http://127.0.0.1:5000 node tests/e2e/arabic-runtime-crawl.mjs
 *
 * The static i18n scanner (scripts/i18n-scan.mjs) only sees literals in the
 * source; strings that come from data, hooks or libraries (report catalog
 * labels, chart configs, toasts) slip past it. This crawl looks at what the
 * browser actually renders: it registers a synthetic customer with an Arabic
 * company name, completes express onboarding, seeds one customer, one draft
 * invoice and one receipt, switches the UI to Arabic and visits the launch
 * routes shared with the a11y crawl (tests/e2e/launch-routes.mjs). On each
 * route it collects the visible text nodes (source case, so CSS uppercase
 * cannot disguise a word as an acronym) and counts the ones
 * that still contain English words once allow-listed tokens are removed
 * (tests/e2e/lib/latin-text.mjs: brand names, numbers, ALL-CAPS acronyms such
 * as AED/VAT/TRN/IBAN, e-mails, URLs, document numbers). Text inside an
 * element marked `translate="no"` (user data) or carrying a non-Arabic `lang`
 * attribute (the "English" language switch) is ignored.
 *
 * Fails when any route has more English lines than ARABIC_MAX_ENGLISH_LINES
 * (default 0). Writes tests/e2e/.artifacts/arabic-runtime-last-run.json with
 * per-route counts and the offending lines.
 *
 * Environment:
 *   BASE_URL                    target app (default http://127.0.0.1:5000)
 *   ARABIC_ALLOW_REMOTE=true    required for a non-local BASE_URL (it registers a user)
 *   ARABIC_EMAIL/ARABIC_PASSWORD sign in as an existing user instead of registering
 *   ARABIC_PUBLIC=true          crawl the 14 signed-out public routes (PUBLIC_ROUTES) instead:
 *                               no registration, no seeding, a fresh signed-out browser
 *   --all (or ARABIC_ALL=true)  visit EVERY authenticated route in client/src/App.tsx
 *                               (ALL_AUTH_ROUTES, plus the param routes resolved against seeded
 *                               records) instead of the 20 launch routes. With a local
 *                               DATABASE_URL the synthetic user is promoted to admin + firm
 *                               owner first so ADMIN_ROUTES and FIRM_ROUTES render; without it
 *                               those 20 routes are skipped and listed in the report.
 *   ARABIC_ROUTES=/a,/b         override the route list
 *   ARABIC_MAX_ENGLISH_LINES=n  per-route tolerance (default 0)
 *   ARABIC_ALLOW=a,b            extra allow-listed tokens (seeded data)
 *   ARABIC_STATES=false         skip the state probes (B14): after the routes the crawl also
 *                               measures states a plain visit never shows — the VAT Workpaper
 *                               tab ("/vat-filing#workpaper") and, in a fresh signed-out
 *                               browser, the sign-in and password-reset rate-limit messages
 *                               ("/login#rate-limit", "/forgot-password#rate-limit"). The
 *                               rate-limit probes lock a random, non-existent e-mail only.
 *   CHROMIUM_PATH               existing Chromium binary (else Playwright's own)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  ADMIN_ROUTES,
  ALL_AUTH_ROUTES,
  FIRM_ROUTES,
  LAUNCH_ROUTES,
  PARAM_ROUTES,
  PUBLIC_ROUTES,
} from "./launch-routes.mjs";
import { classifyLines } from "./lib/latin-text.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
// Fable N1: browse in UAE time so a business date formatted as a browser-zone instant (a 30 Sep
// period end shown as 1 Oct) shows up here. Override with E2E_TIMEZONE.
const BROWSER_TIMEZONE = process.env.E2E_TIMEZONE || "Asia/Dubai";
const ALLOW_REMOTE = process.env.ARABIC_ALLOW_REMOTE === "true";
const PUBLIC_ONLY = process.env.ARABIC_PUBLIC === "true";
const ALL = process.argv.includes("--all") || process.env.ARABIC_ALL === "true";
const MAX_ENGLISH = Number(process.env.ARABIC_MAX_ENGLISH_LINES ?? 0);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, ".artifacts");
let ROUTES = process.env.ARABIC_ROUTES
  ? process.env.ARABIC_ROUTES.split(",").map((route) => route.trim())
  : PUBLIC_ONLY
    ? PUBLIC_ROUTES
    : LAUNCH_ROUTES;
const EXTRA_ALLOW = (process.env.ARABIC_ALLOW ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
if (!isLocal && !ALLOW_REMOTE && !PUBLIC_ONLY) {
  console.error(
    `Refusing to register a synthetic customer on ${BASE}. Set ARABIC_ALLOW_REMOTE=true only for disposable targets.`
  );
  process.exit(2);
}

// Bearer token from the login response; Bearer requests are CSRF-exempt.
let bearer = "";
let syntheticEmail = "";

async function api(page, method, url, data) {
  const res = await page.request.fetch(`${BASE}${url}`, {
    method,
    data,
    headers: { Authorization: `Bearer ${bearer}` },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status(), body };
}

/** Seed a little data so list views render rows, not only empty states. */
async function seed(page) {
  const me = await api(page, "GET", "/api/companies");
  const companies = Array.isArray(me.body) ? me.body : (me.body?.items ?? []);
  const companyId = companies[0]?.id;
  if (!companyId) return { seeded: false, reason: `no company (${me.status})` };
  const out = { companyId };
  const contact = await api(page, "POST", `/api/companies/${companyId}/customer-contacts`, {
    name: "مؤسسة النخيل",
    email: "palm@example.com",
  });
  out.contact = contact.status === 201 || contact.status === 200 ? contact.status : contact;
  const today = new Date().toISOString().slice(0, 10);
  const invoice = await api(page, "POST", `/api/companies/${companyId}/invoices`, {
    customerName: "مؤسسة النخيل",
    date: today,
    dueDate: today,
    currency: "AED",
    lines: [{ description: "خدمات استشارية", quantity: 1, unitPrice: 1000, vatRate: 0.05 }],
  });
  out.invoice = invoice.status < 300 ? invoice.status : invoice;
  const receipt = await api(page, "POST", `/api/companies/${companyId}/receipts`, {
    merchant: "مكتبة الشارقة",
    date: today,
    amount: 105,
    vatAmount: 5,
    category: "Office Supplies",
    currency: "AED",
  });
  out.receipt = receipt.status < 300 ? receipt.status : receipt;
  if (ALL) {
    // Records behind the param routes: an account (ledger), a balanced journal entry (detail).
    const accounts = await api(page, "GET", `/api/companies/${companyId}/accounts`);
    const list = Array.isArray(accounts.body) ? accounts.body : (accounts.body?.items ?? []);
    out.accountId = list[0]?.id;
    const debit = list.find((a) => a.type === "expense") ?? list[0];
    const credit = list.find((a) => a.type === "asset") ?? list[1];
    if (debit && credit) {
      const entry = await api(page, "POST", `/api/companies/${companyId}/journal`, {
        date: today,
        memo: "قيد تجريبي للفحص",
        lines: [
          { accountId: debit.id, debit: 150, credit: 0 },
          { accountId: credit.id, debit: 0, credit: 150 },
        ],
      });
      out.journalId = entry.body?.id ?? entry.body?.entry?.id;
      out.journal = entry.status < 300 ? entry.status : entry;
    }
  }
  return out;
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: BROWSER_TIMEZONE,
  });
  const page = await context.newPage();
  const report = {
    base: BASE,
    mode: PUBLIC_ONLY ? "public" : ALL ? "all" : "app",
    maxEnglish: MAX_ENGLISH,
    routes: {},
    failures: [],
  };

  await context.addInitScript((PUBLIC_FLAG) => {
    try {
      if (!PUBLIC_FLAG) localStorage.setItem("muhasib_auth_hint", "1");
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
    } catch {
      /* storage blocked */
    }
  }, PUBLIC_ONLY);

  if (PUBLIC_ONLY) {
    // Signed-out visitor: nothing to register or seed.
  } else if (process.env.ARABIC_EMAIL && process.env.ARABIC_PASSWORD) {
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: process.env.ARABIC_EMAIL, password: process.env.ARABIC_PASSWORD },
    });
    if (login.status() >= 300) throw new Error(`login failed: ${login.status()}`);
    bearer = (await login.json().catch(() => ({}))).token ?? "";
  } else {
    const email = `ar-runtime+${Date.now()}@test.local`;
    syntheticEmail = email;
    const reg = await page.request.post(`${BASE}/api/auth/register`, {
      data: {
        email,
        password: "Password123!",
        name: "سارة أحمد",
        companyName: "شركة الواحة للتجارة ذ.م.م",
      },
    });
    if (reg.status() !== 200 && reg.status() !== 201) {
      throw new Error(`register failed: ${reg.status()} ${(await reg.text()).slice(0, 200)}`);
    }
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: "Password123!" },
    });
    if (login.status() >= 300) throw new Error(`login failed: ${login.status()}`);
    bearer = (await login.json().catch(() => ({}))).token ?? "";
  }

  if (!PUBLIC_ONLY) {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(2200);
    const express = page.locator('[data-testid="onboarding-express"]');
    // The redirect to /onboarding can land after a fixed wait on a cold build.
    await express.waitFor({ timeout: 10000 }).catch(() => undefined);
    if (await express.count()) {
      await express.click();
      await page.waitForTimeout(3500);
      // WP-B: onboarding is three screens; skip the starting point, then look around.
      for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
        const next = page.locator(`[data-testid="${id}"]`);
        if (await next.count()) {
          await next.click();
          await page.waitForTimeout(1500);
        }
      }
    }
    if (process.env.ARABIC_SEED !== "false") report.seed = await seed(page);
  }

  if (ALL && syntheticEmail && process.env.DATABASE_URL && isLocal) {
    // Admin + firm routes only render for staff accounts. Promote the disposable synthetic user
    // after onboarding and seeding (a firm role would route it to the firm wizard first).
    const { default: pg } = await import("pg");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(
      `UPDATE users SET is_admin = true, user_type = 'admin', firm_role = 'firm_owner', email_verified = true WHERE email = $1`,
      [syntheticEmail]
    );
    await db.end();
    const relogin = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: syntheticEmail, password: "Password123!" },
    });
    if (relogin.status() >= 300) throw new Error(`login failed: ${relogin.status()}`);
    bearer = (await relogin.json().catch(() => ({}))).token ?? "";
    report.promoted = true;
  }

  if (ALL && !process.env.ARABIC_ROUTES) {
    const seeded = report.seed ?? {};
    const ids = { account: seeded.accountId, journal: seeded.journalId, company: seeded.companyId };
    const staff = report.promoted ? [...ADMIN_ROUTES, ...FIRM_ROUTES] : [];
    report.skippedStaffRoutes = report.promoted ? [] : [...ADMIN_ROUTES, ...FIRM_ROUTES];
    const params = [];
    report.skippedParamRoutes = [];
    for (const [pattern, kind] of Object.entries(PARAM_ROUTES)) {
      const staffOnly = pattern.startsWith("/admin/") || pattern.startsWith("/firm/");
      if (!ids[kind] || (staffOnly && !report.promoted)) {
        report.skippedParamRoutes.push(pattern);
        continue;
      }
      params.push(pattern.replace(/:\w+/, ids[kind]));
    }
    ROUTES = [...ALL_AUTH_ROUTES, ...staff, ...params];
  }

  for (const route of ROUTES) {
    try {
      await page.goto(`${BASE}${route}`, { timeout: 45000 });
    } catch (error) {
      report.failures.push({ route, rule: "navigation", error: String(error).slice(0, 160) });
      console.log(`${route.padEnd(22)} navigation failed`);
      continue;
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Close the welcome tour / any modal so the page itself is measured.
    if (await page.locator('[role="dialog"]').count()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await measure(page, route, report);
  }

  if (!PUBLIC_ONLY && process.env.ARABIC_STATES !== "false" && !process.env.ARABIC_ROUTES) {
    await probeStates(browser, page, report);
  }

  await browser.close();
  const out = path.join(
    ARTIFACT_DIR,
    PUBLIC_ONLY
      ? "arabic-public-last-run.json"
      : ALL
        ? "arabic-runtime-all-last-run.json"
        : "arabic-runtime-last-run.json"
  );
  await writeFile(out, JSON.stringify(report, null, 2));
  const total = Object.values(report.routes).reduce((sum, r) => sum + r.englishLines, 0);
  console.log(
    `\n=== Arabic runtime crawl: ${Object.keys(report.routes).length} routes/states · ${total} English line(s) · ${report.failures.length} failure(s) ===`
  );
  for (const failure of report.failures) console.log(JSON.stringify(failure));
  console.log(`Report: ${out}`);
  process.exit(report.failures.length > 0 ? 1 : 0);
}

/** Count the English lines on the current page and record them under `route`. */
async function measure(page, route, report) {
  {
    // Visible text nodes in their source case (innerText would apply CSS text-transform and
    // turn "Actions" into an acronym-looking "ACTIONS").
    const sample = await page.evaluate(() => {
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
      const exempt = '[translate="no"], body [lang]:not([lang^="ar"])';
      const texts = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = (node.textContent || "").replace(/\s+/g, " ").trim();
        const parent = node.parentElement;
        if (!value || !parent || SKIP_TAGS.has(parent.tagName)) continue;
        if (parent.closest(exempt)) continue;
        if (typeof parent.checkVisibility === "function" && !parent.checkVisibility()) continue;
        if (parent.getClientRects().length === 0) continue;
        texts.push(value);
      }
      return {
        texts,
        dir: document.documentElement.dir,
        lang: document.documentElement.lang,
        path: location.pathname,
      };
    });
    const lines = sample.texts;
    const result = classifyLines(lines, EXTRA_ALLOW);
    report.routes[route] = {
      finalPath: sample.path,
      dir: sample.dir,
      lang: sample.lang,
      lines: result.total,
      englishLines: result.english,
      english: result.samples,
    };
    if (sample.dir !== "rtl") report.failures.push({ route, rule: "not-rtl", dir: sample.dir });
    if (result.english > MAX_ENGLISH) {
      report.failures.push({ route, rule: "english-lines", count: result.english });
    }
    console.log(
      `${route.padEnd(22)} ${String(result.english).padStart(4)} English / ${result.total} lines`
    );
  }
}

/**
 * States a route visit never reaches (B14): a tab behind a click and messages the server only
 * sends after repeated failures. Each is recorded like a route, so English there fails the run.
 */
async function probeStates(browser, page, report) {
  const fail = (route, error) => {
    report.failures.push({ route, rule: "state-probe", error: String(error).slice(0, 200) });
    console.log(`${route.padEnd(22)} probe failed`);
  };

  // VAT return -> Workpaper tab (the accountant's grid).
  try {
    await page.goto(`${BASE}/vat-filing`, { timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.locator('[data-testid="tab-vat-workpaper"]').click({ timeout: 15000 });
    await page.locator('[data-testid="vat-workpaper-panel"]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await measure(page, "/vat-filing#workpaper", report);
  } catch (error) {
    fail("/vat-filing#workpaper", error);
  }

  // Rate-limit messages, in a fresh signed-out Arabic browser. A random address that has no
  // account: the per-address lockout opens after RL_LOGIN_LOCK_MAX (default 5) failures, so the
  // API takes the first failures and the form shows the server's 429 sentence.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: BROWSER_TIMEZONE,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
      localStorage.setItem("cookie-consent", "accepted");
    } catch {
      /* storage blocked */
    }
  });
  const visitor = await context.newPage();
  const lockedEmail = `ar-ratelimit+${Date.now()}@test.local`;
  const attempts = Number(process.env.RL_LOGIN_LOCK_MAX ?? 5) + 1;

  try {
    for (let i = 0; i < attempts; i += 1) {
      await visitor.request.post(`${BASE}/api/auth/login`, {
        data: { email: lockedEmail, password: "Wrong-password-1" },
      });
    }
    await visitor.goto(`${BASE}/login`, { timeout: 45000 });
    await visitor.locator('[data-testid="input-email"]').fill(lockedEmail);
    await visitor.locator('[data-testid="input-password"]').fill("Wrong-password-1");
    await visitor.locator('[data-testid="button-login"]').click();
    await visitor.locator('[data-testid="login-error"]').waitFor({ timeout: 15000 });
    await measure(visitor, "/login#rate-limit", report);
  } catch (error) {
    fail("/login#rate-limit", error);
  }

  try {
    for (let i = 0; i < attempts; i += 1) {
      await visitor.request.post(`${BASE}/api/auth/forgot-password`, {
        data: { email: lockedEmail },
      });
    }
    await visitor.goto(`${BASE}/forgot-password`, { timeout: 45000 });
    await visitor.locator('[data-testid="input-email"]').fill(lockedEmail);
    await visitor.locator('[data-testid="button-send-reset"]').click();
    await visitor.locator('[role="alert"], [data-testid="text-forgot-result"]').first().waitFor({
      timeout: 15000,
    });
    await visitor.waitForTimeout(400);
    await measure(visitor, "/forgot-password#rate-limit", report);
  } catch (error) {
    fail("/forgot-password#rate-limit", error);
  }
  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
