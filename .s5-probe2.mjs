import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL;
const PASSWORD = "SweepPass123!";
const email = `probe-${Date.now()}@test.local`;
const post = async (url, body, token) => {
  const res = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
await post("/api/auth/register", { email, password: PASSWORD, name: "Probe", companyName: "Probe Co" });
const login = await post("/api/auth/login", { email, password: PASSWORD });
const token = login.body.token;
const companies = await (await fetch(BASE + "/api/companies", { headers: { Authorization: `Bearer ${token}` } })).json();
const cid = companies[0].id;
const c = await post(`/api/companies/${cid}/customer-contacts`, { name: "Al Noor", email: "al@noor.test" }, token);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const lang = process.env.LANG_ID || "en";
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, locale: lang === "ar" ? "ar-AE" : "en-AE" });
await ctx.addInitScript((l) => {
  localStorage.setItem("muhasib_auth_hint", "1");
  localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
  localStorage.setItem("cookie-consent", "accepted");
}, lang);
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD } });
const page = await ctx.newPage();
await page.goto(`${BASE}/dashboard`);
await page.waitForTimeout(1500);
await page.goto(`${BASE}/contacts`);
await page.waitForTimeout(1500);
const phone = Number(process.env.W || 390) < 700;
if (phone) {
  await page.locator('[data-testid="mobile-contact-list"] button[aria-haspopup="menu"]').first().click();
} else {
  await page.locator(`[data-testid="row-contact-${c.body.id}"] button[aria-haspopup="menu"]`).first().click();
}
await page.waitForTimeout(300);
await page.locator(`[data-testid="button-portal-access-${c.body.id}"]`).click();
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="portal-access-sheet"]');
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { width: cs.width, maxWidth: cs.maxWidth, left: r.left, right: r.right, cls: el.className.slice(0, 300) };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: process.env.OUT || "/tmp/s5-probe2.png" });
await browser.close();
