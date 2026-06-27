#!/usr/bin/env node

/* Muhasib.ai authenticated production route crawl.
 *
 * Uses an existing smoke user and does not create accounting records. This is
 * intended for production or staging checks after the read-only smoke script
 * proves the deployed commit. Screenshots and a JSON run artifact are written
 * to tests/e2e/.artifacts/.
 *
 * Env:
 *   SMOKE_BASE_URL or BASE_URL or first arg: target app URL
 *   SMOKE_EMAIL / SMOKE_PASSWORD: existing smoke user credentials
 *   SMOKE_EXPECTED_COMMIT: optional deployed commit prefix
 *   AUTH_CRAWL_PROFILE: firm | customer | all (default firm)
 *   AUTH_CRAWL_ROUTES: optional comma-separated route override
 *   CHROMIUM_PATH: optional browser executable path
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = (process.env.SMOKE_BASE_URL || process.env.BASE_URL || process.argv[2] || "").replace(
  /\/$/,
  ""
);
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const EXPECTED_COMMIT = process.env.SMOKE_EXPECTED_COMMIT;
const PROFILE = process.env.AUTH_CRAWL_PROFILE || "firm";
const CUSTOM_ROUTES = process.env.AUTH_CRAWL_ROUTES;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, ".artifacts");
const RUN_ARTIFACT_PATH = path.join(SHOT_DIR, "authenticated-smoke-crawl-last-run.json");

const COMMON_ROUTES = [
  "/dashboard",
  "/reports",
  "/advanced-reports",
  "/notifications",
  "/task-center",
  "/backup-restore",
];

const CUSTOMER_ROUTES = [
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
];

const FIRM_ROUTES = [
  "/firm/command-center",
  "/firm/clients",
  "/firm/health",
  "/firm/value-ops",
  "/firm/comms",
  "/firm/document-chasing",
  "/firm/analytics",
  "/firm/pipeline",
];

const FAIL_TEXT = /something went wrong|an error occurred|failed to load|unexpected error/i;
const LOGIN_PATH = "/api/auth/login";

function requireEnv() {
  const missing = [];
  if (!BASE) missing.push("SMOKE_BASE_URL or BASE_URL");
  if (!EMAIL) missing.push("SMOKE_EMAIL");
  if (!PASSWORD) missing.push("SMOKE_PASSWORD");
  if (missing.length) {
    throw new Error(`Missing required authenticated crawl env: ${missing.join(", ")}`);
  }
}

function routeList() {
  if (CUSTOM_ROUTES) {
    return CUSTOM_ROUTES.split(",")
      .map((route) => route.trim())
      .filter(Boolean);
  }

  if (PROFILE === "customer") return [...COMMON_ROUTES, ...CUSTOMER_ROUTES];
  if (PROFILE === "all") return [...COMMON_ROUTES, ...CUSTOMER_ROUTES, ...FIRM_ROUTES];
  if (PROFILE !== "firm") {
    throw new Error("AUTH_CRAWL_PROFILE must be firm, customer, or all");
  }
  return [...COMMON_ROUTES, ...FIRM_ROUTES];
}

function cleanPath(url) {
  return url.replace(BASE, "").split("?")[0];
}

async function resolveExecutablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function writeRunArtifact(runState) {
  await fs.promises.writeFile(RUN_ARTIFACT_PATH, JSON.stringify(runState, null, 2));
}

async function main() {
  requireEnv();
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const routes = routeList();
  const runState = {
    baseUrl: BASE,
    profile: PROFILE,
    expectedCommit: EXPECTED_COMMIT ?? null,
    routeCount: routes.length,
    routes,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    failures: [],
  };
  await writeRunArtifact(runState);

  const version = await fetch(`${BASE}/api/version`);
  const versionBody = await readJson(version);
  if (!version.ok || versionBody?.status !== "ok" || !versionBody?.commit) {
    throw new Error(`version check failed: ${version.status} ${JSON.stringify(versionBody)}`);
  }
  if (EXPECTED_COMMIT && !String(versionBody.commit).startsWith(EXPECTED_COMMIT)) {
    throw new Error(
      `version commit ${versionBody.commit} does not match expected ${EXPECTED_COMMIT}`
    );
  }

  const browser = await chromium.launch({
    executablePath: await resolveExecutablePath(),
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const failures = [];
  let routeErrors = [];
  let apiFailures = [];

  page.on("pageerror", (error) => routeErrors.push(`JS: ${error.message.slice(0, 200)}`));
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/api/") || response.status() < 400) return;
    const apiPath = cleanPath(url);
    apiFailures.push(`${response.request().method()} ${apiPath} -> ${response.status()}`);
  });

  const fail = async (name, detail) => {
    const failure = { name, ...detail };
    failures.push(failure);
    runState.failures = failures;
    await writeRunArtifact(runState);
    try {
      await page.screenshot({
        path: path.join(SHOT_DIR, `${name.replace(/[^a-z0-9-]+/gi, "_")}.png`),
      });
    } catch {
      /* page may be gone */
    }
  };

  const login = await page.request.post(`${BASE}${LOGIN_PATH}`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  const loginBody = await login.json().catch(() => ({}));
  if (login.status() >= 300 || !loginBody?.user?.id) {
    throw new Error(`login failed: ${login.status()} ${JSON.stringify(loginBody).slice(0, 200)}`);
  }

  const authSession = await page.request.get(`${BASE}/api/auth/me`);
  const authBody = await authSession.json().catch(() => ({}));
  if (authSession.status() >= 300 || authBody?.id !== loginBody.user.id) {
    throw new Error(`auth session failed: ${authSession.status()} ${JSON.stringify(authBody)}`);
  }

  for (const route of routes) {
    routeErrors = [];
    apiFailures = [];
    try {
      await page.goto(`${BASE}${route}`, { timeout: 45000 });
      await page.waitForTimeout(1800);
      const finalPath = cleanPath(page.url());
      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const redirectedToLogin = finalPath.startsWith("/login") || finalPath.startsWith("/register");
      const redirected = !finalPath.startsWith(route);
      const blank = bodyText.trim().length < 40;
      const failText = bodyText.match(FAIL_TEXT)?.[0] ?? null;

      if (
        routeErrors.length ||
        apiFailures.length ||
        redirectedToLogin ||
        redirected ||
        blank ||
        failText
      ) {
        await fail(`route ${route}`, {
          finalPath,
          redirectedToLogin: redirectedToLogin || undefined,
          redirected: redirected || undefined,
          blank: blank || undefined,
          failText,
          js: routeErrors.slice(0, 3),
          api: [...new Set(apiFailures)].slice(0, 8),
        });
      }
    } catch (error) {
      await fail(`route ${route}`, { crash: error.message.slice(0, 200) });
    }
  }

  runState.finishedAt = new Date().toISOString();
  runState.failures = failures;
  await writeRunArtifact(runState);
  await browser.close();

  console.log(
    `\n=== Authenticated smoke route crawl: ${routes.length} routes · ${failures.length} failure(s) ===`
  );
  for (const failure of failures) console.log(JSON.stringify(failure));
  if (failures.length > 0) {
    console.log(`Artifacts: ${SHOT_DIR}`);
    process.exit(1);
  }
  console.log("Authenticated smoke route crawl passed.");
}

main().catch((error) => {
  console.error("FATAL", error.message);
  process.exit(1);
});
