#!/usr/bin/env node
// i18n coverage baseline for client/src/pages.
//
// Reports (a) how many page components import useTranslation and (b) an
// approximate count of hardcoded user-visible strings in JSX. It is
// INFORMATIONAL by default (exit 0) because the current surface is large; once
// the screen count is reduced it becomes a hard gate:
//
//   node scripts/check-i18n.mjs --max-hardcoded 0   # fail if any remain
//   node scripts/check-i18n.mjs --require-translation # fail if a page lacks useTranslation
//
// Heuristic, not a compiler — it counts JSX text nodes that are plain English
// words. Treat the number as a trend line, not an exact figure.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagesDir = join(root, "client", "src", "pages");

const args = process.argv.slice(2);
const maxHardcoded = args.includes("--max-hardcoded")
  ? Number(args[args.indexOf("--max-hardcoded") + 1])
  : null;
const requireTranslation = args.includes("--require-translation");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const files = walk(pagesDir);
let translated = 0;
let hardcoded = 0;
const untranslatedPages = [];

// JSX text node between tags that is an English phrase of 2+ words or a
// capitalised word of 4+ letters. Excludes bindings ({...}), entities, numbers.
const JSX_TEXT = />\s*([A-Z][A-Za-z][A-Za-z ,.'!?&-]{3,60})\s*</g;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const hasT = /useTranslation|\bt\(|i18n/.test(src);
  if (hasT) translated++;
  else untranslatedPages.push(f.replace(root + "/", ""));

  for (const m of src.matchAll(JSX_TEXT)) {
    const text = m[1].trim();
    // skip single short capitalised tokens that are usually component/JSX noise
    if (/^[A-Z]{1,3}$/.test(text)) continue;
    hardcoded++;
  }
}

console.log(`i18n baseline:`);
console.log(`  pages: ${files.length}`);
console.log(`  importing translation: ${translated}/${files.length}`);
console.log(`  approx hardcoded JSX strings: ~${hardcoded}`);
if (untranslatedPages.length && requireTranslation) {
  console.log(`  pages without translation:\n    ` + untranslatedPages.join("\n    "));
}

let failed = false;
if (requireTranslation && untranslatedPages.length) {
  console.error(`✗ ${untranslatedPages.length} page(s) do not import a translation helper`);
  failed = true;
}
if (maxHardcoded != null && hardcoded > maxHardcoded) {
  console.error(`✗ ${hardcoded} hardcoded JSX strings exceed the allowed ${maxHardcoded}`);
  failed = true;
}
process.exit(failed ? 1 : 0);
