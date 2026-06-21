#!/usr/bin/env node

/*
 * Competitor-grade benchmark audit harness.
 *
 * This script runs against a local synthetic app by default. It may call the
 * report-audit fixture to create data, then uses the shared report catalog for
 * report routes, screenshots major surfaces, and writes an evidence pack under
 * docs/qa/<date>-benchmark-audit/.
 *
 * Env:
 *   BASE_URL or first arg              Target app URL.
 *   BENCHMARK_OUTPUT_DIR              Optional evidence output directory.
 *   BENCHMARK_RUN_FIXTURE=false       Skip fixture creation.
 *   BENCHMARK_ALLOW_PROD_WRITES=true  Explicitly allow fixture writes to prod.
 *   BENCHMARK_EMAIL / BENCHMARK_PASSWORD
 *   REPORT_AUDIT_EMAIL / REPORT_AUDIT_PASSWORD are also honored by fixture.
 *   BENCHMARK_CRAWL_PROFILE           customer | all (default customer).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { readyReportCatalog, reportPersonaHref } from "../../client/src/lib/reportCatalog.ts";

const BASE = (process.env.BASE_URL || process.argv[2] || "").replace(/\/$/, "");
const TODAY = new Date().toISOString().slice(0, 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.resolve(
  REPO_ROOT,
  process.env.BENCHMARK_OUTPUT_DIR || `docs/qa/${TODAY}-benchmark-audit`
);
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots");
const FIXTURE_ARTIFACT = path.join(__dirname, ".artifacts", "report-audit-fixture-last-run.json");
const RUN_FIXTURE = process.env.BENCHMARK_RUN_FIXTURE !== "false";
const ALLOW_PROD_WRITES = process.env.BENCHMARK_ALLOW_PROD_WRITES === "true";
const CRAWL_PROFILE = process.env.BENCHMARK_CRAWL_PROFILE || "customer";
const PRODUCTION_HOST = "nr-ai-production.up.railway.app";
const IS_PRODUCTION = BASE.includes(PRODUCTION_HOST);
const FULL_PROD_REPORT_CRAWL = process.env.BENCHMARK_FULL_PROD_REPORT_CRAWL === "true";
const PAGE_DELAY_MS = Number(
  process.env.BENCHMARK_PAGE_DELAY_MS || (IS_PRODUCTION ? "2500" : "800")
);
const RETRY_429_MS = Number(
  process.env.BENCHMARK_RETRY_429_MS || (IS_PRODUCTION ? "10000" : "5000")
);
const MAX_RATE_LIMIT_RETRIES = Number(process.env.BENCHMARK_MAX_429_RETRIES || "3");
const MOBILE_COOLDOWN_MS = Number(
  process.env.BENCHMARK_MOBILE_COOLDOWN_MS || (IS_PRODUCTION ? "15000" : "0")
);

const competitorAnchors = [
  {
    name: "QuickBooks",
    url: "https://quickbooks.intuit.com/accounting/reporting/",
    signal:
      "Customizable reports, P&L, balance sheet, cash flow, A/R aging, drilldown, Excel sync, workflows, and backup/restore.",
    benchmark:
      "Clean report center, reusable views, exports, drilldown, accounting workflow depth, and administrative trust controls.",
  },
  {
    name: "Wafeq",
    url: "https://www.wafeq.com/en",
    signal:
      "Business-owner/accountant workflows with invoices, purchase orders, inventory, payroll, e-invoicing, and 40+ financial reports.",
    benchmark:
      "UAE/GCC accounting, VAT, e-invoicing, payroll, inventory, and regional compliance workflow.",
  },
  {
    name: "Zoho Books UAE",
    url: "https://www.zoho.com/ae/books/",
    signal:
      "UAE VAT and corporate-tax readiness plus quotes, invoicing, bills, banking, inventory, expenses, documents, reporting, payments, and automation.",
    benchmark:
      "SME breadth, UAE VAT/corporate-tax workflows, automation, invoicing, banking, inventory, and reporting.",
  },
  {
    name: "Xero",
    url: "https://www.xero.com/us/accounting-software/",
    signal:
      "Invoices, bills, bank reconciliation, smart document capture, real-time reports, sales tax, dashboards, analytics, and advanced tools.",
    benchmark:
      "Clean UX, bank reconciliation, reporting, automation, integrations, inventory/projects-adjacent workflows, and mobile usability.",
  },
  {
    name: "Digits",
    url: "https://digits.com/",
    signal:
      "Live dashboards/financials, AI-assisted close, bank statement collection, anomaly/error flags, custom checklists, and management reporting.",
    benchmark:
      "AI-native finance workflows, anomaly review, automated close, and stakeholder-ready management reporting.",
  },
];

const benchmarkAreas = [
  ["Accounting integrity", "GL balances, subledger tie-outs, period lock, audit trail."],
  ["UAE tax and compliance", "VAT 201, corporate tax, WPS, e-invoice readiness, Arabic/RTL."],
  [
    "Report center and precision",
    "Catalog discovery, one-report view, source basis, export, drilldown.",
  ],
  [
    "Receivables and payables",
    "Invoices, credit notes, customer/vendor balances, bills, payments.",
  ],
  ["Banking and reconciliation", "Statement import, match rules, unreconciled queue, cash proof."],
  [
    "Payroll, inventory, and assets",
    "Payroll/WPS, inventory valuation/movement, fixed assets, depreciation.",
  ],
  [
    "Automation and AI close",
    "Receipt autopost, anomaly review, AI GL, reminders, delivery handoffs.",
  ],
  [
    "UX, mobile, and accessibility",
    "Density, hierarchy, keyboard flow, mobile 375px, no overflow.",
  ],
  [
    "Trust and administration",
    "Security page, backup/restore, incident process, privacy/DPA posture.",
  ],
  [
    "Reliability and release gates",
    "Checks, E2E, smoke, production commit verification, dependency audit.",
  ],
];

const customerRoutes = [
  "/dashboard",
  "/reports",
  "/advanced-reports",
  "/invoices",
  "/receipts",
  "/bank-reconciliation",
  "/vat-filing",
  "/corporate-tax",
  "/document-vault",
  "/payment-chasing",
  "/contacts",
  "/integrations",
  "/subscription",
  "/backup-restore",
];

const firmRoutes = [
  "/firm/command-center",
  "/firm/clients",
  "/firm/health",
  "/firm/value-ops",
  "/firm/comms",
  "/firm/document-chasing",
  "/firm/analytics",
  "/firm/pipeline",
];

const defaultMobileRoutes = IS_PRODUCTION
  ? ["/dashboard", "/reports"]
  : ["/dashboard", "/reports", "/invoices", "/vat-filing", "/bank-reconciliation"];
const mobileRoutes = process.env.BENCHMARK_MOBILE_ROUTES
  ? process.env.BENCHMARK_MOBILE_ROUTES.split(",")
      .map((route) => route.trim())
      .filter(Boolean)
  : defaultMobileRoutes;
const failText = /something went wrong|an error occurred|failed to load|unexpected error/i;
const productionReportSampleIds = new Set([
  "profit-loss",
  "balance-sheet",
  "cash-flow",
  "ar-aging",
  "ap-aging",
  "vat-return",
  "general-ledger",
  "consolidated-statements",
]);

const state = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  baseUrl: BASE || null,
  outputDir: OUTPUT_DIR,
  mode: "benchmark-audit",
  version: null,
  account: null,
  company: null,
  created: {},
  fixtureProbes: [],
  fixtureWarnings: [],
  fixtureMode: {
    runFixture: RUN_FIXTURE,
    allowProductionWrites: ALLOW_PROD_WRITES,
    productionTarget: IS_PRODUCTION,
  },
  routeChecks: [],
  reportChecks: [],
  reportScope: null,
  mobileChecks: [],
  blockers: [],
  screenshots: [],
  rateLimitRetries: [],
};

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mdEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function addBlocker(scope, message, detail = null) {
  state.blockers.push({ scope, message, detail });
}

async function ensureDirs() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${pathname} -> ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

function runFixture() {
  if (!RUN_FIXTURE) return { skipped: true };
  if (BASE.includes(PRODUCTION_HOST) && !ALLOW_PROD_WRITES) {
    addBlocker(
      "fixture",
      "Refused to run synthetic write fixture against production without BENCHMARK_ALLOW_PROD_WRITES=true."
    );
    return { skipped: true, refused: true };
  }

  const result = spawnSync(process.execPath, ["tests/e2e/report-audit-fixture.mjs", BASE], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    addBlocker("fixture", "Report audit fixture failed.", {
      status: result.status,
      stderr: result.stderr.slice(-2000),
      stdout: result.stdout.slice(-2000),
    });
  }
  return result;
}

async function loadFixtureArtifact() {
  let artifact = null;
  try {
    artifact = await readJsonFile(FIXTURE_ARTIFACT);
  } catch {
    addBlocker(
      "fixture",
      `Missing fixture artifact at ${path.relative(REPO_ROOT, FIXTURE_ARTIFACT)}.`
    );
    return null;
  }

  if (String(artifact.baseUrl || "").replace(/\/$/, "") !== BASE) {
    addBlocker("fixture", "Fixture artifact base URL does not match benchmark target.", {
      artifactBaseUrl: artifact.baseUrl,
      targetBaseUrl: BASE,
    });
    return null;
  }

  state.account = artifact.account
    ? { email: artifact.account.email, reused: Boolean(artifact.account.reused) }
    : null;
  state.company = artifact.company || null;
  state.created = artifact.created || {};
  state.fixtureProbes = artifact.probes || [];
  state.fixtureWarnings = artifact.warnings || [];
  return artifact;
}

async function resolveExecutablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

async function runBrowserAudit(credentials) {
  if (!credentials?.email || !credentials?.password) {
    addBlocker(
      "auth",
      "No benchmark credentials available. Run fixture or set BENCHMARK_EMAIL/BENCHMARK_PASSWORD."
    );
    return;
  }

  const browser = await chromium.launch({
    executablePath: await resolveExecutablePath(),
    args: ["--no-sandbox"],
  });

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: credentials.email, password: credentials.password },
    });
    const loginBody = await login.json().catch(() => ({}));
    if (login.status() >= 300 || !loginBody?.user?.id) {
      addBlocker("auth", "Login failed for benchmark crawl.", {
        status: login.status(),
        body: JSON.stringify(loginBody).slice(0, 300),
      });
      return;
    }

    const routes = CRAWL_PROFILE === "all" ? [...customerRoutes, ...firmRoutes] : customerRoutes;
    for (const route of routes) {
      await checkPage(page, route, state.routeChecks, `route-${slug(route)}`);
    }

    const requestedReportIds = process.env.BENCHMARK_REPORT_IDS
      ? new Set(
          process.env.BENCHMARK_REPORT_IDS.split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        )
      : null;
    const reportsToCheck = readyReportCatalog.filter((report) => {
      if (requestedReportIds) return requestedReportIds.has(report.id);
      if (IS_PRODUCTION && !FULL_PROD_REPORT_CRAWL) return productionReportSampleIds.has(report.id);
      return true;
    });
    state.reportScope = {
      mode: requestedReportIds
        ? "explicit"
        : IS_PRODUCTION && !FULL_PROD_REPORT_CRAWL
          ? "production-representative-sample"
          : "all-ready-reports",
      checked: reportsToCheck.length,
      totalReadyReports: readyReportCatalog.length,
    };

    for (const report of reportsToCheck) {
      const href = reportPersonaHref(report, "owner");
      if (!href) {
        state.reportChecks.push({
          id: report.id,
          name: report.name,
          category: report.category,
          href: null,
          ok: false,
          issue: "No href resolved from report catalog.",
        });
        continue;
      }
      const check = await checkPage(page, href, null, `report-${slug(report.id)}`);
      const body = check.bodyText || "";
      state.reportChecks.push({
        id: report.id,
        name: report.name,
        category: report.category,
        href,
        ok: check.ok,
        screenshot: check.screenshot,
        hasBackToReports: /back to reports/i.test(body),
        hasExport: /\b(export|download|csv|excel|pdf)\b/i.test(body),
        hasPeriodControl: /\b(period|date range|as of|from|to)\b/i.test(body),
        issue: check.issue || null,
      });
    }

    if (MOBILE_COOLDOWN_MS > 0) {
      await page.waitForTimeout(MOBILE_COOLDOWN_MS);
    }
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const mobilePage = await mobileCtx.newPage();
      const mobileLogin = await mobilePage.request.post(`${BASE}/api/auth/login`, {
        data: { email: credentials.email, password: credentials.password },
      });
      if (mobileLogin.status() >= 300) {
        state.mobileChecks.push({
          href: "/login",
          ok: false,
          issue: `Mobile benchmark login failed with HTTP ${mobileLogin.status()}.`,
          screenshot: null,
          bodyText: "",
        });
      } else {
        for (const route of mobileRoutes) {
          await checkPage(mobilePage, route, state.mobileChecks, `mobile-${slug(route)}`);
        }
      }
    } finally {
      await mobileCtx.close();
    }
  } finally {
    await browser.close();
  }
}

async function checkPage(page, href, targetList, screenshotBase) {
  const first = await checkPageOnce(page, href, targetList, screenshotBase);
  if (
    first.issue &&
    first.issue.includes("429") &&
    state.rateLimitRetries.length < MAX_RATE_LIMIT_RETRIES
  ) {
    state.rateLimitRetries.push({ href, waitedMs: RETRY_429_MS });
    await page.waitForTimeout(RETRY_429_MS);
    const retry = await checkPageOnce(page, href, null, screenshotBase);
    if (targetList) targetList[targetList.length - 1] = retry;
    return retry;
  }
  return first;
}

async function checkPageOnce(page, href, targetList, screenshotBase) {
  const result = { href, ok: false, issue: null, screenshot: null, bodyText: "" };
  const pageErrors = [];
  const apiFailures = [];
  const onError = (error) => pageErrors.push(error.message.slice(0, 200));
  const onResponse = (response) => {
    if (response.url().includes("/api/") && response.status() >= 400) {
      apiFailures.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    }
  };
  page.on("pageerror", onError);
  page.on("response", onResponse);
  try {
    await page.goto(`${BASE}${href}`, { timeout: 45000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const currentPath = new URL(page.url()).pathname;
    const blank = bodyText.trim().length < 40;
    const failureText = bodyText.match(failText)?.[0] || null;
    const redirectedToAuth =
      currentPath.startsWith("/login") || currentPath.startsWith("/register");
    const screenshotPath = path.join(SCREENSHOT_DIR, `${screenshotBase}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const relativeScreenshotPath = path.relative(OUTPUT_DIR, screenshotPath);
    if (!state.screenshots.includes(relativeScreenshotPath)) {
      state.screenshots.push(relativeScreenshotPath);
    }
    result.screenshot = relativeScreenshotPath;
    result.bodyText = bodyText;
    if (blank || failureText || redirectedToAuth || pageErrors.length || apiFailures.length) {
      result.issue = JSON.stringify({
        blank: blank || undefined,
        failureText,
        redirectedToAuth: redirectedToAuth || undefined,
        pageErrors: pageErrors.slice(0, 3),
        apiFailures: [...new Set(apiFailures)].slice(0, 6),
      });
    } else {
      result.ok = true;
    }
  } catch (error) {
    result.issue = error.message.slice(0, 500);
  } finally {
    page.off("pageerror", onError);
    page.off("response", onResponse);
    if (PAGE_DELAY_MS > 0) await page.waitForTimeout(PAGE_DELAY_MS);
  }
  if (targetList) targetList.push(result);
  return result;
}

function score(areaName) {
  if (state.blockers.length) return 0;
  const fixturePassed =
    state.fixtureProbes.length > 0 && state.fixtureProbes.every((probe) => probe.passed === true);
  const routesPassed = state.routeChecks.length > 0 && state.routeChecks.every((route) => route.ok);
  const reportsPassed =
    state.reportChecks.length > 0 && state.reportChecks.every((report) => report.ok);
  const mobilePassed =
    state.mobileChecks.length > 0 && state.mobileChecks.every((route) => route.ok);
  if (["Accounting integrity", "UAE tax and compliance"].includes(areaName)) {
    return fixturePassed ? 4 : 2;
  }
  if (areaName === "Report center and precision") {
    const shellGaps = state.reportChecks.filter(
      (report) =>
        report.ok && (!report.hasBackToReports || !report.hasExport || !report.hasPeriodControl)
    ).length;
    if (!reportsPassed) return 2;
    return shellGaps ? 3 : 4;
  }
  if (areaName === "UX, mobile, and accessibility") return routesPassed && mobilePassed ? 4 : 2;
  if (areaName === "Reliability and release gates") return routesPassed ? 4 : 2;
  return fixturePassed && routesPassed ? 4 : 3;
}

function isRateLimitOnly(issue) {
  if (!issue || !issue.includes("429")) return false;
  const lowered = issue.toLowerCase();
  return (
    lowered.includes("apiFailures".toLowerCase()) &&
    !lowered.includes('pageerrors":["') &&
    !lowered.includes('failuretext":"something') &&
    !lowered.includes('failuretext":"an error') &&
    !lowered.includes('redirectedtoauth":true')
  );
}

function topGaps() {
  const gaps = [];
  const hasFixtureBlocker = state.blockers.some((blocker) => blocker.scope === "fixture");
  if (!state.fixtureProbes.length && !hasFixtureBlocker) {
    gaps.push({
      priority: IS_PRODUCTION && !ALLOW_PROD_WRITES ? "P1" : "P0",
      area: "Synthetic accounting coverage",
      finding:
        "No synthetic accounting fixture probes ran, so accountant-grade correctness remains unscored.",
      evidence: IS_PRODUCTION
        ? "Production run was intentionally read-only; route/report rendering evidence is valid, but trial balance, VAT/CT tie-outs, and subledger probes require a local synthetic run."
        : "Run the report-audit fixture against a local Postgres-backed app before scoring accounting/tax parity.",
      fix: "Run `bash scripts/qa/bootstrap-e2e.sh`, then `BASE_URL=http://localhost:5000 npm run e2e:benchmark-audit` and review the generated probes.",
    });
  }
  for (const blocker of state.blockers) {
    gaps.push({
      priority: "P0",
      area: blocker.scope,
      finding: blocker.message,
      evidence: blocker.detail
        ? JSON.stringify(blocker.detail).slice(0, 240)
        : "Benchmark blocked.",
      fix: "Resolve this before claiming benchmark coverage.",
    });
  }
  for (const route of [...state.routeChecks, ...state.mobileChecks].filter((item) => !item.ok)) {
    const rateLimitOnly = isRateLimitOnly(route.issue);
    gaps.push({
      priority: rateLimitOnly ? "P1" : "P0",
      area: rateLimitOnly ? "Rate-limit pressure" : "Route crawl",
      finding: rateLimitOnly
        ? `${route.href} hit API 429 during benchmark crawl.`
        : `${route.href} failed benchmark crawl.`,
      evidence: route.issue || "Route did not pass.",
      fix: rateLimitOnly
        ? "Tune audit pacing or production read-rate limits; confirm normal manual usage is unaffected."
        : "Fix crash, auth redirect, blank state, or failing API before scoring workflow parity.",
    });
  }
  for (const report of state.reportChecks.filter((item) => !item.ok)) {
    gaps.push({
      priority: "P1",
      area: "Reports",
      finding: `${report.name} did not render cleanly.`,
      evidence: report.issue || report.href || report.id,
      fix: "Repair report route/rendering before report precision scoring.",
    });
  }
  for (const report of state.reportChecks.filter(
    (item) => item.ok && (!item.hasBackToReports || !item.hasExport || !item.hasPeriodControl)
  )) {
    gaps.push({
      priority: "P1",
      area: "Report shell",
      finding: `${report.name} is missing benchmark shell controls.`,
      evidence: `back=${report.hasBackToReports}, export=${report.hasExport}, period=${report.hasPeriodControl}`,
      fix: "Bring report into shared shell or add equivalent back/export/period controls.",
    });
  }
  for (const warning of state.fixtureWarnings) {
    gaps.push({
      priority: "P2",
      area: "Fixture warning",
      finding: warning.name || "Fixture warning",
      evidence: warning.message || JSON.stringify(warning).slice(0, 240),
      fix: "Review warning and decide whether it reflects product or fixture setup.",
    });
  }
  return gaps.slice(0, 10);
}

function table(headers, rows) {
  return [
    `| ${headers.map(mdEscape).join(" |")} |`,
    `| ${headers.map(() => "---").join(" |")} |`,
    ...rows.map((row) => `| ${row.map(mdEscape).join(" |")} |`),
  ].join("\n");
}

async function writeDocs() {
  state.finishedAt = new Date().toISOString();
  const gaps = topGaps();
  const reportRows = state.reportChecks.map((report) => [
    report.name,
    report.category,
    report.ok ? "Pass" : "Fail",
    report.hasBackToReports === undefined ? "n/a" : report.hasBackToReports ? "yes" : "no",
    report.hasExport === undefined ? "n/a" : report.hasExport ? "yes" : "no",
    report.hasPeriodControl === undefined ? "n/a" : report.hasPeriodControl ? "yes" : "no",
    report.screenshot || "",
  ]);

  await fs.writeFile(
    path.join(OUTPUT_DIR, "benchmark-run.json"),
    `${JSON.stringify(state, null, 2)}\n`
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "competitor-scorecard.md"),
    `# Competitor Benchmark Scorecard - ${TODAY}

Target: ${BASE || "not provided"}

## Competitor Anchors

${table(
  ["Competitor", "Official source", "Benchmark bar"],
  competitorAnchors.map((item) => [item.name, item.url, item.benchmark])
)}

## Source Signals

${table(
  ["Competitor", "Official signal used for scoring"],
  competitorAnchors.map((item) => [item.name, item.signal])
)}

## Scorecard

${table(
  ["Area", "Score / 5", "Benchmark expectation"],
  benchmarkAreas.map(([area, expectation]) => [area, String(score(area)), expectation])
)}

## Evidence Summary

- Fixture probes: ${state.fixtureProbes.filter((probe) => probe.passed).length}/${state.fixtureProbes.length} passed.
- Fixture mode: ${RUN_FIXTURE ? "write fixture requested" : "fixture skipped"}${IS_PRODUCTION && !ALLOW_PROD_WRITES ? " (production write guard active)" : ""}.
- Route crawl: ${state.routeChecks.filter((route) => route.ok).length}/${state.routeChecks.length} passed.
- Report views: ${state.reportChecks.filter((report) => report.ok).length}/${state.reportChecks.length} passed (${state.reportScope?.mode || "not-run"}).
- Mobile views: ${state.mobileChecks.filter((route) => route.ok).length}/${state.mobileChecks.length} passed.
- Blockers: ${state.blockers.length}.
- Rate-limit retries: ${state.rateLimitRetries.length}.
`
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "01-accountant-log.md"),
    `# Accountant Log - ${TODAY}

## Synthetic Company

${state.company ? table(["Field", "Value"], Object.entries(state.company)) : "No company was created or loaded."}

## Created Records

${Object.keys(state.created).length ? table(["Record type", "Count"], Object.entries(state.created)) : "No fixture-created record counts available."}

## Fixture Probes

${
  state.fixtureProbes.length
    ? table(
        ["Probe", "Result", "Detail"],
        state.fixtureProbes.map((probe) => [
          probe.name,
          probe.passed ? "Pass" : "Fail",
          JSON.stringify(probe.detail || {}),
        ])
      )
    : "No fixture probes ran."
}
`
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "02-reviewer-memo.md"),
    `# Reviewer Memo - ${TODAY}

## Route And Report Review

${table(
  ["Surface", "Passed", "Failed"],
  [
    [
      "Authenticated routes",
      String(state.routeChecks.filter((item) => item.ok).length),
      String(state.routeChecks.filter((item) => !item.ok).length),
    ],
    [
      "Report views",
      String(state.reportChecks.filter((item) => item.ok).length),
      String(state.reportChecks.filter((item) => !item.ok).length),
    ],
    [
      "Mobile routes",
      String(state.mobileChecks.filter((item) => item.ok).length),
      String(state.mobileChecks.filter((item) => !item.ok).length),
    ],
  ]
)}

## Report Shell Grid

${reportRows.length ? table(["Report", "Category", "Render", "Back", "Export", "Period", "Screenshot"], reportRows) : "No report screenshots captured."}

## Reviewer Verdict

${state.blockers.length ? "Blocked. The benchmark run cannot support an adoption verdict until the P0 blockers are cleared." : gaps.some((gap) => gap.priority === "P0") ? "Not benchmark-ready. P0 route, rendering, or local fixture coverage defects remain." : gaps.some((gap) => gap.priority === "P1") ? "Deployment evidence captured, but P1 benchmark gaps remain before market-readiness claims." : "Pilot benchmark evidence captured. P2 gaps should be ranked before feature expansion."}
`
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "03-cfo-audit-report.md"),
    `# CFO Benchmark Audit Report - ${TODAY}

## Executive Verdict

${state.blockers.length ? "No market-readiness verdict can be issued because the benchmark was blocked before full evidence collection." : state.fixtureProbes.length === 0 ? "Production read-only evidence is useful for deployment confidence, but the full accountant-grade benchmark is not complete until the local synthetic fixture probes pass." : "Muhasib.ai has enough benchmark evidence to rank gaps, but any score below 5 means the product should not claim full parity for that area."}

## QuickBooks-Parity Matrix

${table(
  ["Capability", "Rating", "Evidence"],
  [
    [
      "Memorized/saved reports",
      "Review",
      "Report catalog and saved-view behavior require manual verification.",
    ],
    [
      "Class/location/project tracking",
      "Review",
      "Cost center P&L exists; multi-dimensional drilldown depth must be scored from screenshots.",
    ],
    [
      "Customer/vendor centers",
      "Review",
      "Balances and contacts routes are crawled; single-pane depth must be reviewed.",
    ],
    [
      "Bank feeds and rules",
      "Review",
      "Manual import/reconciliation is tested; live provider credentials are outside this audit.",
    ],
    [
      "Multi-currency revaluation",
      "Review",
      "Fixture probes FX exposure; historical revaluation depth needs reviewer scoring.",
    ],
    [
      "UAE tax reporting",
      "Review",
      "VAT/CT fixture and route evidence are captured when local DB is available.",
    ],
    ["Report drilldown/export", "Review", "Report shell grid marks missing controls explicitly."],
    [
      "Audit trail and permissions",
      "Review",
      "Route crawl plus fixture probes are evidence; role matrix needs dedicated scoring.",
    ],
  ]
)}

## Top 10 Gap Queue

${
  gaps.length
    ? table(
        ["Priority", "Area", "Finding", "Evidence", "Required fix"],
        gaps.map((gap) => [gap.priority, gap.area, gap.finding, gap.evidence, gap.fix])
      )
    : "No P0/P1/P2 gaps detected by the automated benchmark harness."
}
`
  );

  await fs.writeFile(
    path.join(OUTPUT_DIR, "README.md"),
    `# Benchmark Audit Evidence - ${TODAY}

Run target: ${BASE || "not provided"}

Files:

- \`competitor-scorecard.md\`
- \`01-accountant-log.md\`
- \`02-reviewer-memo.md\`
- \`03-cfo-audit-report.md\`
- \`benchmark-run.json\`
- \`screenshots/\`

This evidence pack is synthetic-audit output. It is not third-party certification and should not be used as a parity claim without reviewer sign-off.
If the fixture probes are empty, treat this as a deployment/read-only crawl only, not a full accounting correctness audit.
`
  );
}

async function main() {
  await ensureDirs();
  if (!BASE) {
    addBlocker("environment", "BASE_URL or first argument is required.");
    await writeDocs();
    process.exit(1);
  }

  try {
    state.version = await fetchJson("/api/version");
  } catch (error) {
    addBlocker(
      "environment",
      `Target app is not reachable or did not return /api/version: ${error.message}`
    );
    await writeDocs();
    process.exit(1);
  }

  runFixture();
  const envCredentialsProvided = Boolean(
    (process.env.BENCHMARK_EMAIL || process.env.REPORT_AUDIT_EMAIL) &&
    (process.env.BENCHMARK_PASSWORD || process.env.REPORT_AUDIT_PASSWORD)
  );
  const artifact = RUN_FIXTURE || !envCredentialsProvided ? await loadFixtureArtifact() : null;
  const credentials = {
    email:
      process.env.BENCHMARK_EMAIL ||
      process.env.REPORT_AUDIT_EMAIL ||
      artifact?.account?.email ||
      null,
    password:
      process.env.BENCHMARK_PASSWORD ||
      process.env.REPORT_AUDIT_PASSWORD ||
      artifact?.account?.password ||
      null,
  };

  try {
    await runBrowserAudit(credentials);
  } catch (error) {
    addBlocker("browser", `Browser benchmark crawl failed: ${error.message}`);
  }

  await writeDocs();

  if (state.blockers.length || topGaps().some((gap) => gap.priority === "P0")) {
    console.error(
      `Benchmark audit completed with blockers. Evidence: ${path.relative(REPO_ROOT, OUTPUT_DIR)}`
    );
    process.exit(1);
  }
  console.log(`Benchmark audit completed. Evidence: ${path.relative(REPO_ROOT, OUTPUT_DIR)}`);
}

main().catch(async (error) => {
  addBlocker("fatal", error.message);
  await writeDocs().catch(() => {});
  console.error(error);
  process.exit(1);
});
