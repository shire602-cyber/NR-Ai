#!/usr/bin/env node
/**
 * Local customer UX regression coverage. Start the app with a disposable database and
 * without provider configuration. Set BASE_URL, DATABASE_URL and CHROMIUM_PATH.
 * SHOT_DIR optionally writes viewport screenshots of the synthetic customer screens.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";
import pg from "pg";
import { apiClient, assertLocal, PASSWORD } from "./lib/sweep-personas.mjs";

const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
assertLocal(base);
assert.match(
  process.env.DATABASE_URL,
  /^postgres(?:ql)?:\/\/(?:[^/@]+@)?(?:localhost|127\.0\.0\.1)(?::\d+)?\//
);

const api = apiClient(base);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const shots = process.env.SHOT_DIR;
if (shots) await mkdir(shots, { recursive: true });

const viewports = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

const devices = process.env.CUSTOMER_UX_DEVICES?.split(",") ?? Object.keys(viewports);
const locales = process.env.CUSTOMER_UX_LANGS?.split(",") ?? ["en", "ar"];
const copy = {
  en: {
    bank: "Upload a CSV exported from your bank, review suggested matches, and reconcile against your books",
    csvRequired: "Choose a CSV file exported from your bank.",
    vat: "Prepare and review your VAT 201 here, then submit your return in EmaraTax.",
  },
  ar: {
    bank: "ارفع كشف حسابك البنكي بصيغة CSV، وراجع المطابقات المقترحة، ثم طابقها مع دفاترك",
    csvRequired: "اختر ملف CSV صدّرته من مصرفك.",
    vat: "أعدّ إقرار ضريبة القيمة المضافة 201 وراجعه هنا، ثم قدّمه عبر إمارات تاكس.",
  },
};

async function checked(token, method, route, body) {
  const result = await api(token, method, route, body);
  assert.ok(result.status < 300, `${method} ${route.split("?")[0]} returned ${result.status}`);
  return result.body;
}

async function capture(page, name) {
  if (!shots) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const png = await page.screenshot({ animations: "disabled" });
  await sharp(png)
    .webp({ quality: 84 })
    .toFile(path.join(shots, `${name}.webp`));
}

function monitor(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText;
    if (reason !== "net::ERR_ABORTED")
      failures.push(`${reason} ${new URL(request.url()).pathname}`);
  });
  return () => {
    const observed = failures.splice(0);
    assert.deepEqual(observed, []);
  };
}

async function open(page, route, lang, finalRoute = route) {
  const response = await page.goto(`${base}${route}`);
  assert.ok(response?.ok(), `${route} returned ${response?.status()}`);
  await page.waitForURL(`${base}${finalRoute}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByTestId("page-not-found").count(), 0);
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    return { lang: root.lang, dir: root.dir, overflow: root.scrollWidth - innerWidth };
  });
  assert.equal(layout.lang, lang);
  assert.equal(layout.dir, lang === "ar" ? "rtl" : "ltr");
  assert.ok(layout.overflow <= 1, `${route} overflows by ${layout.overflow}px`);
}

async function bankFlow(page, lang, name) {
  await page.getByTestId("button-import-transactions").click();
  const file = page.getByTestId("input-bank-statement-file");
  assert.equal(await file.getAttribute("accept"), ".csv,text/csv");
  const requests = [];
  const watch = (request) => requests.push(new URL(request.url()).pathname);
  page.on("request", watch);
  await file.setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Unsupported test file"),
  });
  assert.equal(
    await page.getByTestId("text-statement-preview-error").innerText(),
    copy[lang].csvRequired
  );
  const confirm = page.getByTestId("button-confirm-import");
  assert.ok(await confirm.isDisabled());
  page.off("request", watch);
  assert.ok(!requests.some((url) => url.endsWith("/bank-statements/preview")));

  await page.getByTestId("select-import-bank-account").click();
  await page.getByRole("option").first().click();
  const description = lang === "ar" ? "إيداع تجريبي" : "Sample deposit";
  const csv =
    lang === "ar"
      ? `التاريخ,الوصف,المبلغ\n2026-10-14,${description},1050\n`
      : `Date,Description,Amount\n2026-10-14,${description},1050\n`;
  await file.setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByTestId("panel-statement-mapper").waitFor();
  assert.ok(await confirm.isEnabled());
  await capture(page, `${name}-bank-csv-preview`);
  await confirm.click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText(description, { exact: true }).filter({ visible: true }).first().waitFor();
  await page.getByTestId("tab-recon-suggestions").click();
  await page.waitForLoadState("networkidle");
}

async function manualReceiptFlow(page, companyId, token, lang, name) {
  assert.equal((await checked(token, "GET", "/api/ocr/status")).aiConfigured, false);
  const image = await sharp({
    create: { width: 160, height: 200, channels: 3, background: "#e0e8e0" },
  })
    .png()
    .toBuffer();
  const merchant = lang === "ar" ? "متجر الواحة" : "Oasis Supplies";
  await page.getByTestId("input-file").setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByTestId("button-manual-receipt-0").click();
  await page.getByTestId("input-manual-merchant").fill(merchant);
  await page.getByTestId("input-manual-amount").fill("125");
  await capture(page, `${name}-receipt-manual`);
  await page.getByTestId("button-submit-manual-expense").click();
  await page.getByTestId("dialog-manual-expense").waitFor({ state: "hidden" });
  const receipts = await checked(token, "GET", `/api/companies/${companyId}/receipts`);
  assert.ok(
    receipts.find((row) => row.merchant === merchant)?.imagePath,
    "receipt image was not saved"
  );
}

async function ocrReview(page, lang, name) {
  // Exercise review using a local fixture response. The browser never contacts an OCR provider.
  const statusPattern = "**/api/ocr/status";
  const processPattern = "**/api/ocr/process";
  const merchant = lang === "ar" ? "مكتبة الواحة" : "Oasis Stationery";
  await page.route(statusPattern, (route) => route.fulfill({ json: { aiConfigured: true } }));
  await page.route(processPattern, (route) =>
    route.fulfill({
      json: {
        merchant,
        date: "2026-10-15",
        invoiceNumber: "RECEIPT-01",
        subtotal: 100,
        vatAmount: 5,
        total: 105,
        currency: "AED",
        category: "Office Supplies",
        confidence: 0.85,
        confidenceBand: name.endsWith("-phone") ? "future-band" : "review",
        reviewReasons: ["VAT rate 8% is not a UAE standard (0% or 5%)"],
        validationIssues: [{ code: "VAT_RATE_UNUSUAL", severity: "warning" }],
        classifier: { method: "rule", confidence: 0.8 },
        ocrSource: "ai",
      },
    })
  );
  try {
    await open(page, "/receipts", lang);
    await page.getByTestId("input-file").setInputFiles({
      name: "review.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 160, height: 200, channels: 3, background: "#eff5ed" },
      })
        .png()
        .toBuffer(),
    });
    await page.getByTestId("button-process-all").click();
    const merchantInput = page.getByTestId("input-merchant-0");
    await merchantInput.waitFor();
    assert.equal(await merchantInput.inputValue(), merchant);
    await merchantInput.fill(lang === "ar" ? "مكتبة الواحة الجديدة" : "New Oasis Stationery");
    assert.ok(await page.getByTestId("input-amount-0").isVisible());
    assert.match(
      await page.getByTestId("text-classifier-why-0").innerText(),
      lang === "ar" ? /قواعد شركتك/ : /your company rules/
    );
    assert.match(
      await page.getByTestId("confidence-band-0").innerText(),
      lang === "ar" ? /تحقّق من نسبة الضريبة/ : /VAT rate 8%/
    );
    const review = page.getByTestId("button-mark-reviewed-0");
    if (name.endsWith("-phone")) {
      await review.waitFor();
      await review.click();
      assert.match(await review.innerText(), lang === "ar" ? /تمت المراجعة/ : /Reviewed/);
    } else {
      assert.equal(await review.count(), 0);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByTestId("receipt-card-0").scrollIntoViewIfNeeded();
    await capture(page, `${name}-receipt-ocr-review`);
  } finally {
    await page.unroute(statusPattern);
    await page.unroute(processPattern);
  }
}

async function invoiceEmail(context, token, company, contact, customerName, address, lang, name) {
  const invoice = await checked(token, "POST", `${company}/invoices`, {
    contactId: contact.id,
    customerName,
    date: "2026-11-10",
    dueDate: "2026-11-30",
    lines: [
      {
        description: lang === "ar" ? "خدمات استشارية" : "Consulting services",
        quantity: 1,
        unitPrice: 1250,
        vatRate: 5,
      },
    ],
  });
  await checked(token, "PATCH", `/api/invoices/${invoice.id}/status`, { status: "sent" });
  await checked(token, "POST", `${company}/invoices/${invoice.id}/send-email`, {
    to: address,
    language: lang,
  });
  const { rows } = await db.query(
    "select html, status from email_outbox where to_address = $1 and category = 'invoice'",
    [address]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "blocked_no_provider");
  const mailPage = await context.newPage();
  try {
    const assertClean = monitor(mailPage);
    // Email clients do not load the app shell. Playwright renders the actual outbox HTML.
    await mailPage.setContent(rows[0].html);
    const dir = lang === "ar" ? "rtl" : "ltr";
    assert.deepEqual(
      await mailPage.evaluate(() => ({
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
      })),
      { language: lang, direction: dir }
    );
    const invoiceLink = mailPage.locator('a[href*="/view/invoice/"]').first();
    const href = await invoiceLink.getAttribute("href");
    assert.equal(new URL(href).origin, base);
    assert.ok(
      await mailPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    );
    // Keep the bearer-style share URL out of screenshot evidence.
    await mailPage.locator('a[href*="/view/invoice/"]').evaluateAll((links) => {
      for (const link of links) {
        if (link.textContent.startsWith("http"))
          link.textContent = new URL(link.href).origin + "/view/invoice/…";
      }
    });
    await capture(mailPage, `${name}-invoice-email`);
    const publicContext = await context.browser().newContext({ serviceWorkers: "block" });
    try {
      await publicContext.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort()
      );
      const linkPage = await publicContext.newPage();
      const assertLink = monitor(linkPage);
      const response = await linkPage.goto(href);
      assert.ok(response?.ok());
      await linkPage.getByTestId("public-invoice-download").waitFor();
      await linkPage.waitForLoadState("networkidle");
      assertLink();
    } finally {
      await publicContext.close();
    }
    assertClean();
  } finally {
    await mailPage.close();
  }
}

async function retryReceiptList(context, lang) {
  const page = await context.newPage();
  try {
    const pattern = "**/api/companies/*/receipts";
    await page.route(pattern, (route) => route.fulfill({ status: 503, json: {} }));
    await open(page, "/receipts", lang);
    const error = page.getByTestId("error-state");
    await error.waitFor();
    await page.unroute(pattern);
    const result = page.waitForResponse(
      (response) =>
        response.url().endsWith("/receipts") &&
        response.request().method() === "GET" &&
        response.ok()
    );
    await error.getByRole("button").click();
    await result;
    await error.waitFor({ state: "hidden" });
  } finally {
    await page.close();
  }
}

async function login(context, email) {
  const response = await context.request.post(`${base}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  assert.ok(response.ok(), `Login returned ${response.status()}`);
  await context.addInitScript(() => localStorage.setItem("muhasib_auth_hint", "1"));
}

async function run(browser, lang, device) {
  const name = `${lang}-${device}`;
  const runId = randomUUID();
  const email = `customer-ux+${runId}@example.test`;
  const contactEmail = `portal-ux+${runId}@example.test`;
  const localized = (english, arabic) => (lang === "ar" ? arabic : english);
  await checked("", "POST", "/api/auth/register", {
    email,
    password: PASSWORD,
    name: localized("Sara Khalid", "سارة خالد"),
    companyName: localized("Oasis Trading", "شركة الواحة للتجارة"),
  });
  const { token } = await checked("", "POST", "/api/auth/login", { email, password: PASSWORD });
  const [{ id: companyId }] = await checked(token, "GET", "/api/companies");
  const company = `/api/companies/${companyId}`;

  const context = await browser.newContext({
    ...viewports[device],
    locale: localized("en-AE", "ar-AE"),
    timezoneId: "Asia/Dubai",
    colorScheme: "light",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === base ? route.continue() : route.abort()
  );
  await context.addInitScript((locale) => {
    localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale }, version: 0 }));
    localStorage.setItem("cookie-consent", "accepted");
  }, lang);
  const page = await context.newPage();
  const assertClean = monitor(page);

  async function screen(route, label, body) {
    try {
      await open(
        page,
        route,
        lang,
        label === "portal-dashboard" ? "/client-portal/dashboard" : route
      );
      if (body) await body();
      await capture(page, `${name}-${label}`);
      assertClean();
      console.log(`PASS ${name} ${label}`);
    } catch (error) {
      // Continue through the matrix so a single route failure does not hide other defects.
      try {
        assertClean();
      } catch (observed) {
        console.error(observed.message);
      }
      console.error(`FAIL ${name} ${label}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  try {
    await screen("/register", "signup", async () => {
      await page.getByTestId("signup-plan-step").waitFor();
    });
    await login(context, email);
    await screen("/onboarding", "onboarding", async () => {
      await page.getByTestId("onboarding-express").waitFor();
    });
    await checked(token, "PATCH", company, {
      trnVatNumber: "100123456700003",
      taxRegistrationType: "Standard",
      vatFilingFrequency: "Quarterly",
      taxRegistrationDate: "2025-01-01",
      emirate: "dubai",
    });
    await checked(token, "POST", `${company}/onboarding/complete`, {});
    await checked(token, "POST", `${company}/bank-accounts`, {
      nameEn: localized("Operating account", "الحساب التشغيلي"),
      bankName: "Emirates NBD",
      currency: "AED",
    });

    for (const [route, label] of [
      ["/dashboard", "dashboard"],
      ["/invoices", "invoices"],
      ["/invoices/new", "invoice-editor"],
      ["/sales/cash-sale", "cash-sale"],
      ["/bill-pay", "bills"],
      ["/bill-pay?tab=payments", "bill-payments"],
      ["/bill-pay?tab=summary", "bill-summary"],
      ["/bill-pay/new", "bill-capture"],
      ["/expense-claims", "expense-claims"],
      ["/reports", "reports"],
      ["/reports?report=ar-aging", "receivables-aging"],
      ["/financial-statements", "financial-statements"],
      ["/settings/company", "settings"],
      ["/settings/numbering", "settings-numbering"],
      ["/settings/security", "settings-security"],
      ["/bank-accounts", "bank-accounts"],
    ])
      await screen(route, label);

    await screen("/receipts", "receipts", () =>
      manualReceiptFlow(page, companyId, token, lang, name)
    );
    await screen("/receipts", "receipt-ocr", () => ocrReview(page, lang, name));
    await retryReceiptList(context, lang);
    console.log(`PASS ${name} receipt-retry`);
    await screen("/bank-reconciliation", "bank", async () => {
      await page.getByText(copy[lang].bank, { exact: true }).first().waitFor();
      await bankFlow(page, lang, name);
    });
    await screen("/bank-feeds", "bank-csv-fallback", async () => {
      await page.getByText(copy[lang].bank, { exact: true }).waitFor();
      assert.equal(
        await page.getByTestId("button-feeds-import-statement").getAttribute("href"),
        "/bank-reconciliation?import=1"
      );
      assert.doesNotMatch(
        await page.locator("main").innerText(),
        /bank feeds?|coming (?:soon|later)|الربط البنكي|قريب|لاحق/i
      );
    });
    await screen("/vat-filing", "vat-201", async () => {
      await page.getByText(copy[lang].vat, { exact: true }).waitFor();
    });

    // Sign in as a real invited portal user using an isolated cookie jar.
    const customerName = localized("Desert Rose", "وردة الصحراء");
    const contact = await checked(token, "POST", `${company}/customer-contacts`, {
      name: customerName,
      email: contactEmail,
    });
    await invoiceEmail(
      context,
      token,
      company,
      contact,
      customerName,
      `invoice-ux+${runId}@example.test`,
      lang,
      name
    );
    console.log(`PASS ${name} invoice-email`);
    const invitation = await checked(
      token,
      "POST",
      `${company}/customer-contacts/${contact.id}/portal-invitations`,
      {
        email: contactEmail,
        language: lang,
      }
    );
    const inviteToken = new URLSearchParams(new URL(invitation.inviteUrl).hash.slice(1)).get("t");
    assert.ok(inviteToken);
    const accept = await apiClient(base)(
      "",
      "POST",
      `/api/portal-invitations/${inviteToken}/accept`,
      {
        name: localized("Layla Ahmad", "ليلى أحمد"),
        password: PASSWORD,
        acceptTerms: true,
      }
    );
    assert.ok(accept.status < 300, `Portal invitation acceptance returned ${accept.status}`);
    await context.clearCookies();
    await login(context, contactEmail);
    for (const section of [
      "dashboard",
      "invoices",
      "documents",
      "statements",
      "messages",
      "account",
    ]) {
      await screen(
        section === "dashboard" ? "/client-portal" : `/client-portal/${section}`,
        `portal-${section}`
      );
    }
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const lang of locales) {
    for (const device of devices) {
      try {
        await run(browser, lang, device);
      } catch (error) {
        console.error(`FAIL ${lang}-${device}: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
} finally {
  await browser.close();
  await db.end();
}
