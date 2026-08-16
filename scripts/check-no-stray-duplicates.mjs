#!/usr/bin/env node
// Fails if cloud-sync conflict copies ("file 2.ts", "file 3.ts") are present.
//
// A synced Desktop/Drive folder silently creates these on concurrent writes.
// They are untracked, invisible in most editors, and land inside tsconfig's
// include globs — so `tsc` compiles them and the build dies with TS1127
// "Invalid character" on a file nobody knew existed.
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([".git", "dist", "coverage", "tmp", "brand", "uploads"]);
// Skip node_modules and any renamed/quarantined copy of it
// (e.g. node_modules.corrupt-sync-backup) — only source dirs matter.
const SKIP_PREFIX = ["node_modules"];
const bad = [];
(function walk(d) {
  let entries;
  try { entries = readdirSync(d); } catch { return; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    if (SKIP_PREFIX.some((p) => name.startsWith(p))) continue;
    const p = join(d, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p);
    else if (/ \d+\.(ts|tsx|js|mjs|json|sql)$/.test(name)) bad.push(p.replace(root + "/", ""));
  }
})(root);
if (bad.length) {
  console.error(`✗ ${bad.length} sync-conflict duplicate file(s) present — these break tsc:\n  ` + bad.join("\n  "));
  console.error("\n  Delete them. Consider moving the repo out of a cloud-synced folder.");
  process.exit(1);
}
console.log("✓ no sync-conflict duplicate files");
