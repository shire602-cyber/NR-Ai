#!/usr/bin/env node
/**
 * Accessibility + RTL crawl (R18-14, R18-01, R18-11).
 *
 *   BASE_URL=http://127.0.0.1:5000 node tests/e2e/a11y-crawl.mjs          # axe + keyboard crawl
 *   BASE_URL=http://127.0.0.1:5000 node tests/e2e/a11y-crawl.mjs --rtl    # Arabic/RTL layout assertions
 *
 * Default mode: registers a fresh synthetic customer, completes express
 * onboarding, then for every customer route runs axe-core (WCAG 2 A/AA) and a
 * keyboard Tab crawl. The run fails on any critical/serious axe violation or a
 * keyboard trap.
 *
 * --rtl mode: switches the UI to Arabic and, on 20 pages, asserts that the
 * sidebar sits on the right edge (left edge >= clientWidth - sidebarWidth - 1)
 * and that the main content does not intersect it.
 *
 * It also asserts the welcome tour appears at most once across the whole crawl
 * (R18-03).
 *
 * Environment:
 *   BASE_URL                 target app (default http://127.0.0.1:5000)
 *   A11Y_ALLOW_REMOTE=true   required to run against a non-local BASE_URL
 *                            (registers a synthetic customer there)
 *   A11Y_EMAIL/A11Y_PASSWORD sign in as an existing user instead of registering
 *   A11Y_ROUTES=/a,/b        override the route list
 *   A11Y_VERBOSE=true        include node HTML + fix summaries in failures
 *   CHROMIUM_PATH            existing Chromium binary (else Playwright's own)
 *   AXE_CORE_PATH            path to axe.min.js when neither
 *                            @axe-core/playwright nor axe-core is resolvable
 *
 * Dependency: @axe-core/playwright (preferred) or axe-core. Run
 * `npm install --no-save @axe-core/playwright` if neither is installed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const RTL_MODE = process.argv.includes("--rtl");
const ALLOW_REMOTE = process.env.A11Y_ALLOW_REMOTE === "true";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, ".artifacts");

const CUSTOMER_ROUTES = [
  "/dashboard",
  "/invoices",
  "/receipts",
  "/bank-reconciliation",
  "/vat-filing",
  "/corporate-tax",
  "/reports",
  "/analytics",
  "/payment-chasing",
  "/contacts",
  "/integrations-hub",
  "/document-vault",
  "/subscription",
  "/chart-of-accounts",
  "/journal",
  "/ai",
  "/quotes",
  "/payroll",
  "/inventory",
  "/company-profile",
];

const ROUTES = process.env.A11Y_ROUTES
  ? process.env.A11Y_ROUTES.split(",").map((route) => route.trim())
  : CUSTOMER_ROUTES;

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
if (!isLocal && !ALLOW_REMOTE) {
  console.error(
    `Refusing to register a synthetic customer on ${BASE}. Set A11Y_ALLOW_REMOTE=true only for disposable targets.`
  );
  process.exit(2);
}

async function loadAxe() {
  const require = createRequire(import.meta.url);
  try {
    const { AxeBuilder } = await import("@axe-core/playwright");
    return {
      run: async (page) =>
        new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze(),
    };
  } catch {
    /* fall through to bare axe-core */
  }
  let source = null;
  try {
    source = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  } catch {
    if (process.env.AXE_CORE_PATH) source = await readFile(process.env.AXE_CORE_PATH, "utf8");
  }
  if (!source) {
    console.error(
      "DEP-REQUEST: @axe-core/playwright (or axe-core) is not installed. Run `npm install --no-save @axe-core/playwright`."
    );
    process.exit(2);
  }
  return {
    run: async (page) => {
      await page.evaluate(source);
      return page.evaluate(() =>
        // eslint-disable-next-line no-undef
        axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        })
      );
    },
  };
}

function cleanPath(url) {
  const parsed = new URL(url);
  return parsed.pathname;
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const axe = RTL_MODE ? null : await loadAxe();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const failures = [];
  const report = { base: BASE, mode: RTL_MODE ? "rtl" : "a11y", routes: {}, tourOpenings: 0 };

  // Session hint so the app boots as a signed-in user without anonymous probes.
  await context.addInitScript(
    ([rtl]) => {
      try {
        localStorage.setItem("muhasib_auth_hint", "1");
        if (rtl)
          localStorage.setItem(
            "i18n-storage",
            JSON.stringify({ state: { locale: "ar" }, version: 0 })
          );
      } catch {
        /* storage blocked */
      }
    },
    [RTL_MODE]
  );

  if (process.env.A11Y_EMAIL && process.env.A11Y_PASSWORD) {
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: process.env.A11Y_EMAIL, password: process.env.A11Y_PASSWORD },
    });
    if (login.status() >= 300) throw new Error(`login failed: ${login.status()}`);
  } else {
    const email = `a11y-crawl+${Date.now()}@test.local`;
    const reg = await page.request.post(`${BASE}/api/auth/register`, {
      data: {
        email,
        password: "Password123!",
        name: "A11y Crawl",
        companyName: "A11y Crawl Trading LLC",
      },
    });
    if (reg.status() !== 200 && reg.status() !== 201) {
      throw new Error(`register failed: ${reg.status()} ${(await reg.text()).slice(0, 200)}`);
    }
    // W5-E: registration returns no session; sign in (sets the auth cookies).
    await page.request.post(`${BASE}/api/auth/login`, {
      data: { email, password: "Password123!" },
    });
  }

  // Express onboarding so protected routes render instead of redirecting.
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2200);
  const express = page.locator('[data-testid="onboarding-express"]');
  if (await express.count()) {
    await express.click();
    await page.waitForTimeout(3500);
  }

  let tourSeen = false;
  const countTour = async () => {
    const open = await page
      .locator('[role="dialog"]:has([data-testid="button-continue-onboarding"])')
      .count();
    if (open > 0 && !tourSeen) {
      report.tourOpenings += 1;
      tourSeen = true;
    } else if (open === 0) {
      tourSeen = false;
    }
    return open > 0;
  };

  const closeTour = async () => {
    if (await countTour()) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { timeout: 45000 });
    await page.waitForTimeout(1800);
    await countTour();
    await closeTour();
    const entry = { finalPath: cleanPath(page.url()) };
    report.routes[route] = entry;

    if (RTL_MODE) {
      const layout = await page.evaluate(() => {
        const sidebar = document.querySelector('[data-slot="sidebar-container"]');
        const main = document.querySelector("#main-content");
        if (!sidebar || !main) return { missing: true };
        const s = sidebar.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        const clientWidth = document.documentElement.clientWidth;
        return {
          dir: document.documentElement.dir,
          side: sidebar.closest("[data-side]")?.getAttribute("data-side") ?? null,
          sidebarLeft: s.left,
          sidebarRight: s.right,
          sidebarWidth: s.width,
          mainLeft: m.left,
          mainRight: m.right,
          clientWidth,
        };
      });
      entry.layout = layout;
      if (layout.missing) {
        failures.push({ route, rule: "rtl-shell-missing" });
        continue;
      }
      if (layout.dir !== "rtl") failures.push({ route, rule: "rtl-dir", layout });
      if (!(layout.sidebarLeft >= layout.clientWidth - layout.sidebarWidth - 1)) {
        failures.push({ route, rule: "rtl-sidebar-not-on-right", layout });
      }
      // main content must not intersect the sidebar
      if (layout.mainRight > layout.sidebarLeft + 1 && layout.mainLeft < layout.sidebarRight - 1) {
        failures.push({ route, rule: "rtl-main-overlaps-sidebar", layout });
      }
      continue;
    }

    // axe-core: critical and serious violations fail the run.
    const result = await axe.run(page);
    const blocking = result.violations.filter((violation) =>
      ["critical", "serious"].includes(violation.impact)
    );
    entry.axe = {
      total: result.violations.length,
      blocking: blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        target: violation.nodes[0]?.target,
      })),
    };
    for (const violation of blocking) {
      failures.push({
        route,
        rule: `axe:${violation.id}`,
        impact: violation.impact,
        nodes: violation.nodes.length,
        target: violation.nodes[0]?.target,
        ...(process.env.A11Y_VERBOSE === "true"
          ? {
              details: violation.nodes.map((node) => ({
                html: node.html.slice(0, 160),
                summary: (node.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 200),
              })),
            }
          : {}),
      });
    }

    // keyboard-tab crawl: focus must move, start at the skip link and never trap.
    const stops = [];
    await page.evaluate(() => {
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : document.body
      ).blur();
    });
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const name =
          el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName;
        return `${el.tagName.toLowerCase()}|${name}`;
      });
      stops.push(stop);
    }
    const distinct = new Set(stops.filter(Boolean));
    entry.keyboard = { distinctStops: distinct.size, first: stops[0] };
    if (distinct.size < 3)
      failures.push({ route, rule: "keyboard-trap-or-no-focusables", stops: [...distinct] });
    if (route === ROUTES[0] && !/skip|تخط/i.test(stops[0] ?? "")) {
      failures.push({ route, rule: "skip-link-not-first-tab-stop", first: stops[0] });
    }
  }

  if (report.tourOpenings > 1) {
    failures.push({ rule: "tour-shown-more-than-once", openings: report.tourOpenings });
  }

  await browser.close();
  report.failures = failures;
  const out = path.join(ARTIFACT_DIR, RTL_MODE ? "a11y-rtl-last-run.json" : "a11y-last-run.json");
  await writeFile(out, JSON.stringify(report, null, 2));

  console.log(
    `\n=== ${RTL_MODE ? "RTL layout" : "Accessibility"} crawl: ${ROUTES.length} routes · ${failures.length} failure(s) · tour shown ${report.tourOpenings}x ===`
  );
  for (const failure of failures) console.log(JSON.stringify(failure));
  console.log(`Report: ${out}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
