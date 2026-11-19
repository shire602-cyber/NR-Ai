import { chromium } from "playwright-core";
import pg from "pg";

const BASE = process.env.BASE_URL;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(
  `SELECT html FROM email_outbox WHERE category='portal_invite' ORDER BY created_at DESC LIMIT 1`
);
await db.end();
const m = /href="([^"]*\/portal\/join#t=[0-9a-f]{64})"/.exec(rows[0].html);
const hash = new URL(m[1]).hash;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 1440), height: Number(process.env.H || 900) }, locale: "en-AE" });
const page = await ctx.newPage();
page.on("console", (msg) => console.log("console:", msg.type(), msg.text().slice(0, 200)));
page.on("requestfailed", (r) => console.log("failed:", r.url().replace(BASE, ""), r.failure()?.errorText));
page.on("response", (r) => r.status() >= 400 && console.log("resp:", r.status(), r.url().replace(BASE, "")));
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
await page.goto(`${BASE}${process.env.ROUTE || "/portal/join" + hash}`);
await page.waitForTimeout(3000);
console.log("url:", page.url());
console.log("html:", (await page.evaluate(() => document.body.innerHTML.slice(0, 800))));
await page.screenshot({ path: process.env.OUT || "/tmp/s5-probe.png" });
await browser.close();
