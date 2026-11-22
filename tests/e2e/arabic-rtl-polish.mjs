#!/usr/bin/env node
/**
 * Arabic SME and portal regression crawl against a disposable, provider-free local app.
 * BASE_URL=http://127.0.0.1:5000 CHROMIUM_PATH=/usr/bin/chromium node tests/e2e/arabic-rtl-polish.mjs
 *
 * RTL_ROUTES=/one,/two limits a rerun to named routes. RTL_REUSE=true keeps the synthetic fixture.
 * RTL_SHOT_DIR writes the documented representative set. RTL_ALL_SCREENSHOTS=true adds every view.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { ALL_AUTH_ROUTES } from "./launch-routes.mjs";
import { REPORT_URLS } from "./lib/report-urls.mjs";
import { makeFixtures } from "./lib/arabic-rtl-fixtures.mjs";
import { englishWords, pageSnapshot, textProblems } from "./lib/sweep-checks.mjs";
import { PASSWORD } from "./lib/sweep-personas.mjs";

const base = new URL(process.env.BASE_URL ?? "http://127.0.0.1:5000").origin;
assert.match(
  base,
  /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/,
  "Use a disposable local app"
);
const artifactDir = fileURLToPath(new URL("./.artifacts/", import.meta.url));
const reportFile =
  process.env.RTL_REPORT ?? path.join(artifactDir, "arabic-rtl-polish-last-run.json");
const shotDir = process.env.RTL_SHOT_DIR;
const only = new Set((process.env.RTL_ROUTES ?? "").split(",").filter(Boolean));
const devices = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};
const screenshotNames = {
  "/dashboard": "dashboard",
  "/invoices": "invoices",
  "/invoices/:id/edit": "invoice-edit",
  "/contacts": "contacts",
  "/settings/company": "company-settings",
  "/client-portal/dashboard": "portal-dashboard",
  "/client-portal/invoices": "portal-invoices",
  "/client-portal/documents": "portal-documents",
  "/client-portal/statements": "portal-statements",
  "/client-portal/messages": "portal-messages",
  "/client-portal/account": "portal-account",
  "/portal/join": "portal-join",
};
const hardLoadRoutes = new Set([
  "/invoices/:id/edit",
  "/settings/company",
  "/client-portal/account",
]);
const csvImportPage = "/bank-reconciliation?import=1";
const redirects = {
  "/company-profile": "/settings/company",
  "/accounts": "/chart-of-accounts",
  "/banking": csvImportPage,
  "/bank-feeds": csvImportPage,
  "/compliance": "/compliance-calendar",
  "/settings": "/settings/company",
  "/journal-entries": "/journal",
  "/receipt-autopilot": "/receipts?tab=automation",
  "/reconciliation-rules": "/bank-reconciliation?tab=rules",
  "/auto-reconcile": "/bank-reconciliation?tab=suggestions",
  "/ai": "/assistant",
  "/ai-inbox": "/assistant?tab=review",
  "/ai-cfo": "/assistant?tab=ask",
  "/ai-features": "/assistant?tab=automations",
  "/smart-assistant": "/assistant?tab=ask",
  "/ai-chat": "/assistant?tab=ask",
  "/analytics": "/reports?workspace=insights&view=cash-flow",
  "/advanced-analytics": "/reports?workspace=insights&view=cash-flow",
  "/integrations": "/integrations-hub",
  "/reminders": "/payment-chasing?tab=schedule",
  "/advanced-reports": "/reports?workspace=insights&view=cash-flow",
  "/advanced-reports?tab=comparison": "/reports?workspace=insights&view=comparison",
  "/news-feed": "/compliance-calendar",
};

function routeMatrix(fixtures) {
  const appRoutes = new Set([
    ...ALL_AUTH_ROUTES,
    "/accounts",
    "/journal-entries",
    ...REPORT_URLS,
    "/bill-pay?tab=payments",
    "/bill-pay?tab=summary",
  ]);
  appRoutes.delete("/onboarding");
  const staticScreens = [...appRoutes].map((route) => ({
    route,
    href: route,
    expected: redirects[route] ?? route,
    persona: "owner",
    probe: redirects[route] === csvImportPage ? "button-download-sample-bank-csv" : undefined,
  }));
  const parameterScreens = [
    ["/accounts/:id/ledger", "accountId", "owner"],
    ["/journal/:id", "journalId", "owner"],
    ["/invoices/:id/edit", "draftInvoiceId", "owner"],
    ["/invoices/:id", "invoiceId", "owner", `/invoices/${fixtures.invoiceId}/edit`],
    ["/quotes/:id/edit", "quoteId", "owner"],
    ["/purchase-orders/:id/edit", "orderId", "owner"],
    ["/bill-pay/:id/edit", "billId", "owner"],
    ["/recurring-invoices/:id/edit", "recurringId", "owner"],
    ["/view/invoice/:token", "shareToken", "visitor", undefined, "public-invoice-download"],
    ["/portal/:token", "publicPortalToken", "visitor", undefined, "portal-customer-name"],
    ["/portal/einvoicing-approve/:token", "approverToken", "visitor"],
  ].map(([route, key, persona, expected, probe]) => ({
    route,
    href: fixtures[key] ? route.replace(/:id|:token/, fixtures[key]) : null,
    expected,
    persona,
    probe,
  }));
  const portalScreens = [
    "dashboard",
    "invoices",
    "documents",
    "statements",
    "messages",
    "account",
  ].map((section) => {
    const route = `/client-portal/${section}`;
    return { route, href: route, persona: "portal" };
  });
  return [
    ...staticScreens,
    ...parameterScreens,
    ...portalScreens,
    {
      route: "/onboarding",
      href: "/onboarding",
      persona: "onboarding",
      probe: "onboarding-express",
    },
    {
      route: "/portal/join",
      href: `/portal/join#t=${fixtures.pendingInvite}`,
      persona: "visitor",
      probe: "join-form",
    },
  ];
}

function redact(value) {
  return String(value)
    .replace(/\b[0-9a-f]{32,64}\b/gi, "<fixture-token>")
    .replace(/(\/portal\/einvoicing-approve\/)[\w-]{32,}/g, "$1<fixture-token>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<fixture-id>");
}

function monitor(page, issues) {
  const pending = new Set();
  let lastActivity = Date.now();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      pending.add(request);
      lastActivity = Date.now();
    }
  });
  const complete = (request) => {
    if (pending.delete(request)) lastActivity = Date.now();
  };
  page.on("requestfinished", complete);
  page.on("pageerror", (error) => issues.push(["page-error", redact(error.message)]));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(["console-error", redact(message.text())]);
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const { pathname } = new URL(response.url());
    const kind = pathname.startsWith("/api/") ? "api-status" : "http-status";
    issues.push([kind, `${response.request().method()} ${status} ${redact(pathname)}`]);
  });
  page.on("requestfailed", (request) => {
    complete(request);
    const { pathname } = new URL(request.url());
    const reason = request.failure()?.errorText;
    // Chromium intentionally cancels prefetches and obsolete navigation resources.
    if (reason === "net::ERR_ABORTED" && !pathname.startsWith("/api/")) return;
    issues.push(["request-failed", `${reason} ${redact(pathname)}`]);
  });
  return async function waitForApi() {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (pending.size === 0 && Date.now() - lastActivity >= 350) return;
      await delay(100);
    }
    const paths = [...pending].map((request) => redact(new URL(request.url()).pathname));
    issues.push(["api-unsettled", paths.join(", ") || "API requests did not settle"]);
  };
}

async function newContext(browser, viewport, email) {
  const context = await browser.newContext({
    ...viewport,
    locale: "ar-AE",
    timezoneId: "Asia/Dubai",
    colorScheme: "light",
  });
  await context.addInitScript((signedIn) => {
    if (signedIn) localStorage.setItem("muhasib_auth_hint", "1");
    localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "ar" }, version: 0 }));
    localStorage.setItem("cookie-consent", "accepted");
  }, Boolean(email));
  if (email) {
    const login = await context.request.post(`${base}/api/auth/login`, {
      data: { email, password: PASSWORD },
    });
    assert.ok(login.ok(), `Synthetic browser login returned ${login.status()}`);
  }
  return context;
}

async function checkIdentifiers(page, screen, fixtures) {
  const direction = (locator) => locator.evaluate((node) => getComputedStyle(node).direction);
  if (screen.route === "/settings/company") {
    for (const field of ["input-trn", "input-contact-email"]) {
      const input = page.getByTestId(field);
      await input.waitFor({ timeout: 5000 });
      assert.equal(await direction(input), "ltr", `${field} must be LTR in Arabic`);
    }
  }
  if (screen.route === "/client-portal/account") {
    const email = page.getByText(fixtures.portal, { exact: true }).first();
    assert.equal(await direction(email), "ltr", "Portal account email must be LTR");
  }
  if (screen.route === "/client-portal/invoices") {
    const invoice = page
      .getByText(fixtures.invoiceNumber, { exact: true })
      .filter({ visible: true })
      .first();
    assert.equal(await direction(invoice), "ltr", "Invoice number must be LTR");
    const pageText = await page.locator("main").innerText();
    assert.match(pageText, /د\.إ/u, "Arabic AED currency label is missing");
    assert.match(pageText, /نوفمبر/u, "Arabic Gregorian month name is missing");
    assert.doesNotMatch(
      pageText,
      /[\u0660-\u0669\u06f0-\u06f9]/u,
      "Use Latin digits for displayed figures"
    );
  }
}

async function capture(page, screen, device) {
  if (!shotDir) return;
  const name = screenshotNames[screen.route];
  if (!name && process.env.RTL_ALL_SCREENSHOTS !== "true") return;
  const file = name ?? screen.route.replace(/^\/|[:?&=/]+/g, "-").replace(/^-/, "");
  await sharp(await page.screenshot({ animations: "disabled" }))
    .webp({ quality: 82 })
    .toFile(path.join(shotDir, `${device}-${file}.webp`));
}

async function checkScreen(page, screen, device, fixtures) {
  const issues = [];
  const result = { device, route: screen.route, persona: screen.persona, issues };
  if (!screen.href) {
    issues.push(["fixture", "Could not resolve the seeded record"]);
    return result;
  }
  page.setDefaultTimeout(18000);
  const waitForApi = monitor(page, issues);
  try {
    if (
      ["owner", "portal"].includes(screen.persona) &&
      !hardLoadRoutes.has(screen.route) &&
      page.url().startsWith(`${base}/`)
    ) {
      // Wouter observes pushState, as it does for links inside the signed-in app shell.
      await page.evaluate((href) => window.history.pushState(null, "", href), screen.href);
    } else {
      const response = await page.goto(`${base}${screen.href}`, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      result.documentStatus = response?.status();
      assert.ok(response?.ok(), `Navigation returned ${response?.status()}`);
    }
    const expectedLocation = new URL(screen.expected ?? screen.href, base);
    await page.waitForURL((url) => url.pathname === expectedLocation.pathname);
    if (screen.probe) await page.getByTestId(screen.probe).waitFor();
    const requiresMain = ["owner", "portal"].includes(screen.persona);
    const waitForContent = () =>
      page.waitForFunction((needsMain) => {
        const main = document.querySelector("main");
        const content = main ?? document.body;
        return (
          (!needsMain || main !== null) &&
          document.documentElement.dir === "rtl" &&
          content.innerText.trim() !== "" &&
          !content.querySelector(
            '[aria-live="polite"][aria-busy="true"], [role="status"][aria-busy="true"]'
          )
        );
      }, requiresMain);
    await waitForContent();
    await waitForApi();
    const font = await page.evaluate(async () => {
      const faces = await document.fonts.load('400 16px "Noto Sans Arabic"', "العربية");
      return (
        faces.length > 0 && getComputedStyle(document.body).fontFamily.includes("Noto Sans Arabic")
      );
    });
    await waitForContent();
    const snapshot = await page.evaluate(pageSnapshot);
    Object.assign(result, {
      finalPath: redact(snapshot.path),
      direction: snapshot.dir,
      language: snapshot.lang,
      overflow: snapshot.overflowX,
      arabicFont: font,
    });
    if (snapshot.lang !== "ar" || snapshot.dir !== "rtl")
      issues.push(["locale", "Expected ar and rtl"]);
    if (!font) issues.push(["arabic-font", "Noto Sans Arabic was unavailable"]);
    if (!snapshot.mainText) issues.push(["blank", "No visible screen content"]);
    if (snapshot.notFound) issues.push(["not-found", "The route rendered its 404 screen"]);
    if (snapshot.errorBoundary.length)
      issues.push(["error-boundary", snapshot.errorBoundary.join(", ")]);
    if (snapshot.overflowX)
      issues.push(["layout-overflow", `${snapshot.overflowX}px document overflow`]);
    if (
      expectedLocation.search &&
      snapshot.path !== expectedLocation.pathname + expectedLocation.search
    )
      issues.push([
        "navigation",
        `Expected ${redact(expectedLocation.pathname + expectedLocation.search)}`,
      ]);
    const untranslated = [
      ...new Set(snapshot.texts.filter((line) => englishWords(line).length > 0)),
    ];
    const malformed = [...new Set(snapshot.texts.filter((line) => textProblems(line).length > 0))];
    result.untranslated = untranslated.map(redact);
    result.malformed = malformed.map(redact);
    if (untranslated.length) issues.push(["english-ui", `${untranslated.length} unique line(s)`]);
    if (malformed.length) issues.push(["malformed-copy", `${malformed.length} unique line(s)`]);
    try {
      await checkIdentifiers(page, screen, fixtures);
    } catch (error) {
      issues.push(["mixed-direction", redact(error.message)]);
    }
    await capture(page, screen, device);
  } catch (error) {
    const observed = new URL(page.url());
    result.finalPath = redact(observed.pathname + observed.search);
    issues.push(["screen-check", redact(error.message).split("\n")[0]]);
  } finally {
    for (const event of [
      "request",
      "requestfinished",
      "pageerror",
      "console",
      "response",
      "requestfailed",
    ]) {
      page.removeAllListeners(event);
    }
  }
  return result;
}

await mkdir(artifactDir, { recursive: true });
if (shotDir) await mkdir(shotDir, { recursive: true });
const fixtures = await makeFixtures(base, path.join(artifactDir, "arabic-rtl-fixtures.json"));
const screens = routeMatrix(fixtures).filter(({ route }) => only.size === 0 || only.has(route));
assert.equal(screens.length > 0, true, "No requested Arabic routes matched the matrix");
// The loopback fixture bypasses this closed proxy port. Public providers remain unreachable
// while normal Chromium caching keeps the wide route matrix practical on the dev server.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1,[::1]" },
});
let results;
try {
  results = await Promise.all(
    Object.entries(devices).map(async ([device, viewport]) => {
      const contexts = new Map();
      try {
        const outcomes = [];
        for (const screen of screens) {
          if (!contexts.has(screen.persona)) {
            const context = await newContext(browser, viewport, fixtures[screen.persona]);
            contexts.set(screen.persona, { context, page: await context.newPage() });
          }
          const result = await checkScreen(
            contexts.get(screen.persona).page,
            screen,
            device,
            fixtures
          );
          outcomes.push(result);
          const summary = result.issues.map(([kind, detail]) => `${kind}: ${detail}`).join("; ");
          console.log(
            `${result.issues.length ? "FAIL" : "PASS"} ${device} ${screen.route} ${summary}`
          );
        }
        return outcomes;
      } finally {
        await Promise.all([...contexts.values()].map(({ context }) => context.close()));
      }
    })
  );
} finally {
  await browser.close();
}
const pages = results.flat();
const failures = pages.filter(({ issues }) => issues.length > 0).length;
await writeFile(
  reportFile,
  JSON.stringify({ checked: pages.length, failures, pages }, null, 2) + "\n"
);
console.log(
  `Arabic browser matrix: ${pages.length - failures}/${pages.length} checks passed. Report: ${reportFile}`
);
process.exitCode = Number(failures > 0);
