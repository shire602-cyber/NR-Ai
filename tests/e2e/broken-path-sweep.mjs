#!/usr/bin/env node
/**
 * Broken-path sweep (pre-release, owner requirement "no broken paths").
 *
 *   BASE_URL=http://localhost:<port> DATABASE_URL=<scratch db> npm run e2e:sweep
 *
 * For each persona (tests/e2e/lib/sweep-personas.mjs: trial owner, owner with populated books,
 * accountant, viewer, NR firm staff, NR admin, client-portal user, signed-out visitor) and each
 * language (en, ar) it:
 *   1. loads every route the persona can reach: the App.tsx route table
 *      (tests/e2e/launch-routes.mjs, pinned to App.tsx by tests/unit/launch-routes-all.test.ts),
 *      the param routes resolved against seeded records, and every in-app link found on the
 *      pages it visits (sidebar, settings sub-nav, footer, in-page links);
 *   2. fails a page on: 4xx/5xx document, a 5xx or non-gate 4xx API response (401/402/403 are
 *      deliberate gates), the 404 page, an error boundary, a blank main area, a console error,
 *      a page error or unhandled rejection, a failed same-origin request, horizontal scroll,
 *      a visible native date/select/file input, a raw i18n key / {placeholder} / UUID /
 *      "undefined" in visible text, and (Arabic) English UI text or a non-RTL document. English
 *      is excused only where a whole user-data string (a customer, a vendor, an item) appears in
 *      the line; a word that occurs somewhere in the data excuses nothing. The ownerAr persona
 *      has Arabic data only, so nothing at all is excused there. Every individual report the
 *      catalog opens (tests/e2e/lib/report-urls.mjs) is visited by owner and ownerAr;
 *   3. clicks every enabled button, tab, switch and menu item on the page (destructive actions
 *      skipped) and fails a click that throws, makes a failed request or does nothing observable
 *      (no navigation, dialog, DOM change, request, download, print or clipboard write). A dialog
 *      that opens is submitted empty: it must answer with validation, never a 5xx;
 *   4. (owner, desktop) opens every command-palette entry; (owner, 390px) every mobile More row,
 *      and repeats the load checks at phone width.
 *
 * Writes tests/e2e/.artifacts/broken-path-sweep-last-run.json (every route x persona x language
 * with its result) and exits 1 on any failure not in tests/e2e/lib/sweep-allow.mjs.
 *
 * Environment:
 *   BASE_URL, DATABASE_URL  local target and its scratch database (required)
 *   SWEEP_REUSE=true        reuse the personas of the previous run (delta runs)
 *   SWEEP_PERSONAS=a,b      subset (trial,owner,ownerAr,accountant,viewer,firmStaff,admin,portal,visitor)
 *   SWEEP_LANGS=en,ar       languages (default both)
 *   SWEEP_CLICKS=false      skip the click pass; SWEEP_CLICK_LANGS (default en,ar for owner,
 *                           en for the other personas) and SWEEP_MAX_CLICKS (per route, 40)
 *   SWEEP_ROUTES=/a,/b      restrict the route list (link discovery still follows links)
 *   SWEEP_DISCOVER=false    do not follow discovered links
 *   SWEEP_MOBILE=false      skip the phone-width pass; SWEEP_PALETTE=false skip the palette pass
 *   SWEEP_AI=true           also click controls that start a paid AI call (skipped by default)
 *   SWEEP_OUT=<file>        report path (default .artifacts/broken-path-sweep-last-run.json)
 *   CHROMIUM_PATH, E2E_TIMEZONE (default Asia/Dubai)
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { ADMIN_ROUTES, ALL_AUTH_ROUTES, FIRM_ROUTES, PUBLIC_ROUTES } from "./launch-routes.mjs";
import { ARTIFACT_DIR, apiClient, setupPersonas } from "./lib/sweep-personas.mjs";
import { REPORT_URLS } from "./lib/report-urls.mjs";
import {
  GATE_STATUSES,
  collectUserStrings,
  englishOutsideUserData,
  englishWords,
  instrumentScript,
  pageSnapshot,
  textProblems,
} from "./lib/sweep-checks.mjs";
import { SWEEP_ALLOW } from "./lib/sweep-allow.mjs";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
if (!BASE) {
  console.error("BASE_URL is required");
  process.exit(2);
}
const TZ = process.env.E2E_TIMEZONE || "Asia/Dubai";
const list = (value, fallback) =>
  value
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : fallback;
const PERSONAS = list(process.env.SWEEP_PERSONAS, [
  "visitor",
  "trial",
  "owner",
  "accountant",
  "viewer",
  "firmStaff",
  "admin",
  "portal",
  "ownerAr",
]);
const LANGS = list(process.env.SWEEP_LANGS, ["en", "ar"]);
const CLICKS = process.env.SWEEP_CLICKS !== "false";
const MAX_CLICKS = Number(process.env.SWEEP_MAX_CLICKS ?? 40);
const DEDUPE = process.env.SWEEP_DEDUPE !== "false";
/** Report path; SWEEP_OUT names a slice (several slices merge in tests/e2e/sweep-report.mjs). */
const OUT = process.env.SWEEP_OUT || path.join(ARTIFACT_DIR, "broken-path-sweep-last-run.json");
const DISCOVER = process.env.SWEEP_DISCOVER !== "false";
const MOBILE = process.env.SWEEP_MOBILE !== "false";
const PALETTE = process.env.SWEEP_PALETTE !== "false";
const ONLY_ROUTES = list(process.env.SWEEP_ROUTES, null);
const clickLangsFor = (persona) =>
  list(process.env.SWEEP_CLICK_LANGS, persona === "owner" ? ["en", "ar"] : ["en"]);

const DESTRUCTIVE =
  /\b(delete|remove|void|reverse|reversal|archive|revoke|disconnect|deactivate|sign ?out|log ?out|erase|purge|restore backup|reset|unlink|discard|cancel (the )?(subscription|plan)|close (the )?period|lock period|file return|mark (as )?filed|transfer ownership|leave)\b|حذف|إزالة|إلغاء الاشتراك|تسجيل الخروج|عكس|إبطال|أرشفة|إعادة تعيين|فصل|تجاهل/i;
const AI_CLICKS = process.env.SWEEP_AI === "true";
const AI_TESTID =
  /(^|-)ai(-|$)|run-scan|scan-now|assistant-send|ask-ai|categori[sz]e|anomal|forecast-run|cfo/i;
const DESTRUCTIVE_TESTID =
  /delete|remove|logout|log-out|sign-out|void|reverse|archive|revoke|disconnect|deactivate|reset|discard|language-toggle|lang-toggle|locale|unlink|purge|restore/i;

const ROUTES_FOR = {
  visitor: [
    ...PUBLIC_ROUTES,
    "/verify-email",
    "/dashboard",
    "/view/invoice/:shareToken",
    "/portal/:portalToken",
    // STEP5: the customer invitation page: a valid pending invitation and a well-formed unknown one.
    "/portal/join#t=:portalInviteToken",
    `/portal/join#t=${"0".repeat(64)}`,
    "/portal/einvoicing-approve/:approverToken",
  ],
  trial: [...ALL_AUTH_ROUTES],
  owner: [
    ...ALL_AUTH_ROUTES,
    "/accounts/:accountId/ledger",
    "/journal/:journalId",
    "/invoices/:invoiceId/edit",
    "/quotes/:quoteId/edit",
    "/purchase-orders/:purchaseOrderId/edit",
    "/bill-pay/:billId/edit",
    "/recurring-invoices/:recurringId/edit",
    ...REPORT_URLS,
  ],
  ownerAr: [...REPORT_URLS, ...ALL_AUTH_ROUTES],
  accountant: [...ALL_AUTH_ROUTES, "/accounts/:accountId/ledger", "/journal/:journalId"],
  viewer: [...ALL_AUTH_ROUTES, "/accounts/:accountId/ledger", "/journal/:journalId"],
  firmStaff: [...FIRM_ROUTES, "/firm/clients/:companyId"],
  admin: [
    ...ADMIN_ROUTES,
    ...FIRM_ROUTES,
    "/admin/clients/:companyId",
    "/admin/clients/:companyId/documents",
    "/admin/clients/:companyId/tasks",
    "/firm/clients/:companyId",
  ],
  portal: [
    "/client-portal/dashboard",
    "/client-portal/invoices",
    "/client-portal/documents",
    "/client-portal/statements",
    "/client-portal/messages",
    "/client-portal/account",
  ],
};

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  personas: PERSONAS,
  langs: LANGS,
  pages: [],
  clicks: { total: 0, skipped: 0, failures: 0 },
  failures: [],
  allowed: [],
  info: [],
};

function allowedBy(failure) {
  return SWEEP_ALLOW.find(
    (entry) =>
      entry.rule === failure.rule &&
      (!entry.route || entry.route.test(failure.route)) &&
      (!entry.match || entry.match.test(String(failure.detail ?? "")))
  );
}

function fail(failure) {
  const allow = allowedBy(failure);
  if (allow) {
    report.allowed.push({ ...failure, reason: allow.reason });
    return false;
  }
  report.failures.push(failure);
  console.log(
    `  FAIL ${failure.rule} ${failure.route} ${String(failure.detail ?? "").slice(0, 200)}`
  );
  return true;
}

/** Same-origin bookkeeping for the current page: responses, console, requests. */
function attach(page, state) {
  page.on("response", (res) => {
    const url = res.url();
    if (!url.startsWith(BASE)) return;
    const status = res.status();
    const rel = url.slice(BASE.length);
    const type = res.request().resourceType();
    state.requests += 1;
    if (status < 400) return;
    const entry = { status, url: rel.split("?")[0], method: res.request().method(), type };
    if (type === "document")
      state.problems.push({ rule: "http-document", detail: `${status} ${rel}` });
    else if (rel.startsWith("/api/")) {
      if (GATE_STATUSES.has(status)) state.gates.push(entry);
      else if (state.expectValidation && (status === 400 || status === 422 || status === 409)) {
        state.validation.push(entry);
      } else if (state.clicking && (status === 409 || status === 422)) {
        // A click the server refuses with a reason (year-end close before the year ends, a scan
        // already running) is a deliberate refusal the page explains, not a broken path.
        state.refusals.push(entry);
      } else
        state.problems.push({
          rule: status >= 500 ? "api-5xx" : "api-4xx",
          detail: `${entry.method} ${status} ${rel.slice(0, 160)}`,
        });
    } else state.problems.push({ rule: "asset-4xx", detail: `${status} ${rel}` });
  });
  page.on("request", (req) => {
    if (req.url().startsWith(BASE)) state.requestsStarted += 1;
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    const failure = req.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)) return;
    if (!url.startsWith(BASE)) {
      state.external.push(`${failure} ${url.slice(0, 120)}`);
      return;
    }
    state.problems.push({
      rule: "request-failed",
      detail: `${failure} ${url.slice(BASE.length, BASE.length + 160)}`,
    });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Status responses are judged by the response handler (gates are allowed there).
    if (/^Failed to load resource: the server responded with a status of/.test(text)) return;
    // Blocked third-party requests (fonts, analytics) in the sandbox are not app errors.
    if (/^Failed to load resource: net::ERR_(TUNNEL|PROXY|NAME|CONNECTION)/.test(text)) return;
    state.problems.push({ rule: "console-error", detail: text.slice(0, 300) });
  });
  page.on("pageerror", (error) => {
    state.problems.push({
      rule: "page-error",
      detail: String(error?.stack || error).slice(0, 300),
    });
  });
  page.on("filechooser", () => {
    state.signals += 1;
  });
  page.on("download", () => {
    state.signals += 1;
  });
  page.on("popup", (popup) => {
    state.signals += 1;
    popup.close().catch(() => {});
  });
}

function freshState() {
  return {
    problems: [],
    gates: [],
    validation: [],
    external: [],
    requests: 0,
    requestsStarted: 0,
    signals: 0,
    expectValidation: false,
    clicking: false,
    refusals: [],
  };
}

async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function dismissOverlays(page) {
  for (let i = 0; i < 2; i += 1) {
    if (!(await page.locator('[role="dialog"], [role="alertdialog"], [role="menu"]').count()))
      return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

function resolveRoute(route, ids) {
  let missing = null;
  const out = route.replace(/:(\w+)/g, (_, key) => {
    if (!ids[key]) missing = key;
    return ids[key] ?? `:${key}`;
  });
  return missing ? null : out;
}

/** Route pattern key used to de-duplicate discovered links (/invoices/<uuid>/edit -> :id). */
function linkKey(href) {
  const [pathname, search = ""] = href.split("#")[0].split("?");
  const norm = pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
  const keys = [...new URLSearchParams(search).keys()].sort().join(",");
  return `${norm}?${keys}`;
}

const FILE_LINK = /\.(pdf|csv|xlsx|xls|zip|xml|json|txt|png|jpe?g|svg)$/i;
const SKIP_LINK = /^\/(api\/|uploads\/|auth\/logout|logout)/;

function checkSnapshot(snap, ctx, lang, userStrings) {
  const problems = [];
  if (snap.notFound) problems.push({ rule: "not-found-page", detail: snap.path });
  if (snap.errorBoundary.length)
    problems.push({ rule: "error-boundary", detail: snap.errorBoundary.join(",") });
  if (!snap.dialog && snap.mainText < 15)
    problems.push({ rule: "blank-page", detail: `main text ${snap.mainText}` });
  if (snap.overflowX > 0)
    problems.push({ rule: "horizontal-scroll", detail: `${snap.overflowX}px at ${ctx.viewport}` });
  for (const n of snap.native) problems.push({ rule: "native-input", detail: n });
  for (const r of snap.rejections)
    problems.push({ rule: "unhandled-rejection", detail: r.slice(0, 300) });
  const seen = new Set();
  for (const line of [...snap.texts, ...snap.exemptTexts]) {
    for (const rule of textProblems(line)) {
      if (seen.has(rule + line)) continue;
      seen.add(rule + line);
      problems.push({ rule, detail: line.slice(0, 160) });
    }
  }
  if (lang === "ar") {
    if (snap.dir !== "rtl") problems.push({ rule: "not-rtl", detail: snap.dir });
    for (const line of snap.texts) {
      // Whole user-data strings (seeded customer / vendor / item names) are excused; nothing else.
      const words = userStrings ? englishOutsideUserData(line, userStrings) : englishWords(line);
      if (!words.length) continue;
      problems.push({ rule: "english-in-arabic", detail: line.slice(0, 160) });
    }
  }
  return problems;
}

/** Every whole string the seeded records carry (see collectUserStrings), for Arabic mode. */
async function harvestUserStrings(token, companyId) {
  const api = apiClient(BASE);
  const strings = new Set();
  const endpoints = [
    "",
    "/customer-contacts",
    "/vendors",
    "/accounts",
    "/invoices",
    "/bills",
    "/receipts",
    "/journal",
    "/items",
    "/inventory/items",
    "/employees",
    "/payroll/employees",
    "/fixed-assets",
    "/cost-centers",
    "/budgets",
    "/budget-plans",
    "/products",
    "/inventory/valuation",
    "/inventory/reorder",
    "/inventory-movements",
    "/bank-accounts",
    "/bank-transactions",
    "/quotes",
    "/purchase-orders",
    "/credit-notes",
    "/debit-notes",
    "/expense-claims",
    "/recurring-invoices",
    "/projects",
    "/team",
    "/einvoicing/partner",
    "/ai-gl/queue",
    "/invoices?all=true",
    "/payroll-runs",
    "/report-delivery/subscriptions",
  ];
  const walk = (value) => collectUserStrings(value, strings);
  for (const ep of endpoints) {
    const res = await api(token, "GET", `/api/companies/${companyId}${ep}`).catch(() => null);
    if (res && res.status < 300) walk(res.body);
  }
  // Line descriptions live on the invoice detail only.
  const invoices = await api(token, "GET", `/api/companies/${companyId}/invoices?all=true`);
  for (const inv of (Array.isArray(invoices.body) ? invoices.body : []).slice(0, 60)) {
    const res = await api(token, "GET", `/api/invoices/${inv.id}`).catch(() => null);
    if (res && res.status < 300) walk(res.body);
  }
  // Budget lines (categories) live on the variance report of each plan.
  const plans = await api(token, "GET", `/api/companies/${companyId}/budget-plans`).catch(
    () => null
  );
  for (const plan of (Array.isArray(plans?.body) ? plans.body : []).slice(0, 10)) {
    const res = await api(token, "GET", `/api/budget-plans/${plan.id}/variance`).catch(() => null);
    if (res && res.status < 300) walk(res.body);
  }
  const me = await api(token, "GET", "/api/auth/me");
  walk(me.body?.name);
  walk(me.body?.email);
  return strings;
}

async function newContext(browser, persona, lang, viewport) {
  const context = await browser.newContext({
    viewport,
    timezoneId: TZ,
    locale: lang === "ar" ? "ar-AE" : "en-AE",
  });
  await context.addInitScript(
    ({ lang, signedIn }) => {
      try {
        if (signedIn) localStorage.setItem("muhasib_auth_hint", "1");
        localStorage.setItem(
          "i18n-storage",
          JSON.stringify({ state: { locale: lang }, version: 0 })
        );
        localStorage.setItem("cookie-consent", "accepted");
        localStorage.setItem("muhasib_tour_dismissed", "1");
      } catch {
        /* storage blocked */
      }
    },
    { lang, signedIn: persona.name !== "visitor" }
  );
  await context.addInitScript(instrumentScript);
  if (persona.email) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { email: persona.email, password: persona.password },
    });
    if (res.status() >= 300) throw new Error(`login ${persona.name}: ${res.status()}`);
  }
  return context;
}

async function finishOnboarding(page) {
  await page.goto(`${BASE}/dashboard`, { timeout: 45000 });
  await settle(page, 1500);
  const express = page.locator('[data-testid="onboarding-express"]');
  await express.waitFor({ timeout: 8000 }).catch(() => undefined);
  if (await express.count()) {
    await express.click();
    await page.waitForTimeout(3000);
    for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
      const next = page.locator(`[data-testid="${id}"]`);
      if (await next.count()) {
        await next.click();
        await page.waitForTimeout(1500);
      }
    }
  }
}

/**
 * Snapshot after the page settled. A heavy page (Evidence Center) can still show its loading
 * skeleton after network idle; an empty main area is re-read for up to 6 s before it counts.
 */
async function settledSnapshot(page) {
  let snap = await page.evaluate(pageSnapshot);
  for (let i = 0; i < 4 && !snap.dialog && snap.mainText < 15; i += 1) {
    await page.waitForTimeout(1500);
    const next = await page.evaluate(pageSnapshot);
    next.rejections = [...snap.rejections, ...next.rejections];
    snap = next;
  }
  return snap;
}

/** Load one URL and run the page rules. Returns the snapshot (or null on navigation failure). */
async function loadAndCheck(page, state, url, ctx) {
  state.problems.length = 0;
  state.gates.length = 0;
  try {
    const res = await page.goto(`${BASE}${url}`, { timeout: 45000 });
    if (res && res.status() >= 400)
      state.problems.push({ rule: "http-document", detail: `${res.status()} ${url}` });
  } catch (error) {
    fail({ ...ctx, route: url, rule: "navigation", detail: String(error).slice(0, 200) });
    return null;
  }
  await settle(page, 900);
  await dismissOverlays(page);
  const snap = await settledSnapshot(page);
  const problems = [...state.problems, ...checkSnapshot(snap, ctx, ctx.lang, ctx.userStrings)];
  let failed = 0;
  for (const p of problems) if (fail({ ...ctx, route: url, ...p })) failed += 1;
  report.pages.push({
    persona: ctx.persona,
    lang: ctx.lang,
    viewport: ctx.viewport,
    route: url,
    finalPath: snap.path,
    gates: state.gates.map((g) => `${g.status} ${g.url}`).slice(0, 5),
    result: failed ? "fail" : "pass",
    problems: problems.map((p) => p.rule),
  });
  console.log(
    `${failed ? "FAIL" : "ok  "} ${ctx.persona}/${ctx.lang}/${ctx.viewport} ${url}${snap.path !== url ? ` -> ${snap.path}` : ""}`
  );
  return snap;
}

/** Clickable elements on the page (outside dialogs); see window.__sweepCandidates. */
function collectClickables(shellSelector) {
  return window
    .__sweepCandidates(shellSelector)
    .filter((c) => !c.repeated)
    .map(({ el, ...rest }) => {
      void el;
      return rest;
    });
}

function markTarget({ key, SHELL_SELECTOR }) {
  document
    .querySelectorAll("[data-sweep-target]")
    .forEach((el) => el.removeAttribute("data-sweep-target"));
  const hit = window.__sweepCandidates(SHELL_SELECTOR).find((c) => c.key === key);
  if (!hit) return false;
  hit.el.setAttribute("data-sweep-target", "1");
  return true;
}

const SHELL_SELECTOR =
  'aside, [data-sidebar], header, [data-testid="app-header"], nav.mobile-nav, footer';

async function counters(page) {
  return page.evaluate(() => ({
    mutations: window.__sweep?.mutations ?? 0,
    signals: window.__sweep?.signals ?? 0,
    url: location.pathname + location.search + location.hash,
    dialogs: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
    menus: document.querySelectorAll('[role="menu"], [role="listbox"]').length,
  }));
}

/** Submit an open dialog empty: it must answer (validation or a request), never 5xx. */
async function probeDialog(page, state, ctx, key) {
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').last();
  const submit = dialog.locator('button[type="submit"]:not([disabled])').first();
  if (!(await submit.count())) return;
  const label = ((await submit.innerText().catch(() => "")) || "").trim();
  if (DESTRUCTIVE.test(label)) return;
  const before = await counters(page);
  const reqBefore = state.requestsStarted;
  state.expectValidation = true;
  const problemsBefore = state.problems.length;
  await submit.click({ timeout: 3000 }).catch(() => {});
  await settle(page, 600);
  state.expectValidation = false;
  const after = await counters(page);
  for (const p of state.problems.slice(problemsBefore)) {
    fail({ ...ctx, rule: `dialog-${p.rule}`, detail: `${key} submit: ${p.detail}` });
  }
  if (
    after.mutations === before.mutations &&
    state.requestsStarted === reqBefore &&
    after.dialogs === before.dialogs
  ) {
    fail({ ...ctx, rule: "dialog-submit-no-op", detail: `${key} -> "${label}"` });
  }
  report.clicks.dialogSubmits = (report.clicks.dialogSubmits ?? 0) + 1;
}

async function clickOne(page, state, ctx, item, restoreUrl) {
  const found = await page.evaluate(markTarget, { ...item, SHELL_SELECTOR });
  if (!found) {
    report.clicks.skipped += 1;
    return;
  }
  const target = page.locator("[data-sweep-target]").first();
  const before = await counters(page);
  const reqBefore = state.requestsStarted;
  const signalsBefore = state.signals;
  const problemsBefore = state.problems.length;
  report.clicks.total += 1;
  state.clicking = true;
  try {
    await target.click({ timeout: 3000 });
  } catch (error) {
    state.clicking = false;
    report.info.push({
      ...ctx,
      rule: "unclickable",
      detail: `${item.key}: ${String(error).split("\n")[0].slice(0, 120)}`,
    });
    report.clicks.skipped += 1;
    return;
  }
  await page.waitForTimeout(450);
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  state.clicking = false;
  const after = await counters(page).catch(() => null);
  const newProblems = state.problems.slice(problemsBefore);
  for (const p of newProblems) {
    if (fail({ ...ctx, rule: `click-${p.rule}`, detail: `${item.key}: ${p.detail}` }))
      report.clicks.failures += 1;
  }
  if (!after) return;
  const observable =
    after.url !== before.url ||
    after.mutations !== before.mutations ||
    after.signals !== before.signals ||
    state.signals !== signalsBefore ||
    state.requestsStarted !== reqBefore ||
    after.dialogs !== before.dialogs;
  if (!observable) {
    if (fail({ ...ctx, rule: "click-no-op", detail: `${item.key} "${item.name}"` }))
      report.clicks.failures += 1;
  }
  if (after.dialogs > before.dialogs && after.url === before.url) {
    await probeDialog(page, state, ctx, item.key);
  }
  // Menus: click each item once (depth one), re-opening the menu each time.
  if (after.menus > before.menus && after.url === before.url) {
    const items = await page
      .locator(
        '[role="menu"] [role="menuitem"]:not([data-disabled]), [role="menu"] [role="menuitemcheckbox"]'
      )
      .allInnerTexts()
      .catch(() => []);
    await page.keyboard.press("Escape");
    for (let i = 0; i < Math.min(items.length, 15); i += 1) {
      const text = (items[i] || "").trim();
      if (!text || DESTRUCTIVE.test(text)) continue;
      if (!(await page.evaluate(markTarget, { ...item, SHELL_SELECTOR }))) break;
      await page
        .locator("[data-sweep-target]")
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      await page.waitForTimeout(300);
      const menuItem = page
        .locator('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')
        .nth(i);
      if (!(await menuItem.count())) break;
      const b2 = await counters(page);
      const r2 = state.requestsStarted;
      const s2 = state.signals;
      const p2 = state.problems.length;
      report.clicks.total += 1;
      await menuItem.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(450);
      await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
      const a2 = await counters(page).catch(() => null);
      for (const p of state.problems.slice(p2)) {
        if (fail({ ...ctx, rule: `click-${p.rule}`, detail: `${item.key} > ${text}: ${p.detail}` }))
          report.clicks.failures += 1;
      }
      if (
        a2 &&
        a2.url === b2.url &&
        a2.signals === b2.signals &&
        state.signals === s2 &&
        state.requestsStarted === r2 &&
        a2.dialogs <= b2.dialogs - 0 &&
        a2.mutations === b2.mutations
      ) {
        if (fail({ ...ctx, rule: "click-no-op", detail: `${item.key} > ${text}` }))
          report.clicks.failures += 1;
      }
      if (a2 && a2.dialogs > 0 && a2.url === b2.url)
        await probeDialog(page, state, ctx, `${item.key} > ${text}`);
      await restore(page, restoreUrl);
    }
  }
  await restore(page, restoreUrl);
}

async function restore(page, url) {
  const now = await page.evaluate(() => location.pathname + location.search).catch(() => "");
  if (now !== url) {
    await page.goto(`${BASE}${url}`, { timeout: 45000 }).catch(() => {});
    await settle(page, 500);
    return;
  }
  await dismissOverlays(page);
  if (await page.locator('[role="dialog"], [role="alertdialog"]').count()) {
    await page.goto(`${BASE}${url}`, { timeout: 45000 }).catch(() => {});
    await settle(page, 500);
  }
}

async function clickSweep(page, state, url, ctx, shellDone) {
  const items = (await page.evaluate(collectClickables, SHELL_SELECTOR)).filter((item) => {
    if (DESTRUCTIVE.test(item.name) || DESTRUCTIVE_TESTID.test(item.testid)) return false;
    // Controls that start a paid AI call are left to the core flows (a handful of real calls).
    if (!AI_CLICKS && AI_TESTID.test(item.testid)) return false;
    // Shell controls (sidebar, header) are clicked once per persona and language; a page control
    // with a data-testid seen on an earlier route (shared toolbars, export menus) is clicked once
    // too unless SWEEP_DEDUPE=false.
    const globalKey = item.shell ? item.key : item.testid && DEDUPE ? item.key : null;
    if (globalKey) {
      if (shellDone.has(globalKey)) return false;
      shellDone.add(globalKey);
    }
    return true;
  });
  const finalUrl = await page.evaluate(() => location.pathname + location.search);
  for (const item of items.slice(0, MAX_CLICKS)) {
    await clickOne(page, state, { ...ctx, route: url }, item, finalUrl);
  }
  if (items.length > MAX_CLICKS)
    report.info.push({
      ...ctx,
      route: url,
      rule: "click-cap",
      detail: `${items.length} clickables, ${MAX_CLICKS} clicked`,
    });
}

async function paletteSweep(page, state, ctx) {
  await page.goto(`${BASE}/dashboard`);
  await settle(page, 800);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(600);
  const ids = await page
    .locator('[data-testid^="command-item-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  await page.keyboard.press("Escape");
  console.log(`palette: ${ids.length} entries`);
  report.palette = { entries: ids.length, checked: 0 };
  const max = Number(process.env.SWEEP_PALETTE_MAX ?? 500);
  for (const id of ids.slice(0, max)) {
    state.problems.length = 0;
    await page.keyboard.press("Control+k");
    const entry = page.locator(`[data-testid="${id}"]`).first();
    if (!(await entry.count())) {
      await page.waitForTimeout(400);
    }
    try {
      await entry.scrollIntoViewIfNeeded({ timeout: 2000 });
      await entry.click({ timeout: 3000 });
    } catch (error) {
      fail({
        ...ctx,
        route: `palette:${id}`,
        rule: "palette-unclickable",
        detail: String(error).split("\n")[0].slice(0, 120),
      });
      await page.keyboard.press("Escape");
      continue;
    }
    await settle(page, 600);
    const snap = await settledSnapshot(page);
    const problems = [
      ...state.problems,
      ...checkSnapshot(snap, ctx, ctx.lang, ctx.userStrings),
    ].filter((p) => p.rule !== "horizontal-scroll" || true);
    let failed = 0;
    for (const p of problems)
      if (fail({ ...ctx, route: `palette:${id} -> ${snap.path}`, ...p })) failed += 1;
    report.palette.checked += 1;
    report.pages.push({
      persona: ctx.persona,
      lang: ctx.lang,
      viewport: "palette",
      route: `palette:${id}`,
      finalPath: snap.path,
      result: failed ? "fail" : "pass",
      problems: problems.map((p) => p.rule),
    });
    await dismissOverlays(page);
  }
}

async function mobileMoreSweep(page, state, ctx) {
  await page.goto(`${BASE}/dashboard`);
  await settle(page, 800);
  const openMore = async () => {
    await page.locator("nav.mobile-nav button").last().click({ timeout: 3000 });
    await page.waitForTimeout(500);
  };
  await openMore();
  const rows = await page
    .locator('[data-testid="mobile-more-nav"] .mobile-nav-more-row')
    .evaluateAll((els) => els.map((e, i) => e.getAttribute("data-testid") || `row-${i}`));
  report.mobileMore = (report.mobileMore ?? 0) + rows.length;
  await page.keyboard.press("Escape");
  for (let i = 0; i < rows.length; i += 1) {
    state.problems.length = 0;
    await page.goto(`${BASE}/dashboard`);
    await settle(page, 500);
    await openMore();
    const row = page.locator('[data-testid="mobile-more-nav"] .mobile-nav-more-row').nth(i);
    try {
      await row.click({ timeout: 3000 });
    } catch (error) {
      fail({
        ...ctx,
        route: `more:${rows[i]}`,
        rule: "more-unclickable",
        detail: String(error).split("\n")[0],
      });
      continue;
    }
    await settle(page, 700);
    const snap = await settledSnapshot(page);
    const problems = [...state.problems, ...checkSnapshot(snap, ctx, ctx.lang, ctx.userStrings)];
    let failed = 0;
    for (const p of problems)
      if (fail({ ...ctx, route: `more:${rows[i]} -> ${snap.path}`, ...p })) failed += 1;
    report.pages.push({
      persona: ctx.persona,
      lang: ctx.lang,
      viewport: "mobile-more",
      route: `more:${rows[i]}`,
      finalPath: snap.path,
      result: failed ? "fail" : "pass",
      problems: problems.map((p) => p.rule),
    });
  }
}

async function sweepPersona(browser, name, persona, ids, userStrings) {
  // A SWEEP_ROUTES param route (seeded in the owner's company) is only visited by personas whose
  // own route list has it: another tenant's record is a deliberate 404.
  const routes = (
    ONLY_ROUTES
      ? ONLY_ROUTES.filter((r) => !r.includes(":") || ROUTES_FOR[name].includes(r))
      : ROUTES_FOR[name]
  )
    .map((route) => resolveRoute(route, { ...ids, companyId: persona.companyId }))
    .filter(Boolean);
  // The Arabic-data persona only exists to run the strict Arabic check.
  for (const lang of name === "ownerAr" ? LANGS.filter((l) => l === "ar") : LANGS) {
    const ctxBase = {
      persona: name,
      lang,
      viewport: "desktop",
      // trial and ownerAr own no English data at all: nothing is excused there.
      userStrings: name === "trial" || name === "ownerAr" ? null : userStrings,
    };
    const context = await newContext(browser, { ...persona, name }, lang, {
      width: 1440,
      height: 900,
    });
    const page = await context.newPage();
    const state = freshState();
    attach(page, state);
    if (["trial", "owner", "ownerAr", "admin"].includes(name)) await finishOnboarding(page);
    const queue = [...routes];
    const seenKeys = new Set(queue.map(linkKey));
    const shellDone = new Set();
    const doClicks = CLICKS && clickLangsFor(name).includes(lang);
    for (let i = 0; i < queue.length; i += 1) {
      const url = queue[i];
      if (FILE_LINK.test(url.split("?")[0])) {
        // A file link (sample PDF, CSV template): it must download, not 404.
        const res = await page.request
          .get(`${BASE}${url}`)
          .catch((error) => ({ status: () => 0, error }));
        const status = res.status();
        const ok = status > 0 && status < 400;
        if (!ok) fail({ ...ctxBase, route: url, rule: "file-link", detail: `${status}` });
        report.pages.push({
          persona: name,
          lang,
          viewport: "file",
          route: url,
          finalPath: url,
          result: ok ? "pass" : "fail",
          problems: ok ? [] : ["file-link"],
        });
        continue;
      }
      const snap = await loadAndCheck(page, state, url, ctxBase);
      if (!snap) continue;
      if (DISCOVER) {
        for (const href of snap.links) {
          if (SKIP_LINK.test(href)) continue;
          const key = linkKey(href);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          queue.push(href.split("#")[0]);
        }
      }
      if (doClicks && i < routes.length) {
        await clickSweep(page, state, url, { ...ctxBase, persona: name }, shellDone);
      }
    }
    report.discovered = report.discovered ?? {};
    report.discovered[`${name}/${lang}`] = queue.length - routes.length;
    if (PALETTE && name === "owner") await paletteSweep(page, state, ctxBase);
    await context.close();

    if (MOBILE && ["owner", "ownerAr", "visitor", "trial"].includes(name)) {
      const mctx = { ...ctxBase, viewport: "mobile" };
      const mobile = await newContext(browser, { ...persona, name }, lang, {
        width: 390,
        height: 844,
      });
      const mpage = await mobile.newPage();
      const mstate = freshState();
      attach(mpage, mstate);
      // Phone width: the Arabic-data persona only re-checks the reports.
      const mobileRoutes =
        name === "ownerAr" ? routes.filter((r) => REPORT_URLS.includes(r)) : routes;
      for (const url of mobileRoutes) await loadAndCheck(mpage, mstate, url, mctx);
      if (name !== "visitor" && name !== "ownerAr") await mobileMoreSweep(mpage, mstate, mctx);
      await mobile.close();
    }
  }
}

async function main() {
  const setup = await setupPersonas(BASE);
  const personas = setup.personas;
  for (const p of Object.values(personas)) p.password = "Fake-Sweep-Password-123";
  const userStrings = await harvestUserStrings(personas.owner.token, personas.owner.companyId);
  for (const text of await harvestUserStrings(personas.admin.token, personas.admin.companyId))
    userStrings.add(text);
  report.links = Object.fromEntries(
    Object.entries(setup.links).map(([k, v]) => [k, v ? "set" : "missing"])
  );
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const name of PERSONAS) {
      console.log(`\n=== persona ${name} ===`);
      try {
        await sweepPersona(browser, name, personas[name] ?? {}, setup.links, userStrings);
      } catch (error) {
        // One persona's crash (server gone, browser closed) is a failure, not the end of the run.
        fail({
          persona: name,
          route: "(persona)",
          rule: "persona-crash",
          detail: String(error).slice(0, 300),
        });
      }
      // Written after every persona so a long run that is stopped still leaves its results.
      await writeFile(OUT, JSON.stringify(report, null, 2));
    }
  } finally {
    await browser.close();
  }
  report.finishedAt = new Date().toISOString();
  const out = OUT;
  await writeFile(out, JSON.stringify(report, null, 2));
  const pass = report.pages.filter((p) => p.result === "pass").length;
  console.log(
    `\n=== Broken-path sweep: ${report.pages.length} page checks (${pass} pass), ${report.clicks.total} clicks, ${report.failures.length} failure(s), ${report.allowed.length} allowed ===`
  );
  const byRule = {};
  for (const f of report.failures) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  console.log(JSON.stringify(byRule));
  console.log(`Report: ${out}`);
  process.exit(report.failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
