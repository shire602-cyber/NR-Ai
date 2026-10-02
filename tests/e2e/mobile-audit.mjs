#!/usr/bin/env node
/* 375 px audit of the 25 most used screens, in English and Arabic.
 *
 * LOCAL / DEV ONLY: it signs in as a test user and, with --seed (default), creates a
 * few demo records (contact, invoice, journal entry) so detail screens have data.
 *
 * Checks per screen (viewport 375x812):
 *   overflow   no horizontal page scroll (content wider than the viewport that is not
 *              inside its own scroll container)
 *   targets    interactive elements are at least 24x24 CSS px (WCAG 2.5.8); inline text
 *              links are exempt
 *   inputs     text inputs use at least 16 px so iOS does not zoom on focus
 *   h1         exactly one visible <h1>
 *   main       a <main> landmark
 *   buttons    every visible button has an accessible name
 *   labels     every visible form field has a label (placeholder does not count)
 *   tables     a table marked `stack-table` (payroll leave/loans/settlement tabs, projects) is stacked into cards
 *              below 768 px: none may need sideways scrolling
 *
 * Env / args:
 *   BASE_URL        app URL (default http://localhost:5000)
 *   AUDIT_EMAIL / AUDIT_PASSWORD   optional: an existing user. Without them the script registers its own owner
 *                       (random credentials, never printed) and completes the company onboarding, all through the API
 *   --locales en,ar     (default both)
 *   --routes /a,/b      override the list
 *   --shots <dir>       save a screenshot per screen
 *   --extra /a,/b       audit more routes after the 25 (public ones such as /developers/api work too)
 *   --employee          also sign in as an employee-role user (invited by the AUDIT_EMAIL owner) and check the
 *                       self-service shell: own pages open, every finance route redirects to /payroll with a notice,
 *                       the menu offers no finance entries, and the employee pages pass the 375 px audit
 *   --selftest          prove the checks can fail: inject known-bad markup and expect every check to fire
 *   --no-seed           do not create demo records
 *   --json <file>       write the findings as JSON
 *   CHROMIUM_PATH       optional browser executable
 *
 * Exit code 1 when any check fails.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
let EMAIL = process.env.AUDIT_EMAIL;
let PASSWORD = process.env.AUDIT_PASSWORD;
const LOCALES = (flag("--locales") || "en,ar").split(",");
const SHOTS = flag("--shots");
const JSON_OUT = flag("--json");
const SEED = !args.includes("--no-seed");

const SCREENS = [
  ["Dashboard", "/dashboard"],
  ["Invoices", "/invoices"],
  ["Invoice create", "/invoices", { open: /new invoice|فاتورة جديدة|إنشاء فاتورة/i, dialog: true }],
  ["Public invoice", "{publicInvoice}"],
  ["Quotes", "/quotes"],
  ["Receipts", "/receipts"],
  ["Expense claims", "/expense-claims"],
  ["Bills", "/bill-pay"],
  ["Contacts", "/contacts"],
  ["Inventory", "/inventory"],
  ["Journal", "/journal"],
  ["Journal entry", "{journalEntry}"],
  ["Chart of accounts", "/chart-of-accounts"],
  ["Account ledger", "{ledger}"],
  ["Bank reconciliation", "/bank-reconciliation"],
  ["Reports", "/reports"],
  ["Financial statements", "/financial-statements"],
  ["VAT filing", "/vat-filing"],
  ["Payroll", "/payroll"],
  ["Company settings", "/settings/company"],
  ["Team", "/team"],
  ["Notifications", "/notifications"],
  ["Login", "/login", { anonymous: true }],
  ["Help centre", "/help", { anonymous: true }],
  ["Security", "/settings/security"],
  // Phase 8 D2: stacked-card tables (checked by the `tables` check); `tab` clicks the tab with that data-testid first
  ["Payroll leave", "/payroll", { tab: "tab-payroll-leave" }],
  ["Payroll loans", "/payroll", { tab: "tab-payroll-loans" }],
  ["Projects", "/projects"],
  ["Project time", "{project}", { tab: "tab-project-time" }],
];

for (const route of (flag("--extra") || "").split(",").filter(Boolean)) SCREENS.push([route, route, { anonymous: /^\/(help|developers|login)/.test(route) }]);

async function api(request, method, url, { token, data } = {}) {
  const res = await request.fetch(`${BASE}${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status(), json };
}

/** A project with time, and an employee with a leave request and a loan, so the stacked tables have rows. */
async function seedPeopleAndProjects(request, token, cid, accounts, today, out) {
  const project = await api(request, "POST", `/api/companies/${cid}/projects`, { token, data: { name: "Audit project", hourlyRate: 150 } });
  if (project.json?.id) {
    out.project = `/projects/${project.json.id}`;
    await api(request, "POST", `/api/companies/${cid}/time-entries`, { token, data: { projectId: project.json.id, entryDate: today, hours: 1.5, notes: "Audit time" } });
  }
  const year = new Date().getUTCFullYear();
  const employee = await api(request, "POST", `/api/companies/${cid}/employees`, { token, data: { fullName: "Audit Employee", nationality: "India", basicSalary: 6000, joinDate: `${year - 2}-01-01` } });
  if (!employee.json?.id) return;
  const types = (await api(request, "GET", `/api/companies/${cid}/leave-types`, { token })).json ?? [];
  const sick = types.find((t) => t.code === "sick");
  if (sick) await api(request, "POST", `/api/companies/${cid}/leave-requests`, { token, data: { employeeId: employee.json.id, leaveTypeId: sick.id, startDate: today, endDate: today } });
  const bank = accounts.find((a) => a.code === "1020");
  if (bank) {
    await api(request, "POST", `/api/companies/${cid}/employee-loans`, {
      token,
      data: { employeeId: employee.json.id, principal: 1200, instalmentCount: 12, firstPeriodYear: year + 1, firstPeriodMonth: 1, disbursementDate: today, paymentAccountId: bank.id },
    });
  }
}

async function seed(request, token) {
  const out = {};
  await api(request, "PATCH", "/api/onboarding", { token, data: { showTour: false } }); // the welcome tour would cover every screen
  const companies = (await api(request, "GET", "/api/companies", { token })).json;
  const cid = companies?.[0]?.id;
  if (!cid) return out;
  const today = new Date().toISOString().slice(0, 10);
  const accounts = (await api(request, "GET", `/api/companies/${cid}/accounts`, { token })).json ?? [];
  out.accountId = accounts[0]?.id;
  if (SEED) {
    await api(request, "POST", `/api/companies/${cid}/customer-contacts`, { token, data: { name: "Audit Customer", email: "audit@example.com" } });
    const inv = await api(request, "POST", `/api/companies/${cid}/invoices`, {
      token,
      data: { customerName: "Audit Customer", date: today, dueDate: today, lines: [{ description: "Consulting", quantity: 2, unitPrice: "500.00", vatRate: 0.05 }] },
    });
    if (inv.json?.id) {
      await api(request, "PATCH", `/api/invoices/${inv.json.id}/status`, { token, data: { status: "sent" } });
      const share = await api(request, "POST", `/api/invoices/${inv.json.id}/share`, { token });
      if (share.json?.token) out.publicInvoice = `/view/invoice/${share.json.token}`;
    }
    const cash = accounts.find((a) => a.code === "1010");
    const revenue = accounts.find((a) => a.code === "4010");
    if (cash && revenue) {
      const je = await api(request, "POST", `/api/companies/${cid}/journal`, {
        token,
        data: { date: today, status: "posted", lines: [{ accountId: cash.id, debit: 10 }, { accountId: revenue.id, credit: 10 }] },
      });
      if (je.json?.id) out.journalEntry = `/journal/${je.json.id}`;
    }
  }
  if (!out.journalEntry) {
    const list = (await api(request, "GET", `/api/companies/${cid}/journal`, { token })).json;
    const first = Array.isArray(list) ? list[0] : list?.entries?.[0];
    if (first?.id) out.journalEntry = `/journal/${first.id}`;
  }
  if (out.accountId) out.ledger = `/accounts/${out.accountId}/ledger`;
  if (SEED) await seedPeopleAndProjects(request, token, cid, accounts, today, out);
  return out;
}

/** Runs inside the page. Returns findings per check. */
function auditInPage() {
  const vw = window.innerWidth;
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"]')) return false; // hidden from assistive tech (e.g. Radix's form-bubble <select>)
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    const hint = [el.getAttribute("data-testid") && `data-testid=${el.getAttribute("data-testid")}`, el.getAttribute("placeholder") && `placeholder="${el.getAttribute("placeholder")}"`, el.getAttribute("type") && `type=${el.getAttribute("type")}`]
      .filter(Boolean)
      .join(" ");
    return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}${hint ? ` [${hint}]` : ""}`;
  };
  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth - 1 && p.getBoundingClientRect().right <= vw + 1) return true;
      if (getComputedStyle(p).position === "fixed") return true;
    }
    return false;
  };

  const findings = { overflow: [], targets: [], inputs: [], h1: [], main: [], buttons: [], labels: [], tables: [] };

  // A table that is meant to stack into cards on a phone must not need sideways scrolling inside its own box.
  for (const box of document.querySelectorAll(".stack-table")) {
    if (!visible(box)) continue;
    const table = box.querySelector("table");
    const boxes = [box, ...box.querySelectorAll(":scope > div")];
    const wide = boxes.find((el) => el.scrollWidth > el.clientWidth + 1);
    if (wide) findings.tables.push(`${describe(table ?? box)} scrolls sideways (${wide.scrollWidth}px in ${wide.clientWidth}px)`);
  }

  const doc = document.documentElement;
  if (doc.scrollWidth > vw + 1) {
    const culprits = [...document.body.querySelectorAll("*")]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 1 && !inScroller(el))
      .slice(0, 4)
      .map(describe);
    findings.overflow.push(`page is ${doc.scrollWidth}px wide in a ${vw}px viewport${culprits.length ? `: ${culprits.join(" | ")}` : ""}`);
  }

  const interactive = [...document.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], input:not([type="hidden"]), select, textarea')].filter(visible);
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    if (tag === "input" && /(checkbox|radio)/.test(el.type) && !el.closest("label") && r.width < 24) {
      // native checkboxes are padded by their label; only flag stand-alone ones
    }
    // Exempt: a link inside a sentence (WCAG 2.5.8 "inline"), and an anchor that wraps a real button (the button is the target).
    const ownText = (el.textContent || "").trim().length;
    const parentText = (el.parentElement?.textContent || "").trim().length;
    const inlineLink = tag === "a" && (el.querySelector("button") || (getComputedStyle(el).display === "inline" && parentText > ownText + 3));
    if (!inlineLink && (r.width < 24 || r.height < 24) && !el.closest('[aria-hidden="true"]') && !el.classList.contains("sr-only")) {
      findings.targets.push(`${describe(el)} is ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (!visible(el)) continue;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["checkbox", "radio", "file", "hidden", "range", "color", "button", "submit"].includes(type)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) findings.inputs.push(`${describe(el)} uses ${size}px`);
  }

  if (document.querySelector('[role="dialog"][data-state="open"]')) findings.main.push("a dialog is open over the page, so the audit cannot see it");
  const h1s = [...document.querySelectorAll("h1")].filter(visible);
  if (h1s.length !== 1) findings.h1.push(`${h1s.length} visible h1 elements`);
  if (!document.querySelector("main, [role=main]")) findings.main.push("no <main> landmark");

  const nameOf = (el) => {
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return true;
    if (el.closest("label")) return true;
    if (el.getAttribute("aria-label")?.trim() || el.getAttribute("title")?.trim()) return true;
    const by = el.getAttribute("aria-labelledby");
    if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
    if ((el.textContent || "").trim()) return true;
    if (el.querySelector("img[alt]:not([alt=''])") || el.querySelector("svg title")) return true;
    return false;
  };
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    if (visible(el) && !nameOf(el)) findings.buttons.push(describe(el) || "unnamed button");
  }

  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (!visible(el)) continue;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "button", "submit", "reset", "image"].includes(type)) continue;
    const labelled =
      el.getAttribute("aria-label")?.trim() ||
      el.getAttribute("title")?.trim() ||
      (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent?.trim()) ||
      el.closest("label") ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
    if (!labelled) findings.labels.push(`${describe(el)} has no label`);
  }
  return findings;
}

const EMPLOYEE_ALLOWED = [
  ["Employee dashboard", "/dashboard", "[data-testid=employee-dashboard]"],
  ["Employee payroll", "/payroll", null],
  ["Employee leave", "/payroll?tab=leave", null],
  ["Employee loans", "/payroll?tab=loans", null],
  ["Employee expense claims", "/expense-claims", null],
  ["Employee security", "/settings/security", null],
];
const FINANCE_ROUTES = ["/invoices", "/quotes", "/bill-pay", "/journal", "/chart-of-accounts", "/reports", "/vat-filing", "/contacts", "/inventory", "/bank-reconciliation", "/settings/company", "/team", "/settings/data", "/import", "/developer-settings", "/approvals", "/financial-statements"];

/** Returns the number of failed expectations. */
async function employeeAudit(browser, ownerRequest) {
  let failed = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  [employee] ${name}${ok ? "" : ` ${detail}`}`);
    if (!ok) failed++;
  };
  const login = await ownerRequest.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  const owner = await login.json();
  const companies = (await api(ownerRequest, "GET", "/api/companies", { token: owner.token })).json;
  const cid = companies?.[0]?.id;
  const empEmail = `audit-employee-${Date.now()}@example.com`;
  const empPassword = `Aud1t-${Math.random().toString(36).slice(2)}Xx9`;
  const regContext = await browser.newContext(); // its own cookie jar: a session cookie would outrank the owner's Bearer token
  const reg = await regContext.request.post(`${BASE}/api/auth/register`, { data: { name: "Audit Employee", email: empEmail, password: empPassword } });
  const invite = await api(ownerRequest, "POST", `/api/companies/${cid}/team/invite`, { token: owner.token, data: { email: empEmail, role: "employee" } });
  await regContext.close();
  check("employee user invited", reg.ok() && invite.status === 201, `register ${reg.status()} invite ${invite.status} ${JSON.stringify(invite.json)}`);
  if (!invite.json) return failed + 1;

  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["375px", { width: 375, height: 812 }]]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    await context.addInitScript((id) => {
      try {
        localStorage.setItem("muhasib_active_company_id", id);
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "en" }, version: 0 }));
      } catch {
        /* storage blocked */
      }
    }, cid);
    const res = await context.request.post(`${BASE}/api/auth/login`, { data: { email: empEmail, password: empPassword } });
    const body = await res.json();
    await api(context.request, "PATCH", "/api/onboarding", { token: body.token, data: { showTour: false } });
    const page = await context.newPage();
    const forbiddenCalls = [];
    page.on("response", (r) => {
      if (r.status() === 403 && r.url().includes("/api/")) forbiddenCalls.push(new URL(r.url()).pathname);
    });

    for (const [name, route, marker] of EMPLOYEE_ALLOWED) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForSelector("h1", { timeout: 4000 }).catch(() => undefined);
      const path = new URL(page.url()).pathname;
      const dialog = await page.locator('[role="dialog"][data-state="open"]').count();
      check(`${label}: ${name} opens`, path === new URL(route, BASE).pathname && (!marker || (await page.locator(marker).count()) === 1) && dialog === 0, `${path} dialogs=${dialog} dialogText=${dialog ? (await page.locator('[role="dialog"]').first().innerText()).slice(0, 80) : ""}`);
      if (route === "/expense-claims") {
        const review = await page.getByRole("tab", { name: /review/i }).count();
        const approve = await page.locator('button[title="Approve"], button[title="Reject"], button[title="Mark as paid"]').count();
        check(`${label}: expense claims hide the Review tab and approve/reject/pay controls`, review === 0 && approve === 0, `review tabs ${review}, controls ${approve}`);
      }
      if (label === "375px") {
        const findings = await page.evaluate(auditInPage);
        const n = Object.values(findings).reduce((t, l) => t + l.length, 0);
        check(`375 px audit: ${name}`, n === 0, JSON.stringify(findings));
      }
    }

    forbiddenCalls.length = 0;
    for (const route of FINANCE_ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(300);
      const url = new URL(page.url());
      const noticed = (await page.locator("[data-testid=notice-role-redirect]").count()) === 1;
      check(`${label}: ${route} redirects to /payroll with a notice`, url.pathname === "/payroll" && noticed, url.pathname + url.search);
    }
    check(`${label}: the redirected finance screens fired no refused API calls`, forbiddenCalls.length === 0, [...new Set(forbiddenCalls)].join(", "));

    if (label === "desktop") {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
      const offered = await page.$$eval("aside a[href], [data-sidebar] a[href]", (as) => as.map((a) => a.getAttribute("href")));
      const financeLinks = offered.filter((h) => h && FINANCE_ROUTES.includes(h.split("?")[0]));
      check("menu offers no finance entries", financeLinks.length === 0, financeLinks.join(", "));
      check("menu offers payroll, leave, loans, account and help", ["/payroll", "/payroll?tab=leave", "/payroll?tab=loans", "/expense-claims", "/settings/security", "/help"].every((h) => offered.includes(h)), offered.join(", "));
    }
    await context.close();
  }
  return failed;
}

async function selftest() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await page.setContent(`<body><div style="width:900px;height:20px">too wide</div><button style="width:10px;height:10px;padding:0"></button>
    <input style="font-size:12px" placeholder="x"><h1>a</h1><h1>b</h1><img src="data:," alt=""><select></select>
    <div class="stack-table" style="overflow-x:auto;width:200px"><table style="width:600px"><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table></div></body>`);
  const f = await page.evaluate(auditInPage);
  const expected = ["overflow", "targets", "inputs", "h1", "main", "buttons", "labels", "tables"];
  const missing = expected.filter((k) => f[k].length === 0);
  console.log(missing.length ? `SELFTEST FAIL: no finding for ${missing.join(", ")}` : "SELFTEST PASS: every check fires on known-bad markup");
  await browser.close();
  process.exit(missing.length ? 1 : 0);
}

async function main() {
  if (args.includes("--selftest")) return selftest();
  if (!EMAIL || !PASSWORD) {
    // Self-seeding: a throwaway owner with a random password, so nothing secret is needed in the environment.
    const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    EMAIL = `audit-owner-${stamp}@example.com`;
    PASSWORD = `Aud1t-${crypto.randomBytes(9).toString("hex")}Xx`;
    const reg = await fetch(`${BASE}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Audit Owner", email: EMAIL, password: PASSWORD }) });
    const body = await reg.json().catch(() => ({}));
    if (!reg.ok || !body.token || !body.company?.id) {
      console.error(`could not register an audit owner (${reg.status}). Is BASE_URL a running dev server?`);
      process.exit(2);
    }
    await fetch(`${BASE}/api/companies/${body.company.id}/onboarding/complete`, { method: "POST", headers: { Authorization: `Bearer ${body.token}` } });
    console.log("Registered a throwaway audit owner and completed its onboarding.");
  }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
  const results = [];
  let failures = 0;

  for (const locale of LOCALES) {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.addInitScript((l) => {
      try {
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
        localStorage.setItem("onboarding_tour_dismissed", "true");
      } catch {
        /* storage blocked */
      }
    }, locale);
    const page = await context.newPage();
    const login = await context.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
    const loginBody = await login.json().catch(() => ({}));
    if (!login.ok() || !loginBody.token) {
      console.error(`login failed (${login.status()})`);
      process.exit(2);
    }
    const ids = await seed(context.request, loginBody.token);

    const only = flag("--routes")?.split(",");
    for (const [name, rawRoute, opts = {}] of SCREENS) {
      const route = rawRoute.startsWith("{") ? ids[rawRoute.slice(1, -1)] : rawRoute;
      if (only && !only.some((r) => route?.startsWith(r))) continue;
      if (!route) {
        results.push({ locale, name, skipped: "no data to open this screen" });
        console.log(`SKIP  [${locale}] ${name}: no data to open this screen`);
        continue;
      }
      const target = opts.anonymous ? await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }) : null;
      let p = page;
      if (target) {
        await target.addInitScript((l) => localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 })), locale);
        p = await target.newPage();
      }
      try {
        await p.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => undefined);
        await p.waitForSelector("h1", { timeout: 4000 }).catch(() => undefined); // let the page finish loading before auditing
        await p.waitForTimeout(500);
        // The first-run welcome dialog opens over whichever screen is current and hides the page from the audit.
        // Dismiss it the way a user does (it is not what is being audited).
        const skip = p.getByTestId("button-skip-onboarding");
        if (await skip.count()) {
          await skip.first().click().catch(() => undefined);
          await p.waitForTimeout(400);
        }
        if (opts.tab) {
          const tab = p.getByTestId(opts.tab).first();
          if (await tab.count()) {
            await tab.click().catch(() => undefined);
            await p.waitForTimeout(700);
          }
        }
        if (opts.open) {
          const button = p.getByRole("button", { name: opts.open }).first();
          if (await button.count()) {
            await button.click().catch(() => undefined);
            await p.waitForTimeout(700);
          }
        }
        const findings = await p.evaluate(auditInPage);
        // A modal dialog marks the page behind it aria-hidden, so the page heading and landmark are not visible to the audit.
        if (opts.dialog) {
          findings.h1 = [];
          findings.main = [];
        }
        const count = Object.values(findings).reduce((n, list) => n + list.length, 0);
        failures += count;
        results.push({ locale, name, route, findings });
        console.log(`${count === 0 ? "PASS" : "FAIL"}  [${locale}] ${name} ${route}`);
        for (const [check, list] of Object.entries(findings)) for (const f of list.slice(0, 6)) console.log(`        ${check}: ${f}`);
        if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `${locale}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`), fullPage: false });
      } catch (error) {
        failures++;
        results.push({ locale, name, route, crash: String(error).slice(0, 200) });
        console.log(`FAIL  [${locale}] ${name} ${route}: ${String(error).slice(0, 120)}`);
      } finally {
        if (target) await target.close();
      }
    }
    await context.close();
  }
  if (args.includes("--employee")) {
    const ownerContext = await browser.newContext();
    failures += await employeeAudit(browser, ownerContext.request);
    await ownerContext.close();
  }
  await browser.close();
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  const total = results.filter((r) => !r.skipped).length;
  console.log(`\n${total} screen run(s), ${failures} finding(s).`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(2);
});
