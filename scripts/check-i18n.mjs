#!/usr/bin/env node
// STRICT i18n gate (part of `npm run check`).
//
// Fails (exit 1) when a file under client/src/pages or client/src/components
// contains an English, user-visible string literal that does not go through the
// translation system (`tr("key")` from a per-page `*.i18n.ts` table, or the
// legacy central `t.key`). Detection lives in scripts/lib/i18n-scan.mjs.
//
// Escape hatch: put `// i18n-ignore: <reason>` on the line above (or the same
// line as) a literal that must stay English, e.g. a proper name or a protocol
// value. A marker without a reason is itself an error.
//
// Allow-list (scripts/i18n-allowlist.json):
//   reserved  files owned by an in-flight rewrite; skipped entirely. MUST BE
//             EMPTIED once that work has merged (then translate those files).
//   todo      files not translated yet, with the number of violations they
//             have today. It is a ratchet: the count may only go DOWN, and a
//             file that reaches zero must be removed from the list.
//
//   node scripts/check-i18n.mjs                     # the gate
//   node scripts/check-i18n.mjs --update-todo       # rewrite the todo counts (after translating)
//   node scripts/check-i18n.mjs --list <file>       # show the violations in one file

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./lib/i18n-scan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(root, "scripts", "i18n-allowlist.json");
const scanDirs = ["client/src/pages", "client/src/components"].map((d) => join(root, d));

const args = process.argv.slice(2);
const updateTodo = args.includes("--update-todo");
const listFile = args.includes("--list") ? args[args.indexOf("--list") + 1] : null;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const reserved = new Set(allowlist.reserved ?? []);
const todo = { ...(allowlist.todo ?? {}) };

const files = scanDirs.flatMap(walk).sort();
const failures = [];
const results = new Map();
let cleanCount = 0;
let legacyTernaries = 0;

for (const abs of files) {
  const rel = relative(root, abs);
  if (reserved.has(rel)) continue;
  const { items, legacy, badIgnores } = scanSource(readFileSync(abs, "utf8"), abs);
  legacyTernaries += legacy.length;
  results.set(rel, items);
  for (const line of badIgnores) failures.push(`${rel}:${line}  \`i18n-ignore\` needs a reason: // i18n-ignore: <why>`);
  if (listFile && (rel === listFile || rel.endsWith(`/${listFile}`))) {
    for (const it of items) console.log(`${rel}:${it.line}  ${it.context}  ${JSON.stringify(it.text)}`);
  }
}

if (listFile) process.exit(0);

if (updateTodo) {
  const next = {};
  for (const [rel, items] of results) if (items.length > 0) next[rel] = items.length;
  allowlist.todo = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(allowlistPath, `${JSON.stringify(allowlist, null, 2)}\n`);
  console.log(`i18n allow-list updated: ${Object.keys(next).length} file(s) still have untranslated strings.`);
  process.exit(0);
}

for (const [rel, items] of results) {
  const allowed = todo[rel];
  if (items.length === 0) {
    cleanCount += 1;
    if (allowed !== undefined) failures.push(`${rel} is fully translated: remove it from "todo" in scripts/i18n-allowlist.json`);
    continue;
  }
  if (allowed === undefined) {
    const sample = items.slice(0, 5).map((it) => `    ${rel}:${it.line}  ${JSON.stringify(it.text.slice(0, 70))}`);
    failures.push(
      `${rel} has ${items.length} untranslated user-visible string(s):\n${sample.join("\n")}${
        items.length > 5 ? `\n    ... and ${items.length - 5} more (node scripts/check-i18n.mjs --list ${rel})` : ""
      }`
    );
  } else if (items.length > allowed) {
    failures.push(`${rel} regressed: ${items.length} untranslated strings, allow-list permits ${allowed}`);
  }
}
for (const rel of Object.keys(todo)) if (!results.has(rel)) failures.push(`allow-list "todo" names a missing or reserved file: ${rel}`);
for (const rel of reserved) if (!files.some((f) => relative(root, f) === rel)) failures.push(`allow-list "reserved" names a missing file: ${rel}`);

const todoFiles = Object.keys(todo).filter((rel) => results.has(rel));
const todoStrings = todoFiles.reduce((n, rel) => n + (results.get(rel)?.length ?? 0), 0);
console.log("i18n gate:");
console.log(`  files scanned:            ${files.length} (pages + components)`);
console.log(`  fully translated:         ${cleanCount}`);
console.log(`  allow-listed (todo):      ${todoFiles.length} file(s), ${todoStrings} string(s) left`);
console.log(`  reserved (other work):    ${reserved.size} file(s)`);
console.log(`  legacy locale ternaries:  ${legacyTernaries} (bilingual but not the target pattern)`);

if (failures.length > 0) {
  console.error(`\ni18n check failed (${failures.length}):`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("i18n check passed.");
