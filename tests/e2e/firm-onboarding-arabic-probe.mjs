#!/usr/bin/env node
/**
 * Firm onboarding wizard in Arabic (F11): registers a synthetic user, promotes it to firm_owner
 * (and firm_admin) in Postgres, walks every wizard step in Arabic and fails on any English line.
 *
 *   BASE_URL=http://127.0.0.1:PORT DATABASE_URL=postgres://... CHROMIUM_PATH=... \
 *     node tests/e2e/firm-onboarding-arabic-probe.mjs
 *
 * Use a disposable local database only (it writes users and promotes them).
 */
import pg from "pg";
import { chromium } from "playwright-core";
import { classifyLines } from "./lib/latin-text.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  console.error("Refusing to run against a non-local BASE_URL");
  process.exit(1);
}
const ROLES = ["firm_owner", "firm_admin"];

async function visibleLines(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || el.closest("script,style,[translate=no]")) continue;
      out.push(text);
    }
    return out;
  });
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
try {
  for (const role of ROLES) {
    const email = `firm-probe-${role}+${Date.now()}@test.local`;
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
    await db.query("UPDATE users SET firm_role = $1 WHERE email = $2", [role, email]);
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: "Password123!" },
    });
    if (login.status() >= 300) throw new Error(`login failed ${login.status()}`);

    await page.goto(`${BASE}/onboarding`);
    // WP-B: three steps (Team · Clients · Done).
    await page.waitForSelector('[data-testid="onboarding-next"]', { timeout: 20000 });
    const steps = [await visibleLines(page)];
    await page.click('[data-testid="onboarding-next"]');
    await page.waitForTimeout(600);
    steps.push(await visibleLines(page));
    await page.click('[data-testid="firm-onboarding-finish"]');
    await page.waitForTimeout(900);
    steps.push(await visibleLines(page));
    for (const [i, lines] of steps.entries()) {
      const { english, samples } = classifyLines(lines);
      console.log(`${role} step ${i + 1}: ${lines.length} lines, ${english} English`);
      for (const line of samples) console.log("   ", line);
      failures += english;
    }
    await context.close();
  }
} finally {
  await browser.close();
  await db.end();
}
console.log(failures === 0 ? "OK: 0 English lines" : `FAIL: ${failures} English line(s)`);
process.exit(failures === 0 ? 0 : 1);
