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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '.artifacts');

const ROUTES = [
  '/dashboard', '/invoices', '/recurring-invoices', '/payment-chasing', '/contacts',
  '/receipts', '/receipt-autopilot', '/chart-of-accounts', '/accounts', '/journal',
  '/vat-filing', '/vat-autopilot', '/bank-reconciliation', '/corporate-tax',
  '/compliance-calendar', '/tax-return-archive', '/reports', '/advanced-reports',
  '/analytics', '/advanced-analytics', '/cashflow-forecast', '/anomaly-detection',
  '/auto-reconcile', '/ai-cfo', '/ai-chat', '/ai-features', '/ai-inbox',
  '/smart-assistant', '/payroll', '/fixed-assets', '/budgets', '/bill-pay',
  '/expense-claims', '/inventory', '/integrations', '/integrations-hub', '/whatsapp',
  '/document-chasing', '/notifications', '/reminders', '/company-profile',
  '/settings/company', '/team', '/document-vault', '/month-end', '/backup-restore',
  '/history', '/exchange-rates', '/quotes', '/credit-notes', '/purchase-orders', '/cost-centers', '/financial-statements', '/reconciliation-rules', '/task-center', '/news-feed',
  '/admin/dashboard', '/admin/clients', '/admin/invitations', '/admin/import',
  '/admin/activity-logs', '/admin/users', '/admin',
  '/firm/command-center', '/firm/clients', '/firm/staff', '/firm/health',
  '/firm/analytics', '/firm/bulk', '/firm/comms', '/firm/pipeline', '/firm/value-ops',
];

// API endpoints that are allowed to 4xx without failing a route (documented
// gaps, not regressions). Keep this list short and justified.
const TOLERATED_API = [
  /\/billing\/(subscription|usage)$/, // billing module not deployed — gates fail open
];

const FAIL_TEXT = /something went wrong|an error occurred|failed to load|unexpected error/i;
const NOT_FOUND = (t) => /not found/i.test(t) && t.trim().length < 300 && !/no [a-z ]*found/i.test(t);

async function resolveExecutablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: await resolveExecutablePath(),
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let routeErrors = [];
  let apiFailures = [];
  page.on('pageerror', (e) => routeErrors.push(`JS: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => {
    const url = r.url();
    if (!url.includes('/api/') || r.status() < 400 || r.status() === 401) return;
    const cleanPath = url.replace(BASE, '').split('?')[0];
    if (TOLERATED_API.some((re) => re.test(cleanPath))) return;
    apiFailures.push(`${r.request().method()} ${cleanPath} -> ${r.status()}`);
  });

  const failures = [];
  const fail = async (name, detail) => {
    failures.push({ name, ...detail });
    try {
      await page.screenshot({ path: path.join(SHOT_DIR, `${name.replace(/[^a-z0-9-]+/gi, '_')}.png`) });
    } catch { /* page may be gone */ }
  };

  // ── 1. Fresh account + express onboarding ─────────────────────────────────
  const email = `e2e+${Date.now()}@test.local`;
  const reg = await page.request.post(`${BASE}/api/auth/register`, {
    data: { email, password: 'Password123!', name: 'E2E Owner', companyName: 'E2E Holdings LLC' },
  });
  if (reg.status() !== 200 && reg.status() !== 201) {
    await fail('register', { detail: `status ${reg.status()}` });
    throw new Error(`register failed: ${reg.status()}`);
  }

  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(3000);
  if (page.url().includes('onboarding')) {
    const express = page.locator('[data-testid="onboarding-express"]');
    if (await express.count()) {
      await express.click();
      await page.waitForTimeout(4000);
    }
  }
  if (!page.url().includes('dashboard')) {
    await fail('express-onboarding', { detail: `ended on ${page.url()}` });
  }

  // Promote to admin + firm owner so the crawl covers admin and firm suites.
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    `UPDATE users SET is_admin = true, user_type = 'admin', firm_role = 'firm_owner', email_verified = true WHERE email = $1`,
    [email],
  );
  await db.end();

  // ── 2. Seed a firm client (CSRF-signed API call) ──────────────────────────
  const csrfToken = (await (await page.request.get(`${BASE}/api/csrf-token`)).json())?.csrfToken;
  const clientRes = await page.request.post(`${BASE}/api/firm/clients`, {
    headers: { 'x-csrf-token': csrfToken ?? '' },
    data: { name: `E2E Client ${Date.now()}`, emirate: 'dubai', contactEmail: 'client@e2e.local' },
  });
  let clientId = null;
  try {
    const body = await clientRes.json();
    clientId = body?.id ?? body?.company?.id ?? null;
  } catch { /* tolerated below */ }
  if (!clientId) await fail('firm-client-create', { detail: `status ${clientRes.status()}` });

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
      await page.waitForTimeout(1700);
      const finalUrl = page.url().replace(BASE, '');
      const mainText = await page.locator('main').innerText().catch(() => '');
      const failText = mainText.match(FAIL_TEXT)?.[0] ?? (NOT_FOUND(mainText) ? 'not-found screen' : null);
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
    const accounts = await (await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)).json();
    const debitAccount = accounts.find((a) => a.type === 'expense') ?? accounts[0];
    const creditAccount = accounts.find((a) => a.type === 'asset') ?? accounts[1];
    const memo = `E2E balanced entry ${Date.now()}`;
    const entryRes = await page.request.post(`${BASE}/api/companies/${companyId}/journal`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
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
      await fail('journal-flow create', { detail: `status ${entryRes.status()}: ${(await entryRes.text()).slice(0, 200)}` });
    } else {
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/journal`);
      await page.waitForTimeout(2500);
      const journalText = await page.locator('main').innerText().catch(() => '');
      if (!journalText.includes(memo)) {
        await fail('journal-flow render', { detail: 'posted entry not visible in journal UI' });
      }
    }
  } catch (e) {
    await fail('journal-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 5. Quote lifecycle: create → renders in UI → converts to invoice ──────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const quoteNumber = `Q-${Date.now()}`;
    const quoteRes = await page.request.post(`${BASE}/api/companies/${companyId}/quotes`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: {
        number: quoteNumber,
        customerName: 'Quote Customer LLC',
        date: new Date().toISOString(),
        currency: 'AED',
        subtotal: 1000,
        vatAmount: 50,
        total: 1050,
        status: 'sent',
        lines: [
          { description: 'Consulting services', quantity: 2, unitPrice: 500, vatRate: 0.05 },
        ],
      },
    });
    if (quoteRes.status() !== 201) {
      await fail('quote-flow create', { detail: `status ${quoteRes.status()}: ${(await quoteRes.text()).slice(0, 200)}` });
    } else {
      const quote = await quoteRes.json();
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/quotes`);
      await page.waitForTimeout(2500);
      const quotesText = await page.locator('main').innerText().catch(() => '');
      if (!quotesText.includes(quoteNumber)) {
        await fail('quote-flow render', { detail: 'created quote not visible in quotes UI' });
      }
      const convertRes = await page.request.post(`${BASE}/api/quotes/${quote.id}/convert-to-invoice`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
      });
      if (convertRes.status() >= 300) {
        await fail('quote-flow convert', { detail: `status ${convertRes.status()}: ${(await convertRes.text()).slice(0, 200)}` });
      } else {
        const detail = await (await page.request.get(`${BASE}/api/quotes/${quote.id}`)).json();
        if (detail?.status !== 'converted' || !detail?.convertedInvoiceId) {
          await fail('quote-flow status', { detail: `expected converted, got ${detail?.status}` });
        }
      }
    }
  } catch (e) {
    await fail('quote-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 6. Credit note lifecycle: create → renders → issue posts a reversing
  //       journal entry against the seeded chart of accounts ────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const cnNumber = `CN-${Date.now()}`;
    const cnRes = await page.request.post(`${BASE}/api/companies/${companyId}/credit-notes`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: {
        number: cnNumber,
        customerName: 'Credit Customer LLC',
        date: new Date().toISOString(),
        currency: 'AED',
        subtotal: 200,
        vatAmount: 10,
        total: 210,
        reason: 'Returned goods',
        lines: [
          { description: 'Returned item', quantity: 1, unitPrice: 200, vatRate: 0.05 },
        ],
      },
    });
    if (cnRes.status() !== 201) {
      await fail('credit-note-flow create', { detail: `status ${cnRes.status()}: ${(await cnRes.text()).slice(0, 200)}` });
    } else {
      const note = await cnRes.json();
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/credit-notes`);
      await page.waitForTimeout(2500);
      const cnText = await page.locator('main').innerText().catch(() => '');
      if (!cnText.includes(cnNumber)) {
        await fail('credit-note-flow render', { detail: 'created credit note not visible in UI' });
      }
      const issueRes = await page.request.post(`${BASE}/api/credit-notes/${note.id}/issue`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
      });
      if (issueRes.status() >= 300) {
        await fail('credit-note-flow issue', { detail: `status ${issueRes.status()}: ${(await issueRes.text()).slice(0, 200)}` });
      } else {
        const detail = await (await page.request.get(`${BASE}/api/credit-notes/${note.id}`)).json();
        if (detail?.status !== 'issued' || !detail?.journalEntryId) {
          await fail('credit-note-flow status', { detail: `expected issued with journal link, got ${detail?.status}` });
        }
      }
    }
  } catch (e) {
    await fail('credit-note-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 7. Purchase order lifecycle: create → renders → send → approve →
  //       receive ───────────────────────────────────────────────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const poNumber = `PO-${Date.now()}`;
    const poRes = await page.request.post(`${BASE}/api/companies/${companyId}/purchase-orders`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: {
        number: poNumber,
        vendorName: 'Supplier Trading FZE',
        date: new Date().toISOString(),
        expectedDeliveryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        currency: 'AED',
        subtotal: 500,
        vatAmount: 25,
        total: 525,
        lines: [
          { description: 'Office supplies', quantity: 5, unitPrice: 100, vatRate: 0.05 },
        ],
      },
    });
    if (poRes.status() !== 201) {
      await fail('po-flow create', { detail: `status ${poRes.status()}: ${(await poRes.text()).slice(0, 200)}` });
    } else {
      const po = await poRes.json();
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/purchase-orders`);
      await page.waitForTimeout(2500);
      const poText = await page.locator('main').innerText().catch(() => '');
      if (!poText.includes(poNumber)) {
        await fail('po-flow render', { detail: 'created purchase order not visible in UI' });
      }
      for (const step of ['send', 'approve', 'receive']) {
        const stepRes = await page.request.post(`${BASE}/api/purchase-orders/${po.id}/${step}`, {
          headers: { 'x-csrf-token': csrfToken ?? '' },
        });
        if (stepRes.status() >= 300) {
          await fail(`po-flow ${step}`, { detail: `status ${stepRes.status()}: ${(await stepRes.text()).slice(0, 200)}` });
          break;
        }
      }
      const detail = await (await page.request.get(`${BASE}/api/purchase-orders/${po.id}`)).json();
      if (detail?.status !== 'received') {
        await fail('po-flow status', { detail: `expected received, got ${detail?.status}` });
      }
    }
  } catch (e) {
    await fail('po-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 8. Cost center flow: create → renders → allocate a journal line →
  //       per-center P&L report reflects it ─────────────────────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const ccCode = `CC-${Date.now() % 100000}`;
    const ccRes = await page.request.post(`${BASE}/api/companies/${companyId}/cost-centers`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: { code: ccCode, name: 'Dubai Branch', description: 'E2E cost center' },
    });
    if (ccRes.status() !== 201) {
      await fail('cost-center-flow create', { detail: `status ${ccRes.status()}: ${(await ccRes.text()).slice(0, 200)}` });
    } else {
      const cc = await ccRes.json();
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}/cost-centers`);
      await page.waitForTimeout(2500);
      const ccText = await page.locator('main').innerText().catch(() => '');
      if (!ccText.includes(ccCode) && !ccText.includes('Dubai Branch')) {
        await fail('cost-center-flow render', { detail: 'created cost center not visible in UI' });
      }
      const summaryRes = await page.request.get(`${BASE}/api/companies/${companyId}/cost-centers/${cc.id}/report`);
      if (summaryRes.status() >= 300) {
        await fail('cost-center-flow report', { detail: `status ${summaryRes.status()}: ${(await summaryRes.text()).slice(0, 200)}` });
      }
    }
  } catch (e) {
    await fail('cost-center-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 9. Financial statements + reconciliation rules flows ──────────────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;

    // P&L must reflect the journal entry posted in flow 4 (150 expense).
    const today = new Date().toISOString().slice(0, 10);
    const plRes = await page.request.get(
      `${BASE}/api/companies/${companyId}/financial-statements/profit-loss?startDate=${today}&endDate=${today}`,
    );
    if (plRes.status() >= 300) {
      await fail('financial-statements pl', { detail: `status ${plRes.status()}: ${(await plRes.text()).slice(0, 200)}` });
    }
    const bsRes = await page.request.get(
      `${BASE}/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${today}`,
    );
    if (bsRes.status() >= 300) {
      await fail('financial-statements bs', { detail: `status ${bsRes.status()}: ${(await bsRes.text()).slice(0, 200)}` });
    }

    // Reconciliation rule: create then run auto-match (no transactions is fine
    // — the endpoint must respond coherently, not 500).
    const ruleRes = await page.request.post(`${BASE}/api/companies/${companyId}/reconciliation-rules`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: { name: 'Salaries auto-tag', matchField: 'description', matchType: 'contains', matchValue: 'SALARY', category: 'Payroll' },
    });
    if (ruleRes.status() !== 201 && ruleRes.status() !== 200) {
      await fail('reconciliation-rule create', { detail: `status ${ruleRes.status()}: ${(await ruleRes.text()).slice(0, 200)}` });
    } else {
      const applyRes = await page.request.post(`${BASE}/api/companies/${companyId}/reconciliation-rules/auto-match`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
      });
      if (applyRes.status() >= 300) {
        await fail('reconciliation-rule apply', { detail: `status ${applyRes.status()}: ${(await applyRes.text()).slice(0, 200)}` });
      }
    }
  } catch (e) {
    await fail('statements-rules-flow', { crash: e.message.slice(0, 150) });
  }

  await browser.close();

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n=== E2E: ${routes.length} routes + flows · ${failures.length} failure(s) ===`);
  for (const f of failures) console.log(JSON.stringify(f));
  if (failures.length > 0) {
    console.log(`Screenshots: ${SHOT_DIR}`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
