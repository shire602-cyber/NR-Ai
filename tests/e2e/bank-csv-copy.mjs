#!/usr/bin/env node
// Run against a disposable local app with PostgreSQL and no live providers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { findBankLaunchClaim } from "./lib/bank-launch-wording.mjs";
import { apiClient, PASSWORD } from "./lib/sweep-personas.mjs";

const base = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/);

const locales = [
  {
    locale: "en",
    dir: "ltr",
    heading: "Bank reconciliation",
    copy: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    uploadHelp: "CSV files can use commas, semicolons, or tabs",
  },
  {
    locale: "ar",
    dir: "rtl",
    heading: "التسوية البنكية",
    copy: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    uploadHelp: "يمكن فصل أعمدة ملف CSV بفاصلة أو فاصلة منقوطة أو علامة جدولة",
  },
];
const otherFormats = /\b(?:XLSX|MT940|CAMT\.053|OFX)\b/u;

const api = apiClient(base);
async function checked(token, method, route, body) {
  const response = await api(token, method, route, body);
  assert.ok(response.status < 300, route + " returned HTTP " + response.status);
  return response.body;
}

const email = "bank-csv-copy+" + randomUUID().slice(0, 8) + "@example.test";
const loginBody = { email, password: PASSWORD };
await checked("", "POST", "/api/auth/register", {
  ...loginBody,
  name: "سارة أحمد",
  companyName: "شركة النخيل",
});
const { token } = await checked("", "POST", "/api/auth/login", loginBody);
const companies = await checked(token, "GET", "/api/companies");
const companyPath = "/api/companies/" + companies[0].id;
await checked(token, "POST", companyPath + "/onboarding/complete", {});
const customerBankStatus = await checked(token, "GET", "/api/bank/providers");
assert.deepEqual(customerBankStatus, {
  statuses: [
    {
      id: "bank_reconciliation",
      label: Object.fromEntries(locales.map(({ locale, heading }) => [locale, heading])),
      status: "available",
      message: Object.fromEntries(locales.map(({ locale, copy }) => [locale, copy])),
    },
  ],
});

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const { locale, dir, copy, uploadHelp } of locales) {
    const context = await browser.newContext({ locale: locale + "-AE", timezoneId: "Asia/Dubai" });
    try {
      await context.addInitScript((activeLocale) => {
        localStorage.setItem(
          "i18n-storage",
          JSON.stringify({ state: { locale: activeLocale }, version: 0 })
        );
        localStorage.setItem("cookie-consent", "accepted");
      }, locale);
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await page.goto(base + "/" + locale);
      const faq = page.locator(".phase-faq details").filter({ hasText: copy });
      await faq.locator("summary").click();
      assert.equal(await faq.locator("p").innerText(), copy);
      assert.equal(findBankLaunchClaim(await page.locator("main").innerText()), undefined);

      await page.goto(base + "/" + locale + "/product/bank-reconciliation");
      await page.getByText(copy, { exact: true }).waitFor();
      assert.equal(findBankLaunchClaim(await page.locator("main").innerText()), undefined);

      const login = await context.request.post(base + "/api/auth/login", { data: loginBody });
      assert.ok(login.ok(), "Browser fixture login failed");
      await context.addInitScript(() => localStorage.setItem("muhasib_auth_hint", "1"));
      const providerRequests = [];
      page.on("request", (request) => {
        const { pathname } = new URL(request.url());
        if (
          pathname === "/api/bank/providers" ||
          (pathname.includes("/bank-connections") && request.method() !== "GET")
        ) {
          providerRequests.push(pathname);
        }
      });
      await page.goto(base + "/bank-feeds");
      await page.getByText(copy, { exact: true }).waitFor();
      assert.equal(await page.locator("html").getAttribute("dir"), dir);
      assert.equal(findBankLaunchClaim(await page.locator("main").innerText()), undefined);
      await page.getByTestId("button-feeds-import-statement").click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(copy, { exact: true }).waitFor();
      await dialog.getByText(uploadHelp, { exact: true }).waitFor();
      assert.doesNotMatch(await dialog.innerText(), otherFormats);
      assert.equal(findBankLaunchClaim(await dialog.innerText()), undefined);
      const filePicker = dialog.getByTestId("input-bank-statement-file");
      assert.match(await filePicker.getAttribute("accept"), /\.csv\b/u);
      assert.deepEqual(providerRequests, []);

      console.log(locale + " FAQ, product, bank landing, CSV dialog passed");
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
