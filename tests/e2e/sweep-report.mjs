#!/usr/bin/env node
/**
 * Turns the broken-path sweep and core-flow artifacts into the Markdown tables of
 * docs/release/BROKEN-PATH-SWEEP.md:
 *
 *   node tests/e2e/sweep-report.mjs [--before first-run.json] final.json [delta.json ...]
 *
 * Rows come from the final run(s) (a later delta run overrides an earlier result for the same
 * route, persona, language and viewport), one per route pattern (ids replaced by :id) with the
 * personas that loaded it and the en / ar result. With --before, a route that failed in that
 * earlier run and passes now reads "fixed (<rules>)"; a failing path that no run reaches any more
 * (the link was removed) is listed as "fixed (no longer linked)".
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, ".artifacts");
const args = process.argv.slice(2);
const beforeAt = args.indexOf("--before");
const beforeFile = beforeAt >= 0 ? args.splice(beforeAt, 2)[1] : null;
const files = args.length ? args : [path.join(ART, "broken-path-sweep-last-run.json")];

const norm = (route) =>
  route
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(
      /\/(view\/invoice|portal\/einvoicing-approve|portal)\/[A-Za-z0-9_-]{16,}/,
      "/$1/:token"
    );
const keyOf = (p) =>
  `${norm(p.route)}${p.viewport && p.viewport !== "desktop" ? ` (${p.viewport})` : ""}`;

// Latest result per (route key, persona, lang).
const latest = new Map();
let clicks = 0;
for (const file of files) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  clicks += run.clicks?.total ?? 0;
  for (const p of run.pages) latest.set(`${keyOf(p)}|${p.persona}|${p.lang}`, p);
}
const before = new Map();
if (beforeFile) {
  for (const p of JSON.parse(readFileSync(beforeFile, "utf8")).pages) {
    if (p.result !== "pass") {
      const row = before.get(keyOf(p)) ?? new Set();
      for (const r of p.problems ?? []) row.add(r);
      before.set(keyOf(p), row);
    }
  }
}

const rows = new Map();
for (const p of latest.values()) {
  const key = keyOf(p);
  const row = rows.get(key) ?? { personas: new Set(), en: [], ar: [], problems: new Set() };
  row.personas.add(p.persona);
  row[p.lang]?.push(p.result);
  for (const pr of p.problems ?? []) row.problems.add(pr);
  rows.set(key, row);
}

const verdict = (results) =>
  !results.length ? "–" : results.every((r) => r === "pass") ? "pass" : "FAIL";

const lines = ["| Route | Persona(s) | en | ar | Result |", "|---|---|---|---|---|"];
let pass = 0;
let fixed = 0;
let failing = 0;
for (const [route, row] of [...rows].sort((a, b) => a[0].localeCompare(b[0]))) {
  const en = verdict(row.en);
  const ar = verdict(row.ar);
  let result;
  if (en === "FAIL" || ar === "FAIL") {
    result = `FAIL (${[...row.problems].join(", ")})`;
    failing += 1;
  } else if (before.has(route)) {
    result = `fixed (${[...before.get(route)].join(", ")})`;
    fixed += 1;
  } else {
    result = "pass";
    pass += 1;
  }
  lines.push(`| \`${route}\` | ${[...row.personas].join(", ")} | ${en} | ${ar} | ${result} |`);
}
for (const [route, problems] of before) {
  if (rows.has(route)) continue;
  lines.push(
    `| \`${route}\` | – | – | – | fixed (${[...problems].join(", ")}; no longer linked) |`
  );
  fixed += 1;
}
console.log(lines.join("\n"));
console.log(
  `\n${rows.size} routes/states checked in the final run(s): ${pass} pass, ${fixed} fixed, ${failing} failing; ${clicks} clicks.`
);

const flowsFile = path.join(ART, "core-flows-last-run.json");
if (existsSync(flowsFile)) {
  const flows = JSON.parse(readFileSync(flowsFile, "utf8")).results;
  console.log("\n| Flow | Step | en | ar |\n|---|---|---|---|");
  const byStep = new Map();
  for (const r of flows) {
    for (const s of r.steps) {
      const k = `${r.id}\u0000${s.name.replace(/ to (en|ar) and back/, " to the other language and back")}`;
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
