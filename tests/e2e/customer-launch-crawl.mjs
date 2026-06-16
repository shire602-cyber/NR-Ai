/* Muhasib.ai customer-launch browser E2E.
 *
 * Drives the running app as a real SaaS customer, not NR staff:
 *   1. checks public launch pages that ads will send buyers to
 *   2. registers a fresh customer account and completes express onboarding
 *   3. crawls launch-critical SaaS customer routes with no admin/firm role promotion
 *   4. posts customer-owned accounting artifacts: balanced journal, invoice, bank CSV import
 *   5. reruns mobile checks for invoices, receipts, banking, reports, and VAT
 *   6. verifies NR-only surfaces stay blocked, including WhatsApp and document chasing
 *
 * Env:
 *   BASE_URL (default http://127.0.0.1:5000)
 *   CUSTOMER_E2E_PUBLIC_ONLY=true to run the read-only public launch crawl
 *   CUSTOMER_E2E_ALLOW_REMOTE_MUTATION=true to allow full mode against a non-local URL
 *   CHROMIUM_PATH (optional browser override)
 * Exit code 0 = every check passed. Screenshots of failures land in tests/e2e/.artifacts/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
const PUBLIC_ONLY = process.env.CUSTOMER_E2E_PUBLIC_ONLY === "true";
const ALLOW_REMOTE_MUTATION = process.env.CUSTOMER_E2E_ALLOW_REMOTE_MUTATION === "true";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, ".artifacts");

const PUBLIC_ROUTES = ["/", "/demo", "/trust", "/help", "/migration-guides", "/pricing"];

const CUSTOMER_ROUTES = [
  "/dashboard",
  "/invoices",
  "/receipts",
  "/bank-reconciliation",
  "/vat-filing",
  "/corporate-tax",
  "/reports",
  "/advanced-reports",
  "/payment-chasing",
  "/contacts",
  "/integrations",
  "/document-vault",
  "/subscription",
];

const MOBILE_ROUTES = ["/invoices", "/receipts", "/bank-reconciliation", "/reports", "/vat-filing"];

const FORBIDDEN_ROUTES = [
  "/whatsapp",
  "/document-chasing",
  "/firm/document-chasing",
  "/firm/comms",
  "/firm/clients",
  "/firm/value-ops",
  "/admin",
  "/admin/dashboard",
];

const FORBIDDEN_API_STATUS_PATHS = [
  "/api/integrations/whatsapp/status",
  "/api/whatsapp/status",
  "/api/firm/clients",
  "/api/firm/comms/log",
  "/api/firm/value-ops",
  "/api/admin/integration-status",
];

const FAIL_TEXT = /something went wrong|an error occurred|failed to load|unexpected error/i;
const PRIVATE_TEXT = /WhatsApp|Document Chasing|Firm Command|NR Accountant|Value Ops/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function resolveExecutablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

function cleanPath(url) {
  return url.replace(BASE, "").split("?")[0];
}

function isExpectedAnonymousAuthFailure(response) {
  const status = response.status();
  return response.url().includes("/api/auth/refresh") && (status === 400 || status === 401);
}

function isLocalBaseUrl() {
  try {
    const url = new URL(BASE);
    return LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertFullModeMayMutate() {
  if (PUBLIC_ONLY || isLocalBaseUrl() || ALLOW_REMOTE_MUTATION) return;
  throw new Error(
    [
      "Refusing to run full customer E2E against a non-local BASE_URL.",
      "This script registers a customer and creates accounting records.",
      "Use CUSTOMER_E2E_PUBLIC_ONLY=true for a read-only public launch crawl,",
      "or run against staging/local. Set CUSTOMER_E2E_ALLOW_REMOTE_MUTATION=true only for an approved disposable target.",
    ].join(" ")
  );
}

async function main() {
  assertFullModeMayMutate();
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await resolveExecutablePath(),
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const failures = [];
  let routeErrors = [];
  let apiFailures = [];

  page.on("pageerror", (e) => routeErrors.push(`JS: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    const url = r.url();
    if (isExpectedAnonymousAuthFailure(r)) return;
    if (!url.includes("/api/") || r.status() < 400 || r.status() === 401) return;
    apiFailures.push(`${r.request().method()} ${cleanPath(url)} -> ${r.status()}`);
  });

  const fail = async (name, detail) => {
    failures.push({ name, ...detail });
    try {
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name.replace(/[^a-z0-9-]+/gi, "_")}.png`),
      });
    } catch {
      /* page may be gone */
    }
  };

  async function crawlRoute(route, options = {}) {
    routeErrors = [];
    apiFailures = [];
    await page.goto(`${BASE}${route}`, { timeout: 45000 });
    await page.waitForTimeout(options.waitMs ?? 1700);
    const finalUrl = cleanPath(page.url());
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const failText = bodyText.match(FAIL_TEXT)?.[0] ?? null;
    const blank = bodyText.trim().length < 40;
    const redirected = options.expectPrefix ? !finalUrl.startsWith(route) : finalUrl !== route;
    if (routeErrors.length || apiFailures.length || failText || blank || redirected) {
      await fail(`route ${route}`, {
        finalUrl: redirected ? finalUrl : undefined,
        failText,
        blank: blank || undefined,
        js: routeErrors.slice(0, 3),
        api: [...new Set(apiFailures)].slice(0, 5),
      });
    }
    return bodyText;
  }

  async function crawlMobileRoute(route) {
    await page.setViewportSize({ width: 390, height: 844 });
    await crawlRoute(route, { expectPrefix: true, waitMs: 1900 });
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
      const clientWidth = Math.max(doc.clientWidth, window.innerWidth);
      return {
        clientWidth,
        scrollWidth,
        overflowing: scrollWidth > clientWidth + 8,
      };
    });
    if (overflow.overflowing) {
      await fail(`mobile overflow ${route}`, overflow);
    }
  }

  // Public launch surface: these are the routes ads and prospects will hit first.
  for (const route of PUBLIC_ROUTES) {
    await crawlRoute(route);
  }

  if (PUBLIC_ONLY) {
    await browser.close();
    console.log(
      `\n=== Customer launch public E2E: ${PUBLIC_ROUTES.length} public routes · ${failures.length} failure(s) ===`
    );
    for (const f of failures) console.log(JSON.stringify(f));
    if (failures.length > 0) {
      console.log(`Screenshots: ${SHOT_DIR}`);
      process.exit(1);
    }
    console.log("All public customer-launch checks passed.");
    return;
  }

  // Fresh SaaS customer registration. No direct database promotion is used in
  // this script: it must reflect what a buyer can do from the product surface.
  const email = `customer-e2e+${Date.now()}@test.local`;
  const password = "Password123!";
  const reg = await page.request.post(`${BASE}/api/auth/register`, {
    data: {
      email,
      password,
      name: "Launch QA Customer",
      companyName: "Launch QA Trading LLC",
    },
  });
  if (reg.status() !== 200 && reg.status() !== 201) {
    await fail("register", {
      detail: `status ${reg.status()}: ${(await reg.text()).slice(0, 200)}`,
    });
    throw new Error(`register failed: ${reg.status()}`);
  }

  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2500);
  if (page.url().includes("onboarding")) {
    const express = page.locator('[data-testid="onboarding-express"]');
    if (await express.count()) {
      await express.click();
      await page.waitForTimeout(3500);
    }
  }
  if (!cleanPath(page.url()).startsWith("/dashboard")) {
    await fail("customer-onboarding", { detail: `ended on ${cleanPath(page.url())}` });
  }

  const csrfToken = (await (await page.request.get(`${BASE}/api/csrf-token`)).json())?.csrfToken;
  const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
  const companyId = companies?.[0]?.id;
  if (!companyId) {
    await fail("customer-company", { detail: "registered customer has no company" });
  }

  // Customer SaaS route crawl. This excludes every admin and NR firm route.
  for (const route of CUSTOMER_ROUTES) {
    await crawlRoute(route, { expectPrefix: true });
  }

  // Mobile launch QA: the routes most likely to be opened from ads, email, or
  // on-the-go bookkeeping must render without document-level horizontal scroll.
  for (const route of MOBILE_ROUTES) {
    await crawlMobileRoute(route);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  if (companyId) {
    // Core bookkeeping: balanced journal posts through the same customer API used by the UI.
    try {
      const accounts = await (
        await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)
      ).json();
      const debitAccount = accounts.find((a) => a.type === "expense") ?? accounts[0];
      const creditAccount = accounts.find((a) => a.type === "asset") ?? accounts[1];
      const memo = `Customer E2E balanced entry ${Date.now()}`;
      const entryRes = await page.request.post(`${BASE}/api/companies/${companyId}/journal`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          date: new Date().toISOString().slice(0, 10),
          memo,
          lines: [
            { accountId: debitAccount.id, debit: 150, credit: 0 },
            { accountId: creditAccount.id, debit: 0, credit: 150 },
          ],
        },
      });
      if (entryRes.status() >= 300) {
        await fail("customer-journal create", {
          detail: `status ${entryRes.status()}: ${(await entryRes.text()).slice(0, 200)}`,
        });
      } else {
        const journalText = await crawlRoute("/journal", { expectPrefix: true });
        if (!journalText.includes(memo)) {
          await fail("customer-journal render", { detail: "posted entry not visible" });
        }
      }
    } catch (e) {
      await fail("customer-journal", { crash: e.message.slice(0, 150) });
    }

    // Invoice creation: proves the launch invoice surface can create and render customer data.
    try {
      const invoiceNumber = `CUST-E2E-${Date.now()}`;
      const invoiceRes = await page.request.post(`${BASE}/api/companies/${companyId}/invoices`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          number: invoiceNumber,
          customerName: "Launch QA Buyer LLC",
          date: new Date().toISOString().slice(0, 10),
          currency: "AED",
          subtotal: 1000,
          vatAmount: 50,
          total: 1050,
          status: "sent",
          lines: [
            { description: "Launch QA services", quantity: 1, unitPrice: 1000, vatRate: 0.05 },
          ],
        },
      });
      if (invoiceRes.status() >= 300) {
        await fail("customer-invoice create", {
          detail: `status ${invoiceRes.status()}: ${(await invoiceRes.text()).slice(0, 200)}`,
        });
      } else {
        const invoiceText = await crawlRoute("/invoices", { expectPrefix: true });
        if (!invoiceText.includes(invoiceNumber)) {
          await fail("customer-invoice render", { detail: "created invoice not visible" });
        }
      }
    } catch (e) {
      await fail("customer-invoice", { crash: e.message.slice(0, 150) });
    }

    // Bank import: exercises the polished no-live-feed path with a realistic CSV.
    try {
      const connRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/bank-connections`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
          data: {
            provider: "manual",
            connectionType: "statement",
            bankName: "Emirates NBD",
            accountName: "Current AED",
          },
        }
      );
      if (connRes.status() >= 300) {
        await fail("customer-bank connection", {
          detail: `status ${connRes.status()}: ${(await connRes.text()).slice(0, 200)}`,
        });
      } else {
        const conn = await connRes.json();
        const csv = [
          "date,description,amount,reference",
          "2026-06-01,Customer payment Pearl Trading,5250.00,RCPT-77",
          "2026-06-02,DEWA utility bill,-820.50,DEWA-9",
        ].join("\n");
        const importRes = await page.request.post(
          `${BASE}/api/companies/${companyId}/bank-connections/${conn.id}/import`,
          { headers: { "x-csrf-token": csrfToken ?? "" }, data: { csvContent: csv } }
        );
        const result = await importRes.json().catch(() => ({}));
        if (importRes.status() >= 300 || (result?.imported ?? result?.count ?? 0) < 2) {
          await fail("customer-bank import", {
            detail: `status ${importRes.status()}: ${JSON.stringify(result).slice(0, 160)}`,
          });
        }
      }
    } catch (e) {
      await fail("customer-bank", { crash: e.message.slice(0, 150) });
    }

    FORBIDDEN_API_STATUS_PATHS.push(
      `/api/companies/${companyId}/document-requirements`,
      `/api/companies/${companyId}/document-chases/queue`
    );
  }

  // Customer must not see NR/admin/WhatsApp/document-chasing surfaces even by guessing URLs.
  for (const route of FORBIDDEN_ROUTES) {
    routeErrors = [];
    apiFailures = [];
    await page.goto(`${BASE}${route}`, { timeout: 45000 });
    await page.waitForTimeout(1200);
    const finalUrl = cleanPath(page.url());
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (finalUrl.startsWith(route) && PRIVATE_TEXT.test(bodyText)) {
      await fail(`forbidden route ${route}`, {
        detail: "private route rendered for SaaS customer",
        finalUrl,
      });
    }
  }

  for (const apiPath of FORBIDDEN_API_STATUS_PATHS) {
    const res = await page.request.get(`${BASE}${apiPath}`);
    if (![401, 403].includes(res.status())) {
      await fail(`forbidden api ${apiPath}`, {
        detail: `expected 401/403, got ${res.status()}`,
      });
    }
  }

  await browser.close();

  console.log(
    `\n=== Customer launch E2E: ${PUBLIC_ROUTES.length} public + ${CUSTOMER_ROUTES.length} SaaS + ${MOBILE_ROUTES.length} mobile routes · ${failures.length} failure(s) ===`
  );
  for (const f of failures) console.log(JSON.stringify(f));
  if (failures.length > 0) {
    console.log(`Screenshots: ${SHOT_DIR}`);
    process.exit(1);
  }
  console.log("All customer-launch checks passed.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
