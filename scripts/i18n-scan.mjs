// Shared hard-coded-string scanner for scripts/check-i18n.mjs and
// scripts/check-i18n-ratchet.mjs.
//
// Heuristic, not a compiler: it counts JSX text nodes that are plain English
// phrases. Treat the number as a trend line, not an exact figure.
//
// A string that must stay English (brand name, code sample, legal entity) is
// justified with a `i18n-ignore: <reason>` comment on the same line or the line
// above; it is reported separately and does not count against the ratchet.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const pagesDir = join(repoRoot, "client", "src", "pages");
// S9: shared UI also counts. client/src/layouts does not exist today; it is scanned if added.
export const componentDirs = [
  join(repoRoot, "client", "src", "components"),
  join(repoRoot, "client", "src", "layouts"),
];

// JSX text node between tags that is an English phrase of 2+ words or a
// capitalised word of 4+ letters. Excludes bindings ({...}), entities, numbers.
const JSX_TEXT = />\s*([A-Z][A-Za-z][A-Za-z ,.'!?&-]{3,60})\s*</g;

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function scanComponents() {
  return scanDirs(componentDirs.filter((d) => existsSync(d)));
}

export function scanPages() {
  return scanDirs([pagesDir]);
}

function scanDirs(dirs) {
  const files = dirs.flatMap((d) => walk(d));
  let translated = 0;
  let hardcoded = 0;
  let justified = 0;
  const untranslatedPages = [];
  const perFile = {};

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    const hasT = /useTranslation|\bt\(|i18n|<T k=/.test(src);
    if (hasT) translated++;
    else untranslatedPages.push(f.replace(repoRoot + "/", ""));

    let fileCount = 0;
    for (const m of src.matchAll(JSX_TEXT)) {
      const text = m[1].trim();
      // skip single short capitalised tokens that are usually component/JSX noise
      if (/^[A-Z]{1,3}$/.test(text)) continue;
      const lineIndex = src.slice(0, m.index).split("\n").length - 1;
      const context = `${lines[lineIndex - 1] ?? ""}\n${lines[lineIndex] ?? ""}`;
      if (/i18n-ignore:/.test(context)) {
        justified++;
        continue;
      }
      hardcoded++;
      fileCount++;
    }
    if (fileCount > 0) perFile[f.replace(repoRoot + "/", "")] = fileCount;
  }

  return { pages: files.length, translated, hardcoded, justified, untranslatedPages, perFile };
}

// ─── client/src/lib and client/src/hooks (F7, R18-02) ────────────────────────
// Strings that live in data, hooks and libraries never appear as JSX text, so
// the scan above misses them (report catalog labels, toast copy, chart
// configs). This pass flags string literals assigned to user-visible
// properties (label, title, description, placeholder, message, ...) in
// client/src/lib/** and client/src/hooks/**. Move the copy into
// client/src/locales/{en,ar}/<namespace>.json and store the key instead, or
// justify it: `i18n-ignore: <reason>` on (or above) the line, or a file-level
// `i18n-ignore-file: <reason>` comment for files whose strings are not UI copy
// (export workbook cells, PDF content, the English source of a keyed overlay).
export const libHookDirs = [
  join(repoRoot, "client", "src", "lib"),
  join(repoRoot, "client", "src", "hooks"),
];
// The translation tables themselves.
const LIB_HOOK_EXEMPT = new Set(["client/src/lib/i18n.ts", "client/src/lib/i18n-extended.ts"]);
const VISIBLE_PROP =
  /\b(label|title|description|placeholder|message|heading|subtitle|helpText|emptyText|emptyState|cta|actionLabel|tooltip|ariaLabel|confirmLabel|cancelLabel|buttonLabel|hint|caption|toastTitle|toastDescription)\s*:\s*(["'`])((?:(?!\2)[^\n\\]|\\.)*)\2/g;

/** A literal that reads as English prose (not a key, code, id or token). */
export function isEnglishPhrase(value) {
  const text = value.replace(/\$\{[^}]*\}/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  // translation keys ("pages.foo"), ids ("owner-cash-suite"), codes ("extension_not_detected")
  if (/^[a-z0-9]+([._-][A-Za-z0-9]+)+$/.test(text)) return false;
  if (/^[a-z][A-Za-z0-9]*$/.test(text)) return false;
  // single ALL-CAPS token / acronym (VAT, PDF)
  if (/^[A-Z0-9_]+$/.test(text)) return false;
  return /^[A-Z]/.test(text) || /\s/.test(text);
}

function walkSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSources(p));
    else if (/\.tsx?$/.test(p) && !/\.d\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Scan one source text: `hardcoded` user-visible English literals, `justified` ones
 * (i18n-ignore on/above the line, or a file-level i18n-ignore-file), and the 0-based line
 * numbers of the hard-coded hits.
 */
export function scanLibHookSource(src) {
  const lines = src.split("\n");
  const fileIgnore = /i18n-ignore-file:\s*\S/.test(src);
  let hardcoded = 0;
  let justified = 0;
  const hits = [];
  for (const m of src.matchAll(VISIBLE_PROP)) {
    if (!isEnglishPhrase(m[3])) continue;
    const lineIndex = src.slice(0, m.index).split("\n").length - 1;
    const context = `${lines[lineIndex - 1] ?? ""}\n${lines[lineIndex] ?? ""}`;
    if (fileIgnore || /i18n-ignore:/.test(context)) {
      justified++;
      continue;
    }
    hardcoded++;
    hits.push(lineIndex);
  }
  return { hardcoded, justified, hits };
}

export function scanLibHooks() {
  const files = libHookDirs.filter((d) => existsSync(d)).flatMap((d) => walkSources(d));
  let hardcoded = 0;
  let justified = 0;
  const perFile = {};
  const ignoredFiles = {};
  const samples = [];
  for (const f of files) {
    const rel = f.replace(repoRoot + "/", "");
    if (LIB_HOOK_EXEMPT.has(rel)) continue;
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    const result = scanLibHookSource(src);
    hardcoded += result.hardcoded;
    justified += result.justified;
    if (result.hardcoded > 0) perFile[rel] = result.hardcoded;
    if (/i18n-ignore-file:\s*\S/.test(src) && result.justified > 0) {
      ignoredFiles[rel] = result.justified;
    }
    for (const line of result.hits) {
      if (samples.length < 50)
        samples.push(`${rel}:${line + 1}: ${lines[line].trim().slice(0, 100)}`);
    }
  }
  return { files: files.length, hardcoded, justified, perFile, ignoredFiles, samples };
}
