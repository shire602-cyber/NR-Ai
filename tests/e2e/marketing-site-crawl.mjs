import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright-core";

// Crawl the public marketing site from the homepage in both languages. Keep this list
// independent of the router so a page removed from both the menus and router still fails QA.
const editorialPaths = new Set([
  "/services",
  "/services/bookkeeping",
  "/services/vat",
  "/services/corporate-tax",
  "/services/financial-reporting",
  "/resources",
  "/resources/bank-reconciliation-checklist",
  "/resources/vat-201-checklist",
  "/resources/e-invoicing-readiness",
  "/compare",
  "/compare/wafeq",
  "/compare/mazeed",
  "/compare/zoho",
  "/migration-guides",
  "/migration-guides/excel",
  "/migration-guides/wafeq",
  "/migration-guides/mazeed",
  "/migration-guides/zoho",
  "/trust",
]);
const base = new URL(process.env.BASE_URL || "http://127.0.0.1:5000");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext({
  viewport: { width: 320, height: 800 },
});
const page = await context.newPage();
const contextErrors = [];
page.on("pageerror", (error) => contextErrors.push(`Uncaught exception: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") contextErrors.push(`Console: ${message.text()}`);
});
page.on("response", (response) => {
  if (new URL(response.url()).origin === base.origin && response.status() >= 400) {
    contextErrors.push(`HTTP ${response.status()}: ${response.url()}`);
  }
});

async function checkPage(locale, path) {
  const expectedDir = locale === "ar" ? "rtl" : "ltr";
  const heading = page.getByRole("heading", { level: 1 });
  await heading.waitFor();
  await page.waitForFunction(
    ({ lang, dir }) =>
      document.documentElement.lang === lang && document.documentElement.dir === dir,
    { lang: locale, dir: expectedDir }
  );
  const title = (await heading.innerText()).trim();
  assert.ok(
    title && title !== "Page not found" && title !== "الصفحة غير موجودة",
    `${path} heading`
  );
  if (locale === "ar") assert.match(title, /\p{Script=Arabic}/u, `${path} Arabic heading`);
  assert.equal(new URL(page.url()).pathname, path);
  const layout = await page.locator("#phase-main").evaluate((main) => ({
    direction: getComputedStyle(main).direction,
    reflows: document.documentElement.scrollWidth <= window.innerWidth,
  }));
  assert.deepEqual(layout, { direction: expectedDir, reflows: true }, `${path} layout`);
  return title;
}

async function crawl(locale) {
  const prefix = `/${locale}`;
  const queue = new Set([prefix]);
  const legacyLinks = new Set();

  for (const path of queue) {
    contextErrors.length = 0;
    const response = await page.goto(new URL(path, base).href);
    assert.equal(response?.status(), 200, path);
    await checkPage(locale, path);
    if (path === `${prefix}/pricing`) {
      const prices = page.locator("#phase-main .mk-tier__price");
      await prices.nth(2).waitFor();
      const amounts = (await prices.allTextContents()).map(
        (text) =>
          text.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).match(/\d+/)?.[0]
      );
      assert.deepEqual(amounts, ["59", "119", "229"], `${path} monthly prices`);
      await page
        .getByText(
          locale === "ar"
            ? "١٤ يومًا مجاناً. دون بطاقة مصرفية."
            : "14 days free. No card required.",
          { exact: true }
        )
        .waitFor();
    }
    if (editorialPaths.has(path.slice(prefix.length))) {
      await page.locator("[data-editorial-content]").waitFor();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      assert.deepEqual(
        violations.map(({ id, nodes }) => [id, nodes.map((node) => node.target)]),
        [],
        path
      );
    }
    const hrefs = await page
      .locator('.phase-site a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.href));
    for (const href of hrefs) {
      const target = new URL(href);
      if (target.origin !== base.origin) continue;
      if (target.pathname.startsWith(`${prefix}/`)) queue.add(target.pathname);
      if (!/^\/(?:en|ar)(?:\/|$)/.test(target.pathname)) legacyLinks.add(target.href);
    }
    assert.deepEqual(contextErrors, [], path);
  }

  for (const path of editorialPaths)
    assert.ok(queue.has(`${prefix}${path}`), `${prefix}${path} is linked`);
  for (const href of legacyLinks) {
    const response = await context.request.get(href);
    assert.ok(response.ok(), `Linked page ${href} returned ${response.status()}`);
  }
  console.log(
    `${locale}: ${queue.size} localized routes, ${legacyLinks.size} shared destinations, ${editorialPaths.size} axe checks passed`
  );
}

try {
  await crawl("en");
  await crawl("ar");

  contextErrors.length = 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = "/resources/bank-reconciliation-checklist";
  await page.goto(new URL("/en", base).href);
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Resources", exact: true })
    .click();
  await checkPage("en", "/en/resources");
  await page.getByRole("link", { name: /A month-end bank reconciliation checklist/ }).click();
  const englishTitle = await checkPage("en", `/en${article}`);
  await page.locator('header a[hreflang="ar"]').click();
  const arabicTitle = await checkPage("ar", `/ar${article}`);
  await page
    .locator("[data-editorial-content]")
    .getByText("خطوات مراجعة نهاية الشهر", { exact: true })
    .waitFor();
  assert.notEqual(arabicTitle, englishTitle);
  await page.locator('header a[hreflang="en"]').click();
  assert.equal(await checkPage("en", `/en${article}`), englishTitle);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('header a[hreflang="ar"]').click();
  await page.getByRole("button", { name: "افتح القائمة" }).click();
  const drawer = page.getByRole("dialog", { name: "القائمة" });
  await drawer
    .locator("summary")
    .filter({ hasText: /^الموارد\s*$/ })
    .click();
  await drawer.getByRole("link", { name: "أدلة الانتقال" }).click();
  await drawer.waitFor({ state: "hidden" });
  await checkPage("ar", "/ar/migration-guides");
  assert.deepEqual(contextErrors, [], "Navigation and language switch");
  console.log("Desktop mega-menu, Arabic drawer and deep-page language switch passed.");
} finally {
  await browser.close();
}
