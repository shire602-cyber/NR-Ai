// Run with a disposable local app: BASE_URL=http://127.0.0.1:5000 node tests/e2e/excel-export-feedback.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { dubaiToday } from "../helpers/dates.mjs";

const base = new URL(process.env.BASE_URL || "http://127.0.0.1:5000");
assert.ok(
  ["http:", "https:"].includes(base.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
  "Use the export feedback test with a disposable local app"
);
const excelPath = (url) => url.pathname === "/api/export/excel";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
  await context.addInitScript(() => {
    localStorage.setItem("muhasib_auth_hint", "1");
    localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: "en" }, version: 0 }));
  });

  async function json(path, options) {
    const response = await context.request.fetch(new URL(path, base).href, options);
    if (!response.ok()) {
      throw new Error(`${path} returned HTTP ${response.status()}: ${await response.text()}`);
    }
    return response.json();
  }

  const email = `export-feedback+${randomUUID()}@test.local`;
  const password = "Password123!";
  await json("/api/auth/register", {
    method: "POST",
    data: { email, password, name: "Export Feedback QA", companyName: "Export Feedback Trading" },
  });
  const { token } = await json("/api/auth/login", { method: "POST", data: { email, password } });
  const headers = { Authorization: `Bearer ${token}` };
  const [company] = await json("/api/companies", { headers });
  const companyPath = `/api/companies/${company.id}`;
  await json(companyPath, { method: "PATCH", headers, data: { emirate: "dubai" } });
  const date = dubaiToday();
  await json(`${companyPath}/invoices`, {
    method: "POST",
    headers,
    data: {
      customerName: "Feedback Customer",
      date,
      dueDate: date,
      lines: [{ description: "Test service", quantity: 1, unitPrice: 120, vatRate: 5 }],
    },
  });
  await json(`${companyPath}/receipts`, {
    method: "POST",
    headers,
    data: {
      merchant: "Feedback Supplier",
      date,
      amount: 105,
      vatAmount: 5,
      category: "Office Supplies",
      currency: "AED",
    },
  });

  const onboarding = await context.newPage();
  await onboarding.goto(new URL("/onboarding", base).href);
  for (const id of ["onboarding-express", "onboarding-skip", "onboarding-task-explore"]) {
    await onboarding.getByTestId(id).click();
  }
  await onboarding.waitForURL((url) => url.pathname === "/dashboard");
  await onboarding.close();

  for (const [path, trigger, item, filename] of [
    [
      "/reports?tab=ledger&report=general-ledger&persona=accountant",
      "button-export",
      "menu-export-excel",
      "general_ledger",
    ],
    ["/invoices", "button-export-invoices", "menu-export-invoices-excel", "invoices"],
    ["/receipts", "button-export-expenses", "menu-export-expenses-excel", "expenses"],
  ]) {
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    try {
      await page.goto(new URL(path, base).href);
      const button = page.getByTestId(trigger);
      const success = page.getByText("Export successful", { exact: true });
      const failure = page.getByText("Export failed", { exact: true });
      async function clickExport() {
        const excelItem = page.getByTestId(item);
        await excelItem.waitFor({ state: "hidden" });
        await button.click();
        await excelItem.waitFor({ state: "visible" });
        await excelItem.click();
        await excelItem.waitFor({ state: "hidden" });
      }

      const workbookRequest = (request) =>
        request.method() === "POST" && excelPath(new URL(request.url()));
      async function delayWorkbook(respond) {
        let release;
        const blocked = new Promise((resolve) => (release = resolve));
        const handler = async (route) => {
          if (!workbookRequest(route.request())) return route.fallback();
          await blocked;
          await respond(route);
        };
        await page.route(excelPath, handler);
        return { release, remove: () => page.unroute(excelPath, handler) };
      }

      const rejected = await delayWorkbook((route) =>
        route.fulfill({ status: 422, json: { message: "Workbook unavailable" } })
      );
      const failedResponse = page.waitForResponse(
        (response) => workbookRequest(response.request()) && response.status() === 422
      );
      try {
        const started = page.waitForRequest(workbookRequest);
        await clickExport();
        await started;
        assert.equal(
          await success.count(),
          0,
          `${path} announced success while the request was pending`
        );
        assert.equal(await button.isDisabled(), true);
      } finally {
        rejected.release();
      }
      await failedResponse;
      await rejected.remove();
      await failure.waitFor({ state: "visible" });
      assert.equal(await success.count(), 0, `${path} announced success after the rejection`);
      assert.equal(await button.isEnabled(), true);

      const accepted = await delayWorkbook((route) => route.continue());
      const acceptedDownload = Promise.all([
        page.waitForResponse((response) => workbookRequest(response.request()) && response.ok()),
        page.waitForEvent("download", {
          predicate: (download) => download.suggestedFilename().startsWith(filename),
        }),
      ]);
      try {
        const started = page.waitForRequest(workbookRequest);
        await clickExport();
        await started;
        assert.equal(await success.count(), 0, `${path} announced success before download`);
        assert.equal(await button.isDisabled(), true);
      } finally {
        accepted.release();
      }
      const [, file] = await acceptedDownload;
      assert.ok(await file.path(), `${path} did not download a file`);
      await accepted.remove();
      await success.waitFor({ state: "visible" });
      assert.equal(await button.isEnabled(), true);
      assert.deepEqual(pageErrors, []);
      console.log(`${path} reports rejection and waits for the completed Excel download`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
