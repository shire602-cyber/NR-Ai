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

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuard } from "./guard-baselines/guard-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const RAW_BODY_PATTERNS = [
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
