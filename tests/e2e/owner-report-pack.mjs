// Requires the app running against a disposable local database. Registers one customer.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { chromium } from "playwright-core";
import { isEnglishLine } from "./lib/latin-text.mjs";

const base = new URL(process.env.BASE_URL || "http://127.0.0.1:5000");
assert.ok(
  ["http:", "https:"].includes(base.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
  "Use the report pack test with a disposable local app"
);

const expectedSheetCounts = { owner: 66, freelancer: 61, accountant: 82 };
const expected = {
  en: {
    sheet: "Automation Starters",
    setup: "Setup Steps",
    firstStep: "Review invoices and upload a CSV bank statement",
    action: "Primary Action",
    actionValue: "Launch cash autopilot",
  },
  ar: {
    sheet: "بدايات الأتمتة",
    setup: "خطوات الإعداد",
    firstStep: "راجع الفواتير وارفع كشف حساب بنكي بصيغة CSV",
    action: "الإجراء الأساسي",
    actionValue: "إطلاق الأتمتة الذاتية للنقد",
  },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function reportContext(locale, storageState) {
  const context = await browser.newContext({ storageState, acceptDownloads: true });
  await context.addInitScript((lang) => {
    localStorage.setItem("muhasib_auth_hint", "1");
    localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale: lang }, version: 0 }));
  }, locale);
  return context;
}

async function openReportPack(page, persona, locale, minimumSheets) {
  await page.goto(new URL("/reports?workspace=setup&persona=" + persona, base).href);
  const button = page.getByTestId("button-export-workspace-pack-" + persona);
  await button.waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("lang"), locale);

  const downloaded = page.waitForEvent("download").catch(() => null);
  const [response] = await Promise.all([
    page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === "/api/export/excel" &&
        result.request().method() === "POST"
    ),
    button.click(),
  ]);
  const label = locale + " " + persona;
  assert.equal(response.status(), 200, label + " export returned HTTP " + response.status());
  const download = await downloaded;
  assert.ok(download, label + " export did not initiate a browser download");
  assert.match(download.suggestedFilename(), new RegExp("^" + persona + "_report_pack.*\\.xlsx$"));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  const { sheets } = response.request().postDataJSON();
  assert.ok(sheets.length >= minimumSheets, label + " report pack was incomplete");
  assert.equal(workbook.worksheets.length, sheets.length);
  assert.ok(
    workbook.worksheets.every((sheet) => Boolean(sheet.views[0].rightToLeft) === (locale === "ar"))
  );
  if (locale === "ar") {
    const englishSheetNames = workbook.worksheets
      .map((sheet) => sheet.name)
      .filter((name) => isEnglishLine(name));
    assert.deepEqual(englishSheetNames, [], label + " report pack has English sheet names");
    if (persona === "owner") {
      const englishHeaders = [];
      for (const sheet of workbook.worksheets) {
        sheet.getRow(1).eachCell((cell) => {
          if (isEnglishLine(cell.text)) englishHeaders.push(sheet.name + " " + cell.text);
        });
      }
      assert.deepEqual(englishHeaders, [], label + " report pack has English column headers");
    }
  }
  console.log(label + " report pack opened with " + workbook.worksheets.length + " worksheets");
  return workbook;
}

function assertOwnerAutomationStarters(workbook, locale, labels) {
  const starter = workbook.getWorksheet(labels.sheet);
  assert.ok(starter, locale + " starter worksheet is missing");
  assert.equal(starter.actualRowCount, 3);
  const headers = starter.getRow(1).values;
  const setupIndex = headers.indexOf(labels.setup);
  const actionIndex = headers.indexOf(labels.action);
  assert.ok(setupIndex > 0 && actionIndex > 0, locale + " starter headers are missing");
  assert.equal(
    String(starter.getRow(2).getCell(setupIndex).value).split(" | ")[0],
    labels.firstStep
  );
  assert.equal(starter.getRow(2).getCell(actionIndex).value, labels.actionValue);
  if (locale === "ar") {
    const englishCells = [];
    starter.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.text;
        if (!value.startsWith("/reports?") && isEnglishLine(value)) {
          englishCells.push(cell.address + " " + value);
        }
      });
    });
    assert.deepEqual(englishCells, [], "Arabic Automation Starters contains English copy");
  }
}

try {
  const enrollment = await reportContext("en");
  const email = "owner-pack+" + randomUUID() + "@test.local";
  const password = "Password123!";
  const signup = await enrollment.request.post(new URL("/api/auth/register", base).href, {
    data: { email, password, name: "Workbook QA", companyName: "Workbook QA Trading LLC" },
  });
  assert.ok(signup.ok(), "Registration returned " + signup.status());
  const login = await enrollment.request.post(new URL("/api/auth/login", base).href, {
    data: { email, password },
  });
  assert.ok(login.ok(), "Login returned " + login.status());
  const onboarding = await enrollment.newPage();
  await onboarding.goto(new URL("/onboarding", base).href);
  for (const id of ["onboarding-express", "onboarding-skip", "onboarding-task-explore"]) {
    await onboarding.getByTestId(id).click();
  }
  await onboarding.waitForURL((url) => url.pathname === "/dashboard");
  const storageState = await enrollment.storageState();
  await enrollment.close();

  for (const [locale, labels] of Object.entries(expected)) {
    const context = await reportContext(locale, storageState);
    try {
      const page = await context.newPage();
      for (const [persona, count] of Object.entries(expectedSheetCounts)) {
        const workbook = await openReportPack(page, persona, locale, count);
        if (persona === "owner") assertOwnerAutomationStarters(workbook, locale, labels);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
