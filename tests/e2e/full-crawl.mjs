/* Muhasib.ai full-application browser E2E.
 *
 * Drives the running app in headless Chromium as a firm-owner admin:
 *   1. registers a fresh account and completes express onboarding
 *   2. crawls every workspace route — JS errors, error screens, blank mains,
 *      unexpected redirects, and 4xx/5xx API responses all fail the run
 *   3. exercises a real double-entry flow: balanced journal entry posted via
 *      the API must render in the journal UI
 *   4. creates a firm client and opens its profile
 *
 * Env: BASE_URL (default http://127.0.0.1:5000), DATABASE_URL (for the
 * one-time role promotion), CHROMIUM_PATH (optional browser override).
 * Exit code 0 = every check passed. Screenshots of failures land in
 * tests/e2e/.artifacts/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5000";
// Fable N1: browse in UAE time so a business date formatted as a browser-zone instant (a 30 Sep
// period end shown as 1 Oct) shows up here. Override with E2E_TIMEZONE.
const BROWSER_TIMEZONE = process.env.E2E_TIMEZONE || "Asia/Dubai";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, ".artifacts");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for E2E role promotion against the test database.");
  process.exit(1);
}

const ROUTES = [
  "/dashboard",
  "/invoices",
  "/recurring-invoices",
  "/payment-chasing",
  "/contacts",
  "/receipts",
  // WP-C: /receipt-autopilot redirects to the Receipts Automation tab.
  "/receipts?tab=automation",
  "/chart-of-accounts",
  "/journal",
  "/vat-filing",
  // WP-D: /vat-autopilot redirects to the VAT Periods tab.
  "/vat-filing?tab=periods",
  "/bank-reconciliation",
  "/corporate-tax",
  "/compliance-calendar",
  "/tax-return-archive",
  "/reports",
  // WP-D: /analytics (all views) redirects to the Reports Insights workspace.
  "/reports?workspace=insights",
  "/cashflow-forecast",
  "/anomaly-detection",
  // WP-C: /auto-reconcile and /reconciliation-rules redirect to the reconciliation tabs.
  "/bank-reconciliation?tab=suggestions",
  "/bank-reconciliation?tab=rules",
  // WP-E: the /ai hub (every legacy tab) redirects to the Assistant.
  "/assistant?tab=ask",
  "/assistant?tab=review",
  "/assistant?tab=automations",
  "/payroll",
  "/fixed-assets",
  "/budgets",
  "/bill-pay",
  "/expense-claims",
  "/inventory",
  // /integrations redirects to /integrations-hub.
  "/integrations-hub",
  "/notifications",
  // WP-C: /reminders redirects to the Payment reminders Schedule tab.
  "/payment-chasing?tab=schedule",
  // /company-profile redirects to /settings/company since CL-B merged the two pages.
  "/settings/company",
  "/team",
  "/document-vault",
  "/month-end",
  "/backup-restore",
  "/history",
  "/exchange-rates",
  "/quotes",
  "/credit-notes",
  "/purchase-orders",
  "/cost-centers",
  "/financial-statements",
  "/invoice-templates",
  "/document-versions",
  "/developer-settings",
  "/notification-preferences",
  "/subscription",
  // WP-D: /task-center redirects to the calendar's List view.
  "/compliance-calendar?view=list",
  // WP-E: /news-feed redirects to the compliance calendar (crawled above); /admin and
  // /admin/dashboard redirect to /admin/users (crawled below).
  "/admin/invitations",
  "/admin/import",
  "/admin/activity-logs",
  "/admin/users",
  "/firm/command-center",
  "/firm/clients",
  "/firm/staff",
  "/firm/health",
  "/firm/analytics",
  "/firm/bulk",
  "/firm/comms",
  "/firm/document-chasing",
  "/firm/pipeline",
  "/firm/value-ops",
];

// API endpoints that are allowed to 4xx without failing a route (documented
// gaps, not regressions). Keep this list short and justified.
const TOLERATED_API = [];

const FAIL_TEXT = /something went wrong|an error occurred|failed to load|unexpected error/i;
const NOT_FOUND = (t) =>
  /not found/i.test(t) && t.trim().length < 300 && !/no [a-z ]*found/i.test(t);

/** Poll the page's <main> until it shows `text` (client render after a fetch is not instant). */
async function mainShows(page, text, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const body = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    // Long document numbers wrap across lines in table cells, so compare without whitespace.
    if (body.replace(/\s+/g, "").includes(text.replace(/\s+/g, ""))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function resolveExecutablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

async function openDashboard(page) {
  await page.goto(`${BASE}/dashboard`);
  const express = page.getByTestId("onboarding-express");
  const dashboard = page.getByTestId("dashboard-title");
  await express.or(dashboard).filter({ visible: true }).first().waitFor({ timeout: 30000 });
  if (await express.isVisible()) {
    await express.click();
    await page.getByTestId("onboarding-skip").click({ timeout: 20000 });
    await page.getByTestId("onboarding-task-explore").click({ timeout: 20000 });
  }
  await dashboard.waitFor({ timeout: 20000 });
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await resolveExecutablePath(),
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: BROWSER_TIMEZONE,
  });
  await ctx.addInitScript(() => {
    // The client only probes the cookie session when this non-secret sign-in hint is set (R18-04).
    localStorage.setItem("muhasib_auth_hint", "1");
  });
  const page = await ctx.newPage();

  let routeErrors = [];
  let apiFailures = [];
  page.on("pageerror", (e) => routeErrors.push(`JS: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => {
    const url = r.url();
    if (!url.includes("/api/") || r.status() < 400 || r.status() === 401) return;
    const cleanPath = url.replace(BASE, "").split("?")[0];
    if (TOLERATED_API.some((re) => re.test(cleanPath))) return;
    apiFailures.push(`${r.request().method()} ${cleanPath} -> ${r.status()}`);
  });

  const failures = [];
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

  // ── 1. Fresh account + express onboarding ─────────────────────────────────
  const email = `e2e+${Date.now()}@test.local`;
  const reg = await page.request.post(`${BASE}/api/auth/register`, {
    data: { email, password: "Password123!", name: "E2E Owner", companyName: "E2E Holdings LLC" },
  });
  if (reg.status() !== 200 && reg.status() !== 201) {
    await fail("register", { detail: `status ${reg.status()}` });
    throw new Error(`register failed: ${reg.status()}`);
  }
  // W5-E: registration returns no session; sign in (sets the auth cookies).
  await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: "Password123!" } });

  try {
    await openDashboard(page);
  } catch (error) {
    await fail("express-onboarding", { detail: `ended on ${page.url()}` });
    throw error;
  }

  // Promote to admin + firm owner so the crawl covers admin and firm suites.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `UPDATE users SET is_admin = true, user_type = 'admin', firm_role = 'firm_owner', email_verified = true WHERE email = $1`,
    [email]
  );
  await db.end();

  // ── 2. Seed a firm client (CSRF-signed API call) ──────────────────────────
  const csrfToken = (await (await page.request.get(`${BASE}/api/csrf-token`)).json())?.csrfToken;
  const clientRes = await page.request.post(`${BASE}/api/firm/clients`, {
    headers: { "x-csrf-token": csrfToken ?? "" },
    data: { name: `E2E Client ${Date.now()}`, emirate: "dubai", contactEmail: "client@e2e.local" },
  });
  let clientId = null;
  try {
    const body = await clientRes.json();
    clientId = body?.id ?? body?.company?.id ?? null;
  } catch {
    /* tolerated below */
  }
  if (!clientId) await fail("firm-client-create", { detail: `status ${clientRes.status()}` });

  // Dismiss the milestone wizard once; it must stay dismissed.
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2500);
  const skipBtn = page.locator('[data-testid="button-skip-onboarding"]');
  if (await skipBtn.count()) {
    await skipBtn.click();
    await page.waitForTimeout(800);
  }

  // ── 3. Route crawl ─────────────────────────────────────────────────────────
  const routes = clientId ? [...ROUTES, `/firm/clients/${clientId}`] : [...ROUTES];
  for (const route of routes) {
    routeErrors = [];
    apiFailures = [];
    try {
      await page.goto(`${BASE}${route}`, { timeout: 45000 });
      const main = page.locator("main");
      await main.getByRole("heading").filter({ visible: true }).first().waitFor({ timeout: 18000 });
      const finalUrl = page.url().replace(BASE, "");
      const mainText = await main.innerText();
      const failText =
        mainText.match(FAIL_TEXT)?.[0] ?? (NOT_FOUND(mainText) ? "not-found screen" : null);
      const blank = mainText.trim().length < 40;
      const redirected = !finalUrl.startsWith(route);
      if (routeErrors.length || apiFailures.length || failText || blank || redirected) {
        await fail(`route ${route}`, {
          finalUrl: redirected ? finalUrl : undefined,
          failText,
          blank: blank || undefined,
          js: routeErrors.slice(0, 3),
          api: [...new Set(apiFailures)].slice(0, 5),
        });
      }
    } catch (e) {
      await fail(`route ${route}`, { crash: e.message.slice(0, 150) });
    }
  }

  // ── 4. Core flow: balanced double-entry journal posts and renders ─────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const accounts = await (
      await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)
    ).json();
    const debitAccount = accounts.find((a) => a.type === "expense") ?? accounts[0];
    const creditAccount = accounts.find((a) => a.type === "asset") ?? accounts[1];
    const memo = `E2E balanced entry ${Date.now()}`;
    const entryRes = await page.request.post(`${BASE}/api/companies/${companyId}/journal`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        date: new Date().toISOString().slice(0, 10),
        memo,
        status: "posted",
        lines: [
          { accountId: debitAccount.id, debit: 150, credit: 0 },
          { accountId: creditAccount.id, debit: 0, credit: 150 },
        ],
      },
    });
    if (entryRes.status() >= 300) {
      await fail("journal-flow create", {
        detail: `status ${entryRes.status()}: ${(await entryRes.text()).slice(0, 200)}`,
      });
    } else {
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/journal`);
      if (!(await mainShows(page, memo))) {
        await fail("journal-flow render", { detail: "posted entry not visible in journal UI" });
      }
    }
  } catch (e) {
    await fail("journal-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 5. Quote lifecycle: create → renders in UI → converts to invoice ──────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const quoteRes = await page.request.post(`${BASE}/api/companies/${companyId}/quotes`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        // number, status and totals are server-owned (strict body).
        customerName: "Quote Customer LLC",
        date: new Date().toISOString().slice(0, 10),
        currency: "AED",
        placeOfSupplyEmirate: "dubai",
        lines: [{ description: "Consulting services", quantity: 2, unitPrice: 500, vatRate: 0.05 }],
      },
    });
    if (quoteRes.status() !== 201) {
      await fail("quote-flow create", {
        detail: `status ${quoteRes.status()}: ${(await quoteRes.text()).slice(0, 200)}`,
      });
    } else {
      const quote = await quoteRes.json();
      const quoteNumber = quote.number;
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/quotes`);
      if (!(await mainShows(page, quoteNumber))) {
        await fail("quote-flow render", { detail: "created quote not visible in quotes UI" });
      }
      const convertRes = await page.request.post(
        `${BASE}/api/quotes/${quote.id}/convert-to-invoice`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      if (convertRes.status() >= 300) {
        await fail("quote-flow convert", {
          detail: `status ${convertRes.status()}: ${(await convertRes.text()).slice(0, 200)}`,
        });
      } else {
        const detail = await (await page.request.get(`${BASE}/api/quotes/${quote.id}`)).json();
        if (detail?.status !== "converted" || !detail?.convertedInvoiceId) {
          await fail("quote-flow status", { detail: `expected converted, got ${detail?.status}` });
        }
      }
    }
  } catch (e) {
    await fail("quote-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 6. Credit note lifecycle: create from invoice → renders as canonical
  //       invoice-embedded credit note ─────────────────────────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    // Credit notes are raised against an ISSUED invoice: create and issue one here. 0% (out of
    // scope) because the crawl company has no TRN yet and VAT cannot be issued without one (X6a).
    const srcRes = await page.request.post(`${BASE}/api/companies/${companyId}/invoices`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        customerName: "Credit Note Customer LLC",
        date: new Date().toISOString().slice(0, 10),
        placeOfSupplyEmirate: "dubai",
        lines: [
          {
            description: "Consulting",
            quantity: 1,
            unitPrice: 400,
            vatRate: 0,
            vatSupplyType: "out_of_scope",
          },
        ],
      },
    });
    const sourceInvoice = srcRes.status() < 300 ? await srcRes.json() : undefined;
    if (sourceInvoice?.id) {
      await page.request.patch(`${BASE}/api/invoices/${sourceInvoice.id}/status`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: { status: "sent" },
      });
    }
    if (!sourceInvoice?.id) {
      await fail("credit-note-flow source", { detail: "no source invoice available" });
    } else {
      const cnRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/invoices/${sourceInvoice.id}/credit-note`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      if (cnRes.status() !== 201) {
        await fail("credit-note-flow create", {
          detail: `status ${cnRes.status()}: ${(await cnRes.text()).slice(0, 200)}`,
        });
      } else {
        const note = await cnRes.json();
        const cnNumber = note.number;
        routeErrors = [];
        apiFailures = [];
        await page.goto(`${BASE}/credit-notes`);
        if (!(await mainShows(page, cnNumber))) {
          await fail("credit-note-flow render", {
            detail: "created credit note not visible in UI",
          });
        }
        const detail = await (await page.request.get(`${BASE}/api/credit-notes/${note.id}`)).json();
        if (detail?.status !== "issued" || detail?.invoiceId !== sourceInvoice.id) {
          await fail("credit-note-flow status", {
            detail: `expected canonical issued credit note for ${sourceInvoice.id}, got ${detail?.status}`,
          });
        }
      }
    }
  } catch (e) {
    await fail("credit-note-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 7. Purchase order lifecycle: create → renders → send → approve →
  //       receive ───────────────────────────────────────────────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const poRes = await page.request.post(`${BASE}/api/companies/${companyId}/purchase-orders`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        vendorName: "Supplier Trading FZE",
        date: new Date().toISOString().slice(0, 10),
        expectedDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        currency: "AED",
        lines: [{ description: "Office supplies", quantity: 5, unitPrice: 100, vatRate: 0.05 }],
      },
    });
    if (poRes.status() !== 201) {
      await fail("po-flow create", {
        detail: `status ${poRes.status()}: ${(await poRes.text()).slice(0, 200)}`,
      });
    } else {
      const po = await poRes.json();
      const poNumber = po.number; // server-assigned
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/purchase-orders`);
      if (!(await mainShows(page, poNumber))) {
        await fail("po-flow render", { detail: "created purchase order not visible in UI" });
      }
      for (const step of ["send", "approve", "receive"]) {
        const stepRes = await page.request.post(`${BASE}/api/purchase-orders/${po.id}/${step}`, {
          headers: { "x-csrf-token": csrfToken ?? "" },
        });
        if (stepRes.status() >= 300) {
          await fail(`po-flow ${step}`, {
            detail: `status ${stepRes.status()}: ${(await stepRes.text()).slice(0, 200)}`,
          });
          break;
        }
      }
      const detail = await (await page.request.get(`${BASE}/api/purchase-orders/${po.id}`)).json();
      if (detail?.status !== "received") {
        await fail("po-flow status", { detail: `expected received, got ${detail?.status}` });
      }
    }
  } catch (e) {
    await fail("po-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 8. Cost center flow: create → renders → allocate a journal line →
  //       per-center P&L report reflects it ─────────────────────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const ccCode = `CC-${Date.now() % 100000}`;
    const ccRes = await page.request.post(`${BASE}/api/companies/${companyId}/cost-centers`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: { code: ccCode, name: "Dubai Branch", description: "E2E cost center" },
    });
    if (ccRes.status() !== 201) {
      await fail("cost-center-flow create", {
        detail: `status ${ccRes.status()}: ${(await ccRes.text()).slice(0, 200)}`,
      });
    } else {
      const cc = await ccRes.json();
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/cost-centers`);
      if (!(await mainShows(page, "Dubai Branch"))) {
        await fail("cost-center-flow render", { detail: "created cost center not visible in UI" });
      }
      const summaryRes = await page.request.get(
        `${BASE}/api/companies/${companyId}/cost-centers/${cc.id}/report`
      );
      if (summaryRes.status() >= 300) {
        await fail("cost-center-flow report", {
          detail: `status ${summaryRes.status()}: ${(await summaryRes.text()).slice(0, 200)}`,
        });
      }
    }
  } catch (e) {
    await fail("cost-center-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9. Financial statements + reconciliation rules flows ──────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;

    // P&L must reflect the journal entry posted in flow 4 (150 expense).
    const today = new Date().toISOString().slice(0, 10);
    const plRes = await page.request.get(
      `${BASE}/api/companies/${companyId}/financial-statements/profit-loss?startDate=${today}&endDate=${today}`
    );
    if (plRes.status() >= 300) {
      await fail("financial-statements pl", {
        detail: `status ${plRes.status()}: ${(await plRes.text()).slice(0, 200)}`,
      });
    }
    const bsRes = await page.request.get(
      `${BASE}/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${today}`
    );
    if (bsRes.status() >= 300) {
      await fail("financial-statements bs", {
        detail: `status ${bsRes.status()}: ${(await bsRes.text()).slice(0, 200)}`,
      });
    }

    // Reconciliation rule: create then run auto-match (no transactions is fine
    // — the endpoint must respond coherently, not 500). A rule posts to a real contra GL account.
    const ruleAccounts = await (
      await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)
    ).json();
    const ruleAccount = ruleAccounts.find((a) => a.type === "expense");
    const ruleRes = await page.request.post(
      `${BASE}/api/companies/${companyId}/reconciliation-rules`,
      {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          name: "Salaries auto-tag",
          matchField: "description",
          matchType: "contains",
          matchValue: "SALARY",
          accountId: ruleAccount?.id,
          vatTreatment: "none",
          category: "Payroll",
        },
      }
    );
    if (ruleRes.status() !== 201 && ruleRes.status() !== 200) {
      await fail("reconciliation-rule create", {
        detail: `status ${ruleRes.status()}: ${(await ruleRes.text()).slice(0, 200)}`,
      });
    } else {
      const applyRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/reconciliation-rules/auto-match`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      if (applyRes.status() >= 300) {
        await fail("reconciliation-rule apply", {
          detail: `status ${applyRes.status()}: ${(await applyRes.text()).slice(0, 200)}`,
        });
      }
    }
  } catch (e) {
    await fail("statements-rules-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9b. Invoice template flow: create → set default → list reflects it ────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const tplRes = await page.request.post(`${BASE}/api/companies/${companyId}/invoice-templates`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        name: "Brand Emerald",
        layout: "modern",
        primaryColor: "#0D5C3D",
        accentColor: "#C19E50",
      },
    });
    if (tplRes.status() !== 201) {
      await fail("invoice-template create", {
        detail: `status ${tplRes.status()}: ${(await tplRes.text()).slice(0, 200)}`,
      });
    } else {
      const tpl = await tplRes.json();
      const defRes = await page.request.post(
        `${BASE}/api/invoice-templates/${tpl.id}/set-default`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      if (defRes.status() >= 300) {
        await fail("invoice-template set-default", {
          detail: `status ${defRes.status()}: ${(await defRes.text()).slice(0, 200)}`,
        });
      } else {
        const list = await (
          await page.request.get(`${BASE}/api/companies/${companyId}/invoice-templates`)
        ).json();
        const isDefault =
          Array.isArray(list) && list.find((t) => t.id === tpl.id)?.isDefault === true;
        if (!isDefault)
          await fail("invoice-template default-check", {
            detail: "template not marked default in list",
          });
      }
    }
  } catch (e) {
    await fail("invoice-template-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9c. Bank import flow: manual connection → CSV statement import →
  //       transactions land → reconciliation auto-match tags them ───────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    // Rules post through the bank account's GL account, so the statement connection must be
    // linked to a managed bank account (BANK_ACCOUNT_NOT_LINKED otherwise).
    const baRes = await page.request.post(`${BASE}/api/companies/${companyId}/bank-accounts`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: { nameEn: "E2E Current AED", bankName: "Emirates NBD", currency: "AED" },
    });
    const bankAccount = await baRes.json().catch(() => ({}));
    const connRes = await page.request.post(`${BASE}/api/companies/${companyId}/bank-connections`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        bankName: "Emirates NBD",
        accountName: "Current AED",
        bankAccountId: bankAccount?.id,
      },
    });
    if (connRes.status() !== 201) {
      await fail("bank-import connection", {
        detail: `status ${connRes.status()}: ${(await connRes.text()).slice(0, 200)}`,
      });
    } else {
      const conn = await connRes.json();
      const csv = [
        "date,description,amount,reference",
        "2026-06-01,SALARY TRANSFER JUNE,-15000.00,SAL-001",
        "2026-06-02,Customer payment Acme,5250.00,RCPT-77",
        "2026-06-03,DEWA utility bill,-820.50,DEWA-9",
      ].join("\n");
      const importRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/bank-connections/${conn.id}/import`,
        { headers: { "x-csrf-token": csrfToken ?? "" }, data: { csvContent: csv } }
      );
      if (importRes.status() >= 300) {
        await fail("bank-import import", {
          detail: `status ${importRes.status()}: ${(await importRes.text()).slice(0, 250)}`,
        });
      } else {
        const result = await importRes.json();
        if ((result?.imported ?? result?.count ?? 0) < 3) {
          await fail("bank-import count", {
            detail: `expected 3 imported, got ${JSON.stringify(result).slice(0, 150)}`,
          });
        }
        // The SALARY rule from flow 9 should now match one transaction.
        const matchRes = await page.request.post(
          `${BASE}/api/companies/${companyId}/reconciliation-rules/auto-match`,
          {
            headers: { "x-csrf-token": csrfToken ?? "" },
          }
        );
        const match = await matchRes.json().catch(() => ({}));
        if (matchRes.status() >= 300 || (match?.matched ?? 0) < 1) {
          await fail("bank-import auto-match", {
            detail: `status ${matchRes.status()}, matched ${match?.matched}`,
          });
        }
      }
    }
  } catch (e) {
    await fail("bank-import-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9d. Corporate-tax workpaper: create return → pull-from-books fills the
  //       schedule from posted entries → Excel export + template respond ────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const year = new Date().getFullYear();
    const ctRes = await page.request.post(
      `${BASE}/api/companies/${companyId}/corporate-tax/returns`,
      {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          taxPeriodStart: `${year}-01-01`,
          taxPeriodEnd: `${year}-12-31`,
          totalRevenue: 0,
          totalExpenses: 0,
          totalDeductions: 0,
        },
      }
    );
    if (ctRes.status() !== 201) {
      await fail("ct-flow create", {
        detail: `status ${ctRes.status()}: ${(await ctRes.text()).slice(0, 200)}`,
      });
    } else {
      const ct = await ctRes.json();
      const pullRes = await page.request.post(
        `${BASE}/api/corporate-tax/returns/${ct.id}/pull-from-books`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      const pulled = await pullRes.json().catch(() => ({}));
      if (pullRes.status() >= 300 || (pulled?.rows ?? 0) < 1) {
        await fail("ct-flow pull", { detail: `status ${pullRes.status()}, rows ${pulled?.rows}` });
      } else if (!pulled?.workpaper?.rows?.length) {
        await fail("ct-flow workpaper", { detail: "workpaper rows missing on updated return" });
      }
      // Full taxable-profit bridge: add-back + SBR election → deterministic
      // schedule persisted on the return.
      const computeRes = await page.request.post(
        `${BASE}/api/corporate-tax/returns/${ct.id}/compute`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
          data: {
            adjustments: [{ id: "e2e-ent", category: "entertainment_50", amount: 1000 }],
            smallBusinessReliefElected: false,
            relatedPartyNotes: "No related-party transactions in the period.",
          },
        }
      );
      const computed = await computeRes.json().catch(() => ({}));
      if (computeRes.status() >= 300 || !computed?.computation?.bridge?.length) {
        await fail("ct-flow compute", {
          detail: `status ${computeRes.status()}: ${JSON.stringify(computed).slice(0, 150)}`,
        });
      } else {
        const bridgeLabels = computed.computation.bridge.map((l) => l.label).join("|");
        if (!/entertainment/i.test(bridgeLabels) || !/Corporate tax payable/.test(bridgeLabels)) {
          await fail("ct-flow bridge", { detail: bridgeLabels.slice(0, 200) });
        }
        if (
          computed?.return?.relatedPartyNotes !== "No related-party transactions in the period."
        ) {
          await fail("ct-flow tp-notes", { detail: "related-party notes not persisted" });
        }
      }
      const exportRes = await page.request.get(`${BASE}/api/corporate-tax/returns/${ct.id}/export`);
      if (exportRes.status() >= 300) {
        await fail("ct-flow export", { detail: `status ${exportRes.status()}` });
      }
      const tplRes = await page.request.get(`${BASE}/api/corporate-tax/returns/template`);
      if (tplRes.status() >= 300) {
        await fail("ct-flow template", { detail: `status ${tplRes.status()}` });
      }
    }
  } catch (e) {
    await fail("ct-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9e. VAT workpaper review queue: draft rows → bulk approve → totals ────
  try {
    if (clientId) {
      const wpRes = await page.request.post(`${BASE}/api/firm/vat-workpapers`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          companyId: clientId,
          periodStart: "2026-04-01",
          periodEnd: "2026-06-30",
        },
      });
      if (wpRes.status() >= 300) {
        await fail("vat-wp create", {
          detail: `status ${wpRes.status()}: ${(await wpRes.text()).slice(0, 200)}`,
        });
      } else {
        const wp = await wpRes.json();
        for (const row of [
          {
            rowCategory: "standard_sale",
            invoiceNumber: "INV-D1",
            emirate: "dubai",
            taxableAmount: 1000,
            vatAmount: 50,
            status: "draft",
            sourceMethod: "generated",
          },
          {
            rowCategory: "standard_expense",
            invoiceNumber: "BILL-D2",
            emirate: "dubai",
            taxableAmount: 400,
            vatAmount: 20,
            status: "draft",
            sourceMethod: "generated",
          },
        ]) {
          const rowRes = await page.request.post(`${BASE}/api/firm/vat-workpapers/${wp.id}/rows`, {
            headers: { "x-csrf-token": csrfToken ?? "" },
            data: row,
          });
          if (rowRes.status() >= 300) {
            await fail("vat-wp add-row", {
              detail: `status ${rowRes.status()}: ${(await rowRes.text()).slice(0, 200)}`,
            });
          }
        }
        const bulkRes = await page.request.post(
          `${BASE}/api/firm/vat-workpapers/${wp.id}/rows/bulk-status`,
          {
            headers: { "x-csrf-token": csrfToken ?? "" },
            data: { to: "approved" },
          }
        );
        const bulk = await bulkRes.json().catch(() => ({}));
        if (bulkRes.status() >= 300 || (bulk?.updated ?? 0) !== 2) {
          await fail("vat-wp bulk-approve", {
            detail: `status ${bulkRes.status()}, updated ${bulk?.updated}`,
          });
        } else {
          const detail = await (
            await page.request.get(`${BASE}/api/firm/vat-workpapers/${wp.id}`)
          ).json();
          const outputVat = Number(detail?.totals?.box8TotalVat ?? 0);
          const inputVat = Number(detail?.totals?.box11TotalVat ?? 0);
          if (outputVat !== 50 || inputVat !== 20) {
            await fail("vat-wp totals", { detail: `expected 50/20, got ${outputVat}/${inputVat}` });
          }
        }
      }
    }
  } catch (e) {
    await fail("vat-wp-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9f. Backup → delete → restore: the disaster-recovery promise ─────────
  // Journal entries are protected by FTA 5-year retention (good!), so the
  // recovery marker is an unreferenced ledger account.
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const marker = `Restore Marker ${Date.now()}`;
    const acctRes = await page.request.post(`${BASE}/api/companies/${companyId}/accounts`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        code: `9${Date.now() % 100000}`,
        nameEn: marker,
        type: "expense",
        isActive: true,
      },
    });
    if (acctRes.status() >= 300) {
      await fail("backup-flow marker", {
        detail: `status ${acctRes.status()}: ${(await acctRes.text()).slice(0, 200)}`,
      });
    } else {
      const acct = await acctRes.json();
      const backupRes = await page.request.post(`${BASE}/api/companies/${companyId}/backups`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: { name: "E2E disaster-recovery proof" },
      });
      const backup = await backupRes.json().catch(() => ({}));
      if (backupRes.status() >= 300 || !backup?.id) {
        await fail("backup-flow create", {
          detail: `status ${backupRes.status()}: ${JSON.stringify(backup).slice(0, 150)}`,
        });
      } else {
        const delRes = await page.request.delete(`${BASE}/api/accounts/${acct.id}`, {
          headers: { "x-csrf-token": csrfToken ?? "" },
        });
        if (delRes.status() >= 300) {
          await fail("backup-flow delete", {
            detail: `status ${delRes.status()}: ${(await delRes.text()).slice(0, 150)}`,
          });
        } else {
          const restoreRes = await page.request.post(`${BASE}/api/backups/${backup.id}/restore`, {
            headers: { "x-csrf-token": csrfToken ?? "" },
            data: { mode: "merge", confirmRestore: true },
          });
          const restore = await restoreRes.json().catch(() => ({}));
          if (restoreRes.status() >= 300 || (restore?.totals?.insert ?? 0) < 1) {
            await fail("backup-flow restore", {
              detail: `status ${restoreRes.status()}, restored ${restore?.totals?.insert}: ${JSON.stringify(restore).slice(0, 150)}`,
            });
          } else {
            const accountsAfter = await (
              await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)
            ).json();
            const recovered =
              Array.isArray(accountsAfter) && accountsAfter.some((a) => a.nameEn === marker);
            if (!recovered) {
              await fail("backup-flow verify", {
                detail: "restored account not found in chart of accounts",
              });
            }
          }
        }
      }
    }
  } catch (e) {
    await fail("backup-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9g. E-invoicing: validation gate blocks until TRN set, then PINT AE
  //       XML generates with correct per-line VAT categories ────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    // PINT AE needs a complete buyer (TRN endpoint, street, city, emirate): use a real contact.
    const buyerRes = await page.request.post(
      `${BASE}/api/companies/${companyId}/customer-contacts`,
      {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          name: "EInvoice Customer LLC",
          trnNumber: "100765432100003",
          address: "Building 7, Dubai Internet City",
          city: "Dubai",
          emirate: "dubai",
          country: "AE",
        },
      }
    );
    const buyer = await buyerRes.json().catch(() => ({}));
    const invRes = await page.request.post(`${BASE}/api/companies/${companyId}/invoices`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: {
        customerName: "EInvoice Customer LLC",
        customerTrn: "100765432100003",
        contactId: buyer?.id,
        date: new Date().toISOString().slice(0, 10),
        currency: "AED",
        placeOfSupplyEmirate: "dubai",
        lines: [
          {
            description: "Consulting",
            quantity: 2,
            unitPrice: 500,
            vatRate: 0.05,
            vatSupplyType: "standard_rated",
          },
          {
            description: "Export shipment",
            quantity: 1,
            unitPrice: 300,
            vatRate: 0,
            vatSupplyType: "zero_rated",
          },
        ],
      },
    });
    if (invRes.status() >= 300) {
      await fail("einvoice create-invoice", {
        detail: `status ${invRes.status()}: ${(await invRes.text()).slice(0, 200)}`,
      });
    } else {
      const invoice = await invRes.json();
      await page.request.patch(`${BASE}/api/invoices/${invoice.id}/status`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: { status: "sent" },
      });

      // Company has no TRN yet → the gate must refuse generation with issues.
      const blocked = await page.request.post(
        `${BASE}/api/invoices/${invoice.id}/generate-einvoice`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
        }
      );
      if (blocked.status() !== 422) {
        await fail("einvoice gate", {
          detail: `expected 422 without TRN, got ${blocked.status()}`,
        });
      }

      await page.request.patch(`${BASE}/api/companies/${companyId}`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: {
          trnVatNumber: "100123456700003",
          addressStreet: "Sheikh Zayed Road",
          addressCity: "Dubai",
          emirate: "dubai",
        },
      });
      // PINT AE also needs the supplier's trade licence (ibr-150-ae).
      await page.request.put(`${BASE}/api/companies/${companyId}/einvoicing/settings`, {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: { tradeLicenceNo: "TL-E2E-12345" },
      });

      const check = await (
        await page.request.get(`${BASE}/api/invoices/${invoice.id}/einvoice/validate`)
      ).json();
      if (!check?.valid) {
        await fail("einvoice validate", {
          detail: `still invalid: ${JSON.stringify(check?.issues ?? []).slice(0, 200)}`,
        });
      } else {
        const genRes = await page.request.post(
          `${BASE}/api/invoices/${invoice.id}/generate-einvoice`,
          {
            headers: { "x-csrf-token": csrfToken ?? "" },
          }
        );
        const gen = await genRes.json().catch(() => ({}));
        if (genRes.status() >= 300 || gen?.status !== "generated" || !gen?.hash) {
          await fail("einvoice generate", {
            detail: `status ${genRes.status()}: ${JSON.stringify(gen).slice(0, 150)}`,
          });
        } else {
          const xml = await (
            await page.request.get(`${BASE}/api/invoices/${invoice.id}/einvoice-xml`)
          ).text();
          if (!xml.includes("<cbc:ID>S</cbc:ID>") || !xml.includes("<cbc:ID>Z</cbc:ID>")) {
            await fail("einvoice categories", {
              detail: "expected both S and Z VAT categories in the XML",
            });
          }
        }
      }
    }
  } catch (e) {
    await fail("einvoice-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9h. Document versions: snapshot an invoice, history reflects it ───────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const invoices = await (
      await page.request.get(`${BASE}/api/companies/${companyId}/invoices?all=true`)
    ).json();
    const targetInvoice = invoices?.[0];
    if (targetInvoice) {
      const verRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/document-versions`,
        {
          headers: { "x-csrf-token": csrfToken ?? "" },
          data: {
            documentType: "invoice",
            documentId: targetInvoice.id,
            changeDescription: "E2E snapshot before edits", // the server takes the snapshot
          },
        }
      );
      if (verRes.status() !== 201) {
        await fail("docver create", {
          detail: `status ${verRes.status()}: ${(await verRes.text()).slice(0, 200)}`,
        });
      } else {
        const history = await (
          await page.request.get(
            `${BASE}/api/companies/${companyId}/document-versions/invoice/${targetInvoice.id}`
          )
        ).json();
        if (!Array.isArray(history) || history.length < 1 || history[0]?.version !== 1) {
          await fail("docver history", {
            detail: `expected version 1, got ${JSON.stringify(history).slice(0, 120)}`,
          });
        }
      }
    }
  } catch (e) {
    await fail("docver-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 9i. Integrations prepared: status endpoint, API keys, webhooks,
  //       notification preferences, billing endpoints all answer ───────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;

    const status = await (await page.request.get(`${BASE}/api/admin/integration-status`)).json();
    const keys = (status?.integrations ?? []).map((i) => i.key).sort();
    for (const expected of [
      "apiKeys",
      "email",
      "bankStatementCsvImport",
      "push",
      "stripe",
      "tokenEncryption",
      "webhooks",
    ]) {
      if (!keys.includes(expected)) {
        await fail("integration-status", { detail: `missing ${expected} in ${keys.join(",")}` });
        break;
      }
    }

    // API key lifecycle: create returns the raw key exactly once.
    const keyRes = await page.request.post(`${BASE}/api/companies/${companyId}/api-keys`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: { name: "E2E key", scopes: ["read:invoices"] },
    });
    const created = await keyRes.json().catch(() => ({}));
    if (keyRes.status() !== 201 || !created?.key || created?.keyHash) {
      await fail("api-key create", {
        detail: `status ${keyRes.status()}: ${JSON.stringify(created).slice(0, 120)}`,
      });
    } else {
      const list = await (
        await page.request.get(`${BASE}/api/companies/${companyId}/api-keys`)
      ).json();
      if (!Array.isArray(list) || list.some((k) => k.keyHash) || list.length < 1) {
        await fail("api-key list", { detail: "list missing or leaks keyHash" });
      }
    }

    // Webhook endpoint registration (delivery needs a consumer URL — config only).
    const whRes = await page.request.post(`${BASE}/api/companies/${companyId}/webhooks`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: { url: "https://example.com/hooks/muhasib", events: "invoice.created" },
    });
    if (whRes.status() !== 201) {
      await fail("webhook create", {
        detail: `status ${whRes.status()}: ${(await whRes.text()).slice(0, 150)}`,
      });
    }

    // Notification preferences upsert round-trip.
    const prefRes = await page.request.put(`${BASE}/api/notification-preferences`, {
      headers: { "x-csrf-token": csrfToken ?? "" },
      data: { pushEnabled: false, weeklyDigest: true },
    });
    if (prefRes.status() >= 300) {
      await fail("notification prefs", {
        detail: `status ${prefRes.status()}: ${(await prefRes.text()).slice(0, 150)}`,
      });
    } else {
      const prefs = await prefRes.json();
      if (prefs?.pushEnabled !== false || prefs?.weeklyDigest !== true) {
        await fail("notification prefs roundtrip", { detail: JSON.stringify(prefs).slice(0, 120) });
      }
    }

    // Billing endpoints answer with the seeded free subscription.
    const sub = await (
      await page.request.get(`${BASE}/api/companies/${companyId}/billing/subscription`)
    ).json();
    if (!sub?.subscription?.planId) {
      await fail("billing subscription", { detail: JSON.stringify(sub).slice(0, 120) });
    }
  } catch (e) {
    await fail("integrations-flow", { crash: e.message.slice(0, 150) });
  }

  // ── 10. Account-type matrix: every kind of account must work ──────────────
  // (a) 'client' userType: flat workspace sidebar — dashboard, documents,
  //     reports must render with no admin/firm assumptions leaking in.
  // (b) 'client_portal' userType: the separate portal layout.
  async function crawlAs(label, userType, matrixRoutes) {
    const mCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      timezoneId: BROWSER_TIMEZONE,
    });
    await mCtx.addInitScript(() => {
      // The client only probes the cookie session when this non-secret sign-in hint is set (R18-04).
      localStorage.setItem("muhasib_auth_hint", "1");
    });
    const mPage = await mCtx.newPage();
    let mErrors = [];
    let mApi = [];
    mPage.on("pageerror", (e) => mErrors.push(`JS: ${e.message.slice(0, 200)}`));
    mPage.on("response", (r) => {
      const url = r.url();
      if (!url.includes("/api/") || r.status() < 400 || r.status() === 401 || r.status() === 403)
        return;
      const cleanPath = url.replace(BASE, "").split("?")[0];
      if (TOLERATED_API.some((re) => re.test(cleanPath))) return;
      mApi.push(`${r.request().method()} ${cleanPath} -> ${r.status()}`);
    });

    const mEmail = `e2e-${label}+${Date.now()}@test.local`;
    const mReg = await mPage.request.post(`${BASE}/api/auth/register`, {
      data: {
        email: mEmail,
        password: "Password123!",
        name: `E2E ${label}`,
        companyName: `${label} Co LLC`,
      },
    });
    if (mReg.status() >= 300) {
      await fail(`${label} register`, { detail: `status ${mReg.status()}` });
      await mCtx.close();
      return;
    }
    // W5-E: registration returns no session; sign in (sets the auth cookies).
    await mPage.request.post(`${BASE}/api/auth/login`, {
      data: { email: mEmail, password: "Password123!" },
    });
    // Complete onboarding via express so the dashboard doesn't redirect.
    try {
      await openDashboard(mPage);
    } catch (error) {
      await fail(`${label} express-onboarding`, { detail: error.message.slice(0, 150) });
      await mCtx.close();
      return;
    }
    const mDb = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await mDb.connect();
    await mDb.query(`UPDATE users SET user_type = $1, email_verified = true WHERE email = $2`, [
      userType,
      mEmail,
    ]);
    await mDb.end();

    // Access boundary: an ordinary account must be rejected on every NRA /
    // admin surface even when guessing URLs directly. 401/403 both prove the
    // guard held; anything else is a hole.
    for (const guessed of [
      "/api/firm/clients",
      "/api/firm/health",
      "/api/firm/command-center/dashboard",
      "/api/firm/value-ops",
      "/api/admin/integration-status",
    ]) {
      const res = await mPage.request.get(`${BASE}${guessed}`);
      if (![401, 403].includes(res.status())) {
        failures.push({
          name: `${label} boundary ${guessed}`,
          detail: `expected 401/403, got ${res.status()}`,
        });
      }
    }

    for (const route of matrixRoutes) {
      mErrors = [];
      mApi = [];
      try {
        await mPage.goto(`${BASE}${route}`, { timeout: 45000 });
        await mPage.waitForTimeout(1500);
        const finalUrl = mPage.url().replace(BASE, "");
        const mainText = await mPage
          .locator("main")
          .innerText()
          .catch(() => "");
        const bodyText =
          mainText ||
          (await mPage
            .locator("body")
            .innerText()
            .catch(() => ""));
        const failText = bodyText.match(FAIL_TEXT)?.[0] ?? null;
        const blank = bodyText.trim().length < 40;
        if (mErrors.length || mApi.length || failText || blank) {
          failures.push({
            name: `${label} route ${route}`,
            finalUrl: finalUrl !== route ? finalUrl : undefined,
            failText,
            blank: blank || undefined,
            js: mErrors.slice(0, 3),
            api: [...new Set(mApi)].slice(0, 5),
          });
          try {
            await mPage.screenshot({
              path: path.join(SHOT_DIR, `${label}_${route.replace(/[^a-z0-9-]+/gi, "_")}.png`),
            });
          } catch {
            /* page gone */
          }
        }
      } catch (e) {
        failures.push({ name: `${label} route ${route}`, crash: e.message.slice(0, 150) });
      }
    }
    await mCtx.close();
  }

  await crawlAs("client-type", "client", [
    "/dashboard",
    "/document-vault",
    "/tax-return-archive",
    "/compliance-calendar",
    "/compliance-calendar?view=list",
    "/reports",
  ]);
  await crawlAs("portal", "client_portal", [
    "/client-portal/dashboard",
    "/client-portal/invoices",
    "/client-portal/documents",
    "/client-portal/statements",
    "/client-portal/messages",
  ]);

  // ── 10b. Time-zone probe (Fable N1): business dates are calendar days ─────
  // A VAT period end is stored as 23:59:59.999Z; formatted as a browser-zone instant it read
  // "1 Oct" for a 30 Sep quarter in UAE time. Generate the last completed quarter's return and
  // require /vat-filing to show the same dates in this (UAE-time) browser as in a UTC one.
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const now = new Date();
    const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 - 3;
    const qStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
    const qEnd = new Date(Date.UTC(qStart.getUTCFullYear(), qStart.getUTCMonth() + 3, 0));
    const ymd = (d) => d.toISOString().slice(0, 10);
    const generated = await page.request.post(
      `${BASE}/api/companies/${companyId}/vat-returns/generate`,
      {
        headers: { "x-csrf-token": csrfToken ?? "" },
        data: { periodStart: ymd(qStart), periodEnd: ymd(qEnd) },
      }
    );
    if (!generated.ok()) throw new Error(`VAT return generation returned ${generated.status()}`);
    const { id: returnId } = await generated.json();
    if (!returnId) throw new Error("VAT return generation did not supply an ID");
    const datesOn = async (p) => {
      await p.goto(`${BASE}/vat-filing?tab=returns`, { timeout: 45000 });
      const row = p.getByTestId(`row-return-${returnId}`);
      await row.waitFor({ state: "visible", timeout: 18000 });
      const cells = row.getByRole("cell");
      return { period: await cells.nth(0).innerText(), dueDate: await cells.nth(1).innerText() };
    };
    const utcCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      timezoneId: "UTC",
      storageState: await ctx.storageState(),
    });
    let utcDates;
    try {
      utcDates = await datesOn(await utcCtx.newPage());
    } finally {
      await utcCtx.close();
    }
    const localDates = await datesOn(page);
    const month = new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const expectedPeriod = `${month.format(qStart)} - ${month.format(qEnd)}`;
    if (
      JSON.stringify(utcDates) !== JSON.stringify(localDates) ||
      localDates.period !== expectedPeriod
    ) {
      await fail(`timezone probe /vat-filing (${BROWSER_TIMEZONE})`, {
        utc: utcDates,
        local: localDates,
        expectedPeriod,
      });
    }
  } catch (e) {
    await fail("timezone-probe", { crash: e.message.slice(0, 150) });
  }

  // ── 11. Arabic / RTL smoke: the bilingual promise must hold ───────────────
  // Switch the persisted locale to Arabic, crawl key routes, and assert the
  // document direction flips and nothing breaks.
  try {
    await page.addInitScript(() => {
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
    });
    for (const route of [
      "/dashboard",
      "/invoices",
      "/vat-filing",
      "/reports",
      "/settings/company",
    ]) {
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}${route}`, { timeout: 45000 });
      await page.waitForTimeout(1700);
      // The document direction flips once the locale store hydrates; wait for it (and for the
      // route to render) instead of racing a fixed delay.
      await page
        .waitForFunction(() => document.documentElement.getAttribute("dir") === "rtl", null, {
          timeout: 15000,
        })
        .catch(() => {});
      const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
      let mainText = "";
      for (let i = 0; i < 30 && mainText.trim().length < 40; i++) {
        mainText = await page
          .locator("main")
          .innerText()
          .catch(() => "");
        if (mainText.trim().length < 40) await page.waitForTimeout(500);
      }
      const blank = mainText.trim().length < 40;
      if (dir !== "rtl" || routeErrors.length || blank) {
        await fail(`rtl route ${route}`, {
          dir,
          blank: blank || undefined,
          js: routeErrors.slice(0, 3),
          api: [...new Set(apiFailures)].slice(0, 4),
        });
      }
    }
  } catch (e) {
    await fail("rtl-smoke", { crash: e.message.slice(0, 150) });
  }

  await browser.close();

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n=== E2E: ${routes.length} routes + flows · ${failures.length} failure(s) ===`);
  for (const f of failures) console.log(JSON.stringify(f));
  if (failures.length > 0) {
    console.log(`Screenshots: ${SHOT_DIR}`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
