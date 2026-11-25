#!/usr/bin/env node
// i18n coverage baseline for client/src/pages.
//
// Reports (a) how many page components import useTranslation and (b) an
// approximate count of hardcoded user-visible strings in JSX. It is
// INFORMATIONAL by default (exit 0); the hard gate is the ratchet in
// scripts/check-i18n-ratchet.mjs, which fails when the count grows past
// scripts/guard-baselines/i18n.json.
//
//   node scripts/check-i18n.mjs --max-hardcoded 0   # fail if any remain
//   node scripts/check-i18n.mjs --require-translation # fail if a page lacks useTranslation
//   node scripts/check-i18n.mjs --by-file           # list the worst offenders
//
// Heuristic, not a compiler — see scripts/i18n-scan.mjs. Justify an intentional
// English string with an `i18n-ignore: <reason>` comment on or above its line.

import { scanPages } from "./i18n-scan.mjs";

const args = process.argv.slice(2);
const maxHardcoded = args.includes("--max-hardcoded")
  ? Number(args[args.indexOf("--max-hardcoded") + 1])
  : null;
const requireTranslation = args.includes("--require-translation");
const byFile = args.includes("--by-file");

const { pages, translated, hardcoded, justified, untranslatedPages, perFile } = scanPages();

console.log(`i18n baseline:`);
console.log(`  pages: ${pages}`);
console.log(`  importing translation: ${translated}/${pages}`);
console.log(`  approx hardcoded JSX strings: ~${hardcoded}`);
console.log(`  justified English strings (i18n-ignore): ${justified}`);
if (byFile) {
  const rows = Object.entries(perFile).sort((a, b) => b[1] - a[1]);
  console.log(
    `  by file:\n` + rows.map(([file, n]) => `    ${String(n).padStart(4)}  ${file}`).join("\n")
  );
}
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
