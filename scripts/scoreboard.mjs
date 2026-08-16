#!/usr/bin/env node
// One command, one table, every Friday.
//
//   npm run scoreboard
//
// Prints each tracked metric against its baseline (the state found in the
// 7 Aug 2026 teardown) and its target. Everything is measured from the repo, so
// the numbers cannot drift from reality the way a hand-maintained table does.
//
// Metrics needing a build (bundle sizes) are skipped with a note unless
// dist/public exists — run `npm run build` first to include them.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => join(root, ...p);

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const sourceFiles = [
  ...walk(P("server"), [".ts", ".tsx"]),
  ...walk(P("client", "src"), [".ts", ".tsx"]),
  ...walk(P("shared"), [".ts", ".tsx"]),
];
// Count newlines, matching `wc -l` so these figures are comparable with the
// baseline numbers in the teardown (which were measured with wc -l).
const lineCount = (f) => {
  const s = readFileSync(f, "utf8");
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};
const totalLoc = sourceFiles.reduce((s, f) => s + lineCount(f), 0);

// ── API endpoints (unique METHOD + path) ──────────────────────────────
const routeFiles = walk(P("server", "routes"), [".ts"]);
const endpoints = new Set();
for (const f of routeFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(
    /(?:app|router|apiRouter)\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g
  )) {
    endpoints.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
}

// ── client routes / pages / nav ───────────────────────────────────────
const appTsx = existsSync(P("client/src/App.tsx")) ? readFileSync(P("client/src/App.tsx"), "utf8") : "";
const clientRoutes = (appTsx.match(/<Route/g) || []).length;
const pages = existsSync(P("client/src/pages"))
  ? readdirSync(P("client/src/pages")).filter((f) => f.endsWith(".tsx")).length
  : 0;
const sidebar = existsSync(P("client/src/components/layout/AppSidebar.tsx"))
  ? readFileSync(P("client/src/components/layout/AppSidebar.tsx"), "utf8")
  : "";
const navDestinations = (sidebar.match(/url:\s*["'`]/g) || []).length;

// ── largest files ─────────────────────────────────────────────────────
const sized = sourceFiles.map((f) => [f.replace(root + "/", ""), lineCount(f)]).sort((a, b) => b[1] - a[1]);
const largest = sized[0] || ["—", 0];
const over800 = sized.filter(([, n]) => n > 800).length;

// ── migrations ────────────────────────────────────────────────────────
const migDir = P("migrations");
const migFiles = existsSync(migDir) ? readdirSync(migDir).filter((f) => f.endsWith(".sql")) : [];
const journal = existsSync(join(migDir, "meta", "_journal.json"))
  ? JSON.parse(readFileSync(join(migDir, "meta", "_journal.json"), "utf8"))
  : { entries: [] };
const journaled = new Set(journal.entries.map((e) => e.tag));
const unjournaled = migFiles.map((f) => f.replace(/\.sql$/, "")).filter((t) => !journaled.has(t)).length;

// ── float money columns (reuse the guard's logic, loosely) ────────────
let floatMoney = 0;
{
  const MONEY = /(amount|total|balance|debit|credit|vat|subtotal|paid|price|salary|net_tax|output_tax|input_tax|due_tax|recoverable_tax|payable_tax|base_currency)/i;
  const NOT_MONEY = /(quantity|confidence|rate_limit|conversion_rate|error_rate|change_percent)/i;
  const colType = new Map();
  for (const e of journal.entries) {
    let sql;
    try { sql = readFileSync(join(migDir, `${e.tag}.sql`), "utf8"); } catch { continue; }
    for (const raw of sql.split(";")) {
      const stmt = raw.replace(/--.*$/gm, "").trim();
      const create = stmt.match(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*)\)/i);
      if (create) {
        for (const line of create[2].split(",")) {
          const c = line.trim().match(/^"?(\w+)"?\s+(real|double precision|numeric)/i);
          if (c) colType.set(`${create[1]}.${c[1]}`.toLowerCase(), c[2].toLowerCase());
        }
        continue;
      }
      const alter = stmt.match(/alter\s+table\s+"?(\w+)"?\s([\s\S]*)/i);
      if (alter) {
        for (const m of alter[2].matchAll(/alter\s+column\s+"?(\w+)"?[\s\S]*?type\s+(real|double precision|numeric[^\s,;()]*(?:\([^)]*\))?)/gi))
          colType.set(`${alter[1]}.${m[1]}`.toLowerCase(), m[2].toLowerCase());
        for (const m of alter[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+(real|double precision|numeric[^\s,;()]*(?:\([^)]*\))?)/gi))
          colType.set(`${alter[1]}.${m[1]}`.toLowerCase(), m[2].toLowerCase());
      }
    }
  }
  for (const [k, t] of colType) {
    const col = k.split(".")[1];
    if ((t === "real" || t === "double precision") && MONEY.test(col) && !NOT_MONEY.test(col)) floatMoney++;
  }
}

// ── tests ─────────────────────────────────────────────────────────────
const integrationTests = existsSync(P("tests/integration"))
  ? readdirSync(P("tests/integration")).filter((f) => /\.test\.(mjs|ts)$/.test(f)).length
  : 0;

// ── i18n ──────────────────────────────────────────────────────────────
const pageFiles = walk(P("client/src/pages"), [".tsx"]);
const translatedPages = pageFiles.filter((f) => /useTranslation|\bt\(|i18n/.test(readFileSync(f, "utf8"))).length;

// ── dependencies ──────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(P("package.json"), "utf8"));
const prodDeps = Object.keys(pkg.dependencies || {}).length;

// ── bundle (needs a build) ────────────────────────────────────────────
let firstPaintRaw = null, firstPaintGzip = null, cssRaw = null;
const indexHtml = P("dist/public/index.html");
if (existsSync(indexHtml)) {
  const h = readFileSync(indexHtml, "utf8");
  const js = [...h.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1]);
  const bufs = [];
  firstPaintRaw = 0;
  for (const f of js) {
    try { const d = readFileSync(P("dist/public/assets", f)); firstPaintRaw += d.length; bufs.push(d); } catch {}
  }
  firstPaintGzip = bufs.length ? gzipSync(Buffer.concat(bufs)).length : 0;
  const css = [...h.matchAll(/assets\/([^"]+\.css)/g)].map((m) => m[1]);
  cssRaw = 0;
  for (const f of css) { try { cssRaw += readFileSync(P("dist/public/assets", f)).length; } catch {} }
}

// ── render ────────────────────────────────────────────────────────────
const rows = [
  ["Total TypeScript LOC", 219217, totalLoc, 90000, "lower"],
  ["Source files", 430, sourceFiles.length, null, "lower"],
  ["API endpoints (unique)", 619, endpoints.size, 180, "lower"],
  ["Client routes", 113, clientRoutes, 20, "lower"],
  ["Page components", 102, pages, null, "lower"],
  ["Nav destinations", 61, navDestinations, 12, "lower"],
  ["Largest file (lines)", 21779, largest[1], 800, "lower"],
  ["Files > 800 lines", 66, over800, 0, "lower"],
  ["Production dependencies", 108, prodDeps, null, "lower"],
  ["Float money columns", 63, floatMoney, 0, "lower"],
  ["Unjournaled migrations", 8, unjournaled, 0, "lower"],
  ["Integration test suites", 0, integrationTests, 2, "higher"],
  ["Pages importing translation", 44, translatedPages, pageFiles.length, "higher"],
];
if (firstPaintRaw != null) {
  rows.push(["First-paint JS raw (B)", 2013806, firstPaintRaw, 460800, "lower"]);
  rows.push(["First-paint JS gzip (B)", 616448, firstPaintGzip, 143360, "lower"]);
  rows.push(["CSS raw (B)", 254267, cssRaw, 61440, "lower"]);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const W = [30, 12, 12, 12, 10];

console.log("\nMUHASIB SCOREBOARD   " + new Date().toISOString().slice(0, 10));
console.log("baseline = state found in the 7 Aug 2026 teardown\n");
console.log(pad("Metric", W[0]) + padL("Baseline", W[1]) + padL("Now", W[2]) + padL("Target", W[3]) + padL("Δ", W[4]));
console.log("-".repeat(W.reduce((a, b) => a + b, 0)));
for (const [name, base, now, target, dir] of rows) {
  const delta = now - base;
  const good = dir === "lower" ? delta <= 0 : delta >= 0;
  const hit = target == null ? "" : dir === "lower" ? (now <= target ? " ✓" : "") : now >= target ? " ✓" : "";
  const arrow = delta === 0 ? "0" : (delta > 0 ? "+" : "") + delta;
  console.log(
    pad(name, W[0]) + padL(base, W[1]) + padL(now, W[2]) + padL(target ?? "—", W[3]) +
      padL((good ? " " : "!") + arrow + hit, W[4])
  );
}
if (firstPaintRaw == null) {
  console.log("\n(bundle metrics skipped — run `npm run build` first to include them)");
}
console.log("");
