import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright-core";

// Pin destinations independently of the router so a shared route-table mistake
// or an HTTP 200 fallback rendering the wrong page still fails the crawl.
const editorialHeadings = {
  "/services": ["Accounting services", "خدمات المحاسبة"],
  "/services/bookkeeping": ["Bookkeeping services", "خدمات مسك الدفاتر"],
  "/services/vat": ["UAE VAT services", "خدمات ضريبة القيمة المضافة في الإمارات"],
  "/services/corporate-tax": ["UAE corporate tax services", "خدمات ضريبة الشركات في الإمارات"],
  "/services/financial-reporting": ["Financial reporting services", "خدمات إعداد التقارير المالية"],
  "/resources": ["Resources", "الموارد"],
  "/resources/bank-reconciliation-checklist": [
    "A month-end bank reconciliation checklist",
    "قائمة مراجعة المطابقة البنكية في نهاية الشهر",
  ],
  "/resources/vat-201-checklist": [
    "A checklist for reviewing VAT 201",
    "قائمة مراجعة إقرار VAT 201",
  ],
  "/resources/e-invoicing-readiness": [
    "Preparing for UAE e-invoicing",
    "الاستعداد للفوترة الإلكترونية في الإمارات",
  ],
  "/compare": ["Compare accounting software", "قارن برامج المحاسبة"],
  "/compare/wafeq": ["Compare with Wafeq", "المقارنة مع وافق (Wafeq)"],
  "/compare/mazeed": ["Compare with Mazeed", "المقارنة مع مزيد (Mazeed)"],
  "/compare/zoho": ["Compare with Zoho Books", "المقارنة مع زوهو بوكس (Zoho Books)"],
  "/migration-guides": ["Migration guides", "أدلة الانتقال"],
  "/migration-guides/excel": ["Move your books from Excel", "انقل دفاترك من إكسل (Excel)"],
  "/migration-guides/wafeq": ["Move your books from Wafeq", "انقل دفاترك من وافق (Wafeq)"],
  "/migration-guides/mazeed": ["Move your books from Mazeed", "انقل دفاترك من مزيد (Mazeed)"],
  "/migration-guides/zoho": [
    "Move your books from Zoho Books",
    "انقل دفاترك من زوهو بوكس (Zoho Books)",
  ],
  "/trust": ["Trust and security", "الثقة والأمان"],
};
const localizedHeadings = {
  "": [
    "Accounting and VAT for UAE businesses",
    "المحاسبة وضريبة القيمة المضافة للشركات في الإمارات",
  ],
  "/book-a-demo": ["Book a demo", "احجز عرضًا توضيحيًا"],
  "/pricing": ["Pricing", "الأسعار"],
  "/product/invoicing": ["Invoicing", "الفوترة"],
  "/product/accounting": ["Accounting", "المحاسبة"],
  "/product/vat": ["VAT 201", "إقرار VAT 201"],
  "/product/reporting": ["Reporting", "التقارير"],
  "/product/expenses": ["Expenses", "المصروفات"],
  "/product/bookkeeping": ["Bookkeeping", "مسك الدفاتر"],
  "/product/inventory": ["Inventory", "المخزون"],
  "/product/bank-reconciliation": ["Bank reconciliation", "المطابقة البنكية"],
  "/product/receipt-scanning": ["AI receipt scanning", "مسح الإيصالات بالذكاء الاصطناعي"],
  "/product/payroll": ["Payroll", "الرواتب"],
  "/product/client-portal": ["Client portal", "بوابة العملاء"],
  "/product/e-invoicing": ["UAE e-invoicing", "الفوترة الإلكترونية في الإمارات"],
  "/solutions/small-business": ["Small and medium businesses", "الشركات الصغيرة والمتوسطة"],
  "/solutions/accounting-firms": ["Accounting firms", "مكاتب المحاسبة"],
  "/tools/vat-calculator": ["VAT calculator", "حاسبة ضريبة القيمة المضافة"],
  "/tools/corporate-tax-estimator": ["Corporate tax estimator", "حاسبة تقديرية لضريبة الشركات"],
  "/tools/e-invoicing-readiness": [
    "E-invoicing readiness checker",
    "فحص الجاهزية للفوترة الإلكترونية",
  ],
  ...editorialHeadings,
};
const registrationHeading = ["Start your books", "ابدأ دفاترك"];
const sharedHeadings = {
  "/help": ["Help with setting up and running your books.", "مساعدة في إعداد دفاترك وإدارتها."],
  "/demo": ["Open a sample company and look around.", "افتح شركة نموذجية وتجوّل فيها."],
  "/login": ["Welcome back", "مرحبًا بعودتك"],
  "/register": ["Choose your plan", "اختر خطتك"],
  "/register?plan=starter&cycle=monthly": registrationHeading,
  "/register?plan=professional&cycle=monthly": registrationHeading,
  "/register?plan=enterprise&cycle=monthly": registrationHeading,
  "/pricing": ["One plan for where your books are today.", "خطة تناسب حال دفاترك اليوم."],
  "/privacy": ["Privacy policy", "سياسة الخصوصية"],
  "/terms": ["Terms of service", "شروط الخدمة"],
};
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

const translated = (copy, locale) => copy[locale === "ar" ? 1 : 0];

async function checkHeading(onPage, path, expected) {
  const heading = onPage.getByRole("heading", { level: 1 });
  await heading.waitFor();
  assert.equal((await heading.innerText()).trim(), expected, `${path} heading`);
}

async function checkPage(onPage, locale, path) {
  const expectedDir = locale === "ar" ? "rtl" : "ltr";
  const expected = localizedHeadings[path.slice(3)];
  assert.ok(expected, `Linked destination ${path} has no expected heading`);
  await onPage.waitForURL((url) => url.pathname === path);
  await checkHeading(onPage, path, translated(expected, locale));
  await onPage.waitForFunction(
    ({ lang, dir }) =>
      document.documentElement.lang === lang && document.documentElement.dir === dir,
    { lang: locale, dir: expectedDir }
  );
  const layout = await onPage.locator("#phase-main").evaluate((main) => ({
    direction: getComputedStyle(main).direction,
    reflows: document.documentElement.scrollWidth <= window.innerWidth,
  }));
  assert.deepEqual(layout, { direction: expectedDir, reflows: true }, `${path} layout`);
}

async function checkMissingPage(locale, localePrefix = locale) {
  const missing = `/${localePrefix}/resources/missing-page`;
  const url = new URL(`${missing}/?source=crawl`, base).href;
  const response = await page.goto(url);
  assert.equal(response?.status(), 404, `${missing} localized HTML status`);
  assert.equal((await page.request.head(url)).status(), 404, `${missing} HEAD status`);
  await checkHeading(page, missing, translated(["Page not found", "الصفحة غير موجودة"], locale));
  await assert.rejects(
    checkHeading(page, missing, translated(editorialHeadings["/resources"], locale)),
    {
      code: "ERR_ASSERTION",
      message: new RegExp(`${missing} heading`),
    }
  );
}

async function checkEncodedPage(locale, encoded, canonical) {
  contextErrors.length = 0;
  const url = new URL(`/${locale}/${encoded}/?source=crawl`, base).href;
  const response = await page.goto(url);
  assert.equal(response?.status(), 200, `${url} localized HTML status`);
  assert.equal((await page.request.head(url)).status(), 200, `${url} HEAD status`);
  await checkHeading(page, url, translated(localizedHeadings[canonical], locale));
  assert.deepEqual(contextErrors, [], url);
  const encodedSeparator = new URL(`/${locale}/product%2Finvoicing`, base).href;
  assert.equal((await page.request.head(encodedSeparator)).status(), 404, encodedSeparator);
}

async function crawl(locale) {
  const prefix = `/${locale}`;
  const queue = new Set([prefix]);
  const legacyLinks = new Set();

  for (const path of queue) {
    contextErrors.length = 0;
    const response = await page.goto(new URL(path, base).href);
    assert.equal(response?.status(), 200, path);
    await checkPage(page, locale, path);
    if (path === `${prefix}/product/bank-reconciliation`) {
      const csv = translated(
        [
          "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
          "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
        ],
        locale
      );
      assert.equal(await page.locator("#phase-main .phase-lead").innerText(), csv);
    }
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
    if (Object.hasOwn(editorialHeadings, path.slice(prefix.length))) {
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
    if (path === `${prefix}/trust`) {
      const backup = page
        .getByRole("heading", {
          name: translated(
            ["In-app backups and restore", "النسخ الاحتياطي والاستعادة داخل التطبيق"],
            locale
          ),
        })
        .locator("..");
      const copy = await backup.innerText();
      assert.match(
        copy,
        locale === "ar" ? /في وضع الاستبدال فقط/ : /before a Replace restore only/
      );
      assert.match(
        copy,
        locale === "ar" ? /وضع الدمج، وهو الوضع الافتراضي/ : /Merge is the default/
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

  for (const path of Object.keys(localizedHeadings)) {
    assert.ok(queue.has(`${prefix}${path}`), `${prefix}${path} is linked`);
  }
  for (const href of legacyLinks) {
    const url = new URL(href);
    const path = `${url.pathname}${url.search}`;
    const expected = sharedHeadings[path];
    assert.ok(expected, `Linked destination ${path} has no expected heading`);
    contextErrors.length = 0;
    const response = await page.goto(href);
    assert.equal(response?.status(), 200, href);
    assert.equal(page.url(), href);
    await checkHeading(page, path, translated(expected, locale));
    assert.deepEqual(contextErrors, [], path);
  }
  await checkMissingPage(locale);
  console.log(
    `${locale}: ${queue.size} localized routes, ${legacyLinks.size} shared destinations, ${Object.keys(editorialHeadings).length} axe checks and localized 404s passed`
  );
}

async function checkEditorialRecovery(locale) {
  const outageContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const outagePage = await outageContext.newPage();
    const session = await outageContext.newCDPSession(outagePage);
    await session.send("Network.setBypassServiceWorker", { bypass: true });
    const chunk =
      /\/(?:assets\/EditorialContent-[^/]+\.js|src\/components\/marketing\/phase\/editorial\/EditorialContent\.tsx)(?:[?#]|$)/;
    const exceptions = [];
    let blocked = 0;
    let documents = 0;
    outagePage.on("pageerror", (error) => exceptions.push(error.message));
    outagePage.on("response", (response) => {
      if (response.request().resourceType() === "document") documents++;
    });
    await outageContext.route(chunk, (route) => {
      blocked++;
      return route.fulfill({ status: 404, headers: { "cache-control": "no-store" } });
    });
    const prefix = `/${locale}`;
    const path = `${prefix}/services`;
    await outagePage.goto(new URL(prefix, base).href);
    const services = outagePage
      .getByRole("navigation", {
        name: translated(["Main navigation", "القائمة الرئيسية"], locale),
      })
      .getByRole("link", { name: translated(["Services", "الخدمات"], locale), exact: true });
    await services.click();
    await checkPage(outagePage, locale, path);
    const retry = outagePage.getByRole("button", {
      name: translated(["Retry", "أعِد المحاولة"], locale),
    });
    await retry.waitFor();
    await outagePage
      .getByRole("alert")
      .filter({
        hasText: translated(
          ["This page’s content couldn’t load.", "تعذّر تحميل محتوى الصفحة."],
          locale
        ),
      })
      .waitFor();
    assert.ok(blocked > 0, `${locale} intercepted the editorial chunk`);
    assert.equal(documents, 1, `${locale} keeps the existing document during an outage`);
    await outagePage.locator("header .phase-brand").click();
    await checkPage(outagePage, locale, prefix);
    await services.click();
    await retry.waitFor();
    await outageContext.unroute(chunk);
    await retry.click();
    await outagePage.locator("[data-editorial-content]").waitFor();
    await checkPage(outagePage, locale, path);
    assert.deepEqual(exceptions, [], `${locale} editorial error recovery`);
  } finally {
    await outageContext.close();
  }
}

try {
  await checkEncodedPage("en", "%70ricing", "/pricing");
  await checkEncodedPage("ar", "%73ervices", "/services");
  await crawl("en");
  await crawl("ar");
  await checkMissingPage("ar", "%61r");
  for (const path of ["/bank-feeds/callback", "/banking/callback/"]) {
    const callback = new URL(`${path}?code=old-code&state=old-state`, base).href;
    for (const method of ["GET", "HEAD"]) {
      const response = await page.request.fetch(callback, { method, maxRedirects: 0 });
      assert.equal(response.status(), 303, callback);
      assert.equal(response.headers().location, "/bank-reconciliation?import=1", callback);
      assert.equal(response.headers()["referrer-policy"], "no-referrer", callback);
    }
  }

  contextErrors.length = 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  const article = "/resources/bank-reconciliation-checklist";
  await page.goto(new URL("/en", base).href);
  await page.getByRole("button", { name: "Resources", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Resources", exact: true })
    .click();
  await checkPage(page, "en", "/en/resources");
  await page.getByRole("link", { name: /A month-end bank reconciliation checklist/ }).click();
  await checkPage(page, "en", `/en${article}`);
  await page.locator('header a[hreflang="ar"]').click();
  await checkPage(page, "ar", `/ar${article}`);
  await page
    .locator("[data-editorial-content]")
    .getByText("خطوات مراجعة نهاية الشهر", { exact: true })
    .waitFor();
  await page.locator('header a[hreflang="en"]').click();
  await checkPage(page, "en", `/en${article}`);

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
  await checkPage(page, "ar", "/ar/migration-guides");
  assert.deepEqual(contextErrors, [], "Navigation and language switch");
  console.log("Desktop mega-menu, Arabic drawer and deep-page language switch passed.");
  await checkEditorialRecovery("en");
  await checkEditorialRecovery("ar");
  console.log("Editorial chunk outage and manual retry passed in both languages.");
} finally {
  await browser.close();
}
