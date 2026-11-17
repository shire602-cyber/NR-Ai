// Stale-doc check (part of `npm run audit:campaign`): every relative markdown link and every
// backticked `docs/...`, `tests/...` or `server/...` file path in AGENTS.md and the live docs/*.md
// must resolve to an existing file. Archived docs (docs/archive) are historical and are not checked.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const docFiles = fs
  .readdirSync(path.join(root, "docs"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => `docs/${f}`);
const files = ["AGENTS.md", ...docFiles];
const problems = [];

for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, "utf8");
  const dir = path.dirname(abs);
  for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(dir, target))) problems.push(`${rel}: broken link ${target}`);
  }
  const pathRe =
    /`((?:docs|tests|server|client\/src|shared|scripts)\/[A-Za-z0-9_./-]+\.(?:md|ts|tsx|mjs|json))`/g;
  for (const m of text.matchAll(pathRe)) {
    if (m[1].includes("/.artifacts/")) continue; // generated at runtime
    if (!fs.existsSync(path.join(root, m[1]))) problems.push(`${rel}: missing path ${m[1]}`);
  }
}

if (problems.length) {
  console.error(`Stale documentation references (${problems.length}):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`check-stale-docs: ${files.length} files OK`);
