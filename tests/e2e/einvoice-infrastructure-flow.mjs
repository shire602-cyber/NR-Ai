#!/usr/bin/env node
/**
 * Run after npm run build with Chromium and a disposable local Postgres database.
 * DATABASE_URL=postgresql://postgres@127.0.0.1:55452/einvoice_qa \
 * CHROMIUM_PATH=/usr/bin/chromium npx tsx tests/e2e/einvoice-infrastructure-flow.mjs
 *
 * Starts the built app twice, first without ASP credentials, then against a loopback mock
 * with generated fixture credentials. The app starts with a clean environment in both runs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright-core";
import {
  companyCredentialVariable,
  sealCompanyCredentials,
} from "../../server/services/einvoice/providers/company-credentials.ts";
import { apiClient, PASSWORD } from "./lib/sweep-personas.mjs";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
assert.ok(
  ["postgresql:", "postgres:"].includes(database.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) &&
    database.pathname.length > 1,
  "Set DATABASE_URL to a disposable local Postgres database."
);
const port = Number(process.env.EINVOICE_E2E_PORT || "5079");
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "Invalid local app port.");
const base = `http://localhost:${port}`;
const fixtureVaultSecret = randomBytes(32).toString("hex");
const appEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  PORT: String(port),
  DATABASE_URL: database.toString(),
  SESSION_SECRET: randomBytes(32).toString("hex"),
  JWT_SECRET: randomBytes(32).toString("hex"),
  TOKEN_ENCRYPTION_KEY: fixtureVaultSecret,
  FRONTEND_URL: base,
  CORS_ORIGIN: base,
  AUTH_PUBLIC_URL: base,
  AUTH_COOKIE_SAMESITE: "lax",
  ALLOW_LOCAL_STORAGE: "true",
  AUTO_MIGRATE_ON_BOOT: "false",
  DOTENV_CONFIG_PATH: "/nonexistent/einvoice-browser.env",
  DOTENV_CONFIG_QUIET: "true",
  RL_AUTH_MAX: "500",
  LOG_LEVEL: "fatal",
};

const copies = {
  en: {
    title: "UAE e-invoicing",
    delivery: "Delivery to customer",
    notConfigured: "Not configured",
    queued: "Queued for submission",
    sent: "Sending",
    recipientReceived: "Received by the buyer’s provider",
    accepted: "Accepted by the buyer’s provider",
    bankStatementImport: "Import bank statements",
    verifyTracking: "Verify and save",
    trackingVerified: "Tracking environment verified",
    sandbox: "Sandbox",
    firm: "Fixture firm",
    clients: ["Fixture bakery", "Fixture supplier"],
  },
  ar: {
    title: "الفوترة الإلكترونية في الإمارات",
    delivery: "التسليم إلى العميل",
    notConfigured: "غير مهيّأ",
    queued: "في قائمة انتظار الإرسال",
    sent: "لدى مزود الخدمة",
    recipientReceived: "استلمها مزود خدمة المشتري",
    accepted: "قبلها مزود خدمة المشتري",
    bankStatementImport: "استيراد كشوف الحسابات البنكية",
    verifyTracking: "تحقّق واحفظ",
    trackingVerified: "تم التحقق من بيئة المتابعة",
    trackingDocumentId: "معرّف المستند لدى المزوّد",
    sandbox: "بيئة تجريبية",
    firm: "مكتب المحاسبة التجريبي",
    clients: ["المخبز التجريبي", "المورد التجريبي"],
  },
};
const sellerTrn = "100123456700003";
const sellerTin = sellerTrn.slice(0, 10);
const acubeInvoiceUuid = "019ffedf-0461-7dd2-b20c-a0df95b2bfff";
const acubeLegalEntityUuid = "019e91b7-0a3c-7b1e-9f2d-5c8a1b4e6d70";
const runTag = randomUUID().slice(0, 8);
const localeFixtures = [
  { lang: "en", width: 1440, providers: ["acube", "complyance"] },
  { lang: "ar", width: 360, providers: ["complyance", "acube"] },
];

const api = apiClient(base);
const db = new pg.Client({ connectionString: database.toString() });
const credentials = {
  acube: { email: "asp-fixture@example.test", password: randomUUID() },
  complyance: { apiKey: randomUUID() },
};
const mockToken = randomUUID();
const mockDocuments = new Map();
const legacyDocuments = new Map();
const verificationReads = new Set();
let acubeStatus = "processed";
let complyanceStatus = "submitted";
const posts = [];
const unexpected = [];

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

const mock = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  try {
    if (req.method === "POST" && pathname === "/login") {
      const login = JSON.parse(body);
      assert.ok(
        login.email === credentials.acube.email && login.password === credentials.acube.password
      );
      assert.equal(login.environment, "sandbox");
      return json(res, 200, { token: mockToken });
    }
    if (req.method === "POST" && pathname === "/invoices") {
      assert.ok(req.headers.authorization === `Bearer ${mockToken}`);
      assert.match(body, /<cbc:EndpointID schemeID="0235">1002003004<\/cbc:EndpointID>/);
      posts.push("acube");
      mockDocuments.set(acubeInvoiceUuid, "acube");
      await delay(2_000);
      return json(res, 201, { uuid: acubeInvoiceUuid, direction: "outgoing", status: "processed" });
    }
    if (req.method === "POST" && pathname === "/api/v3/unify") {
      assert.ok(req.headers.authorization === `Bearer ${credentials.complyance.apiKey}`);
      const payload = JSON.parse(body);
      assert.equal(payload.environment, "sandbox");
      assert.equal(payload.source, "einvoice-browser-fixture:v1");
      assert.ok(payload.payload.header.documentNumber);
      const documentId = randomUUID();
      posts.push("complyance");
      mockDocuments.set(documentId, "complyance");
      await delay(2_000);
      return json(res, 200, { documentId });
    }
    if (req.method === "GET") {
      if (pathname === "/invoices" && searchParams.get("direction") === "outgoing") {
        assert.equal(req.headers.authorization, `Bearer ${mockToken}`);
        assert.equal(searchParams.get("page"), "1");
        return json(
          res,
          200,
          [...legacyDocuments]
            .filter(([, doc]) => doc.reference === "search")
            .map(([uuid, doc]) => ({
              uuid,
              direction: "outgoing",
              invoiceNumber: doc.number,
              status: "processed",
            }))
        );
      }
      if (["/invoices", "/credit-notes"].includes(pathname)) return json(res, 200, []);
      if (pathname === "/api/v3/documents" && searchParams.get("type") === "purchases") {
        return json(res, 200, { data: [], meta: { hasMore: false } });
      }
      const sourceId = /^\/invoices\/([^/]+)\/source$/.exec(pathname)?.[1];
      const acubeLegacy = legacyDocuments.get(sourceId);
      if (acubeLegacy?.provider === "acube") {
        assert.equal(req.headers.authorization, `Bearer ${mockToken}`);
        verificationReads.add(sourceId);
        return res.writeHead(200, { "Content-Type": "application/xml" }).end(acubeLegacy.xml);
      }
      const invoice = /^\/invoices\/([^/]+)$/.exec(pathname);
      const legacyInvoice = legacyDocuments.get(invoice?.[1]);
      if (legacyInvoice?.provider === "acube") {
        assert.equal(req.headers.authorization, `Bearer ${mockToken}`);
        return json(res, 200, {
          uuid: invoice[1],
          invoiceNumber: legacyInvoice.number,
          direction: "outgoing",
          status: "processed",
          environment: "sandbox",
          ownerFiscalId: sellerTin,
          legalEntityUuid: acubeLegalEntityUuid,
        });
      }
      if (invoice && mockDocuments.get(invoice[1]) === "acube") {
        return json(res, 200, { uuid: invoice[1], direction: "outgoing", status: acubeStatus });
      }
      const documentId = /^\/api\/v3\/documents\/([^/]+)$/.exec(pathname)?.[1];
      const complyanceLegacy = legacyDocuments.get(documentId);
      if (complyanceLegacy?.provider === "complyance") {
        assert.equal(searchParams.get("type"), "sales");
        assert.equal(req.headers.authorization, `Bearer ${credentials.complyance.apiKey}`);
        verificationReads.add(documentId);
        return json(res, 200, {
          success: true,
          data: {
            documentId,
            documentNumber: complyanceLegacy.number,
            state: "processing",
            environment: "sandbox",
            seller: { trn: sellerTrn },
          },
        });
      }
      if (mockDocuments.get(documentId) === "complyance") {
        return json(res, 200, {
          success: true,
          data: {
            documentId,
            state: complyanceStatus,
            ...(complyanceStatus === "final_valid" && {
              compliance: { ftaApprovedStatus: "APPROVED" },
            }),
          },
        });
      }
    }
    throw new Error("Unexpected mock endpoint");
  } catch {
    unexpected.push(`${req.method} ${pathname}`);
    json(res, 500, { message: "Unexpected synthetic provider request" });
  }
});

function start(command, env = {}) {
  return spawn(process.execPath, [`dist/${command}.js`], {
    env: { ...appEnv, ...env },
    stdio: "inherit",
  });
}

let runtime;
async function stopApp() {
  if (!runtime || runtime.exitCode !== null) return;
  const exited = once(runtime, "exit");
  runtime.kill("SIGTERM");
  await exited;
}

async function startApp(env = {}) {
  runtime = start("index", env);
  for (let i = 0; i < 60; i++) {
    assert.equal(runtime.exitCode, null, "The local app exited before readiness.");
    const health = await fetch(`${base}/health`).catch(() => null);
    if (health?.ok) return;
    await delay(500);
  }
  throw new Error("The local app did not reach readiness.");
}

async function request(token, method, url, body) {
  const response = await api(token, method, url, body);
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${method} ${url}: ${response.status}`
  );
  return response.body;
}

async function seed(fixture) {
  const { lang } = fixture;
  const email = `einvoice-fixture-${lang}-${runTag}@example.test`;
  await request("", "POST", "/api/auth/register", {
    email,
    password: PASSWORD,
    name: copies[lang].firm,
    companyName: copies[lang].firm,
  });
  await db.query(
    "UPDATE users SET firm_role = 'firm_owner', email_verified = true WHERE email = $1",
    [email]
  );
  const { token } = await request("", "POST", "/api/auth/login", { email, password: PASSWORD });
  const clients = [];
  for (const name of copies[lang].clients) {
    const client = await request(token, "POST", "/api/firm/clients", {
      name: `${name} ${runTag}`,
      trnVatNumber: sellerTrn,
      emirate: "dubai",
      vatFilingFrequency: "quarterly",
    });
    await db.query(
      `UPDATE companies SET address_street = 'Sheikh Zayed Road', address_city = 'Dubai',
         trade_licence_no = 'TL-123456', einvoice_scope = 'b2b', einvoice_turnover_band = 'standard',
         onboarding_completed = true WHERE id = $1`,
      [client.id]
    );
    clients.push(client);
  }
  return { ...fixture, email, token, clients };
}

async function seedOutbound(persona, existingContactId) {
  const companyId = persona.clients[0].id;
  const clientPath = `/api/companies/${companyId}`;
  if (persona.providers[0] === "complyance") {
    // Opt in this fixture early so reporting is required regardless of the run date.
    await db.query("UPDATE companies SET einvoice_go_live_date = CURRENT_DATE - 7 WHERE id = $1", [
      companyId,
    ]);
  }
  const contactId =
    existingContactId ??
    (
      await request(persona.token, "POST", `${clientPath}/customer-contacts`, {
        name: "Fixture buyer LLC",
        nameAr: "المشتري التجريبي",
        trnNumber: "100200300400003",
        emirate: "dubai",
        addressStreet: "Al Wasl Road",
        city: "Dubai",
      })
    ).id;
  const date = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const invoice = await request(persona.token, "POST", `${clientPath}/invoices`, {
    contactId,
    date: date(-2),
    dueDate: date(28),
    placeOfSupplyEmirate: "dubai",
    lines: [{ description: "Fixture consulting", quantity: 1, unitPrice: 4000, vatRate: 0.05 }],
  });
  await request(persona.token, "PATCH", `/api/invoices/${invoice.id}/status`, { status: "sent" });
  const document = await request(
    persona.token,
    "POST",
    `/api/invoices/${invoice.id}/generate-einvoice`
  );
  assert.equal(document.status, "generated");
  if (!existingContactId && persona.providers[0] === "acube") {
    // Legacy A-Cube reporting was inferred from TDD availability and sometimes omitted the provider.
    await db.query(
      `INSERT INTO einvoice_document_events (company_id, invoice_id, track, from_status, to_status)
       VALUES ($1, $2, 'reporting', 'pending', 'reported')`,
      [companyId, invoice.id]
    );
  }
  await db.query(
    `INSERT INTO einvoice_legal_entities
       (company_id, provider, environment, legal_entity_id, tin, status, peppol_address, provider_details)
     VALUES ($1, $2, 'sandbox', $3, $4, 'active', $5, $6)
     ON CONFLICT (company_id, provider, environment) DO NOTHING`,
    [
      companyId,
      persona.providers[0],
      persona.providers[0] === "acube" ? acubeLegalEntityUuid : randomUUID(),
      sellerTin,
      `0235:${sellerTin}`,
      {
        sourceName: "einvoice-browser-fixture",
        sourceVersion: "v1",
      },
    ]
  );
  return { invoiceId: invoice.id, contactId };
}

async function seedLegacyTracking(persona, contactId, reference) {
  const { invoiceId } = await seedOutbound(persona, contactId);
  const provider = persona.providers[0];
  const providerMessageId = randomUUID();
  const storedMessageId = reference === "stored" ? providerMessageId : null;
  const {
    rows: [invoice],
  } = await db.query(
    `UPDATE invoices SET einvoice_status = 'submitted', einvoice_provider = $2,
       einvoice_provider_message_id = $3 WHERE id = $1 RETURNING number, einvoice_xml`,
    [invoiceId, provider, storedMessageId]
  );
  await db.query(
    `UPDATE einvoice_documents SET status = 'submitted', provider = $2,
       provider_message_id = $3, delivery_status = $4 WHERE invoice_id = $1`,
    [invoiceId, provider, storedMessageId, storedMessageId ? "sending" : "needs_link"]
  );
  legacyDocuments.set(providerMessageId, {
    provider,
    reference,
    number: invoice.number,
    xml: invoice.einvoice_xml,
  });
  return { invoiceId, provider, providerMessageId, reference };
}

async function inBrowser(browser, { email, lang, width }, flow) {
  const ctx = await browser.newContext({
    locale: lang === "ar" ? "ar-AE" : "en-AE",
    colorScheme: "light",
    viewport: { width, height: 900 },
    timezoneId: "Asia/Dubai",
  });
  const failures = [];
  try {
    await ctx.addInitScript((locale) => {
      localStorage.setItem("i18n-storage", JSON.stringify({ state: { locale }, version: 0 }));
      localStorage.setItem("cookie-consent", "accepted");
    }, lang);
    const page = await ctx.newPage();
    const pendingApi = new Set();
    let lastApiActivity = Date.now();
    page.on("request", (req) => {
      if (!new URL(req.url()).pathname.startsWith("/api/")) return;
      pendingApi.add(req);
      lastApiActivity = Date.now();
    });
    const apiDone = (req) => {
      if (pendingApi.delete(req)) lastApiActivity = Date.now();
    };
    page.on("requestfinished", apiDone);
    page.on("requestfailed", apiDone);

    async function settleApi() {
      const started = Date.now();
      while (Date.now() - started < 20_000) {
        if (pendingApi.size === 0 && Date.now() - Math.max(started, lastApiActivity) >= 500) {
          return;
        }
        await delay(100);
      }
      throw new Error(`${lang} app API requests did not settle before navigation`);
    }

    await open(page, "/login");
    await page.getByTestId("input-email").fill(email);
    await page.getByTestId("input-password").fill(PASSWORD);
    await page.getByTestId("button-login").click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.waitForLoadState("networkidle");
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") failures.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      const path = new URL(req.url()).pathname;
      const error = req.failure()?.errorText;
      // A full navigation cancels the prior page's speculative static preloads.
      if (
        error === "net::ERR_ABORTED" &&
        /^(\/assets\/|\/firm-assets\/|\/favicon\.png$)/.test(path)
      )
        return;
      failures.push(`${req.method()} ${path} ${error}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) failures.push(`${res.status()} ${new URL(res.url()).pathname}`);
    });
    await flow(page, async (path) => {
      await settleApi();
      // Use the app's router after login so the previous document's API requests can finish.
      await page.evaluate((href) => window.history.pushState(null, "", href), path);
      await page.waitForURL(new URL(path, base).href);
    });
    await settleApi();
    assert.deepEqual(failures, [], `${lang} browser and API errors`);
  } finally {
    await ctx.close();
  }
}

async function open(page, path) {
  const response = await page.goto(`${base}${path}`);
  assert.ok(response?.ok(), `${path}: HTTP ${response?.status()}`);
  assert.equal(new URL(page.url()).pathname, new URL(path, base).pathname);
}

async function openBooks(page, navigate, persona, index) {
  const client = persona.clients[index];
  await navigate("/firm/clients");
  const book =
    persona.width < 768
      ? page.getByTestId(`button-open-books-${client.id}`)
      : page
          .getByRole("row")
          .filter({ hasText: client.name })
          .getByRole("button", {
            name: /Open books|فتح الدفاتر/,
          });
  await book.click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.waitForLoadState("networkidle");
}

async function expectFrame(page, lang) {
  const html = page.locator("html");
  assert.equal(await html.getAttribute("lang"), lang);
  assert.equal(await html.getAttribute("dir"), lang === "ar" ? "rtl" : "ltr");
  assert.equal(await html.evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
}

async function selectProviders(browser, persona) {
  const { lang, providers, token, clients } = persona;
  await inBrowser(browser, persona, async (page, navigate) => {
    for (const [index, provider] of providers.entries()) {
      await openBooks(page, navigate, persona, index);
      const statusPath = `/api/companies/${clients[index].id}/einvoicing/provider`;
      const status = page.waitForResponse((res) => new URL(res.url()).pathname === statusPath);
      await navigate("/settings/einvoicing");
      await page.getByRole("heading", { name: copies[lang].title, exact: true }).waitFor();
      assert.equal((await (await status).json()).status, "not_selected");
      await expectFrame(page, lang);
      const theme = await page.locator(".einvoice-surface").evaluate((surface) => {
        const style = getComputedStyle(surface);
        return { background: style.backgroundColor, color: style.color, font: style.fontFamily };
      });
      assert.equal(theme.background, "rgb(247, 248, 244)");
      assert.equal(theme.color, "rgb(20, 36, 30)");
      assert.match(theme.font, /Geist Sans/);
      if (lang === "ar") assert.match(theme.font, /Noto Sans Arabic/);
      const radios = page.getByTestId("einvoice-partner-card").getByRole("radio");
      await radios.last().waitFor();
      assert.equal(await radios.count(), 2);
      assert.deepEqual(
        await radios.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-checked"))),
        ["false", "false"]
      );
      const chosen = page.getByTestId(`einvoice-partner-option-${provider}`);
      await chosen.click();
      const providerStatus = page.getByTestId("einvoice-provider-status");
      await providerStatus.filter({ hasText: copies[lang].notConfigured }).waitFor();
      assert.equal(await providerStatus.textContent(), copies[lang].notConfigured);
      assert.equal(await chosen.getAttribute("aria-checked"), "true");
      const health = await request(token, "GET", statusPath);
      assert.equal(health.chosenProvider, provider);
      assert.equal(health.status, "not_configured");
      assert.equal(health.environment, "sandbox");
      assert.equal(health.provider, null);
      await page.waitForLoadState("networkidle");
    }
    await openBooks(page, navigate, persona, 0);
    await navigate("/settings/einvoicing");
    const selected = page.getByRole("radio", { checked: true });
    await selected.waitFor();
    assert.equal(
      await selected.getAttribute("data-testid"),
      `einvoice-partner-option-${providers[0]}`
    );
    await navigate("/bank-feeds");
    await page.getByText(copies[lang].bankStatementImport, { exact: true }).waitFor();
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /\bbank\s+feeds?\b|الربط\s+البنكي\s+المباشر|الخلاصة\s+البنكية/i
    );
    await expectFrame(page, lang);
    const importStatement = page.getByTestId("button-feeds-import-statement");
    assert.equal(await importStatement.getAttribute("href"), "/bank-reconciliation?import=1");
    await importStatement.click();
    await page.waitForURL("**/bank-reconciliation?import=1");
    await page.getByTestId("button-download-sample-bank-csv").waitFor();
  });
  console.log(
    `${lang}: two client books stayed isolated and missing credentials rendered gracefully`
  );
}

async function verifyLegacyTracking(browser, persona, legacy) {
  const { lang, token } = persona;
  const { invoiceId, provider, providerMessageId, reference } = legacy;
  const invoicePath = `/api/invoices/${invoiceId}/einvoice`;
  const statusBefore = await request(token, "GET", `${invoicePath}/status`);
  assert.equal(statusBefore.transmission.environment, null);
  assert.equal(statusBefore.transmission.canRefresh, false);
  assert.deepEqual(statusBefore.transmission.environmentVerification, {
    provider,
    environments: ["sandbox"],
    reference,
  });
  await inBrowser(browser, persona, async (page, navigate) => {
    await openBooks(page, navigate, persona, 0);
    const evidence = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/companies/${persona.clients[0].id}/einvoicing/compliance` &&
        url.searchParams.get("invoiceIds")?.split(",").includes(invoiceId)
      );
    });
    await navigate("/invoices");
    const batch = await evidence;
    assert.equal(batch.status(), 200);
    assert.ok((await batch.json()).documents.some((doc) => doc.invoiceId === invoiceId));
    await page.locator(`[data-testid="einvoice-cell-${invoiceId}"]:visible`).first().click();
    const sheet = page.getByTestId("einvoice-sheet");
    const tracking = sheet.getByTestId("einvoice-tracking-verification");
    await tracking.waitFor();
    await expectFrame(page, lang);
    const choice = tracking.getByRole("radio", { name: copies[lang].sandbox, exact: true });
    const confirm = tracking.getByTestId("einvoice-tracking-confirm");
    assert.equal(await choice.isChecked(), false);
    assert.equal(await tracking.getByRole("radio").count(), 1);
    assert.equal(await confirm.textContent(), copies[lang].verifyTracking);
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(verificationReads.has(providerMessageId), false);
    assert.equal(await sheet.getByTestId("einvoice-send").count(), 0);
    assert.equal(await sheet.getByTestId("einvoice-refresh").count(), 0);
    await choice.check();
    if (reference === "manual") {
      assert.equal(await confirm.isDisabled(), true);
      await tracking
        .getByRole("textbox", { name: copies[lang].trackingDocumentId })
        .fill(providerMessageId);
    } else {
      assert.equal(await tracking.getByTestId("einvoice-tracking-document-id").count(), 0);
    }
    const confirmation = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `${invoicePath}/confirm-environment`
    );
    await confirm.click();
    const result = await confirmation;
    assert.equal(result.status(), 200);
    assert.deepEqual(result.request().postDataJSON(), {
      environment: "sandbox",
      ...(reference === "manual" ? { documentId: providerMessageId } : {}),
    });
    const verified = await result.json();
    assert.equal(verified.provider, provider);
    assert.equal(verified.environment, "sandbox");
    assert.equal(verified.verified, true);
    if (reference !== "stored") assert.equal(verified.providerDocumentId, providerMessageId);
    await page.getByText(copies[lang].trackingVerified, { exact: true }).waitFor();
    await tracking.waitFor({ state: "hidden" });
    await sheet.getByTestId("einvoice-refresh").waitFor();
    assert.equal(await sheet.getByTestId("einvoice-resubmit").count(), 0);
    assert.equal(verificationReads.has(providerMessageId), true);
  });
  const saved = await request(token, "GET", `${invoicePath}/status`);
  assert.equal(saved.transmission.environment, "sandbox");
  assert.equal(saved.transmission.provider, provider);
  assert.equal(saved.transmission.providerDocumentId, providerMessageId);
  assert.equal(saved.transmission.environmentVerification, null);
  console.log(`${lang}: verified ${reference} tracking without resending`);
}

async function sendInvoice(browser, persona) {
  const { invoiceId, contactId, lang, token } = persona;
  const originalProvider = persona.providers[0];
  const statusPath = `/api/invoices/${invoiceId}/einvoice/status`;
  await inBrowser(browser, persona, async (page, navigate) => {
    await openBooks(page, navigate, persona, 0);
    await navigate(`/contacts?open=${contactId}`);
    const buyer = page.getByTestId("edit-customer-contact");
    await buyer.waitFor();
    assert.equal(await buyer.getByTestId("input-contact-name").inputValue(), "Fixture buyer LLC");
    const openInvoice = async () => {
      await navigate("/invoices");
      await page.locator(`[data-testid="einvoice-cell-${invoiceId}"]:visible`).first().click();
    };
    await openInvoice();
    await expectFrame(page, lang);
    const sheet = page.getByTestId("einvoice-sheet");
    const send = sheet.getByTestId("einvoice-send");
    const submitPath = `/api/invoices/${invoiceId}/einvoice/submit`;
    const submit = page.waitForResponse((res) => new URL(res.url()).pathname === submitPath);
    assert.equal(
      await send.evaluate((button) => getComputedStyle(button).backgroundColor),
      "rgb(11, 106, 74)"
    );
    await send.click();
    assert.equal((await submit).status(), 202);
    const queued = sheet.getByTestId("einvoice-queued");
    await queued.waitFor();
    assert.equal(await queued.textContent(), copies[lang].queued);
    assert.equal(await send.count(), 0);
    const delivery = sheet.getByTestId("einvoice-track-delivery");
    await delivery.getByText(copies[lang].sent, { exact: true }).waitFor({ timeout: 85_000 });
    assert.equal((await request(token, "GET", statusPath)).submissionState, "sent");
    if (originalProvider === "acube") {
      await request(token, "PUT", `/api/companies/${persona.clients[0].id}/einvoicing/partner`, {
        partner: "complyance",
      });
      await navigate("/dashboard");
      await openInvoice();
      const pinned = await request(token, "GET", statusPath);
      assert.equal(pinned.transmission.provider, "acube");
      assert.equal(pinned.transmission.environment, "sandbox");
      assert.equal(pinned.transmission.canRefresh, true);
      assert.equal(pinned.transmission.block, null);
      await delivery.getByText("Handed to A-Cube", { exact: true }).waitFor();
      acubeStatus = "delivered";
    } else {
      complyanceStatus = "delivery_success";
    }
    await sheet.getByTestId("einvoice-refresh").click();
    await delivery.getByText(copies[lang].recipientReceived, { exact: true }).waitFor();
    const receipt = await request(token, "GET", statusPath);
    assert.equal(receipt.submissionState, "sent");
    assert.equal(receipt.transmission.recipientAcknowledgement, "received");
    assert.equal(receipt.transmission.canRefresh, true);
    if (originalProvider === "acube") {
      acubeStatus = "accepted";
    } else {
      complyanceStatus = "final_valid";
    }
    await sheet.getByTestId("einvoice-refresh").click();
    await delivery.getByText(copies[lang].accepted, { exact: true }).waitFor();
    const result = await request(token, "GET", statusPath);
    assert.equal(result.submissionState, "accepted");
    if (originalProvider === "acube") {
      assert.equal(result.transmission.providerDocumentId, acubeInvoiceUuid);
    } else {
      assert.equal(receipt.tracks.reporting.status, "pending");
      assert.equal(result.tracks.reporting.status, "reported");
    }
    await sheet.getByTestId("einvoice-history-open").click();
    const history = page.getByTestId("einvoice-history");
    const { delivery: deliveryLabel, queued: queuedLabel, accepted: acceptedLabel } = copies[lang];
    await history.getByText(`${deliveryLabel}: ${queuedLabel}`, { exact: true }).waitFor();
    await history
      .getByText(`${deliveryLabel}: ${copies[lang].recipientReceived}`, { exact: true })
      .waitFor();
    await history.getByText(`${deliveryLabel}: ${acceptedLabel}`, { exact: true }).waitFor();
    if (originalProvider === "acube") {
      await history.getByText("FTA reporting: Confirmation unavailable", { exact: true }).waitFor();
    }
  });
  console.log(`${lang}: queued, sent and accepted invoice status through the loopback provider`);
}

let browser;
try {
  assert.equal((await once(start("migrate"), "exit"))[0], 0, "Local migration failed.");
  await db.connect();
  await startApp();
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const personas = [];
  for (const fixture of localeFixtures) {
    const persona = await seed(fixture);
    await selectProviders(browser, persona);
    const outbound = await seedOutbound(persona);
    const legacy = [
      await seedLegacyTracking(persona, outbound.contactId, "stored"),
      await seedLegacyTracking(
        persona,
        outbound.contactId,
        persona.providers[0] === "acube" ? "search" : "manual"
      ),
    ];
    personas.push({ ...persona, ...outbound, legacy });
  }
  assert.deepEqual(posts, []);
  await stopApp();

  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const providerBase = `http://127.0.0.1:${mock.address().port}`;
  process.env.TOKEN_ENCRYPTION_KEY = fixtureVaultSecret;
  const encrypted = Object.fromEntries(
    personas.map((persona) => {
      const context = {
        companyId: persona.clients[0].id,
        provider: persona.providers[0],
        environment: "sandbox",
      };
      return [
        companyCredentialVariable(context),
        sealCompanyCredentials(context, credentials[context.provider]),
      ];
    })
  );
  delete process.env.TOKEN_ENCRYPTION_KEY;
  await startApp({
    ACUBE_BASE_URL: providerBase,
    ACUBE_LOGIN_URL: `${providerBase}/login`,
    COMPLYANCE_BASE_URL: providerBase,
    ...encrypted,
  });
  for (const { token, clients } of personas) {
    const status = (id) => request(token, "GET", `/api/companies/${id}/einvoicing/provider`);
    assert.equal((await status(clients[0].id)).status, "configured");
    assert.equal((await status(clients[1].id)).status, "not_configured");
  }
  const recover = async (browser, persona) => {
    for (const legacy of persona.legacy) await verifyLegacyTracking(browser, persona, legacy);
  };
  for (const flow of [recover, sendInvoice]) {
    const results = await Promise.allSettled(personas.map((persona) => flow(browser, persona)));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  assert.deepEqual(posts.sort(), ["acube", "complyance"]);
  assert.deepEqual(unexpected, []);
} finally {
  await browser?.close();
  await stopApp();
  mock.close();
  mock.closeAllConnections();
  await db.end();
}
