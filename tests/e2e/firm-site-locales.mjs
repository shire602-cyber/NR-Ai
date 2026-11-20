import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
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
const reviewFailures = [];

function checkReview(name, actual, expected) {
  try {
    assert.deepEqual(actual, expected, name);
  } catch (error) {
    reviewFailures.push(error.message);
  }
}

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

async function checkPublishedMetrics(page) {
  const copy = await page.evaluate(() =>
    [
      document.body.textContent,
      document.title,
      ...Array.from(document.querySelectorAll("meta[content]"), (tag) => tag.content),
    ].join(" ")
  );
  const normalized = copy.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const claim = normalized.match(
    /\b(?:700|500|40)\s*\+|\b98\s*[%٪]|\b(?:700|500)\s+(?:active clients?|clients?|businesses|منشأة|عميل)|\b40\s+(?:industries|قطاع)/iu
  );
  checkReview(
    `${new URL(page.url()).pathname} published client or industry metric`,
    claim?.[0],
    undefined
  );
}

async function checkReliefGuide(page, locale) {
  const conditions = await page.locator("article .prose, .article .prose").innerText();
  const required =
    locale === "ar"
      ? ["الفترات الضريبية السابقة", "31 ديسمبر 2026", "اخترت تسهيلات الأعمال الصغيرة"]
      : ["all prior relevant periods", "31 December 2026", "elect Small Business Relief"];
  for (const phrase of required) {
    checkReview(`${locale} relief guide includes ${phrase}`, conditions.includes(phrase), true);
  }
}

async function checkServicesContrast(page) {
  const { violations } = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  assert.deepEqual(
    violations.flatMap(({ nodes }) =>
      nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
    ),
    [],
    `${new URL(page.url()).pathname} services text contrast`
  );
}

async function checkCalculators(page, locale) {
  const ar = locale === "ar";
  const format = (value, decimals = 0) => {
    const number = new Intl.NumberFormat(ar ? "ar-AE" : "en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
    return ar ? `${number} درهم` : `AED ${number}`;
  };
  const revenue = page.locator("#ct-revenue");
  const due = page.locator("#ct-due");
  const election = page.locator("#ct-sbr");
  const eligibility = page.locator("#ct-sbr-eligible");
  await page.locator("#ct-profit").fill("600000");
  checkReview(`${locale} ordinary Corporate Tax estimate`, await due.innerText(), format(20250));
  await election.check();
  checkReview(
    `${locale} election needs eligibility confirmation`,
    await due.innerText(),
    format(20250)
  );
  for (const invalid of ["", "-1"]) {
    await revenue.fill(invalid);
    checkReview(`${locale} invalid revenue ${JSON.stringify(invalid)}`, await due.innerText(), "—");
    checkReview(
      `${locale} revenue field is invalid`,
      await revenue.getAttribute("aria-invalid"),
      "true"
    );
  }
  await revenue.fill("3000000");
  checkReview(`${locale} eligibility confirmation field`, await eligibility.count(), 1);
  if (await eligibility.count()) {
    const checklist = await page.locator("#ct-sbr-conditions").innerText();
    checkReview(
      `${locale} prior-period revenue is in the conditions`,
      (ar ? /الفترات الضريبية السابقة/ : /prior tax periods/).test(checklist),
      true
    );
    await election.uncheck();
    await eligibility.check();
    checkReview(
      `${locale} confirmation alone needs an election`,
      await due.innerText(),
      format(20250)
    );
    await election.check();
    checkReview(`${locale} confirmed relief estimate`, await due.innerText(), format(0));
    checkReview(
      `${locale} relief is conditional`,
      (ar ? /تقدير مشروط/ : /conditional estimate/i).test(
        await page.locator("#ct-msg").innerText()
      ),
      true
    );
    await revenue.fill("3000000.01");
    checkReview(`${locale} revenue above the relief cap`, await due.innerText(), format(20250));
  }

  await page
    .getByRole("button", { name: ar ? "ضريبة القيمة المضافة" : "VAT", exact: true })
    .click();
  for (const [mode, amount, amounts] of [
    ["remove", "100", [95.24, 4.76, 100]],
    ["add", "0.10", [0.1, 0.01, 0.11]],
    ["add", "19.99", [19.99, 1, 20.99]],
  ]) {
    await page.locator("#vat-dir").selectOption(mode);
    await page.locator("#vat-amount").fill(amount);
    const values = await Promise.all(
      ["net", "vat", "gross"].map((id) => page.locator(`#vat-${id}`).innerText())
    );
    checkReview(
      `${locale} VAT ${mode} ${amount}`,
      values,
      amounts.map((value) => format(value, 2))
    );
  }
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
      await checkPublishedMetrics(page);
      if (file === "insight-small-business-relief.html") await checkReliefGuide(page, "ar");
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
  await page.waitForLoadState("domcontentloaded");
  await checkServicesContrast(page);
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
  await checkCalculators(page, "ar");
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
    await checkPublishedMetrics(englishPage);
    if (file === "insight-small-business-relief.html") await checkReliefGuide(englishPage, "en");
    if (file === "services.html") await checkServicesContrast(englishPage);
  }
  await englishPage.goto(new URL("/tools.html", base).href);
  await checkCalculators(englishPage, "en");
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
  assert.deepEqual(reviewFailures, [], "calculator results and published firm metrics");
  console.log(
    `Verified ${files.length} Arabic routes and ${files.length} English pages, language switching, navigation, form validation and calculator output.`
  );
} finally {
  await browser.close();
}
