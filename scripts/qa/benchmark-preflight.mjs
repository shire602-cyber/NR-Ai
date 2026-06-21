#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import pg from "pg";
import { chromium } from "playwright-core";

const target = (process.env.BASE_URL || process.argv[2] || "http://localhost:5000").replace(
  /\/$/,
  ""
);
const dbUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || "";
const hasExplicitE2EDb = Boolean(process.env.E2E_DATABASE_URL);
const productionHost = "nr-ai-production.up.railway.app";
const isProductionTarget = target.includes(productionHost);
const localBinSuffix = process.platform === "win32" ? ".cmd" : "";
const localPgliteBin = path.resolve("node_modules", ".bin", `pglite-server${localBinSuffix}`);

const checks = [];

function commandExists(command) {
  const probe =
    process.platform === "win32"
      ? spawnSync("where", [command], { encoding: "utf8" })
      : spawnSync("/bin/sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
  return probe.status === 0;
}

function check(name, ok, detail, fix = "") {
  checks.push({ name, ok, detail, fix });
}

async function checkDatabaseConnection(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("select 1");
    check(
      "database-connectivity",
      true,
      `Connected to ${safeDbSummary(url)}.`,
      "Verify the database accepts TCP connections and credentials."
    );
  } catch (error) {
    check(
      "database-connectivity",
      false,
      `Could not connect to ${safeDbSummary(url)}: ${error.message}`,
      "Fix E2E_DATABASE_URL or start the disposable Postgres database."
    );
  } finally {
    await client.end().catch(() => {});
  }
}

function safeDbSummary(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

check("npm", commandExists("npm"), "Required to run scripts and migrations.", "Install Node/npm.");
check("curl", commandExists("curl"), "Required by scripts/qa/bootstrap-e2e.sh.", "Install curl.");
check("jq", commandExists("jq"), "Required by scripts/qa/bootstrap-e2e.sh.", "Install jq.");
check(
  "openssl",
  commandExists("openssl"),
  "Required for local bootstrap secrets.",
  "Install openssl."
);

const dockerAvailable = commandExists("docker");
const npxAvailable = commandExists("npx");
const pgliteAvailable = commandExists("pglite-server") || fs.existsSync(localPgliteBin);
const pgliteOnDemandAvailable = pgliteAvailable || npxAvailable;
check(
  "disposable-postgres-source",
  Boolean(dbUrl) || dockerAvailable || pgliteOnDemandAvailable,
  dbUrl
    ? `Will use ${hasExplicitE2EDb ? "E2E_DATABASE_URL" : "DATABASE_URL"} (${safeDbSummary(dbUrl)}).`
    : dockerAvailable
      ? "Docker is available; bootstrap can start postgres:16-alpine."
      : pgliteAvailable
        ? "PGlite socket server is available; npm run e2e:benchmark-local can start a disposable Postgres-compatible database."
        : npxAvailable
          ? "npx is available; npm run e2e:benchmark-local can fetch PGlite socket server on demand."
          : "No Docker, PGlite socket server, npx, or E2E_DATABASE_URL/DATABASE_URL were found.",
  "Install Docker, preinstall pglite-server, keep npx/network access available, or set E2E_DATABASE_URL to a disposable Postgres database."
);

if (dbUrl && !hasExplicitE2EDb) {
  check(
    "database-url-safety",
    false,
    "DATABASE_URL is set, but E2E_DATABASE_URL is preferred so production/staging databases are not used accidentally.",
    "Set E2E_DATABASE_URL to a disposable benchmark database before running write fixtures."
  );
}

if (hasExplicitE2EDb) {
  await checkDatabaseConnection(dbUrl);
}

check(
  "production-write-guard",
  !isProductionTarget || process.env.BENCHMARK_RUN_FIXTURE === "false",
  isProductionTarget
    ? "Production target detected. Use BENCHMARK_RUN_FIXTURE=false for production crawls."
    : "Local/non-production target detected.",
  "Do not run write fixtures against production; use BASE_URL=http://localhost:5000."
);

let chromiumOk = false;
let chromiumDetail = "";
try {
  chromiumDetail = chromium.executablePath();
  chromiumOk = Boolean(chromiumDetail);
} catch (error) {
  chromiumDetail = error.message;
}
check(
  "chromium",
  chromiumOk,
  chromiumOk ? `Chromium executable resolved at ${chromiumDetail}.` : chromiumDetail,
  "Install Playwright Chromium or set CHROMIUM_PATH."
);

const failures = checks.filter((item) => !item.ok);
const result = {
  target,
  ready: failures.length === 0,
  checks,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length) {
  process.exit(1);
}
