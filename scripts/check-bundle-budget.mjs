#!/usr/bin/env node
// Bundle budget (R20-15): fails when any client JS/CSS chunk in
// dist/public/assets grows more than BUNDLE_BUDGET_TOLERANCE (default 10%)
// over the committed baseline in scripts/qa/bundle-baseline.json.
//
// Chunks are keyed by file name with the content hash stripped
// (Reports-AbC123.js -> Reports.js). New chunks are reported but do not
// fail; chunks that disappeared are reported too.
//
// Usage: npm run build && node scripts/check-bundle-budget.mjs [--update]
// --update rewrites the baseline from the current build (commit it deliberately).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "dist/public/assets");
const baselinePath = join(root, "scripts/qa/bundle-baseline.json");
const tolerance = Number(process.env.BUNDLE_BUDGET_TOLERANCE ?? 0.1);
const update = process.argv.includes("--update");

export function chunkKey(file) {
  // Vite/Rolldown names: name-<hash>.js where hash is 8+ url-safe chars.
  return file.replace(/-[A-Za-z0-9_-]{8}(?=\.(js|css)$)/, "");
}

if (!existsSync(assetsDir)) {
  console.error(`check-bundle-budget: ${assetsDir} not found — run \`npm run build\` first`);
  process.exit(1);
}

const current = {};
for (const file of readdirSync(assetsDir)) {
  if (!/\.(js|css)$/.test(file)) continue;
  const buf = readFileSync(join(assetsDir, file));
  const key = chunkKey(file);
  const prev = current[key] ?? { bytes: 0, gzipBytes: 0 };
  current[key] = {
    bytes: prev.bytes + statSync(join(assetsDir, file)).size,
    gzipBytes: prev.gzipBytes + gzipSync(buf).length,
  };
}

if (update || !existsSync(baselinePath)) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    baselinePath,
    JSON.stringify({ tolerance, updatedAt: new Date().toISOString(), chunks: sorted }, null, 2) +
      "\n"
  );
  console.log(
    `check-bundle-budget: baseline written (${Object.keys(sorted).length} chunks) -> ${baselinePath}`
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).chunks;
const failures = [];
const added = [];
for (const [key, size] of Object.entries(current)) {
  const base = baseline[key];
  if (!base) {
    added.push(`${key} (${size.bytes} B)`);
    continue;
  }
  const limit = Math.round(base.bytes * (1 + tolerance));
  // Tiny chunks fluctuate by a few hundred bytes; only enforce above 2 KB.
  if (size.bytes > limit && size.bytes - base.bytes > 2048) {
    failures.push(
      `${key}: ${base.bytes} -> ${size.bytes} B (+${(((size.bytes - base.bytes) / base.bytes) * 100).toFixed(1)}%, limit ${limit})`
    );
  }
}
const removed = Object.keys(baseline).filter((k) => !current[k]);

const total = (m) => Object.values(m).reduce((s, v) => s + v.bytes, 0);
console.log(
  `check-bundle-budget: ${Object.keys(current).length} chunks, ${total(current)} B (baseline ${total(baseline)} B)`
);
if (added.length) console.log(`  new chunks (not budgeted yet): ${added.join(", ")}`);
if (removed.length) console.log(`  chunks no longer emitted: ${removed.join(", ")}`);
if (failures.length) {
  console.error(
    `✗ ${failures.length} chunk(s) grew more than ${tolerance * 100}%:\n  ${failures.join("\n  ")}`
  );
  console.error(
    "  If the growth is intended, run `node scripts/check-bundle-budget.mjs --update` and commit."
  );
  process.exit(1);
}
console.log(`✓ check-bundle-budget: no chunk grew more than ${tolerance * 100}%`);
