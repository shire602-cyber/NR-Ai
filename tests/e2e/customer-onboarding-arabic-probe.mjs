#!/usr/bin/env node
/**
 * Customer onboarding wizard in Arabic (F12): registers a synthetic customer, walks every step
 * of the guided wizard (welcome, company, accounts, bank, first document, complete) in Arabic and
 * fails on any English line outside allow-listed brands/codes (tests/e2e/lib/latin-text.mjs).
 *
 *   BASE_URL=http://127.0.0.1:PORT CHROMIUM_PATH=... node tests/e2e/customer-onboarding-arabic-probe.mjs
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

async function visibleLines(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || el.closest("script,style,[translate=no]")) continue;
      out.push(text);
    }
    // Placeholders and accessible names are user-visible too.
    for (const el of document.querySelectorAll("[placeholder], [aria-label]")) {
      if (el.closest("[translate=no]")) continue;
      for (const attr of ["placeholder", "aria-label"]) {
        const value = el.getAttribute(attr)?.trim();
        if (value) out.push(value);
      }
    }
    return out;
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
const report = (label, lines) => {
  const { english, samples } = classifyLines(lines);
  console.log(`${label}: ${lines.length} lines, ${english} English`);
  for (const line of samples) console.log("   ", line);
  failures += english;
};
const click = async (page, testId) => {
  const loc = page.locator(`[data-testid="${testId}"]`);
  if (!(await loc.count())) return false;
  await loc.first().click();
  await page.waitForTimeout(900);
  return true;
};

try {
  const email = `cust-onboarding+${Date.now()}@test.local`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

  await page.goto(`${BASE}/onboarding`);
  await page.waitForSelector('[data-testid="onboarding-start"]', { timeout: 20000 });
  report("welcome", await visibleLines(page));
  await click(page, "onboarding-start");
  report("company", await visibleLines(page));
  // Name and emirate are pre-filled from registration; save and continue.
  await click(page, "onboarding-next");
  report("accounts", await visibleLines(page));
  await click(page, "onboarding-next");
  report("bank", await visibleLines(page));
  // Bank form with the validation/saving state.
  await page.fill('[data-testid="onboarding-bank-name"]', "حساب العمليات").catch(() => {});
  await click(page, "onboarding-skip-bank");
  report("first document", await visibleLines(page));
  await click(page, "onboarding-skip-doc");
  report("complete", await visibleLines(page));
  await context.close();
} finally {
  await browser.close();
}
console.log(failures === 0 ? "OK: 0 English lines" : `FAIL: ${failures} English line(s)`);
process.exit(failures === 0 ? 0 : 1);
