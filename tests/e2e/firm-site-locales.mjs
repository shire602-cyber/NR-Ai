import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = new URL(process.env.FIRM_SITE_URL || "http://127.0.0.1:8080");
const files = (await readdir(new URL("../../sites/najma-al-raeda-website/", import.meta.url)))
  .filter((file) => file.endsWith(".html"))
  .sort();
assert.equal(files.length, 23, "all legacy English pages are still published");
const arabicPath = (file) =>
  file === "index.html" ? "/ar/" : `/ar/${file.replace(/\.html$/, "")}/`;
const arabicRoutes = new Set(files.map(arabicPath));
const englishRoutes = new Set(["/", ...files.map((file) => `/${file}`)]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function openContext(locale, options = {}) {
  const context = await browser.newContext({
    locale,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    ...options,
  });
  // Exercise the site itself independently of third-party fonts and media.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort()
  );
  return context;
}

function checkErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).origin === base.origin && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  return errors;
}

async function documentState(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    direction: getComputedStyle(document.body).direction,
    heading: document.querySelector("h1")?.textContent?.trim(),
    lead: document.querySelector("section .lead")?.textContent?.trim(),
    title: document.title,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
}

async function assertDocument(page, expected, locale) {
  await page.locator("h1").waitFor({ state: "attached" });
  const state = await documentState(page);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const script = locale === "ar" ? /\p{Script=Arabic}/u : /[A-Za-z]/;
  assert.equal(new URL(page.url()).pathname, expected);
  assert.equal(state.lang, locale, `${expected} language`);
  assert.equal(state.dir, dir, `${expected} direction attribute`);
  assert.equal(state.direction, dir, `${expected} computed direction`);
  assert.match(state.heading ?? "", script, `${expected} heading`);
  assert.match(state.lead ?? "", script, `${expected} visible lead`);
  assert.match(state.title, script, `${expected} document title`);
  assert.equal(state.overflow, false, `${expected} page reflows`);
}

async function assertInternalLinks(page, locale) {
  const links = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.href,
      alternative: anchor.hreflang,
    }))
  );
  for (const { href, alternative } of links) {
    const target = new URL(href);
    if (target.origin !== base.origin) continue;
    const paths = (alternative || locale) === "ar" ? arabicRoutes : englishRoutes;
    assert.ok(paths.has(target.pathname), `${page.url()} links to ${target.pathname}`);
  }
}

try {
  const arabicBrowser = await openContext("ar-AE");
  const page = await arabicBrowser.newPage();
  const failures = [];
  const errors = checkErrors(page);
  for (const file of files) {
    const target = arabicPath(file);
    await page.goto(new URL(`/${file}`, base).href, { waitUntil: "commit" });
    await page.waitForURL(new URL(target, base).href, { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("domcontentloaded");
    try {
      await assertDocument(page, target, "ar");
      await assertInternalLinks(page, "ar");
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], "an Arabic browser should see translated RTL pages at /ar routes");
  assert.deepEqual(errors, [], "Arabic pages and first-party assets load cleanly");

  await page.goto(new URL("/services.html?source=browser#main", base).href, {
    waitUntil: "commit",
  });
  await page.waitForURL(new URL("/ar/services/?source=browser#main", base).href);
  await page.getByRole("button", { name: "القائمة" }).click();
  await page.locator(".nav-links").getByRole("link", { name: "القطاعات", exact: true }).click();
  await page.waitForURL(new URL("/ar/industries/", base).href);
  await page.getByRole("link", { name: "English", exact: true }).click();
  await page.waitForURL(new URL("/industries.html?lang=en", base).href);
  await assertDocument(page, "/industries.html", "en");
  await page.locator("header .brand").click();
  await page.waitForURL(new URL("/index.html", base).href);
  await assertDocument(page, "/index.html", "en");
  await page.getByRole("link", { name: "العربية", exact: true }).click();
  await page.waitForURL(new URL("/ar/", base).href);
  await assertDocument(page, "/ar/", "ar");
  await page.goto(new URL("/ar/tools/", base).href);
  await page.getByRole("button", { name: "ضريبة القيمة المضافة", exact: true }).click();
  await page.getByLabel("المبلغ (بالدرهم)", { exact: true }).fill("20000");
  assert.match(await page.locator("#vat-vat").innerText(), /(?:1,000|١٬٠٠٠) درهم/u);
  await page.goto(new URL("/ar/contact/", base).href);
  await page.getByLabel("الاسم الكامل").fill("جهة اختبار");
  await page.locator("#email").fill("example@invalid");
  await page.locator("#contact-form button[type='submit']").click();
  await page.getByText("أدخل عنوان بريد إلكتروني صالحًا.").waitFor();
  assert.deepEqual(errors, [], "switch, calculator and validation");
  await arabicBrowser.close();

  const englishBrowser = await openContext("en-US", { viewport: { width: 1440, height: 900 } });
  const englishPage = await englishBrowser.newPage();
  const englishErrors = checkErrors(englishPage);
  for (const file of files) {
    const response = await englishPage.goto(new URL(`/${file}`, base).href);
    assert.equal(response?.status(), 200, file);
    await assertDocument(englishPage, `/${file}`, "en");
    await assertInternalLinks(englishPage, "en");
  }
  // An explicit Arabic URL wins over browser detection. Verify its desktop mega-menu too.
  await englishPage.goto(new URL("/ar/service-bookkeeping/", base).href);
  await assertDocument(englishPage, "/ar/service-bookkeeping/", "ar");
  await englishPage
    .locator(".nav-links")
    .getByRole("link", { name: "الخدمات", exact: true })
    .hover();
  const megaLink = englishPage
    .locator(".mega")
    .getByRole("link", { name: /الرواتب ونظام حماية الأجور/ });
  await megaLink.waitFor();
  assert.equal(await megaLink.getAttribute("href"), "/ar/service-payroll/");
  assert.deepEqual(englishErrors, [], "English pages and explicit Arabic navigation");
  await englishBrowser.close();

  const noJs = await openContext("en-US", { javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  const response = await staticPage.goto(new URL("/ar/insight-vat-essentials/", base).href);
  assert.equal(response?.status(), 200);
  await assertDocument(staticPage, "/ar/insight-vat-essentials/", "ar");
  await noJs.close();
  console.log(
    `Verified ${files.length} Arabic routes and ${files.length} English pages, language switching, navigation, form validation and calculator output.`
  );
} finally {
  await browser.close();
}
