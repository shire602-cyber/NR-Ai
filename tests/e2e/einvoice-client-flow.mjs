#!/usr/bin/env node
/**
 * Per-client e-invoicing: the send flow, the EmaraTax approval flow and the bilingual approver
 * e-mail, from a client's books (NR firm staff via "Open books", and the company owner), on
 * iPhone 13, a 360 px Android and 1440x900, in English and Arabic.
 *
 *   BASE_URL=http://localhost:5077 DATABASE_URL=postgres://... node tests/e2e/einvoice-client-flow.mjs
 *
 * Needs a running production build (FRONTEND_URL = BASE_URL), local only. It registers synthetic
 * users through the API (a company owner, an NR firm owner and a firm preparer; firm roles are
 * written through DATABASE_URL), a client company with a tax identity, a customer without an
 * e-invoicing endpoint or address, and sent invoices. No provider is configured (no credentials
 * exist), so the flow must explain what is needed and never pretend to send. Per screen:
 *   - 0 console errors, 0 failed requests (the intended refusals are declared), no horizontal
 *     overflow, `<html lang dir>`, an h1, no raw catalog keys, 44 px phone targets, axe
 *     serious/critical = 0, and in Arabic no English text nodes;
 * and flow assertions:
 *   - settings (identity, scope, the two accredited providers, none pre-selected, "not
 *     connected" with what is needed), the invoice list cell and sheet ("not sent", the
 *     set-up link), generate answering 422 with EINVOICE_BUYER_ENDPOINT_MISSING and
 *     EINVOICE_BUYER_ADDRESS_MISSING shown as localized fix text with a link to the contact,
 *     submit refused without a provider (409/422, never a fake "sent");
 *   - the approval request: partner choice, link creation, the bilingual approver e-mail (both
 *     blocks, company name only, never a TRN, absolute links, bilingual subject and text), the
 *     no-login page (company name only), done, and the outcome on the client's e-invoicing
 *     page and in the firm client list; invalid, expired, revoked and used links.
 *
 * Environment: BASE_URL (default http://localhost:5000), DATABASE_URL (required), SHOT_DIR,
 * E2E_VIEWPORTS (android,13,desktop), E2E_LANGS (en,ar), CHROMIUM_PATH (falls back to
 * /opt/pw-browsers/chromium-1243/chrome-linux64/chrome when present). Exits 1 on a failure.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright-core";
import pg from "pg";
import { classifyLines } from "./lib/latin-text.mjs";

const SHOT_DIR = process.env.SHOT_DIR || "";
const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");

const PW = "Fake-Password-123";
const RUN = Math.random().toString(36).slice(2, 8);
const CHROMIUM_FALLBACK = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (firm roles are written through the database).");
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

const VIEWPORTS = (process.env.E2E_VIEWPORTS || "android,13,desktop").split(",");
const LANGS = (process.env.E2E_LANGS || "en,ar").split(",");
const DEVICE = {
  android: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } },
  13: { ...devices["iPhone 13"] },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const failures = [];
const log = [];
let currentLabel = "";
function check(ok, message, detail) {
  const line = `${ok ? "ok  " : "FAIL"} [${currentLabel}] ${message}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`;
  log.push(line);
  console.log(line);
  if (!ok) failures.push(line);
}

const require = createRequire(import.meta.url);
let axeSource = "";
try {
  axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
} catch {
  console.warn("axe-core not installed: accessibility checks skipped");
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function api(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const OUTBOX_TRN = "100123456700003";
const DATA_ALLOW = [
  RUN,
  "Acme Owner",
  `Acme Owner Home ${RUN}`,
  "Firm Owner",
  "Firm Owner Home",
  "Desert Rose Catering",
  "FZ-LLC",
  "Audit Client",
  "Alpha",
  "Platform ACube Technologies LLC",
  "Complyance Electronics L.L.C",
  "Technologies",
  "Electronics",
  "Khalid",
  "Khalid Al Mansoori",
  "LLC",
  "Dubai",
  "English",
  "A-Cube",
  "Complyance",
  "TRN",
  "Peppol",
  "PINT AE",
  "XML",
  "PDF",
  "UBL",
  "EmaraTax",
  "FTA",
  "ASP",
  "UAE",
  "AED",
];
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ─── Data ────────────────────────────────────────────────────────────────────

async function registerUser(name, email, firmRole) {
  const reg = await api("POST", "/api/auth/register", null, {
    name,
    email,
    password: PW,
    companyName: `${name} Home ${RUN}`,
  });
  if (reg.status >= 300) throw new Error(`register ${email} failed: ${reg.status}`);
  if (firmRole)
    await db.query(`UPDATE users SET firm_role = $2 WHERE email = $1`, [email, firmRole]);
  const login = await api("POST", "/api/auth/login", null, { email, password: PW });
  const cid = (
    await db.query(
      `SELECT company_id FROM company_users WHERE user_id = (SELECT id FROM users WHERE email = $1) LIMIT 1`,
      [email]
    )
  ).rows[0]?.company_id;
  return { email, token: login.json.token, id: login.json.user?.id, companyId: cid };
}

/** A company with a complete tax identity, a customer with no endpoint/address, two sent invoices. */
async function prepareCompany(cid, token, label) {
  await db.query(
    `UPDATE companies SET trn_vat_number = $2, emirate = 'dubai', address_street = 'Sheikh Zayed Road',
       address_city = 'Dubai', trade_licence_no = 'TL-123456', einvoice_scope = 'b2b',
       einvoice_turnover_band = 'standard', onboarding_completed = true WHERE id = $1`,
    [cid, OUTBOX_TRN]
  );
  const contact = await api("POST", `/api/companies/${cid}/customer-contacts`, token, {
    name: "Desert Rose Catering FZ-LLC",
    nameAr: "ديزرت روز للتموين",
    email: `ap+${RUN}${label}@desertrose.example`,
  });
  if (contact.status >= 300) throw new Error(`contact failed ${contact.status}`);
  const ids = [];
  for (const price of [1000, 2500]) {
    const inv = await api("POST", `/api/companies/${cid}/invoices`, token, {
      contactId: contact.json.id,
      date: day(-3),
      dueDate: day(27),
      placeOfSupplyEmirate: "dubai",
      lines: [{ description: "Retainer", quantity: 1, unitPrice: price, vatRate: 0.05 }],
    });
    if (inv.status >= 300)
      throw new Error(`invoice failed ${inv.status} ${JSON.stringify(inv.json)}`);
    await api("PATCH", `/api/invoices/${inv.json.id}/status`, token, { status: "sent" });
    ids.push(inv.json.id);
  }
  // A customer with a TRN and a full address: its invoice passes validation.
  const ready = await api("POST", `/api/companies/${cid}/customer-contacts`, token, {
    name: "Palm Crest Real Estate LLC",
    nameAr: "بالم كريست العقارية",
    email: `ap+${RUN}${label}@palmcrest.example`,
    trnNumber: "100200300400003",
    emirate: "dubai",
    addressStreet: "Al Wasl Road",
    city: "Dubai",
  });
  if (ready.status >= 300) throw new Error(`ready contact failed ${ready.status}`);
  const readyInv = await api("POST", `/api/companies/${cid}/invoices`, token, {
    contactId: ready.json.id,
    date: day(-2),
    dueDate: day(28),
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Consulting", quantity: 1, unitPrice: 4000, vatRate: 0.05 }],
  });
  if (readyInv.status >= 300) throw new Error(`ready invoice failed ${readyInv.status}`);
  await api("PATCH", `/api/invoices/${readyInv.json.id}/status`, token, { status: "sent" });
  return {
    companyId: cid,
    contactId: contact.json.id,
    invoiceIds: ids,
    readyInvoiceId: readyInv.json.id,
    token,
  };
}

async function seed() {
  const owner = await registerUser("Acme Owner", `acme-owner+${RUN}@example.com`, null);
  const ownerCo = await prepareCompany(owner.companyId, owner.token, "o");
  const firm = await registerUser("Firm Owner", `firm-owner+${RUN}@example.com`, "firm_owner");
  const client = await api("POST", "/api/firm/clients", firm.token, {
    name: `Audit Client Alpha ${RUN}`,
    trnVatNumber: OUTBOX_TRN,
    emirate: "dubai",
    vatFilingFrequency: "quarterly",
  });
  if (client.status >= 300) throw new Error(`client failed ${client.status}`);
  const clientCo = await prepareCompany(client.json.id, firm.token, "f");
  return {
    owner,
    ownerCo,
    ownerName: `Acme Owner Home ${RUN}`,
    firm,
    client: { id: client.json.id, ...clientCo },
    clientName: `Audit Client Alpha ${RUN}`,
  };
}
// ─── Page checks ─────────────────────────────────────────────────────────────

async function shot(page, name) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `${currentLabel.replace(/\s+/g, "-")}-${name}.png`),
    fullPage: true,
  });
}

const RAW_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+){1,}$/;
const HEAVY_FOR_FIRM =
  /\/(reportCatalog|reportCatalogText|reportCatalogApi|adminConsole)-[\w-]+\.js/;

async function signedInContext(browser, viewport, lang, account, activeCompanyId) {
  const ctx = await browser.newContext({
    ...DEVICE[viewport],
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
  });
  await ctx.addInitScript(
    ([l, active]) => {
      try {
        localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
        localStorage.setItem("cookie-consent", "accepted");
        if (active) localStorage.setItem("muhasib_active_company_id", active);
        else localStorage.removeItem("muhasib_active_company_id");
      } catch {
        /* storage blocked */
      }
    },
    [lang, activeCompanyId ?? null]
  );
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.fill("[data-testid=input-email]", account.email);
  await page.fill("[data-testid=input-password]", PW);
  await page.click("[data-testid=button-login]");
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 });
  await page.close();
  return ctx;
}

/** Open `url` in `ctx`, run the generic checks. opts: lang, viewport, name, errorsOk, act. */
async function openScreen(ctx, url, opts) {
  const page = await ctx.newPage();
  const errors = [];
  const bad = [];
  const requests = [];
  const visited = [];
  let refused = 0;
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) =>
    bad.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`)
  );
  page.on(
    "framenavigated",
    (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname)
  );
  page.on("response", (r) => {
    const u = r.url().replace(BASE, "");
    requests.push(u);
    if (r.status() >= 400 && r.url().startsWith(BASE) && !opts.errorsOk) {
      // A declared, intended refusal (e.g. submit without a provider) is not a failed call.
      if ((opts.refusals || []).some((re) => re.test(u))) refused++;
      else bad.push(`${r.status()} ${u}`);
    }
  });
  page.removeAllListeners("requestfailed");
  page.on("requestfailed", (r) => {
    if (!opts.errorsOk) bad.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`);
  });
  if (opts.before) await opts.before(page);
  const response = await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  if (opts.act) await opts.act(page);
  if (!opts.skipH1) {
    await page
      .locator("h1")
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => undefined);
  }

  const phone = opts.viewport !== "desktop";
  const info = await page.evaluate(() => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
    };
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (
        !el ||
        /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName) ||
        el.closest("[translate=no]") ||
        !vis(el)
      )
        continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    }
    const main = document.querySelector("main") ?? document.body;
    const targets = [
      ...main.querySelectorAll(
        "a,button,input,select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=combobox]"
      ),
    ]
      .filter(
        (e) => vis(e) && !e.closest(".sr-only") && !e.hasAttribute("hidden") && e.type !== "hidden"
      )
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const inline =
          e.tagName === "A" && e.closest("p, li") && getComputedStyle(e).display === "inline";
        // A checkbox inside a 44px-tall label is a 44px target (the label is the hit area).
        const lab = e.closest("label");
        const inLabel = !!lab && lab.getBoundingClientRect().height >= 43.5;
        return !inline && !inLabel && (r.height < 43.5 || r.width < 43.5);
      })
      .map(
        (e) =>
          `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || e.getAttribute("data-testid") || "").trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`
      );
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      h1: document.querySelectorAll("h1").length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      lines,
      targets,
      path: location.pathname,
    };
  });

  let tolerated = refused;
  const realErrors = errors.filter((e) => {
    if (opts.errorsOk && /status of (4|5)\d\d|net::ERR_FAILED/.test(e)) return false;
    if (tolerated > 0 && /status of 4\d\d/.test(e)) {
      tolerated--;
      return false;
    }
    return true;
  });
  check(response?.ok(), `${opts.name}: page status ${response?.status()}`);
  check(realErrors.length === 0, `${opts.name}: 0 console errors`, realErrors);
  check(bad.length === 0, `${opts.name}: 0 failed requests`, bad);
  check(!info.overflow, `${opts.name}: no horizontal overflow`);
  check(info.lang === opts.lang, `${opts.name}: html lang=${opts.lang}`, info.lang);
  check(info.dir === (opts.lang === "ar" ? "rtl" : "ltr"), `${opts.name}: dir`, info.dir);
  if (!opts.skipH1) check(info.h1 >= 1, `${opts.name}: has an h1`, info.h1);
  const raw = info.lines.filter((l) => RAW_KEY.test(l));
  check(raw.length === 0, `${opts.name}: no raw catalog keys on screen`, raw.slice(0, 5));
  if (phone)
    check(info.targets.length === 0, `${opts.name}: 44px tap targets`, info.targets.slice(0, 6));
  if (opts.lang === "ar") {
    // Company names and e-mail addresses are seeded user data, not UI copy.
    const copy = info.lines.filter((l) => !/LLC|L\.L\.C|@|Audit Client Alpha/.test(l));
    const english = classifyLines(copy, opts.allow || []).samples;
    check(english.length === 0, `${opts.name}: no English text in Arabic`, english.slice(0, 6));
  }
  if (axeSource && !opts.skipAxe) {
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef -- injected by the axe-core script evaluated above
      const r = await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
      return r.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}:${v.nodes.length}`);
    });
    check(violations.length === 0, `${opts.name}: axe serious/critical`, violations);
  }
  if (opts.noDupes !== false) {
    // Speed: a screen asks for each API resource once (no needless or repeated requests).
    const seen = new Map();
    for (const u of requests.filter((x) => x.startsWith("/api/")))
      seen.set(u, (seen.get(u) || 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([u, n]) => `${n}x ${u.slice(0, 90)}`);
    check(dupes.length === 0, `${opts.name}: no repeated API requests`, dupes);
  }
  if (opts.firmChunks) {
    const heavy = requests.filter((u) => HEAVY_FOR_FIRM.test(u));
    check(heavy.length === 0, `${opts.name}: no report-catalog or admin chunks`, heavy);
  }
  await shot(page, opts.name.replace(/\W+/g, "-"));
  return { page, info, visited, requests };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const L = (lang, en, ar) => (lang === "ar" ? ar : en);

/** Targets (44 px) inside an open dialog/sheet on phones. */
async function dialogTargets(page, selector, name, phone) {
  await page.waitForTimeout(450); // the dialog/sheet open animation scales it
  if (!phone) return;
  const small = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["missing"];
    return [...root.querySelectorAll("a,button,input,select,textarea,[role=button]")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.height < 43.5 || r.width < 43.5);
      })
      .map(
        (e) =>
          `${e.tagName}:${(e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 20)}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`
      );
  }, selector);
  check(small.length === 0, `${name}: 44px targets`, small.slice(0, 6));
}

async function noEnglishIn(page, selector, name, lang, allow) {
  if (lang !== "ar") return;
  const lines = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (t && n.parentElement && n.parentElement.getBoundingClientRect().width > 0) out.push(t);
    }
    return out;
  }, selector);
  const english = classifyLines(lines, allow).samples;
  check(english.length === 0, `${name}: no English text in Arabic`, english.slice(0, 6));
}

// ─── Client books: settings, invoices, generate, sheet ───────────────────────

async function booksFlow(ctx, viewport, lang, co, who) {
  const base = { lang, viewport, allow: DATA_ALLOW };
  const phone = viewport !== "desktop";
  const tag = `${who} `;

  // Settings: identity, scope and the two accredited providers, none pre-selected.
  const s = await openScreen(ctx, "/settings/einvoicing", {
    ...base,
    name: `${tag}e-invoicing settings`,
  });
  const radios = s.page.locator("[role=radio]");
  check((await radios.count()) === 2, `${tag}settings: two providers to choose from`);
  // Nothing is chosen for the client: the selection shown is the one saved for it (none at first).
  const saved = await api("GET", `/api/companies/${co.companyId}/einvoicing/partner`, co.token);
  const checked = await s.page.locator("[role=radio][aria-checked=true]").count();
  check(
    checked === (saved.json.chosen ? 1 : 0) && (saved.json.chosen || checked === 0),
    `${tag}settings: no provider is pre-selected`,
    { checked, chosen: saved.json.chosen }
  );
  const names = (await radios.allInnerTexts()).join(" ");
  check(/A-Cube/.test(names) && /Complyance/.test(names), `${tag}settings: A-Cube and Complyance`);
  check(
    (await s.page.getByTestId("einvoice-provider-not-connected").count()) === 1,
    `${tag}settings: provider card says what is needed (not connected)`
  );
  check(
    (await s.page.getByTestId("einvoice-provider-request-connection").count()) === 1,
    `${tag}settings: request-connection action`
  );
  await s.page.close();

  // A failing list shows a localized error with Retry, never a blank table or the raw message.
  const failing = await openScreen(ctx, "/settings/einvoicing", {
    ...base,
    name: `${tag}settings with failing lists`,
    errorsOk: true,
    noDupes: false,
    // Server errors are retried (1 s, 2 s, 4 s) before the error state shows.
    act: (page) =>
      page
        .locator("[role=alert]")
        .nth(2)
        .waitFor({ timeout: 25000 })
        .catch(() => undefined),
    before: (page) =>
      page.route(/\/einvoicing\/(documents|archive|inbound)(\?|$)/, (r) =>
        r.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' })
      ),
  });
  const alerts = await failing.page.locator("[role=alert]").allInnerTexts();
  check(
    alerts.filter((a) => a.includes(L(lang, "Could not load this list", "تعذّر تحميل هذه القائمة")))
      .length === 3,
    `${tag}settings: each failing list says so, localized`,
    alerts
  );
  check(
    !(await failing.page.locator("body").innerText()).includes("boom"),
    `${tag}settings: the raw server message is not shown`
  );
  await shot(failing.page, `${who}-settings-failing-lists`);
  await failing.page.close();

  // Invoices: generate -> 422 with the two buyer issues, as localized fix text with links.
  const list = await openScreen(ctx, "/invoices", { ...base, name: `${tag}invoices` });
  const id = co.invoiceIds[0];
  const pre = phone ? "mobile-" : "";
  await list.page
    .locator(`[data-testid=${pre}button-invoice-actions-${id}]:visible`)
    .first()
    .click();
  await list.page.locator(`[data-testid=${pre}button-einvoice-${id}]`).click();
  await list.page.getByTestId("dialog-einvoice-issues").waitFor({ timeout: 8000 });
  const ep = list.page.getByTestId("einvoice-issue-EINVOICE_BUYER_ENDPOINT_MISSING");
  const ad = list.page.getByTestId("einvoice-issue-EINVOICE_BUYER_ADDRESS_MISSING");
  check((await ep.count()) === 1, `${tag}generate: endpoint issue shown with fix text`);
  check((await ad.count()) === 1, `${tag}generate: address issue shown with fix text`);
  const dialogText = await list.page.getByTestId("dialog-einvoice-issues").innerText();
  check(
    !/IBT-049|ibr-144|PINT-EndpointID/.test(dialogText),
    `${tag}generate: no raw validator codes in the fix text`,
    dialogText.slice(0, 200)
  );
  const links = await list.page
    .locator("[data-testid^=link-einvoice-fix-]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  check(
    links.length >= 2 && links.every((h) => h === `/contacts?open=${co.contactId}`),
    `${tag}generate: each issue links to the customer`,
    links
  );
  await noEnglishIn(
    list.page,
    "[data-testid=dialog-einvoice-issues]",
    `${tag}issues dialog`,
    lang,
    DATA_ALLOW
  );
  await dialogTargets(
    list.page,
    "[data-testid=dialog-einvoice-issues]",
    `${tag}issues dialog`,
    phone
  );
  await shot(list.page, `${who}-issues-dialog`);
  await list.page.keyboard.press("Escape");

  // The ready invoice: status cell -> sheet. Nothing is sent without a provider.
  const rid = co.readyInvoiceId;
  const cell = list.page.locator(`[data-testid=einvoice-cell-${rid}]:visible`).first();
  await cell.waitFor({ timeout: 8000 }).catch(() => undefined);
  check(
    (await cell.count()) === 1,
    `${tag}invoice list: e-invoice status cell on the generated invoice`
  );
  if ((await cell.count()) === 1) {
    await cell.click();
    const sheet = list.page.getByTestId("einvoice-sheet");
    await sheet.waitFor({ timeout: 8000 });
    await list.page.getByTestId("einvoice-panel").waitFor({ timeout: 8000 });
    check(
      (await list.page.getByTestId("einvoice-not-sent").count()) === 1,
      `${tag}sheet: says nothing was sent (no provider)`
    );
    check(
      (await list.page.getByTestId("einvoice-send").count()) === 0,
      `${tag}sheet: no Send button without a provider`
    );
    const setup = await list.page.locator("[data-testid=einvoice-not-sent] a").getAttribute("href");
    check(setup === "/settings/einvoicing", `${tag}sheet: set-up link`, setup);
    check(
      (await list.page.getByTestId("einvoice-download-xml").count()) === 1 &&
        (await list.page.getByTestId("einvoice-download-pdf").count()) === 1,
      `${tag}sheet: XML and PDF download actions`
    );
    const dl = list.page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await list.page.getByTestId("einvoice-download-xml").click();
    const file = await dl;
    check(
      !!file && /\.xml$/i.test(file.suggestedFilename()),
      `${tag}sheet: XML downloads`,
      file?.suggestedFilename()
    );
    check(
      (await list.page.getByTestId("einvoice-download-error").count()) === 0,
      `${tag}sheet: no download error`
    );
    await noEnglishIn(list.page, "[data-testid=einvoice-sheet]", `${tag}sheet`, lang, DATA_ALLOW);
    await dialogTargets(list.page, "[data-testid=einvoice-sheet]", `${tag}sheet`, phone);
    await shot(list.page, `${who}-einvoice-sheet`);
    await list.page.getByTestId("einvoice-history-open").click();
    await list.page.getByTestId("einvoice-history").waitFor({ timeout: 5000 });
    await shot(list.page, `${who}-einvoice-history`);
  }
  await list.page.close();
}

/** API truths: generate, XML, and submit refused without a provider (never a fake "sent"). */
async function apiChecks(co) {
  currentLabel = "api";
  const gen = await api(
    "POST",
    `/api/invoices/${co.readyInvoiceId}/generate-einvoice`,
    co.token,
    {}
  );
  check(
    gen.status === 200 && gen.json.status === "generated",
    "generate-einvoice on a ready invoice",
    gen
  );
  const xml = await fetch(`${BASE}/api/invoices/${co.readyInvoiceId}/einvoice-xml`, {
    headers: { authorization: `Bearer ${co.token}` },
  });
  const body = await xml.text();
  check(
    xml.ok && /xml/.test(xml.headers.get("content-type") || "") && body.includes("<"),
    "einvoice-xml downloads"
  );
  const bad = await api(
    "POST",
    `/api/invoices/${co.invoiceIds[0]}/generate-einvoice`,
    co.token,
    {}
  );
  const codes = (bad.json.issues || []).map((i) => i.code);
  check(
    bad.status === 422 &&
      codes.includes("EINVOICE_BUYER_ENDPOINT_MISSING") &&
      codes.includes("EINVOICE_BUYER_ADDRESS_MISSING"),
    "generate refused with the two coded buyer issues",
    bad.json
  );
  const sub = await api("POST", `/api/invoices/${co.readyInvoiceId}/einvoice/submit`, co.token, {});
  check(
    (sub.status === 503 || (sub.status >= 400 && sub.status < 500)) &&
      sub.json.code === "EINVOICE_PROVIDER_NOT_CONFIGURED",
    "submit refused without a configured provider",
    sub
  );
  const st = await api("GET", `/api/invoices/${co.readyInvoiceId}/einvoice/status`, co.token);
  check(
    st.json.transmission?.block === "no_provider" && !st.json.transmission?.providerDocumentId,
    "status never claims a handover",
    st.json.transmission
  );
}

// ─── Approval flow ───────────────────────────────────────────────────────────

const hrefsOf = (html) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const ARABIC = /[؀-ۿ]/;

async function outboxRow(to) {
  const r = await db.query(
    `SELECT subject, html, text_body FROM email_outbox WHERE category = 'einvoice_approver_link' AND to_address = $1 ORDER BY created_at DESC LIMIT 1`,
    [to]
  );
  return r.rows[0] ?? null;
}

/** The bilingual approver e-mail: both blocks, both greetings, no TRN, absolute links. */
function checkApproverMail(row, tag, companyName) {
  check(!!row, `${tag}approver e-mail is in the outbox`);
  if (!row) return null;
  check(
    /<html[^>]*lang="en"/.test(row.html) &&
      row.html.includes('lang="en"') &&
      row.html.includes('lang="ar"') &&
      row.html.includes('dir="rtl"'),
    `${tag}approver e-mail: English and Arabic blocks`
  );
  check(
    ARABIC.test(row.subject) && /[A-Za-z]/.test(row.subject),
    `${tag}approver e-mail: bilingual subject`,
    row.subject
  );
  check(
    ARABIC.test(row.text_body) && /[A-Za-z]{4}/.test(row.text_body),
    `${tag}approver e-mail: bilingual plain text`
  );
  check(
    row.html.includes("Dear <bdi>Khalid Al Mansoori</bdi>,") &&
      row.html.includes("مرحباً،") &&
      !/عزيزنا[^<]*Khalid/.test(row.html),
    `${tag}approver e-mail: English greeting names the approver, Arabic greeting is neutral`
  );
  check(
    !(row.html + row.text_body + row.subject).includes(OUTBOX_TRN),
    `${tag}approver e-mail: no TRN`
  );
  check(
    row.html.includes(companyName) || row.html.includes(companyName.replace(/&/g, "&amp;")),
    `${tag}approver e-mail: names the company`
  );
  const hrefs = hrefsOf(row.html).filter((h) => !/^(mailto:|tel:)/.test(h));
  check(
    hrefs.length > 0 && hrefs.every((h) => /^https?:\/\//.test(h)),
    `${tag}approver e-mail: absolute links`,
    hrefs
  );
  const link = hrefs.find((h) => /einvoicing-approve\//.test(h));
  check(!!link && link.startsWith(BASE), `${tag}approver e-mail: links to the approval page`, link);
  check(
    (row.text_body.match(/https?:\/\/[^\s)]+/g) || []).some((u) => /einvoicing-approve\//.test(u)),
    `${tag}approver e-mail: plain text carries the link`
  );
  return link ?? null;
}

async function approvalFlow(browser, ctx, viewport, lang, co, who, companyName) {
  const base = { lang, viewport, allow: DATA_ALLOW };
  const phone = viewport !== "desktop";
  const tag = `${who} `;
  const email = `appr+${RUN}${who}${viewport}${lang}@alnoor.example`;

  // Request the approval from the client's e-invoicing page.
  const s = await openScreen(ctx, "/settings/einvoicing", {
    ...base,
    name: `${tag}request approval`,
    noDupes: false, // the choose/create mutations refetch their lists on purpose
    act: async (page) => {
      const opt = page.getByTestId("einvoice-partner-option-acube");
      if ((await opt.getAttribute("aria-checked")) !== "true") await opt.click();
      await page.getByTestId("partner-step-appoint").waitFor({ timeout: 8000 });
      await page.getByTestId("appoint-someone").click();
      await page.getByTestId("approver-link-name").fill("Khalid Al Mansoori");
      await page.getByTestId("approver-link-email").fill(email);
    },
  });
  check(
    (await s.page.locator("[role=radio][aria-checked=true]").count()) === 1,
    `${tag}approval: the chosen provider is shown as selected`
  );
  const dyn = await s.page.getByTestId("approver-link-create").boundingBox();
  check(
    !!dyn && (!phone || dyn.height >= 43.5),
    `${tag}approval: create button is 44px on phones`,
    dyn
  );
  await s.page.getByTestId("approver-link-create").click();
  await s.page.getByTestId("approver-link-created").waitFor({ timeout: 10000 });
  await noEnglishIn(
    s.page,
    "[data-testid=einvoice-partner-card]",
    `${tag}partner card`,
    lang,
    DATA_ALLOW
  );
  const state = (await s.page.getByTestId("einvoice-appointment-state").innerText()).trim();
  check(state.length > 0, `${tag}approval: state badge after the request`, state);
  await shot(s.page, `${who}-approval-requested`);
  await s.page
    .locator("[data-testid=approver-link-list] li")
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => undefined);
  const listed = await s.page.locator("[data-testid=approver-link-list] li").count();
  check(listed >= 1, `${tag}approval: the request is listed with its state`, listed);
  await s.page.close();

  const row = await outboxRow(email);
  const link = checkApproverMail(row, tag, companyName);
  if (!link) return;
  const path = new URL(link).pathname;

  // The no-login page: company name only, never a TRN, then Done.
  const anon = await browser.newContext({
    ...DEVICE[viewport],
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
  });
  await anon.addInitScript((l) => {
    try {
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
    } catch {
      /* storage blocked */
    }
  }, lang);
  const ap = await openScreen(anon, path, { ...base, name: `${tag}approver page` });
  const text = await ap.page.evaluate(() => document.body.innerText);
  check(text.includes(companyName), `${tag}approver page: names the company`);
  check(
    !text.includes(OUTBOX_TRN) && !ap.info.lines.join(" ").includes(OUTBOX_TRN),
    `${tag}approver page: no TRN`
  );
  await ap.page.getByTestId("approve-done").click();
  await ap.page.getByTestId("approve-completed").waitFor({ timeout: 8000 });
  check(true, `${tag}approver page: Done is confirmed`);
  await noEnglishIn(ap.page, "main", `${tag}approver page (done)`, lang, DATA_ALLOW);
  await shot(ap.page, `${who}-approver-done`);
  await ap.page.close();
  // Opening the used link again shows the completed state, not an error.
  const again = await openScreen(anon, path, { ...base, name: `${tag}used approver link` });
  check(
    (await again.page.getByTestId("approve-completed").count()) === 1,
    `${tag}approver page: a used link shows the confirmed state`
  );
  await again.page.close();

  // Outcome back in the client's e-invoicing page.
  const back = await openScreen(ctx, "/settings/einvoicing", {
    ...base,
    name: `${tag}after approval`,
  });
  const doneState = (await back.page.getByTestId("einvoice-appointment-state").innerText()).trim();
  check(
    doneState ===
      L(
        lang,
        "Approver marked it done, not yet verified",
        "أكّده المسؤول عن الموافقة، ولم يُتحقّق منه بعد"
      ),
    `${tag}approval: the client's e-invoicing page shows the approver finished`,
    doneState
  );
  const doneText = await back.page
    .getByTestId("approver-link-list")
    .innerText()
    .catch(() => "");
  check(
    doneText.includes(L(lang, "Marked done", "تم التأكيد")) || /Marked done|تم/.test(doneText),
    `${tag}approval: the request is listed as marked done without extra clicks`,
    doneText.slice(0, 160)
  );
  await shot(back.page, `${who}-approval-after`);
  await back.page.close();

  // Invalid, expired and revoked links.
  const mk = async (suffix) => {
    const r = await api(
      "POST",
      `/api/companies/${co.companyId}/einvoicing/approver-links`,
      co.token,
      {
        approverName: "Khalid",
        approverEmail: `appr+${RUN}${who}${viewport}${lang}${suffix}@alnoor.example`,
      }
    );
    return r.json;
  };
  const expired = await mk("x");
  await db.query(
    `UPDATE einvoice_approver_links SET expires_at = now() - interval '1 day' WHERE id = $1`,
    [expired.id]
  );
  const revoked = await mk("r");
  await api(
    "POST",
    `/api/companies/${co.companyId}/einvoicing/approver-links/${revoked.id}/revoke`,
    co.token,
    {}
  );
  for (const [testId, url, name] of [
    ["approve-expired", new URL(expired.url).pathname, "expired approver link"],
    ["approve-revoked", new URL(revoked.url).pathname, "revoked approver link"],
    ["approve-invalid", `/portal/einvoicing-approve/${"0".repeat(40)}`, "invalid approver link"],
  ]) {
    const g = await openScreen(anon, url, { ...base, name: `${tag}${name}`, errorsOk: true });
    check((await g.page.getByTestId(testId).count()) === 1, `${tag}${name}: shows its own state`);
    const gt = await g.page.evaluate(() => document.body.innerText);
    check(
      !gt.includes(OUTBOX_TRN) && !gt.includes(companyName),
      `${tag}${name}: shows no company data`
    );
    await g.page.close();
  }
  await anon.close();
}

/** The firm's per-client e-invoicing column. */
async function firmCell(ctx, viewport, lang, who) {
  const base = { lang, viewport, allow: DATA_ALLOW };
  const g = await openScreen(ctx, "/firm/command-center", {
    ...base,
    name: `${who} firm e-invoicing column`,
  });
  const cells = g.page.locator("[data-testid^=firm-einvoicing-]");
  const count = await cells.count();
  check(count >= 1, `${who} firm: an e-invoicing status per client`, count);
  const interactive = await cells.evaluateAll((badges) =>
    badges.some((badge) => !!badge.closest("a, button, [role='button'], [role='link']"))
  );
  check(!interactive, `${who} firm: e-invoicing cells only show status`);
  check(
    (await g.page.locator("[data-testid=firm-einvoicing-approver_done]").count()) >= 1,
    `${who} firm: the client whose approver finished shows as such`
  );
  await shot(g.page, `${who}-firm-einvoicing`);
  await g.page.close();
}

// ─── Bilingual customer e-mails, rendered at mail widths ─────────────────────

/** Send every template once for a company whose language is Arabic and whose contact has no preference. */
async function seedEmails() {
  const u = await registerUser("Mail Owner", `mail-owner+${RUN}@example.com`, null);
  const co = await prepareCompany(u.companyId, u.token, "m");
  await db.query(`UPDATE companies SET locale = 'ar' WHERE id = $1`, [u.companyId]);
  const cid = u.companyId;
  await api("PUT", `/api/companies/${cid}/einvoicing/partner`, u.token, { partner: "acube" });
  const inv = co.invoiceIds[0];
  const post = (url, body) => api("POST", url, u.token, body);
  await post(`/api/companies/${cid}/invoices/${inv}/send-email`, {
    to: `inv+${RUN}@customer.example`,
  });
  await post(`/api/companies/${cid}/invoices/${inv}/send-reminder`, {
    to: `rem+${RUN}@customer.example`,
  });
  const q = await post(`/api/companies/${cid}/quotes`, {
    contactId: co.contactId,
    date: day(0),
    lines: [{ description: "Setup", quantity: 1, unitPrice: 500, vatRate: 0.05 }],
  });
  if (q.status < 300) {
    await api("PATCH", `/api/quotes/${q.json.id}/status`, u.token, { status: "sent" });
    await post(`/api/quotes/${q.json.id}/send-email`, { to: `quote+${RUN}@customer.example` });
  }
  await post(`/api/companies/${cid}/customer-statements/${co.contactId}/email`, {
    to: `st+${RUN}@customer.example`,
  });
  await post(`/api/companies/${cid}/einvoicing/approver-links`, {
    approverName: "Khalid Al Mansoori",
    approverEmail: `appr+${RUN}mail@alnoor.example`,
  });
  await post(`/api/portal/login/request`, {
    companyId: cid,
    email: `ap+${RUN}m@desertrose.example`,
  }).catch(() => undefined);
  await api("POST", "/api/auth/forgot-password", null, { email: u.email });
  return { companyId: cid, invoiceId: inv, email: u.email };
}

/** The invoice share dialog leaves language selection to the recipient's settings. */
async function shareInvoiceByEmail(browser, mailCo, lang) {
  currentLabel = `invoice email ${lang}`;
  const ctx = await signedInContext(browser, "desktop", lang, mailCo, mailCo.companyId);
  try {
    const page = await ctx.newPage();
    await page.goto(BASE + "/invoices", { waitUntil: "load" });
    const id = mailCo.invoiceId;
    await page.getByTestId(`button-invoice-actions-${id}`).click();
    await page.getByTestId(`button-share-invoice-${id}`).click();
    check(
      (await page.locator("html").getAttribute("lang")) === lang,
      "share dialog uses the requested UI language"
    );
    const to = `share-${lang}+${RUN}@customer.example`;
    await page.getByTestId("input-invoice-share-email").fill(to);
    const sent = page.waitForResponse((response) => response.url().endsWith(`/${id}/send-email`));
    await page.getByTestId("button-send-invoice-email").click();
    const response = await sent;
    check(response.status() === 202, "share dialog queued the invoice e-mail", response.status());
    const [row] = (
      await db.query(
        "SELECT subject, html, text_body FROM email_outbox WHERE category = 'invoice' AND company_id = $1 AND to_address = $2",
        [mailCo.companyId, to]
      )
    ).rows;
    check(
      !!row &&
        row.html.includes('dir="ltr" lang="en"') &&
        row.html.includes('dir="rtl" lang="ar"') &&
        /Invoice/.test(row.subject) &&
        ARABIC.test(row.subject) &&
        /Invoice/.test(row.text_body) &&
        ARABIC.test(row.text_body),
      "share dialog preserves bilingual subject, HTML and plain text for a customer without a preference"
    );
  } finally {
    await ctx.close();
  }
}

async function emailRender(browser, mailCo) {
  currentLabel = "emails";
  const rows = (
    await db.query(
      `SELECT category, subject, html, text_body FROM email_outbox
        WHERE company_id = $1 OR to_address = $2 ORDER BY created_at`,
      [mailCo.companyId, mailCo.email]
    )
  ).rows;
  const cats = new Set(rows.map((r) => r.category));
  for (const c of ["invoice", "reminder", "quote", "statement", "einvoice_approver_link"])
    check(cats.has(c), `e-mail outbox has the ${c} message`, [...cats]);
  for (const row of rows) {
    const label = `${row.category} e-mail`;
    const bilingual = row.html.includes('lang="en"') && row.html.includes('lang="ar"');
    if (row.category !== "auth" && row.category !== "portal_login")
      check(bilingual, `${label}: Arabic company, no preference, so both languages`);
    check(
      ARABIC.test(row.subject) && /[A-Za-z]/.test(row.subject) && ARABIC.test(row.text_body),
      `${label}: bilingual subject and plain text`,
      row.subject
    );
    const hrefs = hrefsOf(row.html).filter((h) => !/^(mailto:|tel:)/.test(h));
    check(
      hrefs.every((h) => /^https?:\/\//.test(h)),
      `${label}: every link is absolute`,
      hrefs.filter((h) => !/^https?:\/\//.test(h))
    );
    check(!(row.html + row.text_body).includes(OUTBOX_TRN), `${label}: no seller TRN`);
    // Each block's greeting: the English block never carries the Arabic name and vice versa.
    const en = row.html.split('lang="ar"')[0];
    const ar = row.html.split('lang="ar"')[1] || "";
    if (/Dear </.test(row.html))
      check(
        /عزيزنا|مرحباً|عزيزي/.test(ar) &&
          !/Dear/.test(ar) &&
          !/[\u0600-\u06FF]{3}/.test(en.split("<body")[1] || ""),
        `${label}: each block has its own greeting`
      );
    for (const width of [375, 700, 1000]) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      await page.setContent(row.html, { waitUntil: "load" });
      const m = await page.evaluate(() => {
        const bad = [];
        const vw = document.documentElement.clientWidth;
        for (const e of document.querySelectorAll("body *")) {
          const r = e.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
            bad.push(`${e.tagName}:${Math.round(r.left)}-${Math.round(r.right)}`);
          }
        }
        const btn = document.querySelector("a[style*='background']");
        const br = btn ? btn.getBoundingClientRect() : null;
        return {
          overflow: document.documentElement.scrollWidth > vw + 1,
          bad: bad.slice(0, 4),
          btnH: br ? Math.round(br.height) : null,
          btnW: br ? Math.round(br.width) : null,
          vw,
        };
      });
      check(!m.overflow && m.bad.length === 0, `${label} @${width}: no overflow`, m);
      if (m.btnH !== null)
        check(m.btnH >= 44, `${label} @${width}: button is at least 44px tall`, m.btnH);
      if (SHOT_DIR && ["invoice", "einvoice_approver_link", "reminder"].includes(row.category)) {
        await mkdir(SHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(SHOT_DIR, `email-${row.category}-${width}.png`),
          fullPage: true,
        });
      }
      await ctx.close();
    }
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(CHROMIUM_FALLBACK) ? CHROMIUM_FALLBACK : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const data = await seed();
  await apiChecks(data.ownerCo);
  await apiChecks(data.client);
  const mailCo = await seedEmails();
  for (const viewport of VIEWPORTS)
    for (const lang of LANGS) {
      currentLabel = `${viewport} ${lang}`;
      console.log(`\n=== ${currentLabel} ===`);
      const ctx = await signedInContext(browser, viewport, lang, data.owner);
      await booksFlow(ctx, viewport, lang, data.ownerCo, "owner");
      await approvalFlow(browser, ctx, viewport, lang, data.ownerCo, "owner", data.ownerName);
      await ctx.close();
      // NR firm staff: "Open books" on the client, then the same flows inside its books.
      const fctx = await signedInContext(browser, viewport, lang, data.firm);
      const phone = viewport !== "desktop";
      const fl = await openScreen(fctx, "/firm/clients", {
        lang,
        viewport,
        allow: DATA_ALLOW,
        name: "firm clients",
        skipH1: true,
        skipAxe: true,
        noDupes: false, // a sign-in navigation, not a screen of this flow
        act: async (page) => {
          const btn = phone
            ? page.locator(`[data-testid=button-open-books-${data.client.id}]:visible`).first()
            : page
                .locator("tr", { hasText: data.clientName })
                .getByRole("button", { name: /Open books|فتح الدفاتر/ })
                .first();
          await btn.click();
          await page.waitForURL((u) => /dashboard/.test(u.pathname), { timeout: 20000 });
        },
      });
      check(
        /dashboard/.test(fl.page.url()) && !/onboarding/.test(fl.page.url()),
        "Open books lands on the client's dashboard, not on onboarding",
        fl.page.url()
      );
      const named = await fl.page
        .waitForFunction((n) => document.body.innerText.includes(n), data.clientName, {
          timeout: 8000,
        })
        .then(() => true)
        .catch(() => false);
      check(
        named,
        "Open books: the client's name is shown (managing banner)",
        (await fl.page.locator("body").innerText()).slice(0, 300)
      );
      await fl.page.close();
      await fctx.close();
      const fctx2 = await signedInContext(browser, viewport, lang, data.firm, data.client.id);
      await booksFlow(fctx2, viewport, lang, data.client, "staff");
      await approvalFlow(browser, fctx2, viewport, lang, data.client, "staff", data.clientName);
      await firmCell(fctx2, viewport, lang, "staff");
      await fctx2.close();
    }
  for (const lang of LANGS) await shareInvoiceByEmail(browser, mailCo, lang);
  await emailRender(browser, mailCo);
} finally {
  await browser.close();
  await db.end();
}
if (SHOT_DIR) await writeFile(path.join(SHOT_DIR, "results.txt"), log.join("\n") + "\n");
console.log(`\n${log.length - failures.length}/${log.length} checks passed`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n${failures.join("\n")}`);
  process.exit(1);
}
