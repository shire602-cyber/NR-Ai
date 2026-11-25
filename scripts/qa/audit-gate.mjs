#!/usr/bin/env node
// Production dependency audit gate (R17-27).
//
// Runs `npm audit --omit=dev --json` and fails on any critical/high advisory
// whose package is not listed as an accepted exception in
// docs/security/dependency-exceptions.md (table rows of the form
// "| `package` | severity | ... |"). An exception that no longer matches a
// live advisory is reported so the doc can be pruned.
//
// Usage: node scripts/qa/audit-gate.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const doc = readFileSync(join(root, "docs/security/dependency-exceptions.md"), "utf8");
const accepted = new Set(
  [...doc.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(critical|high)\s*\|/gim)].map((m) => m[1])
);

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // npm audit exits 1 when vulnerabilities exist; the JSON is still on stdout.
  raw = err.stdout;
  if (!raw) {
    console.error("audit-gate: npm audit failed to run:", err.message);
    process.exit(2);
  }
}

const report = JSON.parse(raw);
const vulns = Object.entries(report.vulnerabilities ?? {});
const blocking = [];
const excepted = [];
for (const [name, v] of vulns) {
  if (!["critical", "high"].includes(v.severity)) continue;
  (accepted.has(name) ? excepted : blocking).push(`${name} (${v.severity}, ${v.range})`);
}
const stale = [...accepted].filter(
  (name) => !vulns.some(([n, v]) => n === name && ["critical", "high"].includes(v.severity))
);

const meta = report.metadata?.vulnerabilities ?? {};
console.log(
  `audit-gate: prod advisories critical=${meta.critical ?? 0} high=${meta.high ?? 0} ` +
    `moderate=${meta.moderate ?? 0} low=${meta.low ?? 0}`
);
if (excepted.length) console.log(`  accepted exceptions: ${excepted.join(", ")}`);
if (stale.length)
  console.log(`  exceptions with no live advisory (prune the doc): ${stale.join(", ")}`);
if (blocking.length) {
  console.error(
    `✗ audit-gate: ${blocking.length} unaccepted critical/high advisories:\n  ${blocking.join("\n  ")}`
  );
  process.exit(1);
}
console.log("✓ audit-gate: no unaccepted critical/high production advisories");
