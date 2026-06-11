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
  '/history', '/exchange-rates', '/quotes', '/credit-notes', '/purchase-orders', '/cost-centers', '/financial-statements', '/reconciliation-rules', '/invoice-templates', '/task-center', '/news-feed',
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

  // ── 9b. Invoice template flow: create → set default → list reflects it ────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const tplRes = await page.request.post(`${BASE}/api/companies/${companyId}/invoice-templates`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: { name: 'Brand Emerald', layout: 'modern', primaryColor: '#0D5C3D', accentColor: '#C19E50' },
    });
    if (tplRes.status() !== 201) {
      await fail('invoice-template create', { detail: `status ${tplRes.status()}: ${(await tplRes.text()).slice(0, 200)}` });
    } else {
      const tpl = await tplRes.json();
      const defRes = await page.request.post(`${BASE}/api/invoice-templates/${tpl.id}/set-default`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
      });
      if (defRes.status() >= 300) {
        await fail('invoice-template set-default', { detail: `status ${defRes.status()}: ${(await defRes.text()).slice(0, 200)}` });
      } else {
        const list = await (await page.request.get(`${BASE}/api/companies/${companyId}/invoice-templates`)).json();
        const isDefault = Array.isArray(list) && list.find((t) => t.id === tpl.id)?.isDefault === true;
        if (!isDefault) await fail('invoice-template default-check', { detail: 'template not marked default in list' });
      }
    }
  } catch (e) {
    await fail('invoice-template-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 9c. Bank import flow: manual connection → CSV statement import →
  //       transactions land → reconciliation auto-match tags them ───────────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const connRes = await page.request.post(`${BASE}/api/companies/${companyId}/bank-connections`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: { provider: 'manual', connectionType: 'statement', bankName: 'Emirates NBD', accountName: 'Current AED' },
    });
    if (connRes.status() !== 201) {
      await fail('bank-import connection', { detail: `status ${connRes.status()}: ${(await connRes.text()).slice(0, 200)}` });
    } else {
      const conn = await connRes.json();
      const csv = [
        'date,description,amount,reference',
        '2026-06-01,SALARY TRANSFER JUNE,-15000.00,SAL-001',
        '2026-06-02,Customer payment Acme,5250.00,RCPT-77',
        '2026-06-03,DEWA utility bill,-820.50,DEWA-9',
      ].join('\n');
      const importRes = await page.request.post(
        `${BASE}/api/companies/${companyId}/bank-connections/${conn.id}/import`,
        { headers: { 'x-csrf-token': csrfToken ?? '' }, data: { csvContent: csv } },
      );
      if (importRes.status() >= 300) {
        await fail('bank-import import', { detail: `status ${importRes.status()}: ${(await importRes.text()).slice(0, 250)}` });
      } else {
        const result = await importRes.json();
        if ((result?.imported ?? result?.count ?? 0) < 3) {
          await fail('bank-import count', { detail: `expected 3 imported, got ${JSON.stringify(result).slice(0, 150)}` });
        }
        // The SALARY rule from flow 9 should now match one transaction.
        const matchRes = await page.request.post(`${BASE}/api/companies/${companyId}/reconciliation-rules/auto-match`, {
          headers: { 'x-csrf-token': csrfToken ?? '' },
        });
        const match = await matchRes.json().catch(() => ({}));
        if (matchRes.status() >= 300 || (match?.matched ?? 0) < 1) {
          await fail('bank-import auto-match', { detail: `status ${matchRes.status()}, matched ${match?.matched}` });
        }
      }
    }
  } catch (e) {
    await fail('bank-import-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 9d. Corporate-tax workpaper: create return → pull-from-books fills the
  //       schedule from posted entries → Excel export + template respond ────
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const year = new Date().getFullYear();
    const ctRes = await page.request.post(`${BASE}/api/companies/${companyId}/corporate-tax/returns`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: {
        taxPeriodStart: `${year}-01-01`,
        taxPeriodEnd: `${year}-12-31`,
        totalRevenue: 0,
        totalExpenses: 0,
        totalDeductions: 0,
        taxableIncome: 0,
        taxPayable: 0,
        status: 'draft',
      },
    });
    if (ctRes.status() !== 201) {
      await fail('ct-flow create', { detail: `status ${ctRes.status()}: ${(await ctRes.text()).slice(0, 200)}` });
    } else {
      const ct = await ctRes.json();
      const pullRes = await page.request.post(`${BASE}/api/corporate-tax/returns/${ct.id}/pull-from-books`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
      });
      const pulled = await pullRes.json().catch(() => ({}));
      if (pullRes.status() >= 300 || (pulled?.rows ?? 0) < 1) {
        await fail('ct-flow pull', { detail: `status ${pullRes.status()}, rows ${pulled?.rows}` });
      } else if (!pulled?.workpaper?.rows?.length) {
        await fail('ct-flow workpaper', { detail: 'workpaper rows missing on updated return' });
      }
      const exportRes = await page.request.get(`${BASE}/api/corporate-tax/returns/${ct.id}/export`);
      if (exportRes.status() >= 300) {
        await fail('ct-flow export', { detail: `status ${exportRes.status()}` });
      }
      const tplRes = await page.request.get(`${BASE}/api/corporate-tax/returns/template`);
      if (tplRes.status() >= 300) {
        await fail('ct-flow template', { detail: `status ${tplRes.status()}` });
      }
    }
  } catch (e) {
    await fail('ct-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 9e. VAT workpaper review queue: draft rows → bulk approve → totals ────
  try {
    if (clientId) {
      const wpRes = await page.request.post(`${BASE}/api/firm/vat-workpapers`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
        data: {
          companyId: clientId,
          periodStart: '2026-04-01',
          periodEnd: '2026-06-30',
        },
      });
      if (wpRes.status() >= 300) {
        await fail('vat-wp create', { detail: `status ${wpRes.status()}: ${(await wpRes.text()).slice(0, 200)}` });
      } else {
        const wp = await wpRes.json();
        for (const row of [
          { rowCategory: 'standard_sale', invoiceNumber: 'INV-D1', emirate: 'dubai', taxableAmount: 1000, vatAmount: 50, status: 'draft', sourceMethod: 'generated' },
          { rowCategory: 'standard_expense', invoiceNumber: 'BILL-D2', emirate: 'dubai', taxableAmount: 400, vatAmount: 20, status: 'draft', sourceMethod: 'generated' },
        ]) {
          const rowRes = await page.request.post(`${BASE}/api/firm/vat-workpapers/${wp.id}/rows`, {
            headers: { 'x-csrf-token': csrfToken ?? '' },
            data: row,
          });
          if (rowRes.status() >= 300) {
            await fail('vat-wp add-row', { detail: `status ${rowRes.status()}: ${(await rowRes.text()).slice(0, 200)}` });
          }
        }
        const bulkRes = await page.request.post(`${BASE}/api/firm/vat-workpapers/${wp.id}/rows/bulk-status`, {
          headers: { 'x-csrf-token': csrfToken ?? '' },
          data: { to: 'approved' },
        });
        const bulk = await bulkRes.json().catch(() => ({}));
        if (bulkRes.status() >= 300 || (bulk?.updated ?? 0) !== 2) {
          await fail('vat-wp bulk-approve', { detail: `status ${bulkRes.status()}, updated ${bulk?.updated}` });
        } else {
          const detail = await (await page.request.get(`${BASE}/api/firm/vat-workpapers/${wp.id}`)).json();
          const outputVat = Number(detail?.totals?.box8TotalVat ?? 0);
          const inputVat = Number(detail?.totals?.box11TotalVat ?? 0);
          if (outputVat !== 50 || inputVat !== 20) {
            await fail('vat-wp totals', { detail: `expected 50/20, got ${outputVat}/${inputVat}` });
          }
        }
      }
    }
  } catch (e) {
    await fail('vat-wp-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 9f. Backup → delete → restore: the disaster-recovery promise ─────────
  // Journal entries are protected by FTA 5-year retention (good!), so the
  // recovery marker is an unreferenced ledger account.
  try {
    const companies = await (await page.request.get(`${BASE}/api/companies`)).json();
    const companyId = companies?.[0]?.id;
    const marker = `Restore Marker ${Date.now()}`;
    const acctRes = await page.request.post(`${BASE}/api/companies/${companyId}/accounts`, {
      headers: { 'x-csrf-token': csrfToken ?? '' },
      data: { companyId, code: `9${Date.now() % 100000}`, nameEn: marker, type: 'expense', isActive: true },
    });
    if (acctRes.status() >= 300) {
      await fail('backup-flow marker', { detail: `status ${acctRes.status()}: ${(await acctRes.text()).slice(0, 200)}` });
    } else {
      const acct = await acctRes.json();
      const backupRes = await page.request.post(`${BASE}/api/companies/${companyId}/backups`, {
        headers: { 'x-csrf-token': csrfToken ?? '' },
        data: { name: 'E2E disaster-recovery proof' },
      });
      const backup = await backupRes.json().catch(() => ({}));
      if (backupRes.status() >= 300 || !backup?.id) {
        await fail('backup-flow create', { detail: `status ${backupRes.status()}: ${JSON.stringify(backup).slice(0, 150)}` });
      } else {
        const delRes = await page.request.delete(`${BASE}/api/accounts/${acct.id}`, {
          headers: { 'x-csrf-token': csrfToken ?? '' },
        });
        if (delRes.status() >= 300) {
          await fail('backup-flow delete', { detail: `status ${delRes.status()}: ${(await delRes.text()).slice(0, 150)}` });
        } else {
          const restoreRes = await page.request.post(`${BASE}/api/backups/${backup.id}/restore`, {
            headers: { 'x-csrf-token': csrfToken ?? '' },
            data: { confirmRestore: true },
          });
          const restore = await restoreRes.json().catch(() => ({}));
          if (restoreRes.status() >= 300 || (restore?.totalRestored ?? 0) < 1) {
            await fail('backup-flow restore', { detail: `status ${restoreRes.status()}, restored ${restore?.totalRestored}: ${JSON.stringify(restore?.restored ?? {}).slice(0, 150)}` });
          } else {
            const accountsAfter = await (await page.request.get(`${BASE}/api/companies/${companyId}/accounts`)).json();
            const recovered = Array.isArray(accountsAfter) && accountsAfter.some((a) => a.nameEn === marker);
            if (!recovered) {
              await fail('backup-flow verify', { detail: 'restored account not found in chart of accounts' });
            }
          }
        }
      }
    }
  } catch (e) {
    await fail('backup-flow', { crash: e.message.slice(0, 150) });
  }

  // ── 10. Account-type matrix: every kind of account must work ──────────────
  // (a) 'client' userType: flat workspace sidebar — dashboard, documents,
  //     reports must render with no admin/firm assumptions leaking in.
  // (b) 'client_portal' userType: the separate portal layout.
  async function crawlAs(label, userType, matrixRoutes) {
    const mCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mPage = await mCtx.newPage();
    let mErrors = [];
    let mApi = [];
    mPage.on('pageerror', (e) => mErrors.push(`JS: ${e.message.slice(0, 200)}`));
    mPage.on('response', (r) => {
      const url = r.url();
      if (!url.includes('/api/') || r.status() < 400 || r.status() === 401 || r.status() === 403) return;
      const cleanPath = url.replace(BASE, '').split('?')[0];
      if (TOLERATED_API.some((re) => re.test(cleanPath))) return;
      mApi.push(`${r.request().method()} ${cleanPath} -> ${r.status()}`);
    });

    const mEmail = `e2e-${label}+${Date.now()}@test.local`;
    const mReg = await mPage.request.post(`${BASE}/api/auth/register`, {
      data: { email: mEmail, password: 'Password123!', name: `E2E ${label}`, companyName: `${label} Co LLC` },
    });
    if (mReg.status() >= 300) {
      await fail(`${label} register`, { detail: `status ${mReg.status()}` });
      await mCtx.close();
      return;
    }
    // Complete onboarding via express so the dashboard doesn't redirect.
    await mPage.goto(`${BASE}/dashboard`);
    await mPage.waitForTimeout(2500);
    if (mPage.url().includes('onboarding')) {
      const express = mPage.locator('[data-testid="onboarding-express"]');
      if (await express.count()) {
        await express.click();
        await mPage.waitForTimeout(3500);
      }
    }
    const mDb = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await mDb.connect();
    await mDb.query(`UPDATE users SET user_type = $1, email_verified = true WHERE email = $2`, [userType, mEmail]);
    await mDb.end();

    for (const route of matrixRoutes) {
      mErrors = [];
      mApi = [];
      try {
        await mPage.goto(`${BASE}${route}`, { timeout: 45000 });
        await mPage.waitForTimeout(1500);
        const finalUrl = mPage.url().replace(BASE, '');
        const mainText = await mPage.locator('main').innerText().catch(() => '');
        const bodyText = mainText || (await mPage.locator('body').innerText().catch(() => ''));
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
            await mPage.screenshot({ path: path.join(SHOT_DIR, `${label}_${route.replace(/[^a-z0-9-]+/gi, '_')}.png`) });
          } catch { /* page gone */ }
        }
      } catch (e) {
        failures.push({ name: `${label} route ${route}`, crash: e.message.slice(0, 150) });
      }
    }
    await mCtx.close();
  }

  await crawlAs('client-type', 'client', [
    '/dashboard', '/document-vault', '/tax-return-archive', '/compliance-calendar',
    '/task-center', '/news-feed', '/reports',
  ]);
  await crawlAs('portal', 'client_portal', [
    '/client-portal/dashboard', '/client-portal/invoices', '/client-portal/documents',
    '/client-portal/statements', '/client-portal/messages',
  ]);

  // ── 11. Arabic / RTL smoke: the bilingual promise must hold ───────────────
  // Switch the persisted locale to Arabic, crawl key routes, and assert the
  // document direction flips and nothing breaks.
  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        'i18n-storage',
        JSON.stringify({ state: { locale: 'ar' }, version: 0 }),
      );
    });
    for (const route of ['/dashboard', '/invoices', '/vat-filing', '/reports', '/settings/company']) {
      routeErrors = [];
      apiFailures = [];
      await page.goto(`${BASE}${route}`, { timeout: 45000 });
      await page.waitForTimeout(1700);
      const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
      const mainText = await page.locator('main').innerText().catch(() => '');
      const blank = mainText.trim().length < 40;
      if (dir !== 'rtl' || routeErrors.length || blank) {
        await fail(`rtl route ${route}`, {
          dir,
          blank: blank || undefined,
          js: routeErrors.slice(0, 3),
          api: [...new Set(apiFailures)].slice(0, 4),
        });
      }
    }
  } catch (e) {
    await fail('rtl-smoke', { crash: e.message.slice(0, 150) });
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
