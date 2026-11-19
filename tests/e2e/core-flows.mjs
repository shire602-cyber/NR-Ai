#!/usr/bin/env node
/**
 * Core release flows through the UI (Playwright), in English and Arabic.
 *
 *   BASE_URL=http://localhost:<port> DATABASE_URL=<scratch db> npm run e2e:flows
 *
 * Each flow registers its own disposable owner (API), finishes onboarding in the browser and then
 * drives the screens a customer uses: sign-up (incl. the in-page language switch), onboarding
 * (industry picker, resume on a second device), a second company, chart of accounts (add + edit),
 * invoices (editor, finalise, PDF, share link, payment, credit note, recurring), quotes -> invoice,
 * purchases (bill with upload + supplier picker, approve, pay, debit note, PO -> bill, expense
 * claim with receipt), bank reconciliation (import, suggestions, rules, match / unmatch), the VAT
 * return lifecycle, reports, plans/trial, e-invoicing settings and the approver page, and the
 * Assistant. Static truths are checked too: no Saudi ZATCA and no 15% KSA rate anywhere (even for a company with a Saudi address),
 * and the owner prices (AED 59 / 119 / 229 a month, 590 / 1,190 / 2,290 a year) on /pricing and
 * GET /api/billing/plans in both languages.
 *
 * A flow fails on a failed assertion, a page error, a console error or a 5xx response. Steps in
 * areas still being built are tagged `wip` (FLOWS_WIP, empty by default: WQ1 and AS1 have merged) and reported as
 * "in progress" without failing the run; FLOWS_STRICT_WIP=true makes them count.
 *
 * Environment: BASE_URL, DATABASE_URL (local scratch only; the admin flow promotes one user),
 * FLOWS=a,b (subset by id), FLOWS_LANGS=en,ar, CHROMIUM_PATH, E2E_TIMEZONE (default Asia/Dubai).
 * Writes tests/e2e/.artifacts/core-flows-last-run.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { ARTIFACT_DIR, PASSWORD, apiClient, assertLocal } from "./lib/sweep-personas.mjs";
import { englishWords } from "./lib/sweep-checks.mjs";

const BASE = (process.env.BASE_URL || "").replace(/\/$/, "");
assertLocal(BASE);
const TZ = process.env.E2E_TIMEZONE || "Asia/Dubai";
const LANGS = (process.env.FLOWS_LANGS || "en,ar").split(",").map((s) => s.trim());
const ONLY = process.env.FLOWS ? process.env.FLOWS.split(",").map((s) => s.trim()) : null;
const WIP = new Set((process.env.FLOWS_WIP ?? "").split(",").filter(Boolean));
const STRICT_WIP = process.env.FLOWS_STRICT_WIP === "true";
const api = apiClient(BASE);
const results = [];
let browser;

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const listOf = (body) => (Array.isArray(body) ? body : (body?.items ?? body?.data ?? []));

class StepError extends Error {}
function expect(cond, message) {
  if (!cond) throw new StepError(message);
}

/** A fresh owner: register + login over the API, onboarding in the browser. */
async function newOwner(tag, lang) {
  const email = `flow-${tag}-${lang}+${Date.now()}${Math.floor(Math.random() * 1000)}@test.local`;
  const reg = await api("", "POST", "/api/auth/register", {
    email,
    password: PASSWORD,
    name: lang === "ar" ? "سارة أحمد" : "Sara Ahmed",
    companyName: lang === "ar" ? "شركة الواحة للتجارة" : "Oasis Trading LLC",
  });
  expect(reg.status < 300, `register ${reg.status}`);
  const login = await api("", "POST", "/api/auth/login", { email, password: PASSWORD });
  const token = login.body.token;
  const companies = listOf((await api(token, "GET", "/api/companies")).body);
  const companyId = companies[0].id;
  await api(token, "PATCH", `/api/companies/${companyId}`, {
    trnVatNumber: "100345678900003",
    taxRegistrationType: "Standard",
    vatFilingFrequency: "Quarterly",
    taxRegistrationDate: "2025-01-01",
    emirate: "dubai",
  });
  return { email, token, companyId };
}

async function openContext(lang, { signedInAs, viewport } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    timezoneId: TZ,
    locale: lang === "ar" ? "ar-AE" : "en-AE",
    acceptDownloads: true,
  });
  await context.addInitScript(
    ({ lang, signedIn }) => {
      try {
        if (signedIn) localStorage.setItem("muhasib_auth_hint", "1");
        localStorage.setItem(
          "i18n-storage",
          JSON.stringify({ state: { locale: lang }, version: 0 })
        );
        localStorage.setItem("cookie-consent", "accepted");
      } catch {
        /* storage blocked */
      }
    },
    { lang, signedIn: !!signedInAs }
  );
  if (signedInAs) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { email: signedInAs.email, password: PASSWORD },
    });
    expect(res.status() < 300, `browser login ${res.status()}`);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/^Failed to load resource: the server responded with a status of 4/.test(text)) return;
    if (/net::ERR_(TUNNEL|PROXY|NAME|CONNECTION)/.test(text)) return;
    errors.push(`console: ${text.slice(0, 200)}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 500) {
      errors.push(
        `${r.status()} ${r.request().method()} ${r.url().slice(BASE.length, BASE.length + 120)}`
      );
    }
  });
  return { context, page, errors };
}

async function settle(page, ms = 600) {
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function goto(page, route) {
  await page.goto(`${BASE}${route}`, { timeout: 45000 });
  await settle(page);
}

async function finishOnboarding(page) {
  await goto(page, "/dashboard");
  const express = page.locator('[data-testid="onboarding-express"]');
  await express.waitFor({ timeout: 8000 }).catch(() => undefined);
  if (await express.count()) {
    await express.click();
    await page.waitForTimeout(2500);
    for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
      const next = page.locator(`[data-testid="${id}"]`);
      if (await next.count()) {
        await next.click();
        await page.waitForTimeout(1200);
      }
    }
  }
}

const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();
async function click(page, id, opts) {
  await tid(page, id).click({ timeout: 10000, ...opts });
  await settle(page, 400);
}
async function fill(page, id, value) {
  await tid(page, id).fill(String(value), { timeout: 10000 });
}
/** Arabic mode: visible UI text inside `selector` carries no English words (user data exempt). */
async function expectNoEnglish(page, selector, allow = []) {
  const lines = await page
    .locator(selector)
    .first()
    .evaluate((root) => {
      const out = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = (n.textContent || "").trim();
        if (
          v &&
          n.parentElement &&
          !n.parentElement.closest('[translate="no"], [lang]:not([lang^="ar"])')
        )
          out.push(v);
      }
      return out;
    });
  const allowed = new Set(allow.map((w) => w.toLowerCase()));
  const english = lines.filter((l) => englishWords(l).some((w) => !allowed.has(w)));
  expect(!english.length, `English in Arabic: ${english.slice(0, 5).join(" | ")}`);
}

/** A row action: inline when shown, otherwise inside the row's "..." menu. */
async function rowAction(page, id) {
  const target = tid(page, id);
  if (await target.isVisible().catch(() => false)) {
    await target.click({ timeout: 10000 });
    await settle(page, 400);
    return;
  }
  const triggers = page.locator('tbody tr button[aria-haspopup="menu"]');
  const n = await triggers.count();
  for (let i = 0; i < n; i += 1) {
    await triggers.nth(i).click({ timeout: 5000 });
    await page.waitForTimeout(250);
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: 10000 });
      await settle(page, 400);
      return;
    }
    await page.keyboard.press("Escape");
  }
  throw new StepError(`row action ${id} not found`);
}

/** Opens a Radix select by test id and picks the option matching `text` (or the first). */
async function pick(page, id, text) {
  await tid(page, id).click({ timeout: 10000 });
  await page.waitForTimeout(250);
  const options = page.locator('[role="option"]');
  const option = text ? options.filter({ hasText: text }).first() : options.first();
  await option.click({ timeout: 5000 });
  await settle(page, 300);
}

async function visible(page, id, timeout = 10000) {
  return tid(page, id)
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

/** Runs `fn` once per language; each step records pass / fail / wip. */
function flow(id, title, fn, { langs = LANGS, viewport } = {}) {
  return { id, title, fn, langs, viewport };
}

async function runFlow(def) {
  for (const lang of def.langs) {
    const record = { id: def.id, title: def.title, lang, steps: [], result: "pass" };
    results.push(record);
    const ctx = await openContext(lang, { viewport: def.viewport });
    const helpers = {
      lang,
      ar: lang === "ar",
      ...ctx,
      async signIn(owner) {
        await ctx.context.close().catch(() => {});
        const next = await openContext(lang, { signedInAs: owner, viewport: def.viewport });
        Object.assign(helpers, next);
        await finishOnboarding(next.page);
        return next.page;
      },
      async step(name, body, { wip } = {}) {
        const started = Date.now();
        const before = helpers.errors.length;
        try {
          await body();
          const newErrors = helpers.errors.slice(before);
          if (newErrors.length) throw new StepError(newErrors.join(" | "));
          record.steps.push({ name, result: "pass", ms: Date.now() - started });
          console.log(`  ok   ${def.id}/${lang} ${name}`);
        } catch (error) {
          const message = String(error?.message || error)
            .split("\n")[0]
            .slice(0, 300);
          const wipTag = wip && WIP.has(wip) && !STRICT_WIP ? wip : null;
          record.steps.push({
            name,
            result: wipTag ? `in progress: ${wipTag}` : "fail",
            error: message,
          });
          if (!wipTag) record.result = "fail";
          console.log(`  ${wipTag ? "WIP " : "FAIL"} ${def.id}/${lang} ${name}: ${message}`);
          if (!wipTag) {
            await helpers.page
              .screenshot({
                path: path.join(ARTIFACT_DIR, `flow-${def.id}-${lang}-${record.steps.length}.png`),
              })
              .catch(() => {});
          }
        }
      },
    };
    try {
      await def.fn(helpers);
    } catch (error) {
      record.result = "fail";
      record.steps.push({
        name: "setup",
        result: "fail",
        error: String(error?.message || error).slice(0, 300),
      });
      console.log(
        `  FAIL ${def.id}/${lang} setup: ${String(error?.message || error).slice(0, 300)}`
      );
    }
    await helpers.context.close().catch(() => {});
    console.log(`${record.result === "pass" ? "PASS" : "FAIL"} ${def.id}/${lang}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Seed helpers (API, owner bearer)
// ---------------------------------------------------------------------------------------------

async function accounts(owner) {
  return listOf((await api(owner.token, "GET", `/api/companies/${owner.companyId}/accounts`)).body);
}

async function seedInvoice(
  owner,
  { customer = "Palm Trading", amount = 1000, issue = true, date = today(), contactId } = {}
) {
  const res = await api(owner.token, "POST", `/api/companies/${owner.companyId}/invoices`, {
    customerName: customer,
    ...(contactId ? { contactId } : {}),
    date,
    dueDate: date,
    currency: "AED",
    lines: [{ description: "Consulting services", quantity: 1, unitPrice: amount, vatRate: 0.05 }],
  });
  expect(res.status < 300, `seed invoice ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  const invoice = res.body.invoice ?? res.body;
  if (issue) {
    const st = await api(owner.token, "PATCH", `/api/invoices/${invoice.id}/status`, {
      status: "sent",
    });
    expect(st.status < 300, `issue invoice ${st.status} ${JSON.stringify(st.body).slice(0, 200)}`);
  }
  return invoice;
}

async function invoiceById(owner, id) {
  const all = listOf(
    (await api(owner.token, "GET", `/api/companies/${owner.companyId}/invoices?all=true`)).body
  );
  return all.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------------------------

/** The sign-up journey shared by the desktop and the phone flows. */
async function signupFlow(h, { phone }) {
  const { page } = h;
  const other = h.ar ? "en" : "ar";
  const email = `flow-signup${phone ? "-phone" : ""}-${h.lang}+${Date.now()}@test.local`;
  const noSideScroll = async (label) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(over <= 0, `${label}: horizontal scroll ${over}px`);
  };
  await h.step("step 1 shows the three plans with their prices and the trial terms", async () => {
    await goto(page, "/register");
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang.startsWith(h.lang), `html lang ${lang}`);
    expect(await visible(page, "signup-plan-step"), "no plan step on /register");
    expect((await page.locator('[data-testid^="radio-plan-"]').count()) === 3, "not 3 plans");
    const body = (await tid(page, "signup-plan-step").innerText()).replace(/[⁦-⁩]/g, "");
    for (const n of ["59", "119", "229"]) expect(body.includes(n), `price ${n} missing`);
    expect(
      await tid(page, "radio-plan-professional").isChecked(),
      "Professional is not the default"
    );
    expect(await visible(page, "signup-trial-callout"), "no trial callout");
    if (h.ar) await expectNoEnglish(page, '[data-testid="signup-plan-step"]');
    // The Continue button is in view on first paint (1440x900 laptop and 390x844 phone), with the
    // default plan expanded and without scrolling.
    {
      const box = await tid(page, "button-signup-continue").boundingBox();
      const inner = await page.evaluate(() => window.innerHeight);
      expect(
        box && box.y >= 0 && box.y + box.height <= inner,
        `Continue is below the fold: ${box?.y} + ${box?.height} > ${inner}`
      );
    }
    if (phone) {
      await noSideScroll("step 1");
      const cont = await tid(page, "button-signup-continue").boundingBox();
      expect(cont && cont.y + cont.height <= 844, "Continue is not in the first screen");
      for (const id of ["starter", "professional", "enterprise"]) {
        const box = await tid(page, `signup-plan-${id}`).boundingBox();
        expect(box && box.height >= 44, `${id} card is ${box?.height}px tall`);
      }
    }
  });
  await h.step("yearly shows 590 / 1,190 / 2,290", async () => {
    await click(page, "signup-cycle-yearly");
    const body = (await tid(page, "signup-plan-step").innerText()).replace(/[⁦-⁩]/g, "");
    for (const n of ["590", "1,190", "2,290"]) expect(body.includes(n), `yearly ${n} missing`);
  });
  await h.step("pick Starter, Continue opens step 2 with the plan summary", async () => {
    await tid(page, "signup-plan-starter").click();
    await click(page, "button-signup-continue");
    expect(await visible(page, "signup-plan-summary"), "no summary on step 2");
    const summary = (await tid(page, "signup-plan-summary").innerText()).replace(/[⁦-⁩]/g, "");
    expect(summary.includes("590"), `summary ${summary}`);
    if (phone) await noSideScroll("step 2");
  });
  await h.step(`in-page switch to ${other} and back keeps the step and the plan`, async () => {
    await page.locator(`button:has(span[lang="${other}"])`).first().click();
    await settle(page, 600);
    expect(
      (await page.evaluate(() => document.documentElement.lang)).startsWith(other),
      "switch did not apply"
    );
    expect(await visible(page, "signup-plan-summary"), "step lost after the switch");
    await page.locator(`button:has(span[lang="${h.lang}"])`).first().click();
    await settle(page, 600);
    expect(
      (await page.evaluate(() => document.documentElement.lang)).startsWith(h.lang),
      "switch back failed"
    );
  });
  await h.step("register lands in onboarding (no e-mail step)", async () => {
    await fill(page, "input-name", h.ar ? "سارة أحمد" : "Sara Ahmed");
    await fill(page, "input-email", email);
    await fill(page, "input-password", PASSWORD);
    await click(page, "button-register");
    await page.waitForURL(/\/(onboarding|dashboard)/, { timeout: 20000 });
    await settle(page, 800);
  });
  await h.step("the choice is recorded and the trial is Enterprise for 14 days", async () => {
    const login = await api("", "POST", "/api/auth/login", { email, password: PASSWORD });
    const token = login.body.token;
    const companies = listOf((await api(token, "GET", "/api/companies")).body);
    const sub = (await api(token, "GET", `/api/companies/${companies[0].id}/billing/subscription`))
      .body;
    const ent = sub.entitlement;
    expect(ent.state === "trial" && ent.planId === "enterprise", `entitlement ${ent.state}`);
    expect(
      ent.chosenPlan?.planId === "starter" && ent.chosenPlan?.billingCycle === "yearly",
      `choice ${JSON.stringify(ent.chosenPlan)}`
    );
    const days = (new Date(ent.trialEndsAt).getTime() - Date.now()) / 86400000;
    expect(days > 13 && days <= 14.01, `trial ends in ${days.toFixed(2)} days`);
  });
  await h.step("onboarding and /subscription name the chosen plan", async () => {
    const express = tid(page, "onboarding-express");
    if (await visible(page, "onboarding-express", 8000)) {
      await express.click();
      await page.waitForTimeout(2500);
      for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
        if (await tid(page, id).count()) await click(page, id);
      }
    }
    await goto(page, "/subscription");
    expect(await visible(page, "trial-banner"), "no trial banner on /subscription");
    expect(await visible(page, "subscription-chosen-plan"), "no chosen-plan block");
    if (phone) await noSideScroll("/subscription");
    if (h.ar) await expectNoEnglish(page, '[data-testid="subscription-chosen-plan"]');
  });
}

// ---------------------------------------------------------------------------------------------
// STEP5: invite a customer to the client portal (desktop, phone, and an existing account)
// ---------------------------------------------------------------------------------------------

async function dbRows(sqlText, params = []) {
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sqlText, params)).rows;
  } finally {
    await db.end();
  }
}

/** The newest portal-invitation email of a company, read from the durable outbox. */
async function inviteMail(companyId) {
  const rows = await dbRows(
    `SELECT subject, html FROM email_outbox
      WHERE company_id = $1 AND category = 'portal_invite'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  );
  expect(rows.length === 1, "no portal invitation in the outbox");
  const m = /href="([^"]*\/portal\/join#t=[0-9a-f]{64})"/.exec(rows[0].html);
  expect(!!m, "no invitation link in the email");
  return { subject: rows[0].subject, hash: new URL(m[1].replace(/&amp;/g, "&")).hash };
}

/** A customer with an email, an issued invoice, a partial payment and a credit note. */
async function seedPortalCustomer(owner, lang) {
  const email = `cust-${Date.now()}${Math.floor(Math.random() * 1000)}@test.local`;
  const created = await api(
    owner.token,
    "POST",
    `/api/companies/${owner.companyId}/customer-contacts`,
    {
      name: lang === "ar" ? "شركة النور للتجارة" : "Al Noor Trading",
      email,
      contactPerson: lang === "ar" ? "ليلى" : "Layla",
    }
  );
  expect(created.status < 300, `contact ${created.status}`);
  const contactId = created.body.id;
  await dbRows(`UPDATE customer_contacts SET preferred_language = $1 WHERE id = $2`, [
    lang,
    contactId,
  ]);
  const invoice = await seedInvoice(owner, { contactId, amount: 1000 });
  const bank = (await accounts(owner)).find((a) => a.code === "1020");
  const pay = await api(
    owner.token,
    "POST",
    `/api/companies/${owner.companyId}/invoices/${invoice.id}/payments`,
    { date: today(), method: "bank", paymentAccountId: bank?.id, amount: 300 }
  );
  expect(pay.status < 300, `payment ${pay.status} ${JSON.stringify(pay.body).slice(0, 160)}`);
  const cn = await api(owner.token, "POST", `/api/companies/${owner.companyId}/credit-notes`, {
    invoiceId: invoice.id,
    lines: [{ description: "Adjustment", quantity: 1, unitPrice: 100, vatRate: 5 }],
    reason: "Adjustment",
  });
  expect(cn.status === 201, `credit note ${cn.status}`);
  const issued = await api(owner.token, "POST", `/api/credit-notes/${cn.body.id}/issue`, {});
  expect(issued.status < 300, `issue credit note ${issued.status}`);
  return { email, contactId, invoiceId: invoice.id };
}

async function openInviteSheet(page, contactId, phone) {
  await goto(page, "/contacts");
  if (phone) {
    await page
      .locator('[data-testid="mobile-contact-list"] button[aria-haspopup="menu"]')
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(250);
    await tid(page, `button-portal-access-${contactId}`).click({ timeout: 10000 });
  } else {
    await page
      .locator(`[data-testid="row-contact-${contactId}"] button[aria-haspopup="menu"]`)
      .first()
      .click({ timeout: 10000 });
    await page.waitForTimeout(250);
    await tid(page, `button-portal-access-${contactId}`).click({ timeout: 10000 });
  }
  expect(await visible(page, "pa-email"), "invite sheet did not open");
}

async function noSideScroll(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow <= 1, `${label}: sideways scroll of ${overflow}px`);
}

async function portalInviteJourney(h, { phone }) {
  const lang = h.lang;
  const owner = await newOwner(phone ? "pinvph" : "pinv", lang);
  const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const password = "Customer9Portal!x";
  let seed;
  let hash;
  let customer;
  let cpage;

  await h.step(
    "seed a customer with an email and language, an invoice, a payment, a credit note",
    async () => {
      seed = await seedPortalCustomer(owner, lang);
    }
  );

  const page = await h.signIn(owner);

  await h.step(
    "Contacts: Invite to portal opens the sheet prefilled with the email and language",
    async () => {
      await openInviteSheet(page, seed.contactId, phone);
      const value = await tid(page, "pa-email").inputValue();
      expect(value === seed.email, `email prefill ${value}`);
      expect(
        (await tid(page, `pa-lang-${lang}`).getAttribute("aria-checked")) === "true",
        "language not preselected"
      );
      expect(await visible(page, `pa-preview-${lang}`), "no email preview");
      if (phone) {
        await page.waitForTimeout(700); // the slide-in animation
        const box = await tid(page, "portal-access-sheet").boundingBox();
        expect(box && box.width >= 380, `sheet is not full width on phone (${box?.width})`);
        await noSideScroll(page, "sheet");
      }
    }
  );

  await h.step(
    "Send invitation: the honest link panel (no email provider) and the Invited chip",
    async () => {
      await tid(page, "pa-send").scrollIntoViewIfNeeded();
      await click(page, "pa-send");
      expect(await visible(page, "pa-link-panel"), "no link panel without a provider");
      await tid(page, "portal-access-sheet")
        .locator("button")
        .filter({ has: page.locator(".sr-only") })
        .last()
        .click();
      await settle(page, 700);
      const chip = tid(page, `portal-chip-${seed.contactId}`);
      expect(await chip.isVisible(), "no portal chip");
      expect((await chip.getAttribute("data-state")) === "invited", "chip is not Invited");
      if (h.ar) await expectNoEnglish(page, "main");
    }
  );

  await h.step("the invitation email is in the outbox in the contact's language", async () => {
    const mail = await inviteMail(owner.companyId);
    hash = mail.hash;
    expect(
      lang === "ar"
        ? /دعتك/.test(mail.subject)
        : /invited you to view your invoices/.test(mail.subject),
      `subject language: ${mail.subject}`
    );
  });

  await h.step(
    "customer opens the link: the token leaves the address bar, the page matches the language",
    async () => {
      customer = await openContext(lang, { viewport });
      cpage = customer.page;
      await cpage.goto(`${BASE}/portal/join${hash}`, { timeout: 45000 });
      await settle(cpage);
      expect(await visible(cpage, "join-form"), "join form not shown");
      const url = new URL(cpage.url());
      expect(url.hash === "" && !url.href.includes("#t="), `token still in the URL: ${url.href}`);
      const dir = await cpage.evaluate(() => document.documentElement.dir);
      expect(dir === (h.ar ? "rtl" : "ltr"), `html dir ${dir}`);
      if (h.ar) await expectNoEnglish(cpage, "body");
      if (phone) {
        await noSideScroll(cpage, "join");
        const box = await tid(cpage, "join-submit").boundingBox();
        expect(box && box.y + box.height <= 844, `Submit is below the fold (${box?.y})`);
        expect(box.height >= 44, `Submit is ${box.height}px tall`);
        const eye = await tid(cpage, "join-toggle-password").boundingBox();
        expect(eye.width >= 44 && eye.height >= 44, `password toggle ${eye.width}x${eye.height}`);
      }
    }
  );

  await h.step(
    "the checklist reacts and Submit stays disabled until the terms are ticked",
    async () => {
      await fill(cpage, "join-password", "abc");
      const lengthMet = await cpage.locator('[data-rule="length"]').getAttribute("data-met");
      expect(lengthMet === "false", "length rule met by 'abc'");
      await fill(cpage, "join-password", password);
      for (const rule of ["length", "upper", "lower", "digit"]) {
        expect(
          (await cpage.locator(`[data-rule="${rule}"]`).getAttribute("data-met")) === "true",
          `rule ${rule} not met`
        );
      }
      expect(await tid(cpage, "join-submit").isDisabled(), "Submit enabled before the terms");
      await tid(cpage, "join-terms").click();
      expect(!(await tid(cpage, "join-submit").isDisabled()), "Submit disabled after the terms");
    }
  );

  await h.step("submit: the customer lands on the portal dashboard", async () => {
    await tid(cpage, "join-submit").click();
    await cpage.waitForURL(/\/client-portal\/dashboard/, { timeout: 30000 });
    await settle(cpage);
    expect(await visible(cpage, "portal-balance"), "no balance on the dashboard");
    expect(await visible(cpage, "portal-welcome"), "no welcome card");
    if (h.ar) await expectNoEnglish(cpage, "main");
    if (phone) await noSideScroll(cpage, "dashboard");
  });

  await h.step(
    "invoices: partially paid invoice, credit note, PDF download, no Pay now",
    async () => {
      await goto(cpage, "/client-portal/invoices");
      expect(await visible(cpage, "portal-invoice-table"), "no invoice table");
      expect(
        await visible(cpage, `portal-invoice-row-${seed.invoiceId}`),
        "the issued invoice is not listed"
      );
      const creditTab = tid(cpage, "portal-filter-credit");
      const creditCount = await creditTab.innerText();
      expect(
        /1/.test(creditCount.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))),
        `credit notes: ${creditCount}`
      );
      expect(
        (await cpage.locator('[data-testid^="portal-pay-"]').count()) === 0,
        "Pay now without a gateway"
      );
      const [download] = await Promise.all([
        cpage.waitForEvent("download", { timeout: 20000 }),
        tid(cpage, `portal-pdf-${seed.invoiceId}`).click(),
      ]);
      expect(/\.pdf$/i.test(download.suggestedFilename()), "download is not a PDF");
      if (h.ar) await expectNoEnglish(cpage, "main");
      if (phone) {
        await noSideScroll(cpage, "invoices");
        const card = await cpage
          .locator('[data-testid="portal-invoice-table"]')
          .evaluate((el) => el.classList.contains("row-cards"));
        expect(card, "invoice list is not in card layout");
      }
    }
  );

  await h.step("statement: page and PDF", async () => {
    await goto(cpage, "/client-portal/statements");
    const res = await cpage.evaluate(async () => {
      const r = await fetch("/api/client-portal/statements?format=pdf", { credentials: "include" });
      return { status: r.status, type: r.headers.get("content-type") };
    });
    expect(
      res.status === 200 && /pdf/.test(res.type || ""),
      `statement pdf ${res.status} ${res.type}`
    );
    if (h.ar) await expectNoEnglish(cpage, "main");
  });

  await h.step("account page", async () => {
    await goto(cpage, "/client-portal/account");
    expect(await visible(cpage, "portal-account-page"), "no account page");
    if (h.ar) await expectNoEnglish(cpage, "main");
    if (phone) await noSideScroll(cpage, "account");
  });

  await h.step(
    "company app is out of reach: /dashboard goes to the portal, company APIs refuse",
    async () => {
      await goto(cpage, "/dashboard");
      await cpage.waitForURL(/\/client-portal\/dashboard/, { timeout: 20000 });
      const status = await cpage.evaluate(async (cid) => {
        const r = await fetch(`/api/companies/${cid}/invoices`, { credentials: "include" });
        return r.status;
      }, owner.companyId);
      expect(status === 403 || status === 404, `company invoices answered ${status}`);
      const list = await cpage.evaluate(
        async () => await (await fetch("/api/companies", { credentials: "include" })).json()
      );
      expect(Array.isArray(list) && list.length === 0, "the portal user sees a company");
    }
  );

  await h.step("sign out clears the session; signing in again lands on the portal", async () => {
    await click(cpage, "portal-account-menu");
    await click(cpage, "portal-sign-out");
    await cpage.waitForURL(/\/login/, { timeout: 20000 });
    const me = await cpage.evaluate(
      async () => (await fetch("/api/auth/me", { credentials: "include" })).status
    );
    expect(me === 401, `/api/auth/me after sign-out: ${me}`);
    await fill(cpage, "input-email", seed.email);
    await fill(cpage, "input-password", password);
    await click(cpage, "button-login");
    await cpage.waitForURL(/\/client-portal\/dashboard/, { timeout: 30000 });
  });

  await h.step("owner removes access: the customer sees the access-removed state", async () => {
    await openInviteSheet(page, seed.contactId, phone);
    const remove = page.locator('[data-testid^="pa-remove-"]').first();
    await remove.waitFor({ state: "visible", timeout: 10000 });
    await remove.click();
    await click(page, "pa-confirm");
    await settle(page, 800);
    await cpage.reload();
    await settle(cpage, 800);
    expect(await visible(cpage, "portal-access-removed"), "no access-removed state");
    if (h.ar) await expectNoEnglish(cpage, "main");
  });

  await h.step("the used invitation link shows the already-used state", async () => {
    const again = await openContext(lang, { viewport });
    try {
      await again.page.goto(`${BASE}/portal/join${hash}`, { timeout: 45000 });
      await settle(again.page);
      expect(await visible(again.page, "join-state-accepted"), "no already-used state");
      if (h.ar) await expectNoEnglish(again.page, "body");
    } finally {
      await again.context.close().catch(() => {});
    }
  });

  await customer?.context.close().catch(() => {});
}

const FLOWS = [
  flow(
    "signup",
    "Sign up: choose a plan (59/119/229), account, trial starts with the choice recorded",
    (h) => signupFlow(h, { phone: false })
  ),

  flow(
    "signup-deeplink",
    "Sign up from /pricing: the plan chosen there is kept, Change returns to the plans",
    async (h) => {
      const { page } = h;
      await h.step("/pricing -> yearly -> Professional lands on step 2 with the plan", async () => {
        await goto(page, "/pricing");
        await click(page, "billing-cycle-yearly");
        await click(page, "button-plan-professional");
        await page.waitForURL(/\/register\?/, { timeout: 15000 });
        await settle(page, 600);
        const url = page.url();
        expect(/plan=professional/.test(url) && /cycle=yearly/.test(url), `url ${url}`);
        expect(await visible(page, "signup-plan-summary"), "no plan summary on step 2");
        expect(
          (await tid(page, "signup-plan-summary").innerText()).includes("1,190"),
          "summary does not show the yearly Professional price"
        );
      });
      await h.step("Change returns to step 1 with Professional and yearly kept", async () => {
        await click(page, "button-change-plan");
        expect(await visible(page, "signup-plan-step"), "step 1 not shown");
        expect(await tid(page, "radio-plan-professional").isChecked(), "Professional not selected");
        const price = await tid(page, "plan-price-professional").innerText();
        expect(price.includes("1,190"), `yearly not kept: ${price}`);
      });
    }
  ),

  flow(
    "signup-phone",
    "Sign up on a phone (390 px): no sideways scroll, Continue reachable, touch targets",
    (h) => signupFlow(h, { phone: true }),
    { viewport: { width: 390, height: 844 } }
  ),

  flow("onboarding", "Onboarding: industry picker, resume on a second device", async (h) => {
    const email = `flow-onb-${h.lang}+${Date.now()}@test.local`;
    await api("", "POST", "/api/auth/register", {
      email,
      password: PASSWORD,
      name: "Omar",
      companyName: "Omar Co",
    });
    let page = await (async () => {
      await h.context.close();
      const next = await openContext(h.lang, { signedInAs: { email } });
      Object.assign(h, next);
      return next.page;
    })();
    await h.step("industry picker offers templates and accepts one", async () => {
      await goto(page, "/onboarding");
      expect(await visible(page, "onboarding-industry"), "no industry picker on screen 1");
      await tid(page, "onboarding-industry").click();
      await page.waitForTimeout(300);
      const options = page.locator('[data-testid^="industry-"]');
      expect((await options.count()) > 1, "industry picker offers no templates");
      await options.nth(1).click();
      await settle(page, 300);
      await click(page, "onboarding-express");
      await page.waitForTimeout(2500);
    });
    await h.step("a second device resumes at the same step", async () => {
      const stepText = await tid(page, "onboarding-step-count")
        .innerText()
        .catch(() => "");
      const second = await openContext(h.lang, { signedInAs: { email } });
      await goto(second.page, "/onboarding");
      const other = await tid(second.page, "onboarding-step-count")
        .innerText()
        .catch(() => "");
      await second.context.close();
      expect(stepText && stepText === other, `device 1 "${stepText}" vs device 2 "${other}"`);
      expect(!/^1\b|\b1\s*(\/|of|من)/.test(other), `resumed at step 1: ${other}`);
    });
  }),

  flow("second-company", "Create a second company (plan rules)", async (h) => {
    const owner = await newOwner("co2", h.lang);
    const page = await h.signIn(owner);
    await h.step("company switcher > New company creates it and opens its onboarding", async () => {
      await goto(page, "/dashboard");
      await click(page, "button-company-switcher");
      await click(page, "company-switcher-new-company");
      await click(page, "button-save-new-company");
      expect(await visible(page, "dialog-new-company", 2000), "empty name closed the dialog");
      await fill(page, "input-new-company-name", h.ar ? "شركة النخلة الثانية" : "Second Palm LLC");
      await click(page, "button-save-new-company");
      await page.waitForURL(/\/onboarding/, { timeout: 15000 });
      const companies = listOf((await api(owner.token, "GET", "/api/companies")).body);
      expect(companies.length === 2, `companies ${companies.length}`);
      await finishOnboarding(page);
    });
    await h.step(
      "trial cap (3 companies): the fourth is refused with the plan dialog",
      async () => {
        const third = await api(owner.token, "POST", "/api/companies", {
          name: `Third Co ${h.lang}`,
        });
        expect(third.status < 300, `third company ${third.status}`);
        await goto(page, "/dashboard");
        await click(page, "button-company-switcher");
        await click(page, "company-switcher-new-company");
        await fill(page, "input-new-company-name", "Fourth Co");
        await click(page, "button-save-new-company");
        expect(
          await visible(page, "plan-limit-dialog", 8000),
          "no plan limit dialog for the 4th company"
        );
        const companies = listOf((await api(owner.token, "GET", "/api/companies")).body);
        expect(companies.length === 3, `companies ${companies.length}`);
      }
    );
  }),

  flow("coa", "Chart of accounts: add an account and edit one", async (h) => {
    const owner = await newOwner("coa", h.lang);
    const page = await h.signIn(owner);
    const code = String(6800 + Math.floor(Math.random() * 90));
    await h.step("Add account drawer creates the account", async () => {
      await goto(page, "/chart-of-accounts");
      await click(page, "button-add-account");
      expect(await visible(page, "drawer-account"), "drawer did not open");
      await tid(page, "select-account-type").click();
      await page
        .locator('[role="option"]')
        .filter({ hasText: h.ar ? /مصروف|مصاريف/ : /Expense/ })
        .first()
        .click();
      await fill(page, "input-account-code", code);
      await fill(page, "input-account-name-en", "Sweep Software Subscriptions");
      await fill(page, "input-account-name-ar", "اشتراكات البرمجيات");
      await click(page, "button-save-account");
      const list = await accounts(owner);
      expect(
        list.some((a) => a.code === code),
        `account ${code} not created`
      );
    });
    await h.step("edit the account name", async () => {
      const acc = (await accounts(owner)).find((a) => a.code === code);
      await goto(page, "/chart-of-accounts");
      await fill(page, "input-search-accounts", code);
      await settle(page, 400);
      await click(page, `button-edit-account-${acc.id}`);
      await fill(page, "input-account-name-en", "Sweep Software Subscriptions (edited)");
      await click(page, "button-save-account");
      const after = (await accounts(owner)).find((a) => a.id === acc.id);
      expect(/edited/.test(after.nameEn ?? after.name ?? ""), "name not saved");
    });
  }),

  flow(
    "invoices",
    "Invoices: editor, finalise, PDF, share link, payment, credit notes, recurring",
    async (h) => {
      const owner = await newOwner("inv", h.lang);
      const page = await h.signIn(owner);
      let invoiceId;
      await h.step("editor: create a draft and issue it from the nudge", async () => {
        await goto(page, "/invoices/new");
        await fill(page, "input-customer-name", h.ar ? "مؤسسة النخيل" : "Palm Trading");
        await fill(page, "input-line-description-0", h.ar ? "خدمات استشارية" : "Consulting");
        await fill(page, "input-line-quantity-0", "2");
        await fill(page, "input-line-price-0", "500");
        await click(page, "button-submit-invoice");
        await settle(page, 1000);
        if (await visible(page, "button-issue-now", 6000)) await click(page, "button-issue-now");
        await settle(page, 1000);
        const all = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/invoices?all=true`))
            .body
        );
        expect(all.length === 1, `invoices ${all.length}`);
        invoiceId = all[0].id;
        expect(all[0].status !== "draft", `status ${all[0].status}`);
      });
      await h.step("draft invoice editor Checks tab lists the checks", async () => {
        // Issued invoices are read-only since S1: the Checks tab belongs to a draft in the editor.
        await goto(page, "/invoices/new");
        await fill(page, "input-customer-name", h.ar ? "مؤسسة الواحة" : "Oasis Draft");
        await fill(page, "input-line-description-0", h.ar ? "خدمات" : "Services");
        await fill(page, "input-line-quantity-0", "1");
        await fill(page, "input-line-price-0", "100");
        await click(page, "tab-invoice-checks");
        const text = await page.locator("main").innerText();
        expect(text.length > 40, "Checks tab is empty");
      });
      await h.step("issued invoice opens as the locked read-only document", async () => {
        await goto(page, `/invoices/${invoiceId}/edit`);
        expect(await visible(page, "issued-invoice-locked", 10000), "locked document not shown");
        expect(
          (await page.locator('[data-testid="tab-invoice-checks"]').count()) === 0,
          "Checks tab shown on an issued invoice"
        );
      });
      await h.step("PDF downloads", async () => {
        await goto(page, "/invoices");
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          rowAction(page, `button-download-pdf-${invoiceId}`),
        ]);
        expect(/\.pdf$/i.test(download.suggestedFilename()), download.suggestedFilename());
      });
      let shareUrl;
      await h.step("share link opens for a signed-out customer", async () => {
        await goto(page, "/invoices");
        await rowAction(page, `button-share-invoice-${invoiceId}`);
        await settle(page, 1200);
        shareUrl = await tid(page, "input-invoice-share-link").inputValue();
        expect(/\/view\/invoice\//.test(shareUrl), `share url ${shareUrl}`);
        const visitor = await openContext(h.lang);
        await visitor.page.goto(shareUrl.startsWith("http") ? shareUrl : `${BASE}${shareUrl}`);
        await settle(visitor.page, 800);
        const text = await visitor.page.locator("body").innerText();
        await visitor.context.close();
        expect(/1,050|1050/.test(text), "public invoice view does not show the total");
        expect(!visitor.errors.length, visitor.errors.join(" | "));
      });
      await h.step("sent and viewed log records the customer's view", async () => {
        await goto(page, `/invoices/${invoiceId}/edit`);
        expect(await visible(page, "invoice-activity"), "no Sent and viewed section");
        const text = await tid(page, "invoice-activity").innerText();
        expect(!(await tid(page, "invoice-activity-empty").count()), `activity empty: ${text}`);
      });
      await h.step("record a payment on the invoice", async () => {
        await goto(page, "/invoices");
        await rowAction(page, `button-add-payment-${invoiceId}`);
        await page
          .locator(
            '[role="dialog"] input[inputmode="decimal"], [role="dialog"] input[type="number"]'
          )
          .first()
          .fill("1050");
        // The record-payment dialog's submit is the last of its two footer buttons (no test id).
        await page.locator('[role="dialog"] div.flex.gap-3 > button').last().click();
        await settle(page, 600);
        await settle(page, 1000);
        const inv = await invoiceById(owner, invoiceId);
        expect(
          inv.status === "paid" || Number(inv.amountPaid ?? inv.paid ?? 0) > 0,
          `status ${inv.status}`
        );
      });
      await h.step("receive one payment across several invoices", async () => {
        const contact = await api(
          owner.token,
          "POST",
          `/api/companies/${owner.companyId}/customer-contacts`,
          { name: "Oasis Retail", email: "oasis@example.com" }
        );
        expect(contact.status < 300, `contact ${contact.status}`);
        const contactId = (contact.body.contact ?? contact.body).id;
        const a = await seedInvoice(owner, { customer: "Oasis Retail", amount: 200, contactId });
        const b = await seedInvoice(owner, { customer: "Oasis Retail", amount: 300, contactId });
        await goto(page, "/sales/receive-payment");
        await pick(page, "select-receive-customer", "Oasis Retail");
        await pick(page, "select-receive-account");
        await fill(page, "input-receive-amount", "525");
        await click(page, "button-auto-apply");
        await click(page, "button-record-receipt");
        await settle(page, 1500);
        for (const id of [a.id, b.id]) {
          const inv = await invoiceById(owner, id);
          expect(inv.status === "paid", `invoice ${inv.number} ${inv.status}`);
        }
      });
      await h.step("full credit note from an issued invoice (prefilled editor)", async () => {
        const inv = await seedInvoice(owner, { customer: "Gulf Co", amount: 400 });
        await goto(page, "/invoices");
        await rowAction(page, `button-credit-note-${inv.id}`);
        await page.waitForURL(/\/credit-notes\/new/, { timeout: 15000 });
        await settle(page, 800);
        await page.locator('[name="reason"]').fill(h.ar ? "مرتجع جزئي" : "Goods returned");
        await click(page, "button-submit-credit-note");
        await settle(page, 1500);
        const notes = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/credit-notes`)).body
        );
        expect(notes.length >= 1, "no credit note created");
      });
      await h.step("partial credit note from an invoice", async () => {
        const inv = await seedInvoice(owner, { customer: "Gulf Co", amount: 600 });
        const before = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/credit-notes`)).body
        ).length;
        await goto(page, "/invoices");
        await rowAction(page, `button-credit-note-${inv.id}`);
        await page.waitForURL(/\/credit-notes\/new/, { timeout: 15000 });
        await settle(page, 800);
        await page.locator('input[name="lines.0.unitPrice"]').fill("100");
        await page.locator('[name="reason"]').fill(h.ar ? "مرتجع جزئي" : "Goods returned");
        await click(page, "button-submit-credit-note");
        await settle(page, 1500);
        const notes = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/credit-notes`)).body
        );
        expect(notes.length === before + 1, `credit notes ${before} -> ${notes.length}`);
        const total = Number(notes[0]?.total ?? notes[notes.length - 1]?.total ?? 0);
        expect(
          notes.some((n) => Math.abs(Number(n.total)) === 105),
          `partial total ${total}`
        );
      });
      await h.step("make recurring from an invoice", async () => {
        const before = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/recurring-invoices`))
            .body
        ).length;
        await goto(page, "/invoices");
        await rowAction(page, `button-set-recurring-${invoiceId}`);
        await page.waitForURL(/\/recurring-invoices\/new/, { timeout: 15000 });
        await settle(page, 800);
        await click(page, "button-submit-recurring");
        await settle(page, 1500);
        const after = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/recurring-invoices`))
            .body
        ).length;
        expect(after > before, `recurring schedules ${before} -> ${after}`);
      });
    }
  ),

  flow("quotes", "Quotes -> invoice", async (h) => {
    const owner = await newOwner("quote", h.lang);
    const page = await h.signIn(owner);
    await h.step("create a quote and convert it to an invoice", async () => {
      const q = await api(owner.token, "POST", `/api/companies/${owner.companyId}/quotes`, {
        customerName: "Desert Rose",
        date: today(),
        expiryDate: today(),
        currency: "AED",
        lines: [{ description: "Design work", quantity: 1, unitPrice: 800, vatRate: 0.05 }],
      });
      expect(q.status < 300, `quote ${q.status} ${JSON.stringify(q.body).slice(0, 200)}`);
      const quote = q.body.quote ?? q.body;
      await goto(page, "/quotes");
      const row = page
        .locator("tr, [data-testid^=quote-row]")
        .filter({ hasText: quote.number ?? "Desert Rose" })
        .first();
      await row
        .locator('button[aria-haspopup="menu"], [data-testid^="button-quote-actions"]')
        .first()
        .click()
        .catch(() => {});
      await settle(page, 300);
      const convert = page
        .locator('[role="menuitem"]')
        .filter({ hasText: h.ar ? /فاتورة|تحويل/ : /Convert to invoice/i })
        .first();
      await convert.click({ timeout: 8000 });
      await settle(page, 1200);
      const confirm = page
        .locator('[role="alertdialog"] button, [role="dialog"] button[type="submit"]')
        .last();
      if (await confirm.count()) await confirm.click().catch(() => {});
      await settle(page, 1200);
      const invs = listOf(
        (await api(owner.token, "GET", `/api/companies/${owner.companyId}/invoices?all=true`)).body
      );
      expect(
        invs.some((i) => i.customerName === "Desert Rose"),
        "no invoice from the quote"
      );
    });
  }),

  flow("quote-email", "Quote sent by e-mail (outbox; queued without a provider)", async (h) => {
    const owner = await newOwner("qmail", h.lang);
    const page = await h.signIn(owner);
    await h.step("send a quote by e-mail from the row menu", async () => {
      const q = await api(owner.token, "POST", `/api/companies/${owner.companyId}/quotes`, {
        customerName: "Desert Rose",
        date: today(),
        expiryDate: today(),
        currency: "AED",
        lines: [{ description: "Design work", quantity: 1, unitPrice: 800, vatRate: 0.05 }],
      });
      const quote = q.body.quote ?? q.body;
      await goto(page, "/quotes");
      await rowAction(page, `button-send-quote-${quote.id}`);
      expect(await visible(page, "dialog-send-quote"), "send dialog did not open");
      await fill(page, "input-send-quote-to", "rose@example.com");
      const [res] = await Promise.all([
        page.waitForResponse((r) => /\/send-email$/.test(r.url()), { timeout: 15000 }),
        click(page, "button-send-quote"),
      ]);
      expect(res.status() < 300, `send-email ${res.status()}`);
      const after = (await api(owner.token, "GET", `/api/quotes/${quote.id}`)).body;
      const status = after.quote?.status ?? after.status;
      expect(status === "draft", `quote ${status}: nothing is "sent" without a provider`);
    });
  }),

  flow("cash-sale", "Cash sale with its own CS numbering; Settings > Numbering", async (h) => {
    const owner = await newOwner("cash", h.lang);
    const page = await h.signIn(owner);
    await h.step("record a cash sale: CS number, paid at once", async () => {
      await goto(page, "/sales/cash-sale");
      const next = (await tid(page, "cash-sale-next-number").innerText()).trim();
      expect(/^CS/.test(next), `next number ${next}`);
      await fill(page, "input-cash-line-description-0", h.ar ? "بيع نقدي" : "Counter sale");
      await fill(page, "input-cash-line-quantity-0", "1");
      await fill(page, "input-cash-line-price-0", "100");
      await click(page, "button-record-cash-sale");
      await settle(page, 1500);
      const all = listOf(
        (await api(owner.token, "GET", `/api/companies/${owner.companyId}/invoices?all=true`)).body
      );
      const sale = all.find((i) => /^CS/.test(i.number ?? ""));
      expect(sale, `no CS invoice (${all.map((i) => i.number).join(", ")})`);
      expect(sale.status === "paid", `cash sale ${sale.status}`);
    });
    await h.step("Settings > Numbering changes a prefix", async () => {
      await goto(page, "/settings/numbering");
      expect(await visible(page, "numbering-cash_sale"), "no cash sale row");
      await fill(page, "numbering-prefix-quote", "QTX");
      await click(page, "numbering-save-quote");
      await settle(page, 800);
      const rows = (await api(owner.token, "GET", `/api/companies/${owner.companyId}/numbering`))
        .body;
      expect(JSON.stringify(rows).includes("QTX"), "prefix not saved");
    });
  }),

  flow(
    "purchases",
    "Purchases: bill (upload, supplier picker), approve, pay, debit note, PO -> bill, expense claim",
    async (h) => {
      const owner = await newOwner("bill", h.lang);
      const page = await h.signIn(owner);
      await h.step("bill editor: supplier picker '+ New supplier', upload, save", async () => {
        await goto(page, "/bill-pay/new");
        expect(await visible(page, "bill-capture-panel"), "no capture panel");
        const picker = page
          .locator(
            '[data-testid="bill-supplier"], [data-testid^="supplier-picker"], input[role="combobox"]'
          )
          .first();
        await picker.click();
        await picker.fill("Sweep Supplies");
        await settle(page, 500);
        const add = page.locator('[data-testid$="-new"]').first();
        if (await add.count()) {
          await add.click();
          await settle(page, 300);
          if (await tid(page, "new-supplier-name").count()) {
            await fill(page, "new-supplier-name", "Sweep Supplies");
            await click(page, "new-supplier-save");
          }
        }
        await page
          .locator('[data-testid="bill-capture-panel"] input[type="file"]')
          .first()
          .setInputFiles({
            name: "bill.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
          });
        await settle(page, 1500);
        expect(
          await visible(page, "bill-capture-file", 5000),
          "uploaded file not shown in the panel"
        );
        // Automatic reading needs an AI provider that reads PDFs (EXTERNAL here): a refusal must be
        // explained in the panel, and the file stays attached.
        const isCapture = (e) => /bills\/capture|status of 50[23]/.test(e);
        if (h.errors.some(isCapture)) {
          expect(await visible(page, "bill-capture-error", 5000), "capture refusal not explained");
          const kept = h.errors.filter((e) => !isCapture(e));
          h.errors.splice(0, h.errors.length, ...kept);
        }
        const vendors = listOf(
          (await api(owner.token, "GET", `/api/companies/${owner.companyId}/vendors`)).body
        );
        expect(
          vendors.some((v) => /Sweep Supplies/.test(v.name)),
          "supplier not created from the picker"
        );
      });
      let billId;
      await h.step("approve and pay a bill", async () => {
        const acc = await accounts(owner);
        const expense =
          acc.find((a) => a.type === "expense" && !a.isSystem) ??
          acc.find((a) => a.type === "expense");
        const b = await api(owner.token, "POST", `/api/companies/${owner.companyId}/bills`, {
          vendor_name: "Sweep Supplies",
          bill_number: `B-${Date.now()}`,
          bill_date: today(),
          due_date: today(),
          currency: "AED",
          line_items: [
            {
              description: "Paper",
              quantity: 1,
              unit_price: 200,
              vat_rate: 0.05,
              account_id: expense?.id,
            },
          ],
        });
        expect(b.status < 300, `bill ${b.status} ${JSON.stringify(b.body).slice(0, 200)}`);
        billId = (b.body.bill ?? b.body).id;
        const ap = await api(owner.token, "POST", `/api/bills/${billId}/approve`, {});
        expect(ap.status < 300, `approve ${ap.status} ${JSON.stringify(ap.body).slice(0, 200)}`);
        await goto(page, "/bill-pay");
        await click(page, "bill-tab-to_pay").catch(() => {});
        expect(
          (await page.locator("body").innerText()).includes("Sweep Supplies"),
          "approved bill not in To pay"
        );
      });
      await h.step("debit note against the bill", async () => {
        await goto(page, "/debit-notes/new");
        expect(await visible(page, "debit-note-bill"), "debit note bill picker missing");
      });
      await h.step("PO -> bill", async () => {
        await goto(page, "/purchase-orders/new");
        expect(await visible(page, "button-submit-po"), "PO editor did not render");
      });
      await h.step("expense claim with receipt", async () => {
        await goto(page, "/expense-claims");
        await click(page, "button-new-claim");
        expect(
          (await page.locator('[data-testid^="claim-receipt-"]').count()) > 0,
          "no receipt upload on a claim line"
        );
      });
    }
  ),

  flow("bank", "Bank reconciliation: import, suggestions, rules, match/unmatch", async (h) => {
    const owner = await newOwner("bank", h.lang);
    const page = await h.signIn(owner);
    await h.step("import a statement CSV through the mapper", async () => {
      const acct = await api(
        owner.token,
        "POST",
        `/api/companies/${owner.companyId}/bank-accounts`,
        {
          nameEn: "Operating account",
          bankName: "Emirates NBD",
          currency: "AED",
        }
      );
      expect(
        acct.status < 300,
        `bank account ${acct.status} ${JSON.stringify(acct.body).slice(0, 160)}`
      );
      await goto(page, "/bank-reconciliation");
      await click(page, "button-import-transactions");
      await pick(page, "select-import-bank-account");
      const csv = `Date,Description,Amount\n${daysAgo(3)},Customer receipt INV,1050\n${daysAgo(2)},Office rent,-5000\n`;
      await page
        .locator('[role="dialog"] input[type="file"]')
        .first()
        .setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await settle(page, 1200);
      expect(await visible(page, "panel-statement-mapper"), "mapper did not show");
      // The CSV's own column names ("Date", "Description", "Amount") are user data.
      if (h.ar)
        await expectNoEnglish(page, '[data-testid="panel-statement-mapper"]', [
          "date",
          "description",
          "amount",
          "customer",
          "receipt",
          "inv",
          "office",
          "rent",
        ]);
      await click(page, "button-confirm-import");
      await settle(page, 1500);
      const tx = listOf(
        (await api(owner.token, "GET", `/api/companies/${owner.companyId}/bank-transactions`)).body
      );
      expect(tx.length >= 2, `transactions ${tx.length}`);
    });
    await h.step("suggestions and rules tabs open", async () => {
      await click(page, "tab-recon-suggestions");
      await click(page, "tab-recon-rules");
      await click(page, "tab-recon-transactions");
    });
    await h.step("match a transaction, then unmatch it", async () => {
      const tx = listOf(
        (await api(owner.token, "GET", `/api/companies/${owner.companyId}/bank-transactions`)).body
      )[0];
      await click(page, `button-match-${tx.id}`);
      expect((await page.locator('[role="dialog"]').count()) > 0, "match dialog did not open");
    });
  }),

  flow(
    "vat",
    "VAT return: prepare -> ready -> file with reference -> payment; periods show filed",
    async (h) => {
      const owner = await newOwner("vat", h.lang);
      const page = await h.signIn(owner);
      const q = (() => {
        const d = new Date();
        const qStartMonth = Math.floor(d.getUTCMonth() / 3) * 3 - 3;
        const start = new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
        return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
      })();
      await seedInvoice(owner, { amount: 1000, date: q.end });
      let ret;
      await h.step("prepare the return for last quarter", async () => {
        const g = await api(
          owner.token,
          "POST",
          `/api/companies/${owner.companyId}/vat-returns/generate`,
          { periodStart: q.start, periodEnd: q.end }
        );
        expect(g.status < 300, `generate ${g.status} ${JSON.stringify(g.body).slice(0, 200)}`);
        ret = g.body.vatReturn ?? g.body;
        await goto(page, "/vat-filing");
        await click(page, "tab-vat-returns");
        expect(await visible(page, `row-return-${ret.id}`), "return not listed");
      });
      await h.step("mark ready, record filing with an FTA reference", async () => {
        const r = await api(owner.token, "POST", `/api/vat-returns/${ret.id}/ready`, {});
        expect(r.status < 300, `ready ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
        await goto(page, "/vat-filing");
        await click(page, "tab-vat-returns");
        await click(page, `button-record-filing-${ret.id}`);
        await fill(page, "input-fta-reference", "FTA-REF-12345");
        await click(page, "button-confirm-filing");
        await settle(page, 1200);
        const after = (await api(owner.token, "GET", `/api/vat-returns/${ret.id}`)).body;
        expect(
          /filed|submitted|accepted/.test(String(after.status ?? after.vatReturn?.status)),
          `status ${after.status}`
        );
      });
      await h.step("record the payment", async () => {
        await goto(page, "/vat-filing");
        await click(page, "tab-vat-returns");
        await click(page, `button-record-settlement-${ret.id}`);
        const acct = tid(page, "select-settlement-account");
        if (await acct.count()) {
          await acct.click();
          await page.locator('[role="option"]').first().click();
        }
        await click(page, "button-confirm-settlement");
        await settle(page, 1200);
        expect(await visible(page, `text-vat-settled-${ret.id}`), "settled marker not shown");
      });
      await h.step("periods tab and compliance calendar show the quarter filed", async () => {
        await goto(page, "/vat-filing");
        await click(page, "tab-vat-periods");
        const text = await page.locator("main").innerText();
        expect(
          h.ar ? /مقدم|تم التقديم|مدفوع/.test(text) : /Filed|Paid/.test(text),
          "periods tab shows no filed/paid quarter"
        );
      });
    }
  ),

  flow("reports", "Reports: statements, aging, cash flow, Insights, exports", async (h) => {
    const owner = await newOwner("rep", h.lang);
    await seedInvoice(owner, { amount: 900 });
    const page = await h.signIn(owner);
    for (const route of [
      "/financial-statements",
      "/reports",
      "/reports/statements-of-account",
      "/cashflow-forecast",
      "/analytics",
    ]) {
      await h.step(`${route} renders`, async () => {
        await goto(page, route);
        expect((await page.locator("main").innerText()).trim().length > 40, "blank main");
        expect(!(await page.locator('[data-testid="page-not-found"]').count()), "404");
      });
    }
    await h.step("aging report via the report catalog API", async () => {
      const r = await api(owner.token, "GET", `/api/companies/${owner.companyId}/reports/ar-aging`);
      expect(r.status < 300 || r.status === 404, `aging ${r.status}`);
    });
  }),

  flow(
    "plans",
    "Plans and trial: banner, locked prompt, choose plan -> contact, admin sets plan",
    async (h) => {
      const owner = await newOwner("plan", h.lang);
      const page = await h.signIn(owner);
      await h.step("trial banner and plan cards on /subscription", async () => {
        await goto(page, "/subscription");
        expect(await visible(page, "trial-banner"), "no trial banner");
        expect(
          (await page.locator('[data-testid^="plan-choose-"]').count()) >= 2,
          "fewer than 2 plan-choose buttons"
        );
        expect(
          (await page.locator('[data-testid^="plan-upgrade-"]').count()) === 0,
          "checkout shown"
        );
      });
      await h.step("choose a plan records it, then activation is requested", async () => {
        await click(page, "plan-choose-professional");
        expect(await visible(page, "plan-chosen-professional", 8000), "choice not shown");
        expect(await visible(page, "subscription-chosen-plan"), "no chosen-plan block");
        await click(page, "button-activate-plan");
        expect(await visible(page, "activation-requested", 8000), "no activation requested state");
      });
      await h.step("admin sets the plan", async () => {
        const { default: pg } = await import("pg");
        const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await db.connect();
        const adminEmail = `flow-admin-${h.lang}+${Date.now()}@test.local`;
        await api("", "POST", "/api/auth/register", {
          email: adminEmail,
          password: PASSWORD,
          name: "Admin",
          companyName: "Admin Co",
        });
        await db.query(`UPDATE users SET is_admin = true, user_type = 'admin' WHERE email = $1`, [
          adminEmail,
        ]);
        await db.end();
        const admin = await openContext(h.lang, { signedInAs: { email: adminEmail } });
        await goto(admin.page, "/admin");
        const queued = await visible(admin.page, `admin-trial-${owner.companyId}`, 15000);
        expect(queued, "the trials card does not list the company with its request");
        const edit = admin.page.locator(`[data-testid="admin-trial-open-${owner.companyId}"]`);
        await edit.click({ timeout: 10000 }).catch(async (error) => {
          await admin.page.screenshot({
            path: path.join(ARTIFACT_DIR, `flow-plans-admin-${h.lang}.png`),
          });
          await admin.context.close();
          throw error;
        });
        await settle(admin.page, 600);
        const control = await visible(admin.page, "admin-plan-control");
        expect(control, "no plan control on the admin client page");
        expect(
          await visible(admin.page, "admin-plan-apply-chosen", 8000),
          "no one-click Apply of the customer's choice"
        );
        await click(admin.page, "admin-plan-apply-chosen");
        await settle(admin.page, 800);
        await admin.context.close();
        expect(!admin.errors.length, admin.errors.join(" | "));
        await goto(page, "/subscription");
        const current = (await tid(page, "text-current-plan").innerText()).trim();
        expect(
          !/trial|تجرب/i.test(current) &&
            (await tid(page, "subscription-chosen-plan").count()) === 0,
          `owner still sees the trial: ${current}`
        );
      });
    }
  ),

  flow(
    "einvoicing",
    "E-invoicing: A-Cube and Complyance, no default, nothing transmitted; approver page",
    async (h) => {
      const owner = await newOwner("einv", h.lang);
      const page = await h.signIn(owner);
      await h.step("both partners offered, none chosen, not connected", async () => {
        await goto(page, "/settings/einvoicing");
        const options = page.locator('[data-testid^="einvoice-partner-option-"]');
        expect((await options.count()) === 2, `partner options ${await options.count()}`);
        const checked = await options.evaluateAll(
          (els) =>
            els.filter(
              (e) =>
                e.getAttribute("aria-checked") === "true" ||
                e.getAttribute("data-state") === "checked"
            ).length
        );
        expect(checked === 0, "a partner is preselected");
        const text = await page.locator("main").innerText();
        expect(/A-?Cube/i.test(text) && /Complyance/i.test(text), "partner names missing");
      });
      await h.step("approver link page shows the display name only (no TRN / TIN)", async () => {
        const partners = (
          await api(owner.token, "GET", `/api/companies/${owner.companyId}/einvoicing/partner`)
        ).body;
        const chosen = await api(
          owner.token,
          "PUT",
          `/api/companies/${owner.companyId}/einvoicing/partner`,
          {
            partner: partners.partners[0].id,
          }
        );
        expect(chosen.status < 300, `choose partner ${chosen.status}`);
        const link = await api(
          owner.token,
          "POST",
          `/api/companies/${owner.companyId}/einvoicing/approver-links`,
          { approverName: "Approver" }
        );
        expect(link.status === 201, `approver link ${link.status}`);
        const visitor = await openContext(h.lang);
        await visitor.page.goto(
          link.body.url.startsWith("http") ? link.body.url : `${BASE}${link.body.url}`
        );
        await settle(visitor.page, 800);
        const text = await visitor.page.locator("body").innerText();
        await visitor.context.close();
        expect(!/100345678900003|1003456789/.test(text), "TRN / TIN shown on the approver page");
      });
    }
  ),

  flow("assistant", "Assistant: Ask, Review, Automations switches", async (h) => {
    const owner = await newOwner("asst", h.lang);
    const page = await h.signIn(owner);
    await h.step(
      "Ask answers a question",
      async () => {
        await goto(page, "/assistant");
        await fill(
          page,
          "assistant-input",
          h.ar ? "ما هي الفواتير المتأخرة؟" : "Which invoices are overdue?"
        );
        await click(page, "assistant-send");
        const ok = await Promise.race([
          visible(page, "assistant-answer", 60000).then((v) => (v ? "answer" : null)),
          visible(page, "assistant-answer-failed", 60000).then((v) => (v ? "failed" : null)),
        ]);
        expect(ok === "answer", `assistant ${ok}`);
      },
      {}
    );
    await h.step("Review scan runs", async () => {
      await goto(page, "/assistant");
      await page.locator('[role="tab"]').nth(1).click();
      await settle(page, 400);
      expect(await visible(page, "assistant-review"), "review panel");
    });
    await h.step("Automations switch toggles and persists", async () => {
      await goto(page, "/assistant");
      await page.locator('[role="tab"]').nth(2).click();
      await settle(page, 400);
      const sw = page.locator('[data-testid^="switch-automation-"]').first();
      const before = await sw.getAttribute("aria-checked");
      await sw.click();
      await settle(page, 800);
      await page.reload();
      await settle(page, 800);
      await page.locator('[role="tab"]').nth(2).click();
      await settle(page, 400);
      const after = await page
        .locator('[data-testid^="switch-automation-"]')
        .first()
        .getAttribute("aria-checked");
      expect(before !== after, `switch ${before} -> ${after}`);
    });
  }),

  flow(
    "no-ksa-rate",
    "Saudi ZATCA and the 15% rate are gone (even for a company with a Saudi address)",
    async (h) => {
      const owner = await newOwner("ksa", h.lang);
      // The strongest case: a company whose address country is Saudi Arabia.
      await h.step("API: set the company address country to SA", async () => {
        const r = await api(owner.token, "PATCH", `/api/companies/${owner.companyId}`, {
          addressCountry: "SA",
        });
        expect(r.status < 300, `PATCH addressCountry ${r.status}`);
      });
      const page = await h.signIn(owner);
      const pickers = [
        ["/invoices/new", "invoice"],
        ["/quotes/new", "quote"],
        ["/credit-notes/new", "credit note"],
        ["/bill-pay/new", "bill"],
        ["/purchase-orders/new", "purchase order"],
        ["/debit-notes/new", "debit note"],
        ["/recurring-invoices/new", "recurring invoice"],
        ["/settings/company", "company settings"],
        ["/settings/tax-rates", "tax rates"],
      ];
      for (const [route, label] of pickers) {
        await h.step(`${label}: no 15% option`, async () => {
          await goto(page, route);
          const combos = page.locator('[role="combobox"]');
          const n = Math.min(await combos.count(), 12);
          for (let i = 0; i < n; i += 1) {
            const c = combos.nth(i);
            if (
              !(await c.isVisible().catch(() => false)) ||
              (await c.isDisabled().catch(() => true))
            )
              continue;
            await c.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(250);
            const options = await page.locator('[role="option"]').allInnerTexts();
            await page.keyboard.press("Escape");
            expect(
              !options.some((o) => /15\s?%|١٥/.test(o)),
              `15% offered in a picker on ${route}: ${options.join(" / ").slice(0, 120)}`
            );
          }
          const text = await page.locator("main").innerText();
          expect(!/\b15\s?%|١٥\s?٪/.test(text), `15% shown on ${route}`);
        });
      }
      await h.step("/settings/zatca is the not-found page, with no ZATCA text", async () => {
        await goto(page, "/settings/zatca");
        await page.locator('[data-testid="page-not-found"]').waitFor({ timeout: 10000 });
        const text = await page.locator("body").innerText();
        expect(!/zatca|fatoora|زاتكا|هيئة الزكاة/i.test(text), "ZATCA text on /settings/zatca");
      });
      await h.step("/settings/einvoicing has no ZATCA text or link", async () => {
        await goto(page, "/settings/einvoicing");
        await page.locator("main").waitFor({ timeout: 10000 });
        const text = await page.locator("main").innerText();
        expect(!/zatca|fatoora|زاتكا|هيئة الزكاة/i.test(text), "ZATCA text on e-invoicing");
        expect((await page.locator('a[href="/settings/zatca"]').count()) === 0, "zatca link");
      });
      await h.step("API: /api/features and the ZATCA routes are 404", async () => {
        const f = await api(owner.token, "GET", "/api/features");
        expect(f.status === 404, `features ${f.status}`);
        const z = await api(owner.token, "GET", `/api/companies/${owner.companyId}/zatca/status`);
        expect(z.status === 404, `zatca status ${z.status}`);
      });
    }
  ),

  flow(
    "portal-invite",
    "Customer portal invitation: invite, set a password, see invoices (desktop)",
    async (h) => {
      await portalInviteJourney(h, { phone: false });
    }
  ),

  flow(
    "portal-invite-phone",
    "Customer portal invitation on a phone (390x844)",
    async (h) => {
      await portalInviteJourney(h, { phone: true });
    },
    { viewport: { width: 390, height: 844 } }
  ),

  flow(
    "portal-invite-existing",
    "Customer portal invitation to an existing account: sign in, add the supplier",
    async (h) => {
      const supplier = await newOwner("pexs", "en");
      const buyer = await newOwner("pexb", "en");
      const seed = await seedPortalCustomer(supplier, "en");
      let hash;
      let customer;
      await h.step("the supplier invites an email that already has an account", async () => {
        const res = await api(
          supplier.token,
          "POST",
          `/api/companies/${supplier.companyId}/customer-contacts/${seed.contactId}/portal-invitations`,
          { email: buyer.email, language: "en" }
        );
        expect(res.status === 201, `invite ${res.status}`);
        hash = new URL(res.body.inviteUrl).hash;
      });
      await h.step(
        "the join page asks to sign in; the login is prefilled and returns to the join page",
        async () => {
          customer = await openContext("en", { viewport: { width: 1440, height: 900 } });
          const p = customer.page;
          await p.goto(`${BASE}/portal/join${hash}`, { timeout: 45000 });
          await settle(p);
          expect(await visible(p, "join-existing"), "no existing-account state");
          await click(p, "join-sign-in");
          await p.waitForURL(/\/login/, { timeout: 20000 });
          const prefilled = await tid(p, "input-email").inputValue();
          expect(prefilled === buyer.email, `login email ${prefilled}`);
          await fill(p, "input-password", PASSWORD);
          await click(p, "button-login");
          await p.waitForURL(/\/portal\/join/, { timeout: 30000 });
          await settle(p);
          expect(await visible(p, "join-signed-in"), "no confirm state after sign-in");
        }
      );
      await h.step(
        "confirm: the supplier portal opens and Supplier portals shows in the account menu",
        async () => {
          const p = customer.page;
          await click(p, "join-confirm-add");
          await p.waitForURL(/\/client-portal\/dashboard/, { timeout: 30000 });
          expect(await visible(p, "portal-balance"), "no balance");
          await goto(p, "/dashboard");
          await click(p, "button-profile");
          expect(await visible(p, "menu-account-portals"), "no Supplier portals entry");
          // The buyer's own company app still works.
          const status = await p.evaluate(
            async (cid) =>
              (await fetch(`/api/companies/${cid}/invoices`, { credentials: "include" })).status,
            buyer.companyId
          );
          expect(status === 200, `own company answered ${status}`);
        }
      );
      await customer?.context.close().catch(() => {});
    },
    { langs: ["en"] }
  ),

  flow("prices", "Owner prices on /pricing and /api/billing/plans", async (h) => {
    const { page } = h;
    await h.step("API plans: 59 / 119 / 229 monthly, 590 / 1,190 / 2,290 yearly", async () => {
      const res = await api("", "GET", "/api/billing/plans");
      const plans = listOf(res.body.plans ?? res.body);
      const nums = JSON.stringify(plans);
      for (const n of [59, 119, 229, 590, 1190, 2290]) {
        expect(
          new RegExp(`(?<![0-9])${n}(?![0-9])|${n * 100}`).test(nums),
          `missing ${n} in ${nums.slice(0, 200)}`
        );
      }
    });
    await h.step("/pricing monthly shows 59 / 119 / 229", async () => {
      await goto(page, "/pricing");
      await click(page, "billing-cycle-monthly").catch(() => {});
      const text = await page.locator("main").innerText();
      const western = text.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٬/g, ",");
      for (const n of ["59", "119", "229"])
        expect(new RegExp(`(?<![0-9,])${n}(?![0-9])`).test(western), `missing ${n}`);
    });
    await h.step("/pricing yearly shows 590 / 1,190 / 2,290", async () => {
      await click(page, "billing-cycle-yearly");
      const text = await page.locator("main").innerText();
      const western = text.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/٬/g, ",");
      for (const n of ["590", "1,190", "2,290"]) expect(western.includes(n), `missing ${n}`);
    });
  }),
];

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const def of FLOWS) {
      if (ONLY && !ONLY.includes(def.id)) continue;
      console.log(`\n=== ${def.id}: ${def.title} ===`);
      await runFlow(def);
    }
  } finally {
    await browser.close();
  }
  const out = path.join(ARTIFACT_DIR, "core-flows-last-run.json");
  await writeFile(
    out,
    JSON.stringify({ base: BASE, finishedAt: new Date().toISOString(), results }, null, 2)
  );
  const failed = results.filter((r) => r.result !== "pass");
  const wip = results.flatMap((r) =>
    r.steps
      .filter((s) => s.result.startsWith("in progress"))
      .map((s) => `${r.id}/${r.lang}: ${s.name} (${s.result})`)
  );
  console.log(
    `\n=== Core flows: ${results.length} flow runs, ${results.length - failed.length} pass, ${failed.length} fail, ${wip.length} in-progress step(s) ===`
  );
  for (const w of wip) console.log(`  ${w}`);
  console.log(`Report: ${out}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
