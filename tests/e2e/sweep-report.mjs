#!/usr/bin/env node
/**
 * Turns the broken-path sweep and core-flow artifacts into the Markdown tables of
 * docs/release/BROKEN-PATH-SWEEP.md:
 *
 *   node tests/e2e/sweep-report.mjs [sweep.json ...] > /tmp/tables.md
 *
 * Several sweep artifacts (one per run slice) can be passed; they are merged. Rows are one per
 * route pattern (ids replaced by :id) with the personas that loaded it and the en / ar result.
 * A route that failed in one run and passed in a later one (after the fix) reads "fixed".
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, ".artifacts");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ART, "broken-path-sweep-last-run.json")];

const norm = (route) =>
  route
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(
      /\/(view\/invoice|portal|portal\/einvoicing-approve)\/[A-Za-z0-9_-]{16,}/,
      "/$1/:token"
    );

const rows = new Map();
let clicks = 0;
for (const file of files) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  clicks += run.clicks?.total ?? 0;
  for (const p of run.pages) {
    const key = `${norm(p.route)}${p.viewport && p.viewport !== "desktop" ? ` (${p.viewport})` : ""}`;
    const row = rows.get(key) ?? { personas: new Set(), en: [], ar: [], problems: new Set() };
    row.personas.add(p.persona);
    row[p.lang]?.push(p.result);
    for (const pr of p.problems ?? []) row.problems.add(pr);
    rows.set(key, row);
  }
}

const verdict = (results) => {
  if (!results.length) return "–";
  if (results.every((r) => r === "pass")) return "pass";
  return results[results.length - 1] === "pass" ? "fixed" : "FAIL";
};

const lines = ["| Route | Persona(s) | en | ar | Result |", "|---|---|---|---|---|"];
for (const [route, row] of [...rows].sort((a, b) => a[0].localeCompare(b[0]))) {
  const en = verdict(row.en);
  const ar = verdict(row.ar);
  const result =
    en === "FAIL" || ar === "FAIL"
      ? `FAIL (${[...row.problems].join(", ")})`
      : en === "fixed" || ar === "fixed"
        ? `fixed (${[...row.problems].join(", ")})`
        : "pass";
  lines.push(`| \`${route}\` | ${[...row.personas].join(", ")} | ${en} | ${ar} | ${result} |`);
}
console.log(lines.join("\n"));
console.log(`\n${rows.size} routes/states, ${clicks} clicks.`);

const flowsFile = path.join(ART, "core-flows-last-run.json");
if (existsSync(flowsFile)) {
  const flows = JSON.parse(readFileSync(flowsFile, "utf8")).results;
  console.log("\n| Flow | Step | en | ar |\n|---|---|---|---|");
  const byStep = new Map();
  for (const r of flows) {
    for (const s of r.steps) {
      const k = `${r.id}\u0000${s.name}`;
      const e = byStep.get(k) ?? {};
      e[r.lang] = s.result;
      byStep.set(k, e);
    }
  }
  for (const [k, e] of byStep) {
    const [id, step] = k.split("\u0000");
    console.log(`| ${id} | ${step} | ${e.en ?? "–"} | ${e.ar ?? "–"} |`);
  }
}
