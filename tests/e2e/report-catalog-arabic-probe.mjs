#!/usr/bin/env node
/**
 * Report catalog surfaces in Arabic (F14): registers a synthetic customer and fails on any English
 * line outside allow-listed brands/codes (tests/e2e/lib/latin-text.mjs) on:
 *   - the Reports page with "Advanced tools" expanded (every workspace tab, every persona focus),
 *   - the onboarding completion screen with "Show reporting automations" expanded,
 *   - the Dashboard report quick access,
 *   - the command palette (report shortcuts) and the mobile navigation sheet.
 *
 *   BASE_URL=http://127.0.0.1:PORT CHROMIUM_PATH=... node tests/e2e/report-catalog-arabic-probe.mjs
 *
 * Use a disposable local database only (it registers a user).
 */
import { chromium } from "playwright-core";
import { classifyLines } from "./lib/latin-text.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  console.error("Refusing to run against a non-local BASE_URL");
  process.exit(1);
}
const VERBOSE = process.env.PROBE_VERBOSE === "1";

async function visibleLines(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || el.closest('script,style,[translate=no],body [lang]:not([lang^="ar"])')) continue;
      out.push(text);
    }
    for (const el of document.querySelectorAll("[placeholder], [aria-label], [title]")) {
      if (el.closest('[translate=no],body [lang]:not([lang^="ar"])')) continue;
      for (const attr of ["placeholder", "aria-label", "title"]) {
        const value = el.getAttribute(attr)?.trim();
        if (value) out.push(value);
      }
    }
    return out;
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
let total = 0;
const seen = new Set();
const report = (label, lines) => {
  const { english, samples } = classifyLines(lines);
  total += lines.length;
  console.log(`${label}: ${lines.length} lines, ${english} English`);
  for (const line of samples) {
    if (VERBOSE || !seen.has(line)) console.log("   ", line);
    seen.add(line);
  }
  failures += english;
};
const settle = (page, ms = 700) => page.waitForTimeout(ms);
const clickAll = async (page, selector, limit = 60) => {
  // Expand every collapsed disclosure inside the page (details/summary and aria-expanded=false).
  for (let round = 0; round < 3; round += 1) {
    const handles = await page.$$(`${selector}`);
    let clicked = 0;
    for (const handle of handles.slice(0, limit)) {
      try {
        await handle.click({ timeout: 800 });
        clicked += 1;
      } catch {
        /* not clickable */
      }
    }
    if (!clicked) break;
    await settle(page, 300);
  }
};

try {
  const email = `report-catalog+${Date.now()}@test.local`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("muhasib_auth_hint", "1");
    localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
  });
  const page = await context.newPage();
  const reg = await page.request.post(`${BASE}/api/auth/register`, {
    data: { email, password: "Password123!", name: "سارة أحمد", companyName: "شركة الواحة" },
  });
  if (reg.status() >= 300) throw new Error(`register failed ${reg.status()}`);
  const login = await page.request.post(`${BASE}/api/auth/login`, {
    data: { email, password: "Password123!" },
  });
  if (login.status() >= 300) throw new Error(`login failed ${login.status()}`);

  // ---- Onboarding completion with the automation panel expanded --------------------------------------
  await page.goto(`${BASE}/onboarding`);
  await page.waitForSelector('[data-testid="onboarding-start"]', { timeout: 20000 });
  const click = async (testId) => {
    const loc = page.locator(`[data-testid="${testId}"]`);
    if (!(await loc.count())) return false;
    await loc.first().click();
    await settle(page, 900);
    return true;
  };
  await click("onboarding-start");
  await click("onboarding-next");
  await click("onboarding-next");
  await click("onboarding-skip-bank");
  await click("onboarding-skip-doc");
  report("onboarding complete", await visibleLines(page));
  for (const persona of ["owner", "freelancer", "accountant"]) {
    await click(`onboarding-report-workspace-${persona}`);
    await click("onboarding-report-more-toggle");
    await clickAll(
      page,
      'button[aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"])'
    );
    report(`onboarding automations ${persona}`, await visibleLines(page));
  }
  await click("onboarding-open-report-operations");
  await settle(page, 1500);

  // Seed a delivery run so the delivery history rows (status, schedule, error copy) render.
  {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies[0]?.id ?? companies?.companies?.[0]?.id;
    const csrf = (await (await page.request.get(`${BASE}/api/csrf-token`)).json()).csrfToken;
    for (const subscription of ["owner-weekly-executive-delivery", "owner-tax-deadline-delivery"]) {
      await page.request.post(
        `${BASE}/api/companies/${companyId}/report-delivery/subscriptions/${subscription}/queue`,
        { headers: { "X-CSRF-Token": csrf }, data: {} }
      );
    }
  }

  // ---- Reports page: Advanced tools, every workspace tab and persona focus -----------------
  await page.goto(`${BASE}/reports`);
  await page.waitForSelector('[data-testid="button-reports-advanced-tools"]', { timeout: 20000 });
  report("reports (center)", await visibleLines(page));
  await page.click('[data-testid="button-reports-advanced-tools"]');
  await settle(page, 1200);
  const tabIds = (
    await page.$$eval('[data-testid^="reports-workspace-tab-"]', (els) =>
      els.map((el) => el.getAttribute("data-testid").replace("reports-workspace-tab-", ""))
    )
  ).filter((id) => id !== "reports");
  console.log(`workspace tabs: ${tabIds.length} (${tabIds.join(", ")})`);
  for (const persona of ["owner", "freelancer", "accountant"]) {
    for (const id of tabIds) {
      await page.goto(`${BASE}/reports?workspace=${id}&persona=${persona}`);
      await page.waitForSelector(`[data-testid="reports-workspace-tab-${id}"]`, { timeout: 20000 });
      await settle(page, 1500);
      await clickAll(
        page,
        'button[aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"])'
      );
      report(`reports advanced ${persona} ${id}`, await visibleLines(page));
    }
  }

  // ---- Dashboard -----------------------------------------------------------------------------
  // WP-C (spec 3.6): the report workspace left the dashboard; reports live under Reports.
  await page.goto(`${BASE}/dashboard`);
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 20000 });
  await settle(page, 1500);
  report("dashboard", await visibleLines(page));

  // ---- Command palette report shortcuts (opened on a page with no report content behind it) ----
  await page.goto(`${BASE}/invoices`);
  await settle(page, 2000);
  await page.keyboard.press("Control+k");
  await settle(page, 800);
  report("command palette", await visibleLines(page));
  await page.keyboard.type("تقرير", { delay: 30 });
  await settle(page, 800);
  report("command palette (search)", await visibleLines(page));
  await page.keyboard.press("Escape");

  // ---- Mobile navigation sheet with the report shortcuts expanded ------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/invoices`);
  await settle(page, 2000);
  await page.locator("nav.mobile-nav button").last().click();
  await settle(page, 800);
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await settle(page, 300);
  report("mobile nav", await visibleLines(page));
  await page.setViewportSize({ width: 1440, height: 900 });

  await context.close();
} finally {
  await browser.close();
}
console.log(
  failures === 0
    ? `OK: 0 English lines (${total} lines checked)`
    : `FAIL: ${failures} English line(s) of ${total}`
);
process.exit(failures === 0 ? 0 : 1);
