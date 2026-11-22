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
  if (route.startsWith("/reports")) {
    await page.getByTestId("report-panel-loading").waitFor({ state: "hidden" });
    if (route.includes("report=")) await page.getByTestId("button-back-to-report-center").waitFor();
    else await page.getByTestId("report-catalogue").waitFor();
  }
  if (route === "/bill-pay?tab=summary") await page.getByTestId("bill-summary-balances").waitFor();
  if (route === "/financial-statements") await page.getByTestId("pl-total-revenue").waitFor();
  assert.equal(await page.getByTestId("page-not-found").count(), 0);
  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    return { lang: root.lang, dir: root.dir, overflow: root.scrollWidth - innerWidth };
  });
  assert.equal(layout.lang, lang);
  assert.equal(layout.dir, lang === "ar" ? "rtl" : "ltr");
  assert.ok(layout.overflow <= 1, `${route} overflows by ${layout.overflow}px`);
}

async function selectCompany(page, companyId, notify = true) {
  await page.evaluate(
    ({ companyId, notify }) => {
      const key = "muhasib_active_company_id";
      localStorage.setItem(key, companyId);
      if (notify) window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    { companyId, notify }
  );
}

async function bankFlow(page, lang, name, companyId, otherCompanyId) {
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
  const statement = {
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  };
  await file.setInputFiles(statement);
  await page.getByTestId("panel-statement-mapper").waitFor();
  assert.ok(await confirm.isEnabled());
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = read;
      return Promise.reject(new Error("Fixture file cannot be read again"));
    };
  });
  await confirm.click();
  assert.match(
    await page.getByTestId("text-statement-preview-error").innerText(),
    lang === "ar" ? /تعذّرت قراءة ملف CSV/ : /couldn’t read this CSV/
  );
  assert.ok(await confirm.isDisabled());
  await file.setInputFiles(statement);
  await page.getByTestId("panel-statement-mapper").waitFor();
  await capture(page, `${name}-bank-csv-preview`);
  await selectCompany(page, otherCompanyId, false);
  page.on("request", watch);
  await confirm.click();
  await page.getByTestId("text-statement-preview-error").waitFor();
  page.off("request", watch);
  assert.ok(!requests.some((url) => url.endsWith("/bank-statements/import")));
  await selectCompany(page, otherCompanyId);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByTestId("button-import-transactions").click();
  await page.getByTestId("select-import-bank-account").click();
  await page.getByRole("option").first().click();
  assert.equal(await page.getByTestId("panel-statement-mapper").count(), 0);
  assert.ok(await confirm.isDisabled());
  await selectCompany(page, companyId);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByTestId("button-import-transactions").click();
  await page.getByTestId("select-import-bank-account").click();
  await page.getByRole("option").first().click();
  await file.setInputFiles(statement);
  await page.getByTestId("panel-statement-mapper").waitFor();
  await confirm.click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText(description, { exact: true }).filter({ visible: true }).first().waitFor();
  await page.getByTestId("tab-recon-suggestions").click();
  await page.waitForLoadState("networkidle");
}

async function manualReceiptFlow(page, companyId, otherCompanyId, token, lang, name) {
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
  await page.getByTestId("receipt-card-0").waitFor();
  await page.getByTestId("button-add-manual-expense").click();
  await page.getByTestId("input-manual-merchant").fill("Discard this unsaved entry");
  await page.keyboard.press("Escape");
  await page.getByTestId("dialog-manual-expense").waitFor({ state: "hidden" });
  await page.getByTestId("input-file").setInputFiles({
    name: "other-receipt.png",
    mimeType: "image/png",
    buffer: await sharp({ create: { width: 40, height: 40, channels: 3, background: "#ddddee" } })
      .png()
      .toBuffer(),
  });
  await page.getByTestId("button-manual-receipt-1").click();
  assert.equal(await page.getByTestId("input-manual-merchant").inputValue(), "");
  await page.getByTestId("input-manual-merchant").fill(merchant);
  await page.getByTestId("input-manual-amount").fill("125");
  await capture(page, `${name}-receipt-manual`);
  const receiptWrites = [];
  const watch = (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/receipts")) {
      receiptWrites.push(request.url());
    }
  };
  page.on("request", watch);
  await selectCompany(page, otherCompanyId, false);
  await page.getByTestId("button-submit-manual-expense").click();
  await page
    .getByText(
      lang === "ar" ? /تنتمي هذه المسودة إلى شركة أخرى/ : /This draft belongs to another company/
    )
    .first()
    .waitFor();
  assert.deepEqual(receiptWrites, []);
  await selectCompany(page, otherCompanyId);
  await page.getByTestId("dialog-manual-expense").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("receipt-card-0").count(), 0);
  await selectCompany(page, companyId);
  await page.getByTestId("button-manual-receipt-1").click();
  await page.getByTestId("input-manual-merchant").fill(merchant);
  await page.getByTestId("input-manual-amount").fill("125");
  page.off("request", watch);
  await page.getByTestId("button-submit-manual-expense").click();
  await page.getByTestId("dialog-manual-expense").waitFor({ state: "hidden" });
  const receipts = await checked(token, "GET", `/api/companies/${companyId}/receipts`);
  assert.ok(
    receipts.find((row) => row.merchant === merchant)?.imagePath,
    "receipt image was not saved"
  );
}

async function ocrReview(page, lang, name, token, companyId, otherCompanyId) {
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
        currency: "USD",
        category: "Office Supplies",
        confidence: 0.85,
        confidenceBand: name.endsWith("-phone") ? "future-band" : "review",
        reviewReasons: [
          "Model reported no confidence",
          "AI and internal classifier disagree on the category",
          "VAT rate 8% is not a UAE standard (0% or 5%)",
        ],
        reviewReasonCodes: ["MISSING_CONFIDENCE", "CLASSIFIER_DISAGREEMENT", "VAT_RATE_UNUSUAL"],
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
    await page.getByTestId("input-amount-0").fill("95");
    const invoiceNumber = page.locator('[id="ocr-number-0"]');
    await invoiceNumber.fill("OCR-95");
    assert.equal(await page.locator('[id="ocr-subtotal-0"]').inputValue(), "90");
    assert.match(
      await page.getByTestId("text-classifier-why-0").innerText(),
      lang === "ar" ? /قواعد شركتك/ : /your company rules/
    );
    assert.match(
      await page.getByTestId("confidence-band-0").innerText(),
      lang === "ar" ? /تحقّق من نسبة الضريبة/ : /VAT rate 8%/
    );
    assert.match(
      await page.getByTestId("confidence-band-0").innerText(),
      lang === "ar" ? /لم تُبلغ أداة قراءة الإيصال عن درجة الثقة/ : /Model reported no confidence/
    );
    assert.match(
      await page.getByTestId("confidence-band-0").innerText(),
      lang === "ar" ? /تختلف الفئات المقترحة/ : /classifier disagree/
    );
    assert.match(await page.locator('label[for="ocr-vat-0"]').innerText(), /USD|دولار|US\$/);
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
    const exportRequests = [];
    const watchExport = (request) => {
      if (request.url().endsWith("/api/ocr/export-excel")) exportRequests.push(request.url());
    };
    page.on("request", watchExport);
    await selectCompany(page, otherCompanyId, false);
    await page.getByTestId("button-download-ocr-excel").click();
    await page
      .getByText(
        lang === "ar" ? /تنتمي هذه المسودة إلى شركة أخرى/ : /This draft belongs to another company/
      )
      .first()
      .waitFor();
    assert.deepEqual(exportRequests, []);
    page.off("request", watchExport);
    await selectCompany(page, otherCompanyId);
    await page.getByTestId("receipt-card-0").waitFor({ state: "hidden" });
    assert.equal(await page.getByTestId("button-download-ocr-excel").count(), 0);
    await selectCompany(page, companyId);
    await page.getByTestId("receipt-card-0").waitFor();
    await page.getByTestId("input-file").setInputFiles({
      name: "keep-pending.png",
      mimeType: "image/png",
      buffer: await sharp({ create: { width: 40, height: 40, channels: 3, background: "#eeddee" } })
        .png()
        .toBuffer(),
    });
    await page.getByTestId("receipt-card-1").waitFor();
    const auditResponse = page.waitForResponse((response) =>
      response.url().endsWith("/review-decision")
    );
    await page.getByTestId("button-save-all").click();
    await page.getByTestId("receipt-card-1").waitFor({ state: "hidden" });
    assert.ok(await page.getByTestId("button-manual-receipt-0").isVisible());
    assert.ok((await auditResponse).ok());
    const saved = (await checked(token, "GET", `/api/companies/${companyId}/receipts`)).find(
      (row) => row.invoiceNumber === "OCR-95"
    );
    assert.ok(saved);
    assert.equal(Number(saved.amount) + Number(saved.vatAmount), 95);
    assert.equal(Number(saved.vatAmount), 5);
    const reviewLog = await db.query(
      "SELECT details::jsonb -> 'after' AS after FROM audit_logs WHERE resource_id = $1 AND action = 'receipt.ai_review'",
      [saved.id]
    );
    assert.equal(reviewLog.rows[0].after.decision, "corrected");
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
  const otherEmail = `second-company+${runId}@example.test`;
  await checked("", "POST", "/api/auth/register", {
    email: otherEmail,
    password: PASSWORD,
    name: "Second Owner",
    companyName: "Second Supplier",
  });
  const { token: otherToken } = await checked("", "POST", "/api/auth/login", {
    email: otherEmail,
    password: PASSWORD,
  });
  const [{ id: otherCompanyId }] = await checked(otherToken, "GET", "/api/companies");
  await checked(otherToken, "POST", `/api/companies/${otherCompanyId}/onboarding/complete`, {});
  await checked(otherToken, "POST", `/api/companies/${otherCompanyId}/bank-accounts`, {
    nameEn: localized("Second operating account", "الحساب التشغيلي الثاني"),
    bankName: "Emirates NBD",
    currency: "AED",
  });
  await db.query(
    `INSERT INTO company_users (company_id, user_id, role)
    SELECT $1, id, 'owner' FROM users WHERE email = $2`,
    [otherCompanyId, email]
  );

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

  async function screen(route, label, body, finalRoute = route) {
    try {
      await open(
        page,
        route,
        lang,
        label === "portal-dashboard" ? "/client-portal/dashboard" : finalRoute
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
      console.error(`FAIL ${name} ${label}: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    }
  }

  try {
    await screen("/register", "signup", async () => {
      await page.getByTestId("signup-plan-step").waitFor();
    });
    await login(context, email);
    await selectCompany(page, companyId);
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

    const exampleBill = await checked(token, "POST", `${company}/bills`, {
      vendor_name: localized("Palm Stationery", "مكتبة النخيل"),
      vendor_trn: "100000000000029",
      bill_number: "PALM-01",
      bill_date: "2026-11-10",
      due_date: "2026-12-15",
      line_items: [
        {
          description: localized("Stationery", "قرطاسية"),
          quantity: 1,
          unit_price: 100,
          vat_rate: 5,
        },
      ],
    });
    const bill = `/api/bills/${exampleBill.id}`;
    await checked(token, "POST", `${bill}/approve`, {});
    const paid = await checked(token, "POST", `${bill}/payments`, {
      payment_date: "2026-11-14",
      amount: 105,
    });
    const reversed = await checked(token, "POST", `${bill}/payments/${paid.payment.id}/void`, {
      reason: "Receipt for supplier correction",
    });
    assert.equal(reversed.bill_status, "approved");

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
      await screen(
        route,
        label,
        label === "bill-payments"
          ? async () => {
              await page.getByText(localized("Voided", "ملغاة"), { exact: true }).waitFor();
              await page.getByText(localized("Reversal", "قيد عكسي"), { exact: true }).waitFor();
            }
          : undefined
      );

    await screen("/receipts", "receipts", () =>
      manualReceiptFlow(page, companyId, otherCompanyId, token, lang, name)
    );
    await screen("/receipts", "receipt-ocr", () =>
      ocrReview(page, lang, name, token, companyId, otherCompanyId)
    );
    await retryReceiptList(context, lang);
    console.log(`PASS ${name} receipt-retry`);
    await screen("/bank-reconciliation", "bank", async () => {
      await page.getByText(copy[lang].bank, { exact: true }).first().waitFor();
      await bankFlow(page, lang, name, companyId, otherCompanyId);
    });
    let providerRequests = 0;
    const providerUrl = "**/api/bank/providers";
    await page.route(providerUrl, async (route) => {
      providerRequests++;
      if (device === "phone") await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        json: { statuses: [{ id: "fixture", configured: device === "desktop" }] },
      });
    });
    await screen(
      "/banking",
      "bank-csv-fallback",
      async () => {
        await page.getByText(copy[lang].bank, { exact: true }).waitFor();
        for (const alias of ["/bank-feeds", "/bank-feeds/callback?code=fixture&state=fixture"]) {
          await open(page, alias, lang, "/bank-reconciliation");
        }
        assert.equal(providerRequests, 0);
        assert.doesNotMatch(
          await page.locator("main").innerText(),
          /bank feeds?|coming (?:soon|later)|الربط البنكي|قريب|لاحق/i
        );
      },
      "/bank-reconciliation"
    );
    await page.unroute(providerUrl);
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
    const secondContact = await checked(
      otherToken,
      "POST",
      `/api/companies/${otherCompanyId}/customer-contacts`,
      {
        name: "Second Portal Contact",
        email: contactEmail,
      }
    );
    const bound = await db.query(
      `SELECT a.user_id, a.id FROM customer_portal_accounts a JOIN users u ON u.id = a.user_id
       WHERE a.company_id = $1 AND u.email = $2`,
      [companyId, contactEmail]
    );
    const firstBinding = bound.rows[0].id;
    const second = await db.query(
      `INSERT INTO customer_portal_accounts (user_id, company_id, contact_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [bound.rows[0].user_id, otherCompanyId, secondContact.id]
    );
    const otherBinding = second.rows[0].id;
    const selectSupplier = (id) =>
      page.evaluate((account) => {
        localStorage.setItem("muhasib.portalAccount", account);
      }, id);

    await context.clearCookies();
    await login(context, contactEmail);
    await selectSupplier(firstBinding);
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
        `portal-${section}`,
        section === "messages"
          ? async () => {
              const message = localized("Message for the first supplier", "رسالة للمورد الأول");
              await page.getByRole("textbox").last().fill(message);
              await selectSupplier(otherBinding);
              const sent = page.waitForResponse(
                (response) =>
                  response.url().endsWith("/api/client-portal/messages") &&
                  response.request().method() === "POST"
              );
              await page.getByTestId("button-portal-send").click();
              assert.equal((await (await sent).json()).companyId, companyId);
              await selectSupplier(firstBinding);
            }
          : section === "documents"
            ? async () => {
                const choosing = page.waitForEvent("filechooser");
                await page.getByTestId("button-portal-upload").click();
                const chooser = await choosing;
                await selectSupplier(otherBinding);
                const upload = page.waitForResponse(
                  (response) =>
                    response.url().endsWith("/api/client-portal/documents") &&
                    response.request().method() === "POST"
                );
                await chooser.setFiles({
                  name: "scoped-document.txt",
                  mimeType: "text/plain",
                  buffer: Buffer.from("Document belongs to the first supplier."),
                });
                assert.equal((await (await upload).json()).companyId, companyId);
                await selectSupplier(firstBinding);
              }
            : undefined
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
