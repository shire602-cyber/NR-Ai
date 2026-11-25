#!/usr/bin/env node
/**
 * Retry of an on-demand dialog chunk that failed to load, in a real browser, same document.
 *
 *   BASE_URL=http://localhost:5052 node tests/e2e/dialog-chunk-retry.mjs
 *
 * Covers the two lazily loaded dialogs: Permissions (/team, PermissionsMatrixDialog) and Invite
 * client (/admin/invitations, InviteClientDialog). Needs the real app and a local database (it
 * registers a disposable owner through the API and finishes onboarding in the browser, as
 * tests/e2e/core-flows.mjs does). Works against a production build and against `npm run dev`
 * (Vite serves the dialog as /src/components/team/<Name>.tsx). Local targets only.
 *
 * For each dialog and language (en, ar) one document goes through the whole story. The dialog's
 * real JavaScript request is aborted by the browser (a network failure, not a mock of the loader):
 *   1. a click on the trigger fails: the localized "could not load" notice and Retry appear beside
 *      the trigger, the page stays usable and no dialog opens. The app has already retried once by
 *      itself, under a fresh `muhasib-retry` URL;
 *   2. Retry while the network is still down fails the same way, again under a URL no earlier
 *      request used;
 *   3. with the network back but the request held, one Retry shows the localized loading status,
 *      then opens the dialog. The document never reloaded (a document-level marker survives) and
 *      the request that succeeded was a fresh URL for the same chunk path.
 *
 * The failure is switched on before the page loads, so it does not matter whether the browser
 * requests the plain chunk URL once (preload) or twice (preload and import) or not at all (a
 * failed preload is remembered): only the `muhasib-retry` URLs are asserted on, and they must be
 * unique, because an engine that caches a failed module URL would never recover on a repeated one.
 *
 * `/admin/invitations` is platform-admin only (client guard and server): `/api/auth/me` is passed
 * through with `isAdmin: true` and its two list endpoints answer empty lists, so the page (not the
 * permission) is what is under test. The API is a fixture there; the chunk is real.
 *
 * Environment: BASE_URL (default http://localhost:5000), E2E_LANGS (en,ar), CHROMIUM_PATH.
 * Exits 1 on a failure.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const PW = "Fake-Password-123";
const RUN = Math.random().toString(36).slice(2, 8);
const LANGS = (process.env.E2E_LANGS || "en,ar").split(",").map((s) => s.trim());
const CHROMIUM_FALLBACK = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const PARAM = "muhasib-retry";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.join(HERE, "../../client/src/locales");

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to register synthetic data on ${BASE}: local targets only.`);
  process.exit(2);
}

/** The merged UI catalog of a language, so notice text is compared exactly, not by pattern. */
function catalog(lang) {
  const dir = path.join(LOCALES, lang);
  return Object.assign(
    {},
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
  );
}

const failures = [];
let label = "";
function check(ok, message, detail) {
  const line = `${ok ? "ok  " : "FAIL"} [${label}] ${message}${ok || detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}

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
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: text };
  }
}

const DIALOGS = [
  {
    name: "PermissionsMatrixDialog",
    path: "/team",
    trigger: "[data-testid=button-view-permissions]",
    status: "permissions-dialog",
    adminFixture: false,
  },
  {
    name: "InviteClientDialog",
    path: "/admin/invitations",
    trigger: "[data-testid=button-send-invite]",
    status: "invite-dialog",
    adminFixture: true,
  },
];

/** Polls `condition` (a Node-side check) until it holds; throws `message` after 15 s. */
async function expect(condition, message) {
  for (let i = 0; i < 150; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function newContext(browser, lang) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: lang === "ar" ? "ar-AE" : "en-US",
    timezoneId: "Asia/Dubai",
  });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem("muhasib_auth_hint", "1");
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: l }, version: 0 }));
      localStorage.setItem("cookie-consent", "accepted");
    } catch {
      /* storage blocked */
    }
  }, lang);
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email: `team-owner+${RUN}@example.com`, password: PW },
  });
  if (login.status() >= 300) throw new Error(`browser login failed: ${login.status()}`);
  return ctx;
}

/** The new owner has to finish onboarding once, or every app route redirects to /onboarding. */
async function finishOnboarding(browser) {
  const ctx = await newContext(browser, "en");
  const page = await ctx.newPage();
  await page.goto(BASE + "/dashboard", { waitUntil: "load" });
  const express = page.locator("[data-testid=onboarding-express]");
  await express.waitFor({ timeout: 15000 }).catch(() => undefined);
  if (await express.count()) {
    await express.click();
    for (const id of ["onboarding-skip", "onboarding-task-explore"]) {
      const next = page.locator(`[data-testid=${id}]`);
      await next.waitFor({ timeout: 8000 }).catch(() => undefined);
      if (await next.count()) await next.click();
    }
  }
  await page.waitForFunction(() => !location.pathname.startsWith("/onboarding"), null, {
    timeout: 20000,
  });
  await ctx.close();
}

async function run(browser, lang, dialog) {
  label = `${dialog.name} ${lang}`;
  const text = catalog(lang);
  const loadingText = text["common.loading"];
  const failedText = text["common.loadFailedTitle"];
  const retryText = text["pages.retry"];
  check(
    [loadingText, failedText, retryText].every((v) => typeof v === "string" && v),
    "the catalog has the loading, load-failed and retry strings",
    { loadingText, failedText, retryText }
  );
  const ctx = await newContext(browser, lang);

  // "fail": the browser's own network error; "hold": wait on `gate`, then serve it; "pass".
  let mode = "fail";
  let gate = Promise.resolve();
  const chunk = new RegExp(`/${dialog.name}(?:[-.][^/?]*)?\\.(?:js|tsx)$`);
  const requests = [];
  await ctx.route(
    (url) => chunk.test(url.pathname),
    async (route) => {
      const entry = { url: route.request().url(), mode };
      requests.push(entry);
      if (entry.mode === "fail") return route.abort("failed");
      if (entry.mode === "hold") await gate;
      return route.continue();
    }
  );
  const retried = () => requests.filter((r) => new URL(r.url).searchParams.has(PARAM));

  if (dialog.adminFixture) {
    await ctx.route(
      (url) => /^\/api\/admin\/(invitations|clients)$/.test(url.pathname),
      (route) => route.fulfill({ json: [] })
    );
    // The page is behind the client-side admin guard: show the real session as a platform admin.
    await ctx.route(
      (url) => url.pathname === "/api/auth/me",
      async (route) => {
        const res = await route.fetch();
        const body = await res.json().catch(() => ({}));
        return route.fulfill({ response: res, json: { ...body, isAdmin: true } });
      }
    );
  }

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  await page.goto(BASE + dialog.path, { waitUntil: "load" });
  await page.locator(dialog.trigger).waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    window.__sameDocument = "kept";
  });

  const trigger = page.locator(dialog.trigger);
  const notice = page.locator(`[data-testid=${dialog.status}-error]`);
  const retry = page.locator(`[data-testid=${dialog.status}-retry]`);
  const loading = page.locator(`[data-testid=${dialog.status}-loading]`);
  const dialogs = page.locator("[role=dialog]");
  const baseline = await dialogs.count();
  const normalized = async (locator) => (await locator.innerText()).replace(/\s+/g, " ").trim();

  async function expectFailureState(step) {
    await notice.waitFor({ timeout: 20000 });
    check(
      (await normalized(notice)) === `${failedText} ${retryText}`,
      `${step}: the notice is exactly the localized text and Retry label`,
      await normalized(notice)
    );
    check(await retry.isVisible(), `${step}: Retry is shown`);
    check(await trigger.isEnabled(), `${step}: the trigger stays usable`);
    check((await dialogs.count()) === baseline, `${step}: no dialog opened`);
    check(
      (await page.locator("main h1, main [role=heading]").count()) > 0,
      `${step}: the page content is still rendered`
    );
  }

  // 1. First click: the plain import fails, then the automatic try under a fresh URL fails too.
  await trigger.click();
  await expectFailureState("click");
  const afterClick = retried().length;
  check(afterClick >= 1, "click: the app retried by itself under a fresh URL", requests);

  // 2. Retry while the network is still down.
  await retry.click();
  // The notice goes away while loading, so the one checked below is the new failure.
  await expect(() => retried().length > afterClick, "the Retry did not request the chunk");
  await expectFailureState("retry while offline");

  // 3. Network back, request held: loading is shown, then the dialog opens on the same document.
  let release;
  gate = new Promise((resolve) => (release = resolve));
  mode = "hold";
  const before = requests.length;
  await retry.click();
  await loading.waitFor({ timeout: 10000 });
  check((await normalized(loading)) === loadingText, "retry: the loading status is localized");
  check(await trigger.isEnabled(), "retry: the trigger stays usable while loading");
  release();
  mode = "pass";
  await page.waitForFunction(
    (n) => document.querySelectorAll("[role=dialog]").length > n,
    baseline,
    { timeout: 20000 }
  );
  const served = requests.slice(before).filter((r) => r.mode !== "fail");
  const servedUrl = served[0]?.url;
  check(served.length >= 1, "retry: the chunk was requested again", served);
  check(
    !!servedUrl && new URL(servedUrl).searchParams.has(PARAM),
    "retry: the manual Retry used a fresh muhasib-retry URL",
    servedUrl
  );
  const freshUrls = retried().map((r) => r.url);
  check(
    new Set(freshUrls).size === freshUrls.length,
    "every fresh URL was requested once (a repeated one would stay failed on older engines)",
    freshUrls
  );
  check(
    new Set(requests.map((r) => new URL(r.url).pathname)).size === 1,
    "every attempt is the same chunk path",
    requests.map((r) => r.url)
  );
  check(
    (await page.evaluate(() => window.__sameDocument)) === "kept",
    "the same document served the retry (no reload)"
  );
  check(
    (await notice.count()) === 0 && (await loading.count()) === 0,
    "the status is gone once the dialog is open"
  );
  check(pageErrors.length === 0, "no uncaught page errors", pageErrors);
  await ctx.close();
}

const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(CHROMIUM_FALLBACK) ? CHROMIUM_FALLBACK : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const reg = await api("POST", "/api/auth/register", null, {
    name: "Team Owner",
    email: `team-owner+${RUN}@example.com`,
    password: PW,
    companyName: `Dialog Retry ${RUN} LLC`,
  });
  if (reg.status >= 300) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
  }
  await finishOnboarding(browser);
  for (const lang of LANGS) for (const dialog of DIALOGS) await run(browser, lang, dialog);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nall dialog chunk retry checks passed");
