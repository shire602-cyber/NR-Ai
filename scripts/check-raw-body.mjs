#!/usr/bin/env node
// R17-20 guard: fail on NEW places where a raw request body reaches storage
// or a query builder without passing a schema.
//
// Today's offenders live in scripts/guard-baselines/raw-body.json. New code
// must validate with strictBody(schema) (server/http/strict-body.ts). When you
// fix an offender, run `node scripts/check-raw-body.mjs --update` to ratchet
// the baseline down. Never raise it by hand.
//
// Usage: node scripts/check-raw-body.mjs [--root dir] [--baseline file] [--update] [--json]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard, walk } from "./guard-baselines/guard-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ROUTE_START = /\b(?:router|app|\w+Router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(/g;
const VALIDATED =
  /\b(?:strictBody|validate\w*|parsedBody|safeParse|\w+Schema\.parse|\w+Body\.parse|\.parse)\s*\(/;

/** The registration spans (`router.post(...` up to the next registration) of one file. */
function registrationSpans(content) {
  const spans = [];
  const re = new RegExp(ROUTE_START.source, "g");
  let r;
  let prev = null;
  while ((r = re.exec(content))) {
    if (prev) spans.push({ ...prev, end: r.index });
    prev = { start: r.index, method: r[1] };
  }
  if (prev) spans.push({ ...prev, end: content.length });
  return spans.map((s) => ({ method: s.method, text: content.slice(s.start, s.end) }));
}

// Handlers are split out of the route tables (server/routes/ai/*, firm/*), so the
// registration span of the route file is where validation is visible. Index every
// write registration once per scanned root, keyed by the identifiers it mentions.
const registrationIndex = new Map();
function writeRegistrations(root) {
  let index = registrationIndex.get(root);
  if (index) return index;
  const files = [];
  walk(join(root, "server"), files);
  index = [];
  for (const full of files) {
    const content = readFileSync(full, "utf8");
    if (!new RegExp(ROUTE_START.source).test(content)) continue;
    for (const span of registrationSpans(content)) {
      if (span.method === "get") continue;
      index.push({ text: span.text, validated: VALIDATED.test(span.text) });
    }
  }
  registrationIndex.set(root, index);
  return index;
}

/** The exported handler (or handler factory) that encloses `index` in a handler module. */
function enclosingExport(content, index) {
  const re = /\bexport\s+(?:async\s+)?(?:const|function)\s+(\w+)/g;
  let name = null;
  let r;
  while ((r = re.exec(content)) && r.index <= index) name = r[1];
  return name;
}

/**
 * True when the match sits in a write route (post/put/patch/delete) whose registration-to-next-route
 * span never validates the body (strictBody / validate / zod parse). Reads via GET are ignored.
 *
 * In a handler module (no registration before the match) it follows the exported handler
 * identifier to the route files that register it and applies the same test to that span.
 */
function unvalidatedWriteRoute(content, m, ctx) {
  let start = -1;
  let method = "";
  let next = content.length;
  const re = new RegExp(ROUTE_START.source, "g");
  let r;
  while ((r = re.exec(content))) {
    if (r.index <= m.index) {
      start = r.index;
      method = r[1];
    } else {
      next = r.index;
      break;
    }
  }
  if (start < 0) {
    const name = ctx && enclosingExport(content, m.index);
    if (!name) return false;
    const word = new RegExp(`\\b${name}\\b`);
    return writeRegistrations(ctx.root).some((reg) => word.test(reg.text) && !reg.validated);
  }
  if (method === "get") return false;
  return !VALIDATED.test(content.slice(start, next));
}

export const RAW_BODY_PATTERNS = [
  {
    id: "destructure-req-body",
    re: /\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*req\.body\b/g,
    accept: unvalidatedWriteRoute,
    hint: "destructuring req.body in a write route without strictBody/validate; validate first",
  },
  {
    id: "pick-req-body",
    re: /\breq\.body(?:\.\w+|\[)/g,
    accept: unvalidatedWriteRoute,
    hint: "reading properties off req.body in a write route without strictBody/validate",
  },
  {
    id: "spread-req-body",
    re: /\.\.\.\s*req\.body\b/g,
    hint: "spreading req.body copies unknown keys",
  },
  {
    id: "set-req-body",
    re: /\.set\(\s*req\.body\b/g,
    hint: "db.update().set(req.body) is mass assignment",
  },
  {
    id: "values-req-body",
    re: /\.values\(\s*req\.body\b/g,
    hint: "insert().values(req.body) is mass assignment",
  },
  {
    id: "storage-write-req-body",
    re: /storage\.(?:update|create|upsert)\w*\([^;()]*?\breq\.body\s*\)/g,
    hint: "pass a strictBody-parsed object, not req.body",
  },
  {
    id: "pick-allowed-no-schema",
    re: /pickAllowed\(\s*req\.body\s*(?:\)|,\s*(?:z\.any\(\)|\{))/g,
    hint: "pickAllowed needs a real zod object schema",
  },
  {
    id: "alias-req-body",
    re: /\b(?:const|let|var)\s+\w+(?:\s*:\s*[^=;]+)?\s*=\s*req\.body\s*(?:as\s+[^;]+)?;/g,
    hint: "aliasing req.body hides it from review; destructure or parse instead",
  },
];

const code = runGuard({
  name: "check-raw-body",
  argv: process.argv.slice(2),
  defaultRoot: root,
  defaultBaseline: join(root, "scripts", "guard-baselines", "raw-body.json"),
  description:
    "R17-20 ratchet: raw req.body reaching storage. Burn down to empty; regenerate with `node scripts/check-raw-body.mjs --update` only after removing offenders.",
  scanCfg: { dirs: ["server"], patterns: RAW_BODY_PATTERNS },
});
process.exit(code);
