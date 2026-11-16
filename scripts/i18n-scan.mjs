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
