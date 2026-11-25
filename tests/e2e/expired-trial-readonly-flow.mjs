#!/usr/bin/env node
// Run against a local app with BILLING_ENFORCEMENT=true and a disposable local Postgres database.
// Set BASE_URL, DATABASE_URL and CHROMIUM_PATH as for books-pages-flow.mjs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import pg from "pg";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const base = new URL(process.env.BASE_URL || "http://localhost:5000");
const database = new URL(process.env.DATABASE_URL || "postgres://localhost/missing-fixture-db");
assert(
  process.env.DATABASE_URL && localHosts.has(database.hostname) && localHosts.has(base.hostname),
  "Use a disposable local DATABASE_URL and a local BASE_URL."
);
const FAKE_PASSWORD = "Fake-Password-123";
const email = `trial-owner-${randomUUID()}@harness.test`;
let token;

async function api(method, path, body) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, `${method} ${path} returned ${response.status}`);
  return response.json();
}

const db = new pg.Client({ connectionString: database.href });
await db.connect();
try {
  await api("POST", "/api/auth/register", { name: "Trial Owner", email, password: FAKE_PASSWORD });
  ({ token } = await api("POST", "/api/auth/login", { email, password: FAKE_PASSWORD }));
  const [company] = await api("GET", "/api/companies");
  const companyId = company.id;
  await db.query(
    "UPDATE companies SET onboarding_completed = true, trn_vat_number = '100123456700003', emirate = 'dubai' WHERE id = $1",
    [companyId]
  );
  const {
    rows: [run],
  } = await db.query(
    `INSERT INTO payroll_runs (company_id, period_month, period_year, status, sif_file_content, sif_file_name, sif_generated_at)
     VALUES ($1, 4, 2026, 'approved', 'saved fixture SIF', 'saved.SIF', now()) RETURNING id`,
    [companyId]
  );
  const [period] = await api("GET", `/api/vat/autopilot/periods/${companyId}`);
  assert(period, "Expected a selectable VAT period");
  const start = period.periodStart.slice(0, 10);
  const query = new URLSearchParams({
    periodStart: start,
    periodEnd: period.periodEnd.slice(0, 10),
    frequency: period.frequency,
  });
  const calculationPath = `/api/vat/autopilot/calculate/${companyId}`;
  const { periodId } = await api("GET", `${calculationPath}?${query}`);
  assert(periodId, "Expected a saved VAT snapshot");
  const snapshot = async () =>
    (await db.query("SELECT * FROM vat_return_periods WHERE id = $1", [periodId])).rows[0];
  const before = await snapshot();
  await db.query(
    "UPDATE subscriptions SET trial_ends_at = now() - interval '1 day' WHERE company_id = $1",
    [companyId]
  );
  const billing = await api("GET", `/api/companies/${companyId}/billing/subscription`);
  assert.equal(billing.trialLocked, true);

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript((id) => {
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "en" }, version: 0 }));
      localStorage.setItem("cookie-consent", "accepted");
      localStorage.setItem("muhasib_active_company_id", id);
    }, companyId);
    const page = await context.newPage();
    await page.goto(new URL("/login", base).href);
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(FAKE_PASSWORD);
    await page.getByTestId("button-login").click();
    await page.waitForURL((url) => url.pathname !== "/login");

    const payrollRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/payroll-runs/${run.id}/generate-sif`) {
        payrollRequests.push(request.method());
      }
    });
    await page.goto(new URL("/payroll", base).href);
    await page.getByTestId("trial-readonly-banner").waitFor();
    const april = page.getByRole("row").filter({ hasText: /April 2026/ });
    const pay = april.getByRole("button", { name: "Record payment" });
    await pay.waitFor();
    assert(await pay.isDisabled());
    assert(await page.getByRole("button", { name: "New payroll run" }).isDisabled());
    await april.getByRole("button", { name: "More actions" }).click();
    assert(await page.getByRole("menuitem", { name: "Unapprove" }).isDisabled());
    await page.keyboard.press("Escape");
    await april.getByRole("button", { name: "View", exact: true }).click();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SIF" }).click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), "saved.SIF");
    assert.equal(await readFile(await download.path(), "utf8"), "saved fixture SIF");
    assert.deepEqual(payrollRequests, ["GET"]);

    await page.goto(new URL("/vat-filing?tab=periods", base).href);
    const previewEvent = page.waitForResponse(
      (response) => new URL(response.url()).pathname === calculationPath
    );
    await page.getByTestId(`button-select-vat-period-${start}`).click();
    const preview = await previewEvent;
    assert(preview.ok());
    assert.equal(new URL(preview.url()).searchParams.get("persist"), "false");
    await page.getByText("Box 14", { exact: false }).waitFor();
    assert(await page.getByRole("button", { name: "Add manual adjustment" }).isDisabled());
    assert(await page.getByTestId("button-mark-ready").isDisabled());
    assert.deepEqual(await snapshot(), before);
    console.log(
      "Expired owner downloaded saved SIF and previewed VAT without changing the snapshot."
    );
  } finally {
    await browser.close();
  }
} finally {
  await db.end();
}
