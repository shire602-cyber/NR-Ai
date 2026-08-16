#!/usr/bin/env node
// Fails when two route files register the same METHOD + path shape.
//
// Express matches the FIRST registered handler and silently ignores the rest,
// so a shadowed route is dead code that looks alive. This is not theoretical:
// `POST /api/companies/:id/bank-accounts` was registered in both
// companies.routes.ts and bank-statements.routes.ts. The companies one is
// registered first and wins; the bank-statements one — which validates the bank
// against a UAE bank list and links a GL account — never executed. Bank accounts
// could therefore be created with any bankName at all.
//
// Param NAMES are normalised (:id and :companyId collide) because Express
// matches on position, not name.
//
// Usage: node scripts/check-route-shadowing.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "server", "routes");

const seen = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".ts")) continue;
  const src = readFileSync(join(dir, f), "utf8");
  const re = /(?:app|router)\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const raw = m[2];
    // Sub-routers mounted under a prefix legitimately declare bare "/" paths;
    // those are disambiguated by their mount point, not by this file.
    if (raw === "/" || !raw.startsWith("/api/")) continue;
    const norm = raw.replace(/:[A-Za-z0-9_]+/g, ":p");
    const key = `${method} ${norm}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push({ file: f, raw });
  }
}

const shadowed = [...seen.entries()].filter(
  ([, v]) => new Set(v.map((x) => x.file)).size > 1
);

if (shadowed.length) {
  console.error(`✗ ${shadowed.length} shadowed route(s) — only the first registration runs:\n`);
  for (const [key, v] of shadowed) {
    console.error(`  ${key}`);
    for (const x of v) console.error(`      ${x.file}  ->  ${x.raw}`);
  }
  console.error("\n  Delete the duplicate, or give one of them a distinct path.");
  process.exit(1);
}
console.log(`✓ route-shadowing: no duplicate method+path across route modules`);
