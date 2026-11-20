#!/usr/bin/env node
// Runs the optional repository guard scripts that later workstreams add.
//
// Each guard is executed only when its file exists, so this runner can be
// wired into `npm run check` before every guard has landed. A guard that
// exists and exits non-zero fails the whole check.
//
// Usage: node scripts/run-guards.mjs

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const GUARDS = [
  "scripts/check-raw-body.mjs",
  "scripts/check-ledger-writes.mjs",
  "scripts/check-i18n-ratchet.mjs",
];

let failed = 0;
let ran = 0;
for (const rel of GUARDS) {
  const file = join(root, rel);
  if (!existsSync(file)) {
    console.log(`- guard ${rel}: not present yet, skipped`);
    continue;
  }
  ran++;
  const res = spawnSync(process.execPath, [file], { cwd: root, stdio: "inherit" });
  if (res.status !== 0) {
    failed++;
    console.error(`✗ guard ${rel} failed (exit ${res.status ?? res.signal})`);
  }
}

if (failed) {
  console.error(`✗ run-guards: ${failed} of ${ran} guard(s) failed`);
  process.exit(1);
}
console.log(`✓ run-guards: ${ran} guard(s) passed`);
