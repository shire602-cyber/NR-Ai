#!/usr/bin/env node
// Accessibility basics gate (part of `npm run check`).
//
// Static checks on client/src/pages and client/src/components:
//   1. <img> without an alt attribute (use alt="" for decoration).
//   2. A button whose only content is an icon, with no aria-label,
//      aria-labelledby or title: a screen reader announces just "button".
//
// Ratchet, like the i18n gate (scripts/a11y-allowlist.json): files with older
// violations are listed with their count. A count may only go DOWN, a file not
// on the list must have none, and a file that reaches zero must be removed.
//
//   node scripts/check-a11y-basics.mjs                # the gate
//   node scripts/check-a11y-basics.mjs --update       # rewrite the counts after fixing
//   node scripts/check-a11y-basics.mjs --list <file>  # show violations in one file
//
// Opt out on purpose with `{/* a11y-ignore: reason */}` on the line above.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(root, "scripts", "a11y-allowlist.json");
const scanDirs = ["client/src/pages", "client/src/components"].map((d) => join(root, d));
const args = process.argv.slice(2);
const update = args.includes("--update");
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

/** Text of the opening tag starting at `start` (a "<"), honouring {...} so "=>" inside attributes is not a tag end. Returns the index after the ">". */
function tagEnd(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return i + 1;
  }
  return -1;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;
const ignored = (src, index) => /a11y-ignore:\s*\S/.test(src.slice(src.lastIndexOf("\n", src.lastIndexOf("\n", index) - 1) + 1, index));

/** Does a JSX expression produce words? Translation calls and text-like identifiers do; icons and conditionals between icons do not. */
export function expressionNamesButton(expr) {
  const e = expr.trim();
  // Drop icons, fragments and the strings an equality test compares against; what is left must contain words.
  const stripped = e
    .replace(/<[A-Z][^>]*\/>/g, "")
    .replace(/<\/?>/g, "")
    .replace(/[=!]==?\s*(["'`])[^"'`]*\1/g, "");
  const conditional = stripped !== e || /[?&]/.test(stripped);
  if (!conditional) return !(/^[A-Za-z_$][\w$]*$/.test(e) && /icon|glyph|svg|symbol/i.test(e)); // {action.cta} names; {icon} does not
  return /\w+\(|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*|(["'`])[^"'`]*[A-Za-z\u0600-\u06ff][^"'`]*\1/.test(stripped); // {cond ? icon : t("x")} and {busy ? t.loading : t.save} name; {cond ? <X/> : <Y/>} does not
}

export function scanSource(src) {
  const found = [];

  for (const m of src.matchAll(/<img\b/g)) {
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    const tag = src.slice(m.index, end);
    if (!/\balt\s*=/.test(tag) && !/\{\.\.\./.test(tag) && !ignored(src, m.index)) {
      found.push({ line: lineOf(src, m.index), message: "<img> without alt" });
    }
  }

  for (const m of src.matchAll(/<(Button|button)\b/g)) {
    const openEnd = tagEnd(src, m.index);
    if (openEnd < 0) continue;
    const open = src.slice(m.index, openEnd);
    if (open.endsWith("/>")) continue;
    const close = src.indexOf(`</${m[1]}>`, openEnd);
    if (close < 0) continue;
    // Only an explicit label names the button. A spread ({...props}) may or may not carry one, so it counts as unnamed.
    if (/\baria-label(ledby)?\s*=|\btitle\s*=/.test(open)) continue;
    const inner = src.slice(openEnd, close);
    // Strip self-closing components (icons) and nested JSX; anything left that is text or an expression names the button.
    const withoutIcons = inner.replace(/<[A-Z][A-Za-z0-9.]*\b[^>]*?\/>/g, "");
    const hasIcon = withoutIcons.length !== inner.length;
    // Text names a button; so does an expression that yields text ({t("save")}, {label}, {children}). A bare
    // {expr} (an icon variable, a conditional between two icons) does not.
    const visible = withoutIcons.replace(/<span className="sr-only">[\s\S]*?<\/span>/g, "x");
    const hasName = /[\p{L}\p{N}]/u.test(visible.replace(/\{[^}]*\}/g, "")) || [...inner.replace(/<span className="sr-only">[\s\S]*?<\/span>/g, "{x}").matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}/g)].some((e) => expressionNamesButton(e[1]));
    const iconSized = /size="icon"/.test(open);
    if ((hasIcon && !hasName) || (iconSized && !hasName)) {
      if (!ignored(src, m.index)) found.push({ line: lineOf(src, m.index), message: "icon-only button without aria-label" });
    }
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const todo = { ...(allowlist.todo ?? {}) };
  const counts = new Map();
  for (const abs of scanDirs.flatMap(walk).sort()) {
    const rel = relative(root, abs);
    const found = scanSource(readFileSync(abs, "utf8"));
    if (listFile && rel.endsWith(listFile)) for (const f of found) console.log(`${rel}:${f.line}  ${f.message}`);
    if (found.length) counts.set(rel, found.length);
  }
  if (listFile) process.exit(0);

  if (update) {
    writeFileSync(allowlistPath, JSON.stringify({ _comment: allowlist._comment, todo: Object.fromEntries([...counts].sort()) }, null, 2) + "\n");
    console.log(`Updated ${allowlistPath}: ${counts.size} files, ${[...counts.values()].reduce((a, b) => a + b, 0)} violations.`);
    process.exit(0);
  }

  const failures = [];
  for (const [file, n] of counts) {
    const allowed = todo[file] ?? 0;
    if (n > allowed) failures.push(`${file}: ${n} accessibility problem(s), ${allowed} allowed. Fix them (run with --list ${file.split("/").pop()}).`);
  }
  const stale = Object.keys(todo).filter((f) => !counts.has(f));
  for (const file of stale) failures.push(`${file}: now clean. Remove it from scripts/a11y-allowlist.json (node scripts/check-a11y-basics.mjs --update).`);
  const lowered = [...counts].filter(([f, n]) => todo[f] !== undefined && n < todo[f]);
  for (const [file, n] of lowered) failures.push(`${file}: improved to ${n} (allowed ${todo[file]}). Lock it in with --update.`);

  if (failures.length) {
    console.error("Accessibility basics check failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`Accessibility basics check passed (${total} known problem(s) in ${counts.size} file(s) on the ratchet).`);
}
