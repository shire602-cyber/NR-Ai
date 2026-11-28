#!/usr/bin/env node
// Locale catalog guard: fails when any client/src/locales/**/*.json repeats a key within one
// object. JSON.parse keeps the last duplicate silently, so a copy edit to the first one is lost
// and the two entries drift apart (the bug the catalog dedupe in #248 removed).
//
//   node scripts/check-locale-duplicate-keys.mjs              # scan client/src/locales
//   node scripts/check-locale-duplicate-keys.mjs --root <dir> # scan <dir>/**/*.json (tests)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Finds repeated keys in one JSON document (any nesting depth). Returns
 * `[{ key, line, path }]`, one entry per extra occurrence. Throws on malformed JSON.
 */
export function findDuplicateKeys(source) {
  const raw = String(source);
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const duplicates = [];
  let i = 0;

  const lineAt = (index) => text.slice(0, index).split("\n").length;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const fail = (what) => {
    throw new Error(`Invalid JSON at line ${lineAt(i)}: ${what}`);
  };
  const readString = () => {
    const start = i;
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      i++;
    }
    if (i >= text.length) fail("unterminated string");
    i++; // closing quote
    return JSON.parse(text.slice(start, i));
  };
  const readValue = (path) => {
    skipSpace();
    const c = text[i];
    if (c === "{") {
      i++;
      const seen = new Set();
      skipSpace();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        skipSpace();
        if (text[i] !== '"') fail("expected a key");
        const keyStart = i;
        const key = readString();
        if (seen.has(key)) duplicates.push({ key, line: lineAt(keyStart), path });
        seen.add(key);
        skipSpace();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        readValue(path ? `${path}.${key}` : key);
        skipSpace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return;
        }
        fail("expected ',' or '}'");
      }
    } else if (c === "[") {
      i++;
      skipSpace();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        readValue(`${path}[${n}]`);
        skipSpace();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return;
        }
        fail("expected ',' or ']'");
      }
    } else if (c === '"') {
      readString();
    } else {
      const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) fail("unexpected token");
      i += m[0].length;
    }
  };

  readValue("");
  skipSpace();
  if (i < text.length) fail("unexpected trailing content");
  return duplicates;
}

function jsonFilesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsonFilesUnder(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Scans every .json file under `dir`; returns the files that repeat a key. */
export function scanLocaleDuplicates(dir) {
  const found = [];
  for (const file of jsonFilesUnder(dir)) {
    const dupes = findDuplicateKeys(readFileSync(file, "utf8"));
    if (dupes.length) found.push({ file, dupes });
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rootIdx = process.argv.indexOf("--root");
  const dir = rootIdx > -1 ? process.argv[rootIdx + 1] : join(repoRoot, "client", "src", "locales");
  let found;
  try {
    found = scanLocaleDuplicates(dir);
  } catch (err) {
    console.error(`✗ locale duplicate-key check could not read ${dir}: ${err.message}`);
    process.exit(1);
  }
  if (found.length) {
    console.error("✗ duplicate keys in locale catalogs (the last one silently wins):");
    for (const { file, dupes } of found) {
      for (const d of dupes) {
        console.error(`  ${relative(repoRoot, file)}:${d.line}  "${d.key}"`);
      }
    }
    process.exit(1);
  }
  console.log("✓ locale catalogs: no duplicate keys");
}
